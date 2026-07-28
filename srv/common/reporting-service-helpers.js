/**
 * SmartProcureX - Reporting Domain Service Helpers
 * --------------------------------------------------
 * Responsibility:
 *   Encapsulate all cross-domain aggregation query logic for the
 *   Reporting module so srv/handlers/reporting-handler.js stays
 *   focused on request orchestration and parameter validation.
 *
 * Design:
 *   - Every helper follows the (tx, entities, filters?) convention
 *     from AD-11. The `_tx` argument is kept for signature parity even
 *     though reporting never modifies state via the service tx.
 *   - All database reads route through `dbRun` (the shared cds.db
 *     facade in db-run.js). ReportingService does not project any
 *     transactional entities; a plain tx.run(SELECT.from(ProcEntity))
 *     from a ReportingService handler would fail with "Target cannot
 *     be resolved for service ReportingService". The shared cds.db
 *     facade resolves canonical entities from any namespace regardless
 *     of the calling service's projected entity set (same reasoning as
 *     warehouse-service-helpers.js header and AD-11).
 *   - Aggregation is performed in JavaScript using groupBy() /
 *     sumAmounts() / toMonetary() / toQuantity() from the existing
 *     utility libraries (AD-8). This keeps queries simple, portable
 *     across SQLite and HANA, and leverages already-tested helpers.
 *   - For monetary totals (Decimal(15,2)) sumAmounts() + toMonetary()
 *     is used. For inventory quantities (Decimal(13,3)) plain Number
 *     arithmetic + toQuantity() is used to preserve the 3-decimal
 *     scale beyond sumAmounts' monetary capping.
 *   - Date-range comparisons use ISO-string lexicographic ordering.
 *     For DateTime fields the date portion is extracted via
 *     substring(0, 10) before comparing with a Date filter parameter.
 *   - All helpers are read-only. No INSERT / UPDATE / DELETE is ever
 *     issued by this module (AD-24).
 */

import cds from '@sap/cds';
import { dbRun } from './db-run.js';
import { sumAmounts, toMonetary, toQuantity } from './calculator.js';
import { groupBy } from './utils.js';

const { SELECT } = cds.ql;

// ---------------------------------------------------------------------------
// Internal utility - extract YYYY-MM-DD from a Date or DateTime string
// ---------------------------------------------------------------------------

/**
 * Extract the ISO date portion (YYYY-MM-DD) from a Date or DateTime value.
 * Returns null when the value is falsy.
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function toDateString(value) {
    if (!value) return null;
    return String(value).substring(0, 10);
}

/**
 * Return true when `value` passes the optional [fromDate, toDate] range
 * check. Either bound may be null (omitted = unbounded on that side).
 *
 * @param {string} value    ISO date or datetime string from the DB row
 * @param {string|null} fromDate  Lower bound (YYYY-MM-DD)
 * @param {string|null} toDate    Upper bound (YYYY-MM-DD)
 * @returns {boolean}
 */
function inDateRange(value, fromDate, toDate) {
    const d = toDateString(value);
    if (!d) return true; // null date passes all filters (data quality issue - include row)
    if (fromDate && d < fromDate) return false;
    if (toDate   && d > toDate)   return false;
    return true;
}

// ===========================================================================
// Dashboard
// ===========================================================================

/**
 * Compute top-level KPIs across all SmartProcureX domains.
 *
 * @param {object} _tx       CAP transaction (unused - kept for AD-11 parity)
 * @param {object} entities  Domain entity map built by the handler
 * @returns {Promise<object>} Shape matching DashboardSummary CDS type
 */
export async function fetchDashboardSummary(_tx, entities) {
    const { PurchaseRequest, PurchaseOrder, Approval } = entities.procurement;
    const { InventoryItem }                            = entities.warehouse;
    const { Asset }                                    = entities.asset;
    const { Notification }                             = entities.platform;

    // Fetch minimal columns per entity (no SELECT * to minimize data transfer)
    const prRows  = await dbRun(SELECT.from(PurchaseRequest).columns('status'));
    const poRows  = await dbRun(SELECT.from(PurchaseOrder).columns('status'));

    const pendingRow = await dbRun(
        SELECT.one.from(Approval).columns('count(*) as count')
            .where({ decision: 'Pending' })
    );

    const invRows = await dbRun(
        SELECT.from(InventoryItem).columns('quantityOnHand', 'minimumStock', 'status')
    );

    const assetRows = await dbRun(SELECT.from(Asset).columns('assetStatus'));

    const unreadRow = await dbRun(
        SELECT.one.from(Notification).columns('count(*) as count')
            .where({ isRead: false, isDeleted: false })
    );

    // ---- Procurement aggregations ----
    const OPEN_PR_STATUSES = new Set(['Draft', 'Submitted', 'Approved']);
    const OPEN_PO_STATUSES = new Set(['Created', 'Sent', 'PartiallyReceived', 'Received']);

    const totalPRs  = (prRows ?? []).length;
    const openPRs   = (prRows ?? []).filter(r => OPEN_PR_STATUSES.has(r.status)).length;
    const totalPOs  = (poRows ?? []).length;
    const openPOs   = (poRows ?? []).filter(r => OPEN_PO_STATUSES.has(r.status)).length;
    const pending   = Number(pendingRow?.count ?? 0);

    // ---- Inventory aggregations ----
    const activeInv    = (invRows ?? []).filter(i => i.status === 'ACTIVE');
    const lowStockCount = activeInv.filter(i => {
        const min = Number(i.minimumStock ?? 0);
        return min > 0 && Number(i.quantityOnHand ?? 0) <= min;
    }).length;

    // ---- Asset aggregations ----
    const totalAssets    = (assetRows ?? []).length;
    const assignedAssets = (assetRows ?? []).filter(r => r.assetStatus === 'Assigned').length;

    return {
        totalPurchaseRequests: totalPRs,
        openPurchaseRequests:  openPRs,
        totalPurchaseOrders:   totalPOs,
        openPurchaseOrders:    openPOs,
        pendingApprovals:      pending,
        totalInventoryItems:   activeInv.length,
        lowStockItems:         lowStockCount,
        totalAssets,
        assignedAssets,
        unreadNotifications:   Number(unreadRow?.count ?? 0)
    };
}

// ===========================================================================
// Purchase Request Reports
// ===========================================================================

/**
 * Count and total spend of Purchase Requests grouped by status.
 *
 * @param {object} _tx
 * @param {object} entities
 * @param {object} filters  { fromDate, toDate, departmentID, status }
 * @returns {Promise<Array<{status,count,totalAmount}>>}
 */
export async function fetchPurchaseRequestSummary(_tx, entities, filters = {}) {
    const { PurchaseRequest } = entities.procurement;
    const { fromDate, toDate, departmentID, status } = filters;

    const rows = await dbRun(
        SELECT.from(PurchaseRequest)
            .columns('status', 'totalAmount', 'requestDate', 'department_ID')
    );

    const filtered = (rows ?? []).filter(r => {
        if (!inDateRange(r.requestDate, fromDate, toDate)) return false;
        if (departmentID && r.department_ID !== departmentID)  return false;
        if (status && r.status !== status)                      return false;
        return true;
    });

    const grouped = groupBy(filtered, r => r.status);
    const result  = [];

    for (const [st, items] of grouped) {
        result.push({
            status:      st,
            count:       items.length,
            totalAmount: toMonetary(sumAmounts(items.map(i => i.totalAmount ?? 0)))
        });
    }

    return result.sort((a, b) => a.status.localeCompare(b.status));
}

/**
 * Total spend on Purchase Requests grouped by department.
 * Approved spend counts rows in Approved or ConvertedToPO status.
 *
 * @param {object} _tx
 * @param {object} entities
 * @param {object} filters  { fromDate, toDate }
 * @returns {Promise<Array<DepartmentSpend>>}
 */
export async function fetchDepartmentSpendAnalysis(_tx, entities, filters = {}) {
    const { PurchaseRequest } = entities.procurement;
    const { Department }      = entities.identity;
    const { fromDate, toDate } = filters;

    const [rows, depts] = await Promise.all([
        dbRun(SELECT.from(PurchaseRequest).columns('department_ID', 'totalAmount', 'status', 'requestDate')),
        dbRun(SELECT.from(Department).columns('ID', 'departmentName'))
    ]);

    const deptMap = new Map((depts ?? []).map(d => [d.ID, d.departmentName]));

    const APPROVED_STATUSES = new Set(['Approved', 'ConvertedToPO']);

    const filtered = (rows ?? []).filter(r => inDateRange(r.requestDate, fromDate, toDate));

    const grouped = groupBy(filtered, r => r.department_ID ?? '__unassigned__');
    const result  = [];

    for (const [deptID, items] of grouped) {
        const approvedItems = items.filter(i => APPROVED_STATUSES.has(i.status));
        result.push({
            departmentID:   deptID === '__unassigned__' ? null : deptID,
            departmentName: deptID === '__unassigned__'
                ? 'Unassigned'
                : (deptMap.get(deptID) ?? 'Unknown'),
            requestCount:   items.length,
            totalAmount:    toMonetary(sumAmounts(items.map(i => i.totalAmount ?? 0))),
            approvedAmount: toMonetary(sumAmounts(approvedItems.map(i => i.totalAmount ?? 0)))
        });
    }

    return result.sort((a, b) => b.totalAmount - a.totalAmount);
}

// ===========================================================================
// Approval Reports
// ===========================================================================

/**
 * Approval decision breakdown with counts and percentage of total decisions.
 *
 * @param {object} _tx
 * @param {object} entities
 * @param {object} filters  { fromDate, toDate }
 * @returns {Promise<Array<ApprovalStat>>}
 */
export async function fetchApprovalPerformance(_tx, entities, filters = {}) {
    const { Approval } = entities.procurement;
    const { fromDate, toDate } = filters;

    const rows = await dbRun(
        SELECT.from(Approval).columns('decision', 'approvalDate')
    );

    const filtered = (rows ?? []).filter(r => inDateRange(r.approvalDate, fromDate, toDate));

    if (filtered.length === 0) return [];

    const grouped  = groupBy(filtered, r => r.decision ?? 'Unknown');
    const total    = filtered.length;
    const result   = [];

    for (const [decision, items] of grouped) {
        result.push({
            decision,
            count:            items.length,
            percentageOfTotal: toMonetary((items.length / total) * 100)
        });
    }

    return result.sort((a, b) => b.count - a.count);
}

// ===========================================================================
// Purchase Order Reports
// ===========================================================================

/**
 * Count and total value of Purchase Orders grouped by status.
 *
 * @param {object} _tx
 * @param {object} entities
 * @param {object} filters  { fromDate, toDate, status }
 * @returns {Promise<Array<PurchaseOrderStat>>}
 */
export async function fetchPurchaseOrderSummary(_tx, entities, filters = {}) {
    const { PurchaseOrder } = entities.procurement;
    const { fromDate, toDate, status } = filters;

    const rows = await dbRun(
        SELECT.from(PurchaseOrder).columns('status', 'totalAmount', 'orderDate')
    );

    const filtered = (rows ?? []).filter(r => {
        if (!inDateRange(r.orderDate, fromDate, toDate)) return false;
        if (status && r.status !== status)               return false;
        return true;
    });

    const grouped = groupBy(filtered, r => r.status);
    const result  = [];

    for (const [st, items] of grouped) {
        result.push({
            status:      st,
            count:       items.length,
            totalAmount: toMonetary(sumAmounts(items.map(i => i.totalAmount ?? 0)))
        });
    }

    return result.sort((a, b) => a.status.localeCompare(b.status));
}

/**
 * Total spend grouped by supplier across all Purchase Orders.
 *
 * @param {object} _tx
 * @param {object} entities
 * @param {object} filters  { fromDate, toDate }
 * @returns {Promise<Array<SupplierSpend>>}
 */
export async function fetchSupplierSpendAnalysis(_tx, entities, filters = {}) {
    const { PurchaseOrder } = entities.procurement;
    const { Supplier }      = entities.supplier;
    const { fromDate, toDate } = filters;

    const [orders, suppliers] = await Promise.all([
        dbRun(SELECT.from(PurchaseOrder).columns('supplier_ID', 'totalAmount', 'orderDate')),
        dbRun(SELECT.from(Supplier).columns('ID', 'supplierName'))
    ]);

    const supplierMap = new Map((suppliers ?? []).map(s => [s.ID, s.supplierName]));

    const filtered = (orders ?? []).filter(r => inDateRange(r.orderDate, fromDate, toDate));
    const grouped  = groupBy(filtered, r => r.supplier_ID ?? '__none__');
    const result   = [];

    for (const [suppID, items] of grouped) {
        const totalAmount     = toMonetary(sumAmounts(items.map(i => i.totalAmount ?? 0)));
        const orderCount      = items.length;
        const averageOrderValue = orderCount > 0
            ? toMonetary(totalAmount / orderCount)
            : 0;

        result.push({
            supplierID:   suppID === '__none__' ? null : suppID,
            supplierName: suppID === '__none__'
                ? 'No Supplier'
                : (supplierMap.get(suppID) ?? 'Unknown'),
            orderCount,
            totalAmount,
            averageOrderValue
        });
    }

    return result.sort((a, b) => b.totalAmount - a.totalAmount);
}

// ===========================================================================
// Goods Receipt Reports
// ===========================================================================

/**
 * Count of Goods Receipts grouped by status and warehouse.
 *
 * @param {object} _tx
 * @param {object} entities
 * @param {object} filters  { fromDate, toDate, warehouseID }
 * @returns {Promise<Array<GoodsReceiptStat>>}
 */
export async function fetchGoodsReceiptSummary(_tx, entities, filters = {}) {
    const { GoodsReceipt } = entities.warehouse;
    const { Warehouse }    = entities.warehouse;
    const { fromDate, toDate, warehouseID } = filters;

    const [receipts, warehouses] = await Promise.all([
        dbRun(SELECT.from(GoodsReceipt).columns('status', 'warehouse_ID', 'receivedDate')),
        dbRun(SELECT.from(Warehouse).columns('ID', 'warehouseName'))
    ]);

    const warehouseMap = new Map((warehouses ?? []).map(w => [w.ID, w.warehouseName]));

    const filtered = (receipts ?? []).filter(r => {
        if (!inDateRange(r.receivedDate, fromDate, toDate)) return false;
        if (warehouseID && r.warehouse_ID !== warehouseID)  return false;
        return true;
    });

    // Group by composite key: warehouseID + status
    const grouped = groupBy(filtered, r => `${r.warehouse_ID ?? '__none__'}::${r.status}`);
    const result  = [];

    for (const [key, items] of grouped) {
        const [wID] = key.split('::');
        const first = items[0];
        result.push({
            warehouseID:   wID === '__none__' ? null : wID,
            warehouseName: wID === '__none__'
                ? 'No Warehouse'
                : (warehouseMap.get(wID) ?? 'Unknown'),
            status: first.status,
            count:  items.length
        });
    }

    return result.sort((a, b) =>
        (a.warehouseName ?? '').localeCompare(b.warehouseName ?? '') ||
        (a.status ?? '').localeCompare(b.status ?? '')
    );
}

// ===========================================================================
// Inventory Reports
// ===========================================================================

/**
 * Current stock balance summary per warehouse.
 *
 * @param {object} _tx
 * @param {object} entities
 * @param {object} filters  { warehouseID }
 * @returns {Promise<Array<WarehouseInventoryStat>>}
 */
export async function fetchWarehouseInventorySummary(_tx, entities, filters = {}) {
    const { InventoryItem } = entities.warehouse;
    const { Warehouse }     = entities.warehouse;
    const { warehouseID } = filters;

    const [items, warehouses] = await Promise.all([
        dbRun(SELECT.from(InventoryItem)
            .columns('warehouse_ID', 'quantityOnHand', 'quantityReserved', 'quantityDamaged', 'status')),
        dbRun(SELECT.from(Warehouse).columns('ID', 'warehouseName'))
    ]);

    const warehouseMap = new Map((warehouses ?? []).map(w => [w.ID, w.warehouseName]));

    const filtered = (items ?? []).filter(i => {
        if (i.status !== 'ACTIVE') return false;
        if (warehouseID && i.warehouse_ID !== warehouseID) return false;
        return true;
    });

    const grouped = groupBy(filtered, i => i.warehouse_ID ?? '__none__');
    const result  = [];

    for (const [wID, rows] of grouped) {
        // Use plain arithmetic + toQuantity for Decimal(13,3) columns
        const totalOnHand   = toQuantity(rows.reduce((acc, r) => acc + Number(r.quantityOnHand   ?? 0), 0));
        const totalReserved = toQuantity(rows.reduce((acc, r) => acc + Number(r.quantityReserved ?? 0), 0));
        const totalDamaged  = toQuantity(rows.reduce((acc, r) => acc + Number(r.quantityDamaged  ?? 0), 0));

        result.push({
            warehouseID:   wID === '__none__' ? null : wID,
            warehouseName: wID === '__none__'
                ? 'No Warehouse'
                : (warehouseMap.get(wID) ?? 'Unknown'),
            totalItems: rows.length,
            totalOnHand,
            totalReserved,
            totalDamaged
        });
    }

    return result.sort((a, b) => (a.warehouseName ?? '').localeCompare(b.warehouseName ?? ''));
}

/**
 * Inventory transaction ledger aggregated by transaction type.
 *
 * @param {object} _tx
 * @param {object} entities
 * @param {object} filters  { fromDate, toDate, warehouseID, transactionType }
 * @returns {Promise<Array<InventoryMovementStat>>}
 */
export async function fetchInventoryMovementReport(_tx, entities, filters = {}) {
    const { InventoryTransaction } = entities.warehouse;
    const { fromDate, toDate, warehouseID, transactionType } = filters;

    const rows = await dbRun(
        SELECT.from(InventoryTransaction)
            .columns('transactionType', 'quantity', 'transactionDate', 'warehouse_ID')
    );

    const filtered = (rows ?? []).filter(r => {
        if (!inDateRange(r.transactionDate, fromDate, toDate)) return false;
        if (warehouseID     && r.warehouse_ID   !== warehouseID)     return false;
        if (transactionType && r.transactionType !== transactionType) return false;
        return true;
    });

    const grouped = groupBy(filtered, r => r.transactionType ?? 'Unknown');
    const result  = [];

    for (const [txType, items] of grouped) {
        const totalQuantity = toQuantity(
            items.reduce((acc, r) => acc + Number(r.quantity ?? 0), 0)
        );
        result.push({
            transactionType: txType,
            count:           items.length,
            totalQuantity
        });
    }

    return result.sort((a, b) => a.transactionType.localeCompare(b.transactionType));
}

// ===========================================================================
// Asset Reports
// ===========================================================================

/**
 * Asset count grouped by status with percentage of total fleet.
 *
 * @param {object} _tx
 * @param {object} entities
 * @returns {Promise<Array<AssetUtilizationStat>>}
 */
export async function fetchAssetUtilizationReport(_tx, entities) {
    const { Asset } = entities.asset;

    const rows = await dbRun(SELECT.from(Asset).columns('assetStatus'));

    const total   = (rows ?? []).length;
    const grouped = groupBy(rows ?? [], r => r.assetStatus ?? 'Unknown');
    const result  = [];

    for (const [status, items] of grouped) {
        result.push({
            status,
            count:            items.length,
            percentageOfTotal: total > 0
                ? toMonetary((items.length / total) * 100)
                : 0
        });
    }

    return result.sort((a, b) => b.count - a.count);
}

/**
 * Asset count broken down by lifecycle status per asset category.
 *
 * @param {object} _tx
 * @param {object} entities
 * @param {object} filters  { categoryID }
 * @returns {Promise<Array<AssetLifecycleStat>>}
 */
export async function fetchAssetLifecycleReport(_tx, entities, filters = {}) {
    const { Asset, AssetCategory } = entities.asset;
    const { categoryID } = filters;

    const [assets, categories] = await Promise.all([
        dbRun(SELECT.from(Asset).columns('assetStatus', 'assetCategory_ID')),
        dbRun(SELECT.from(AssetCategory).columns('ID', 'categoryName'))
    ]);

    const categoryMap = new Map((categories ?? []).map(c => [c.ID, c.categoryName]));

    const filtered = (assets ?? []).filter(a => {
        if (categoryID && a.assetCategory_ID !== categoryID) return false;
        return true;
    });

    const grouped = groupBy(filtered, a => a.assetCategory_ID ?? '__none__');
    const result  = [];

    for (const [catID, items] of grouped) {
        const countByStatus = (st) => items.filter(i => i.assetStatus === st).length;
        result.push({
            categoryID:   catID === '__none__' ? null : catID,
            categoryName: catID === '__none__'
                ? 'Uncategorized'
                : (categoryMap.get(catID) ?? 'Unknown'),
            totalAssets: items.length,
            available:   countByStatus('Available'),
            assigned:    countByStatus('Assigned'),
            maintenance: countByStatus('Maintenance'),
            retired:     countByStatus('Retired'),
            disposed:    countByStatus('Disposed')
        });
    }

    return result.sort((a, b) => (a.categoryName ?? '').localeCompare(b.categoryName ?? ''));
}

// ===========================================================================
// Notification Statistics
// ===========================================================================

/**
 * Notification counts grouped by category with read/unread breakdown.
 * Only non-deleted notifications are included.
 *
 * @param {object} _tx
 * @param {object} entities
 * @param {object} filters  { fromDate, toDate }
 * @returns {Promise<Array<NotificationStat>>}
 */
export async function fetchNotificationStatistics(_tx, entities, filters = {}) {
    const { Notification } = entities.platform;
    const { fromDate, toDate } = filters;

    const rows = await dbRun(
        SELECT.from(Notification)
            .columns('category', 'isRead', 'isDeleted', 'createdAt')
            .where({ isDeleted: false })
    );

    const filtered = (rows ?? []).filter(r => inDateRange(r.createdAt, fromDate, toDate));

    const grouped = groupBy(filtered, r => r.category ?? 'General');
    const result  = [];

    for (const [category, items] of grouped) {
        const total  = items.length;
        const read   = items.filter(i => i.isRead === true || i.isRead === 1).length;
        const unread = total - read;
        result.push({
            category,
            total,
            read,
            unread,
            readRate: total > 0 ? toMonetary((read / total) * 100) : 0
        });
    }

    return result.sort((a, b) => b.total - a.total);
}

// ===========================================================================
// Audit Summary
// ===========================================================================

/**
 * AuditLog entries grouped by entity name and operation type.
 *
 * @param {object} _tx
 * @param {object} entities
 * @param {object} filters  { fromDate, toDate, entityName }
 * @returns {Promise<Array<AuditStat>>}
 */
export async function fetchAuditSummary(_tx, entities, filters = {}) {
    const { AuditLog } = entities.platform;
    const { fromDate, toDate, entityName } = filters;

    const rows = await dbRun(
        SELECT.from(AuditLog).columns('entityName', 'operation', 'performedOn')
    );

    const filtered = (rows ?? []).filter(r => {
        if (!inDateRange(r.performedOn, fromDate, toDate)) return false;
        if (entityName && r.entityName !== entityName)     return false;
        return true;
    });

    // Group by composite key: entityName + operation
    const grouped = groupBy(filtered, r => `${r.entityName ?? 'Unknown'}::${r.operation ?? 'Unknown'}`);
    const result  = [];

    for (const [key, items] of grouped) {
        const [en, op] = key.split('::');
        result.push({
            entityName: en,
            operation:  op,
            count:      items.length
        });
    }

    return result.sort((a, b) =>
        (a.entityName ?? '').localeCompare(b.entityName ?? '') ||
        (a.operation  ?? '').localeCompare(b.operation  ?? '')
    );
}
