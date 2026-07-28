/**
 * SmartProcureX - ReportingService Handler
 * --------------------------------------------------
 * Responsibility:
 *   Implement all ReportingService unbound functions. Each handler
 *   validates optional parameters, resolves cross-domain entity
 *   references, and delegates aggregation work to helpers in
 *   srv/common/reporting-service-helpers.js.
 *
 * Design:
 *   - ReportingService projects no transactional entities so
 *     `this.entities` is empty. All entity references are resolved
 *     via `resolveEntities()` which calls cds.entities(namespace)
 *     lazily inside each request handler (after cds.serve is done).
 *   - Parameter extraction from req.data follows the same pattern
 *     used by all other handlers; CAP populates omitted optional
 *     function parameters as null in req.data.
 *   - UUID parameters are validated with isUuid() if provided.
 *     Invalid UUIDs are rejected before any DB query is issued.
 *   - Date and string parameters are accepted as-is; the helper
 *     applies safe lexicographic date comparisons.
 *   - All operations are read-only. No INSERT / UPDATE / DELETE
 *     is ever issued by this handler (AD-24).
 *   - Handler registration follows the same `this.on(event, ...)` 
 *     pattern used by procurement-handler / warehouse-handler /
 *     asset-handler / notification-handler.
 */

import cds from '@sap/cds';
import { isUuid } from '../common/validation.js';
import { rejectValidation } from '../common/errors.js';
import {
    fetchDashboardSummary,
    fetchPurchaseRequestSummary,
    fetchDepartmentSpendAnalysis,
    fetchApprovalPerformance,
    fetchPurchaseOrderSummary,
    fetchSupplierSpendAnalysis,
    fetchGoodsReceiptSummary,
    fetchWarehouseInventorySummary,
    fetchInventoryMovementReport,
    fetchAssetUtilizationReport,
    fetchAssetLifecycleReport,
    fetchNotificationStatistics,
    fetchAuditSummary
} from '../common/reporting-service-helpers.js';

// ---------------------------------------------------------------------------
// Cross-domain entity resolver
// ---------------------------------------------------------------------------
// ReportingService does not project any transactional entities so `this.entities`
// is empty. We resolve canonical entity references from each domain namespace
// directly via cds.entities(). This is safe to call inside any request handler
// because the CDS model is fully compiled by the time cds.serve() completes.
// The lazy function is defined at module scope so all handler closures share it.
// ---------------------------------------------------------------------------

function resolveEntities() {
    return {
        procurement : cds.entities('smartprocurex.procurement'),
        warehouse   : cds.entities('smartprocurex.warehouse'),
        asset       : cds.entities('smartprocurex.asset'),
        platform    : cds.entities('smartprocurex.platform'),
        identity    : cds.entities('smartprocurex.identity'),
        supplier    : cds.entities('smartprocurex.supplier')
    };
}

// ---------------------------------------------------------------------------
// Handler implementation
// ---------------------------------------------------------------------------

export default cds.service.impl(function () {

    // ========================================================================
    // Dashboard
    // ========================================================================

    this.on('getDashboardSummary', async (req) => {
        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchDashboardSummary(tx, entities);
    });

    // ========================================================================
    // Purchase Request Reports
    // ========================================================================

    this.on('getPurchaseRequestSummary', async (req) => {
        const { fromDate, toDate, departmentID, status } = req.data;

        if (departmentID != null && !isUuid(departmentID)) {
            return rejectValidation(req, 'departmentID must be a valid UUID.', 'departmentID');
        }

        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchPurchaseRequestSummary(tx, entities, { fromDate, toDate, departmentID, status });
    });

    this.on('getDepartmentSpendAnalysis', async (req) => {
        const { fromDate, toDate } = req.data;

        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchDepartmentSpendAnalysis(tx, entities, { fromDate, toDate });
    });

    // ========================================================================
    // Approval Reports
    // ========================================================================

    this.on('getApprovalPerformance', async (req) => {
        const { fromDate, toDate } = req.data;

        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchApprovalPerformance(tx, entities, { fromDate, toDate });
    });

    // ========================================================================
    // Purchase Order Reports
    // ========================================================================

    this.on('getPurchaseOrderSummary', async (req) => {
        const { fromDate, toDate, status } = req.data;

        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchPurchaseOrderSummary(tx, entities, { fromDate, toDate, status });
    });

    this.on('getSupplierSpendAnalysis', async (req) => {
        const { fromDate, toDate } = req.data;

        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchSupplierSpendAnalysis(tx, entities, { fromDate, toDate });
    });

    // ========================================================================
    // Goods Receipt Reports
    // ========================================================================

    this.on('getGoodsReceiptSummary', async (req) => {
        const { fromDate, toDate, warehouseID } = req.data;

        if (warehouseID != null && !isUuid(warehouseID)) {
            return rejectValidation(req, 'warehouseID must be a valid UUID.', 'warehouseID');
        }

        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchGoodsReceiptSummary(tx, entities, { fromDate, toDate, warehouseID });
    });

    // ========================================================================
    // Inventory Reports
    // ========================================================================

    this.on('getWarehouseInventorySummary', async (req) => {
        const { warehouseID } = req.data;

        if (warehouseID != null && !isUuid(warehouseID)) {
            return rejectValidation(req, 'warehouseID must be a valid UUID.', 'warehouseID');
        }

        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchWarehouseInventorySummary(tx, entities, { warehouseID });
    });

    this.on('getInventoryMovementReport', async (req) => {
        const { fromDate, toDate, warehouseID, transactionType } = req.data;

        if (warehouseID != null && !isUuid(warehouseID)) {
            return rejectValidation(req, 'warehouseID must be a valid UUID.', 'warehouseID');
        }

        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchInventoryMovementReport(tx, entities, { fromDate, toDate, warehouseID, transactionType });
    });

    // ========================================================================
    // Asset Reports
    // ========================================================================

    this.on('getAssetUtilizationReport', async (req) => {
        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchAssetUtilizationReport(tx, entities);
    });

    this.on('getAssetLifecycleReport', async (req) => {
        const { categoryID } = req.data;

        if (categoryID != null && !isUuid(categoryID)) {
            return rejectValidation(req, 'categoryID must be a valid UUID.', 'categoryID');
        }

        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchAssetLifecycleReport(tx, entities, { categoryID });
    });

    // ========================================================================
    // Notification Statistics
    // ========================================================================

    this.on('getNotificationStatistics', async (req) => {
        const { fromDate, toDate } = req.data;

        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchNotificationStatistics(tx, entities, { fromDate, toDate });
    });

    // ========================================================================
    // Audit Summary
    // ========================================================================

    this.on('getAuditSummary', async (req) => {
        const { fromDate, toDate, entityName } = req.data;

        const tx       = cds.transaction(req);
        const entities = resolveEntities();
        return fetchAuditSummary(tx, entities, { fromDate, toDate, entityName });
    });
});
