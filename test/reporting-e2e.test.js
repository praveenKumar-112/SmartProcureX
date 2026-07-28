/**
 * SmartProcureX - TICKET-009 E2E acceptance tests
 * --------------------------------------------------
 * Responsibility:
 *   Exercise the Reporting module end-to-end against the live CAP
 *   runtime + an ephemeral sqlite in-memory database (AD-14).
 *
 * Coverage:
 *   - getDashboardSummary
 *   - getPurchaseRequestSummary (unfiltered + status-filtered + date-exclusion)
 *   - getDepartmentSpendAnalysis
 *   - getApprovalPerformance
 *   - getPurchaseOrderSummary
 *   - getSupplierSpendAnalysis
 *   - getGoodsReceiptSummary (unfiltered + warehouse-scoped)
 *   - getWarehouseInventorySummary
 *   - getInventoryMovementReport (unfiltered + type-filtered)
 *   - getAssetUtilizationReport
 *   - getAssetLifecycleReport (unfiltered + category-scoped)
 *   - getNotificationStatistics
 *   - getAuditSummary (unfiltered + entity-filtered)
 *   - Negative cases: invalid UUID parameters → 400 rejection
 *
 * Design:
 *   - Bootstraps cds with @cap-js/sqlite in-memory once at the top
 *     of the file (AD-14).
 *   - Seed data is inserted directly via cds.db.run() with namespaced
 *     entity references obtained from cds.entities(). No service
 *     dispatch is needed for seed data since reporting only reads.
 *   - Functions are dispatched via srv.send({ event, data }).
 *   - Simple pass/fail counters; exits 1 on any failure (CI-friendly).
 */
import cds from '@sap/cds';

const { SELECT, INSERT } = cds.ql;

// ============================================================
// Dynamic date helper (keep tests green regardless of run date)
// ============================================================
function isoDateInNDays(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().split('T')[0];
}
const TODAY      = isoDateInNDays(0);
const PAST_DATE  = '2020-01-01';   // guaranteed to exclude all seeded data when used as fromDate after seed

// ============================================================
// Deterministic test entity IDs
// ============================================================
// All IDs follow the pattern RPT_<TYPE>_<N>_ID to avoid collision
// with any identifiers created by other E2E tests (notification-e2e
// uses its own UUID set).

const RPT_ROLE1_ID   = 'b0000001-0000-0000-0000-000000000001';
const RPT_DEPT1_ID   = 'b0000001-0000-0000-0000-000000000002';
const RPT_DEPT2_ID   = 'b0000001-0000-0000-0000-000000000003';
const RPT_USER1_ID   = 'b0000001-0000-0000-0000-000000000004';
const RPT_USER2_ID   = 'b0000001-0000-0000-0000-000000000005';
const RPT_SUPP1_ID   = 'b0000001-0000-0000-0000-000000000006';
const RPT_PR1_ID     = 'b0000001-0000-0000-0000-000000000007';
const RPT_PR2_ID     = 'b0000001-0000-0000-0000-000000000008';
const RPT_PRI1_ID    = 'b0000001-0000-0000-0000-000000000009';
const RPT_PRI2_ID    = 'b0000001-0000-0000-0000-000000000010';
const RPT_PRI3_ID    = 'b0000001-0000-0000-0000-000000000011';
const RPT_APPR1_ID   = 'b0000001-0000-0000-0000-000000000012';
const RPT_PO1_ID     = 'b0000001-0000-0000-0000-000000000013';
const RPT_POI1_ID    = 'b0000001-0000-0000-0000-000000000014';
const RPT_WH1_ID     = 'b0000001-0000-0000-0000-000000000015';
const RPT_GR1_ID     = 'b0000001-0000-0000-0000-000000000016';
const RPT_GRI1_ID    = 'b0000001-0000-0000-0000-000000000017';
const RPT_INV1_ID    = 'b0000001-0000-0000-0000-000000000018';
const RPT_INVTX1_ID  = 'b0000001-0000-0000-0000-000000000019';
const RPT_INVTX2_ID  = 'b0000001-0000-0000-0000-000000000020';
const RPT_CAT1_ID    = 'b0000001-0000-0000-0000-000000000021';
const RPT_ASSET1_ID  = 'b0000001-0000-0000-0000-000000000022';
const RPT_ASSET2_ID  = 'b0000001-0000-0000-0000-000000000023';
const RPT_ASSN1_ID   = 'b0000001-0000-0000-0000-000000000024';
const RPT_NOTIF1_ID  = 'b0000001-0000-0000-0000-000000000025';
const RPT_NOTIF2_ID  = 'b0000001-0000-0000-0000-000000000026';
const RPT_AUDIT1_ID  = 'b0000001-0000-0000-0000-000000000027';
const RPT_AUDIT2_ID  = 'b0000001-0000-0000-0000-000000000028';

// ============================================================
// Tiny assertion helpers (no external dependency)
// ============================================================
let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, label) {
    if (cond) {
        pass++;
    } else {
        fail++;
        failures.push(label);
        console.error('  FAIL:', label);
    }
}

function eq(actual, expected, label) {
    if (actual === expected) {
        pass++;
    } else {
        fail++;
        failures.push(`${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
        console.error(`  FAIL: ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
}

// ============================================================
// Bootstrap
// ============================================================
console.log('\n========================================');
console.log('  SmartProcureX TICKET-009 E2E Tests');
console.log('  ReportingService');
console.log('========================================\n');

const model = await cds.load('*', true);
await cds.deploy(model).to('sqlite::memory:');
await cds.serve('all').from(model).to('sqlite::memory:');

const srv = cds.services.ReportingService;

// Entity references (resolved after model is fully loaded)
const {
    PurchaseRequest,
    PurchaseRequestItem,
    Approval,
    PurchaseOrder,
    PurchaseOrderItem
} = cds.entities('smartprocurex.procurement');

const {
    Warehouse,
    GoodsReceipt,
    GoodsReceiptItem,
    InventoryItem,
    InventoryTransaction
} = cds.entities('smartprocurex.warehouse');

const {
    AssetCategory,
    Asset,
    AssetAssignment
} = cds.entities('smartprocurex.asset');

const {
    Notification,
    AuditLog
} = cds.entities('smartprocurex.platform');

const {
    Role,
    Department,
    User
} = cds.entities('smartprocurex.identity');

const { Supplier } = cds.entities('smartprocurex.supplier');

// ============================================================
// Seed test data
// ============================================================
console.log('Seeding test data …');

// ---- Identity ----
await cds.db.run(INSERT.into(Role).entries({
    ID:       RPT_ROLE1_ID,
    roleCode: 'RPT_MANAGER',
    roleName: 'Reporting Manager'
}));

await cds.db.run(INSERT.into(Department).entries([
    { ID: RPT_DEPT1_ID, departmentCode: 'RPT-D01', departmentName: 'Finance'       },
    { ID: RPT_DEPT2_ID, departmentCode: 'RPT-D02', departmentName: 'Engineering'   }
]));

await cds.db.run(INSERT.into(User).entries([
    {
        ID: RPT_USER1_ID,
        employeeId: 'RPT-U001',
        firstName: 'Anna',
        lastName:  'Report',
        email:     'anna.report@test.com',
        status:    'ACTIVE',
        role_ID:   RPT_ROLE1_ID,
        department_ID: RPT_DEPT1_ID
    },
    {
        ID: RPT_USER2_ID,
        employeeId: 'RPT-U002',
        firstName: 'Bob',
        lastName:  'Report',
        email:     'bob.report@test.com',
        status:    'ACTIVE',
        role_ID:   RPT_ROLE1_ID,
        department_ID: RPT_DEPT2_ID
    }
]));

// ---- Supplier ----
await cds.db.run(INSERT.into(Supplier).entries({
    ID:           RPT_SUPP1_ID,
    supplierCode: 'RPT-S001',
    supplierName: 'Acme Supplies Ltd',
    status:       'ACTIVE'
}));

// ---- Purchase Requests ----
await cds.db.run(INSERT.into(PurchaseRequest).entries([
    {
        ID:            RPT_PR1_ID,
        requestNumber: 'PR-2024-000001',
        requestDate:   TODAY,
        status:        'Submitted',
        totalAmount:   5000.00,
        requestedBy_ID: RPT_USER1_ID,
        department_ID: RPT_DEPT1_ID,
        justification: 'E2E test PR 1'
    },
    {
        ID:            RPT_PR2_ID,
        requestNumber: 'PR-2024-000002',
        requestDate:   TODAY,
        status:        'Approved',
        totalAmount:   12000.00,
        requestedBy_ID: RPT_USER2_ID,
        department_ID: RPT_DEPT2_ID,
        justification: 'E2E test PR 2'
    }
]));

await cds.db.run(INSERT.into(PurchaseRequestItem).entries([
    {
        ID:              RPT_PRI1_ID,
        purchaseRequest_ID: RPT_PR1_ID,
        itemName:        'Office Chairs',
        quantity:        10,
        unitPrice:       250.00,
        totalPrice:      2500.00
    },
    {
        ID:              RPT_PRI2_ID,
        purchaseRequest_ID: RPT_PR1_ID,
        itemName:        'Desk Lamps',
        quantity:        25,
        unitPrice:       100.00,
        totalPrice:      2500.00
    },
    {
        ID:              RPT_PRI3_ID,
        purchaseRequest_ID: RPT_PR2_ID,
        itemName:        'Laptops',
        quantity:        5,
        unitPrice:       2400.00,
        totalPrice:      12000.00
    }
]));

// ---- Approvals ----
await cds.db.run(INSERT.into(Approval).entries({
    ID:                 RPT_APPR1_ID,
    purchaseRequest_ID: RPT_PR2_ID,
    approver_ID:        RPT_USER1_ID,
    approvalLevel:      1,
    decision:           'Approved',
    approvalDate:       new Date().toISOString(),
    comments:           'Approved for E2E test'
}));

// ---- Purchase Order ----
await cds.db.run(INSERT.into(PurchaseOrder).entries({
    ID:                   RPT_PO1_ID,
    poNumber:             'PO-2024-000001',
    orderDate:            TODAY,
    status:               'Sent',
    totalAmount:          12000.00,
    supplier_ID:          RPT_SUPP1_ID,
    purchaseRequest_ID:   RPT_PR2_ID,
    expectedDeliveryDate: isoDateInNDays(30)
}));

await cds.db.run(INSERT.into(PurchaseOrderItem).entries({
    ID:              RPT_POI1_ID,
    purchaseOrder_ID: RPT_PO1_ID,
    itemName:        'Laptops',
    quantity:        5,
    unitPrice:       2400.00,
    totalPrice:      12000.00,
    receivedQuantity: 2
}));

// ---- Warehouse ----
await cds.db.run(INSERT.into(Warehouse).entries({
    ID:            RPT_WH1_ID,
    warehouseCode: 'RPT-WH01',
    warehouseName: 'Central Store',
    location:      'Building A',
    status:        'ACTIVE'
}));

// ---- Goods Receipt ----
await cds.db.run(INSERT.into(GoodsReceipt).entries({
    ID:                 RPT_GR1_ID,
    goodsReceiptNumber: 'GR-2024-000001',
    receivedDate:       TODAY,
    status:             'Posted',
    purchaseOrder_ID:   RPT_PO1_ID,
    warehouse_ID:       RPT_WH1_ID,
    receivedBy_ID:      RPT_USER1_ID
}));

await cds.db.run(INSERT.into(GoodsReceiptItem).entries({
    ID:               RPT_GRI1_ID,
    goodsReceipt_ID:  RPT_GR1_ID,
    itemName:         'Laptops',
    receivedQuantity: 2
}));

// ---- Inventory ----
await cds.db.run(INSERT.into(InventoryItem).entries({
    ID:              RPT_INV1_ID,
    warehouse_ID:    RPT_WH1_ID,
    itemCode:        'RPT-LAPTOP-001',
    itemName:        'Laptops',
    quantityOnHand:  2,
    quantityReserved: 0,
    quantityDamaged: 0,
    minimumStock:    5,
    unit:            'EA',
    status:          'ACTIVE'
}));

await cds.db.run(INSERT.into(InventoryTransaction).entries([
    {
        ID:              RPT_INVTX1_ID,
        inventoryItem_ID: RPT_INV1_ID,
        warehouse_ID:    RPT_WH1_ID,
        transactionType: 'Inbound',
        quantity:        2,
        balanceAfter:    2,
        transactionDate: new Date().toISOString(),
        performedBy_ID:  RPT_USER1_ID,
        goodsReceipt_ID: RPT_GR1_ID
    },
    {
        ID:              RPT_INVTX2_ID,
        inventoryItem_ID: RPT_INV1_ID,
        warehouse_ID:    RPT_WH1_ID,
        transactionType: 'Adjustment',
        quantity:        2,
        balanceAfter:    2,
        transactionDate: new Date().toISOString(),
        performedBy_ID:  RPT_USER1_ID
    }
]));

// ---- Assets ----
await cds.db.run(INSERT.into(AssetCategory).entries({
    ID:           RPT_CAT1_ID,
    categoryCode: 'RPT-CAT01',
    categoryName: 'IT Equipment'
}));

await cds.db.run(INSERT.into(Asset).entries([
    {
        ID:              RPT_ASSET1_ID,
        assetCode:       'RPT-AST-001',
        assetName:       'Laptop Unit 1',
        assetStatus:     'Assigned',
        assetCategory_ID: RPT_CAT1_ID,
        inventoryItem_ID: RPT_INV1_ID,
        purchaseDate:    TODAY
    },
    {
        ID:              RPT_ASSET2_ID,
        assetCode:       'RPT-AST-002',
        assetName:       'Laptop Unit 2',
        assetStatus:     'Available',
        assetCategory_ID: RPT_CAT1_ID,
        inventoryItem_ID: RPT_INV1_ID,
        purchaseDate:    TODAY
    }
]));

await cds.db.run(INSERT.into(AssetAssignment).entries({
    ID:               RPT_ASSN1_ID,
    asset_ID:         RPT_ASSET1_ID,
    employee_ID:      RPT_USER2_ID,
    assignedBy_ID:    RPT_USER1_ID,
    assignedDate:     TODAY,
    expectedReturnDate: isoDateInNDays(365),
    assignmentStatus: 'Assigned'
}));

// ---- Notifications ----
await cds.db.run(INSERT.into(Notification).entries([
    {
        ID:               RPT_NOTIF1_ID,
        title:            'PR Submitted',
        message:          'PR-2024-000001 needs approval',
        category:         'PurchaseRequest',
        priority:         'Medium',
        notificationType: 'Information',
        recipient_ID:     RPT_USER1_ID,
        referenceEntity:  'PurchaseRequest',
        referenceID:      RPT_PR1_ID,
        isRead:           false,
        isArchived:       false,
        isDeleted:        false
    },
    {
        ID:               RPT_NOTIF2_ID,
        title:            'PR Approved',
        message:          'PR-2024-000002 has been approved',
        category:         'Approval',
        priority:         'High',
        notificationType: 'Success',
        recipient_ID:     RPT_USER2_ID,
        referenceEntity:  'Approval',
        referenceID:      RPT_APPR1_ID,
        isRead:           true,
        isArchived:       false,
        isDeleted:        false
    }
]));

// ---- Audit Logs ----
await cds.db.run(INSERT.into(AuditLog).entries([
    {
        ID:             RPT_AUDIT1_ID,
        entityName:     'PurchaseRequest',
        entityId:       RPT_PR1_ID,
        operation:      'Create',
        performedBy_ID: RPT_USER1_ID,
        performedOn:    new Date().toISOString()
    },
    {
        ID:             RPT_AUDIT2_ID,
        entityName:     'PurchaseOrder',
        entityId:       RPT_PO1_ID,
        operation:      'Create',
        performedBy_ID: RPT_USER1_ID,
        performedOn:    new Date().toISOString()
    }
]));

console.log('Seed complete.\n');

// ============================================================
// Test helpers
// ============================================================
function hasField(obj, field, label) {
    ok(obj != null && field in obj, `${label}: has field '${field}'`);
}

function isNonNegativeInt(val, label) {
    ok(typeof val === 'number' && Number.isInteger(val) && val >= 0, label);
}

function isNonNegativeNum(val, label) {
    ok(typeof val === 'number' && Number.isFinite(val) && val >= 0, label);
}

// ============================================================
// Test suite
// ============================================================

// ------------------------------------------------------------
// 1. getDashboardSummary
// ------------------------------------------------------------
console.log('--- getDashboardSummary ---');
{
    const result = await srv.send({ event: 'getDashboardSummary', data: {} });
    ok(result !== null && typeof result === 'object', 'getDashboardSummary returns an object');
    isNonNegativeInt(result.totalPurchaseRequests, 'totalPurchaseRequests is non-negative int');
    isNonNegativeInt(result.openPurchaseRequests,  'openPurchaseRequests is non-negative int');
    isNonNegativeInt(result.totalPurchaseOrders,   'totalPurchaseOrders is non-negative int');
    isNonNegativeInt(result.openPurchaseOrders,    'openPurchaseOrders is non-negative int');
    isNonNegativeInt(result.pendingApprovals,      'pendingApprovals is non-negative int');
    isNonNegativeInt(result.totalInventoryItems,   'totalInventoryItems is non-negative int');
    isNonNegativeInt(result.totalAssets,           'totalAssets is non-negative int');
    isNonNegativeInt(result.assignedAssets,        'assignedAssets is non-negative int');
    isNonNegativeInt(result.unreadNotifications,   'unreadNotifications is non-negative int');
    ok(result.totalPurchaseRequests >= 2,          'at least 2 PRs seeded');
    ok(result.totalPurchaseOrders   >= 1,          'at least 1 PO seeded');
    ok(result.totalAssets           >= 2,          'at least 2 assets seeded');
    ok(result.assignedAssets        >= 1,          'at least 1 assigned asset seeded');
    ok(result.unreadNotifications   >= 1,          'at least 1 unread notification seeded');
    ok(result.lowStockItems         >= 1,          'laptop item below minimumStock=5 → low-stock flag');
}

// ------------------------------------------------------------
// 2. getPurchaseRequestSummary — no filter
// ------------------------------------------------------------
console.log('--- getPurchaseRequestSummary (no filter) ---');
{
    const rows = await srv.send({ event: 'getPurchaseRequestSummary', data: {} });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 2, 'at least 2 status groups returned');
    const submittedRow = rows.find(r => r.status === 'Submitted');
    ok(submittedRow != null, 'Submitted group present');
    eq(submittedRow?.count, 1, 'Submitted count = 1');
    isNonNegativeNum(submittedRow?.totalAmount, 'Submitted totalAmount is number');
    ok(submittedRow?.totalAmount === 5000, 'Submitted totalAmount = 5000');
    const approvedRow = rows.find(r => r.status === 'Approved');
    ok(approvedRow != null, 'Approved group present');
    eq(approvedRow?.count, 1, 'Approved count = 1');
    ok(approvedRow?.totalAmount === 12000, 'Approved totalAmount = 12000');
}

// ------------------------------------------------------------
// 3. getPurchaseRequestSummary — status filter
// ------------------------------------------------------------
console.log('--- getPurchaseRequestSummary (status=Approved) ---');
{
    const rows = await srv.send({
        event: 'getPurchaseRequestSummary',
        data:  { status: 'Approved' }
    });
    ok(Array.isArray(rows), 'returns array');
    eq(rows.length, 1, 'exactly 1 status group when filtered to Approved');
    eq(rows[0]?.status, 'Approved', 'group status is Approved');
    eq(rows[0]?.count, 1, 'count = 1');
}

// ------------------------------------------------------------
// 4. getPurchaseRequestSummary — date filter that excludes all
// ------------------------------------------------------------
console.log('--- getPurchaseRequestSummary (date range excludes seeded data) ---');
{
    const rows = await srv.send({
        event: 'getPurchaseRequestSummary',
        data:  { fromDate: '2000-01-01', toDate: '2000-01-31' }
    });
    ok(Array.isArray(rows), 'returns array');
    eq(rows.length, 0, 'empty result when date range excludes all seeded data');
}

// ------------------------------------------------------------
// 5. getPurchaseRequestSummary — invalid departmentID UUID
// ------------------------------------------------------------
console.log('--- getPurchaseRequestSummary (invalid UUID → 400) ---');
{
    try {
        await srv.send({
            event: 'getPurchaseRequestSummary',
            data:  { departmentID: 'not-a-uuid' }
        });
        ok(false, 'should have rejected invalid departmentID');
    } catch (err) {
        ok(err != null, 'rejects invalid departmentID UUID');
    }
}

// ------------------------------------------------------------
// 6. getDepartmentSpendAnalysis
// ------------------------------------------------------------
console.log('--- getDepartmentSpendAnalysis ---');
{
    const rows = await srv.send({ event: 'getDepartmentSpendAnalysis', data: {} });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 2, 'at least 2 department groups');
    const financeRow = rows.find(r => r.departmentName === 'Finance');
    ok(financeRow != null, 'Finance department present');
    eq(financeRow?.requestCount, 1, 'Finance has 1 PR');
    ok(financeRow?.totalAmount === 5000, 'Finance totalAmount = 5000');
    ok(financeRow?.approvedAmount === 0, 'Finance approvedAmount = 0 (PR is Submitted not Approved)');
    const engRow = rows.find(r => r.departmentName === 'Engineering');
    ok(engRow != null, 'Engineering department present');
    ok(engRow?.approvedAmount === 12000, 'Engineering approvedAmount = 12000 (PR is Approved)');
}

// ------------------------------------------------------------
// 7. getApprovalPerformance
// ------------------------------------------------------------
console.log('--- getApprovalPerformance ---');
{
    const rows = await srv.send({ event: 'getApprovalPerformance', data: {} });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 1, 'at least 1 decision group');
    const approvedRow = rows.find(r => r.decision === 'Approved');
    ok(approvedRow != null, 'Approved decision group present');
    eq(approvedRow?.count, 1, 'Approved count = 1');
    ok(approvedRow?.percentageOfTotal === 100, 'Approved is 100% of total decisions');
}

// ------------------------------------------------------------
// 8. getPurchaseOrderSummary
// ------------------------------------------------------------
console.log('--- getPurchaseOrderSummary ---');
{
    const rows = await srv.send({ event: 'getPurchaseOrderSummary', data: {} });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 1, 'at least 1 PO status group');
    const sentRow = rows.find(r => r.status === 'Sent');
    ok(sentRow != null, 'Sent group present');
    eq(sentRow?.count, 1, 'Sent count = 1');
    ok(sentRow?.totalAmount === 12000, 'Sent totalAmount = 12000');
}

// ------------------------------------------------------------
// 9. getSupplierSpendAnalysis
// ------------------------------------------------------------
console.log('--- getSupplierSpendAnalysis ---');
{
    const rows = await srv.send({ event: 'getSupplierSpendAnalysis', data: {} });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 1, 'at least 1 supplier row');
    const acmeRow = rows.find(r => r.supplierName === 'Acme Supplies Ltd');
    ok(acmeRow != null, 'Acme Supplies present');
    eq(acmeRow?.orderCount, 1, 'Acme orderCount = 1');
    ok(acmeRow?.totalAmount === 12000, 'Acme totalAmount = 12000');
    ok(acmeRow?.averageOrderValue === 12000, 'Acme avgOrderValue = 12000');
}

// ------------------------------------------------------------
// 10. getGoodsReceiptSummary — no filter
// ------------------------------------------------------------
console.log('--- getGoodsReceiptSummary (no filter) ---');
{
    const rows = await srv.send({ event: 'getGoodsReceiptSummary', data: {} });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 1, 'at least 1 GR stat row');
    const grRow = rows.find(r => r.status === 'Posted');
    ok(grRow != null, 'Posted GR row present');
    eq(grRow?.count, 1, 'Posted count = 1');
    ok(grRow?.warehouseName === 'Central Store', 'warehouse name correct');
}

// ------------------------------------------------------------
// 11. getGoodsReceiptSummary — warehouse scoped
// ------------------------------------------------------------
console.log('--- getGoodsReceiptSummary (warehouseID filter) ---');
{
    const rows = await srv.send({
        event: 'getGoodsReceiptSummary',
        data:  { warehouseID: RPT_WH1_ID }
    });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 1, 'filtered result non-empty');
    ok(rows.every(r => r.warehouseID === RPT_WH1_ID || r.warehouseID == null), 'all rows match warehouse filter');
}

// ------------------------------------------------------------
// 12. getGoodsReceiptSummary — invalid warehouseID → 400
// ------------------------------------------------------------
console.log('--- getGoodsReceiptSummary (invalid warehouseID → 400) ---');
{
    try {
        await srv.send({
            event: 'getGoodsReceiptSummary',
            data:  { warehouseID: 'bad-id' }
        });
        ok(false, 'should reject invalid warehouseID');
    } catch (err) {
        ok(err != null, 'rejects invalid warehouseID UUID');
    }
}

// ------------------------------------------------------------
// 13. getWarehouseInventorySummary
// ------------------------------------------------------------
console.log('--- getWarehouseInventorySummary ---');
{
    const rows = await srv.send({ event: 'getWarehouseInventorySummary', data: {} });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 1, 'at least 1 warehouse row');
    const whRow = rows.find(r => r.warehouseName === 'Central Store');
    ok(whRow != null, 'Central Store row present');
    ok(whRow?.totalItems >= 1, 'totalItems >= 1');
    ok(typeof whRow?.totalOnHand   === 'number', 'totalOnHand is number');
    ok(typeof whRow?.totalReserved === 'number', 'totalReserved is number');
    ok(typeof whRow?.totalDamaged  === 'number', 'totalDamaged is number');
    ok(whRow?.totalOnHand === 2, 'totalOnHand = 2 (seeded value)');
}

// ------------------------------------------------------------
// 14. getInventoryMovementReport — no filter
// ------------------------------------------------------------
console.log('--- getInventoryMovementReport (no filter) ---');
{
    const rows = await srv.send({ event: 'getInventoryMovementReport', data: {} });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 2, 'at least 2 transaction-type groups (Inbound + Adjustment)');
    const inboundRow = rows.find(r => r.transactionType === 'Inbound');
    ok(inboundRow != null, 'Inbound group present');
    eq(inboundRow?.count, 1, 'Inbound count = 1');
    ok(inboundRow?.totalQuantity === 2, 'Inbound totalQuantity = 2');
}

// ------------------------------------------------------------
// 15. getInventoryMovementReport — type filter
// ------------------------------------------------------------
console.log('--- getInventoryMovementReport (transactionType=Inbound) ---');
{
    const rows = await srv.send({
        event: 'getInventoryMovementReport',
        data:  { transactionType: 'Inbound' }
    });
    ok(Array.isArray(rows), 'returns array');
    eq(rows.length, 1, 'exactly 1 type group when filtered');
    eq(rows[0]?.transactionType, 'Inbound', 'type is Inbound');
}

// ------------------------------------------------------------
// 16. getAssetUtilizationReport
// ------------------------------------------------------------
console.log('--- getAssetUtilizationReport ---');
{
    const rows = await srv.send({ event: 'getAssetUtilizationReport', data: {} });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 2, 'at least 2 status groups (Assigned + Available)');
    const assignedRow = rows.find(r => r.status === 'Assigned');
    ok(assignedRow != null, 'Assigned group present');
    eq(assignedRow?.count, 1, 'Assigned count = 1');
    ok(typeof assignedRow?.percentageOfTotal === 'number', 'percentageOfTotal is number');
    ok(assignedRow?.percentageOfTotal > 0 && assignedRow?.percentageOfTotal <= 100,
        'percentageOfTotal in (0, 100]');
    const availableRow = rows.find(r => r.status === 'Available');
    ok(availableRow != null, 'Available group present');
    const totalPct = rows.reduce((s, r) => s + r.percentageOfTotal, 0);
    ok(Math.abs(totalPct - 100) < 0.02, 'all percentages sum to ~100%');
}

// ------------------------------------------------------------
// 17. getAssetLifecycleReport — no filter
// ------------------------------------------------------------
console.log('--- getAssetLifecycleReport (no filter) ---');
{
    const rows = await srv.send({ event: 'getAssetLifecycleReport', data: {} });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 1, 'at least 1 category row');
    const catRow = rows.find(r => r.categoryName === 'IT Equipment');
    ok(catRow != null, 'IT Equipment category present');
    eq(catRow?.totalAssets, 2, 'IT Equipment has 2 total assets');
    eq(catRow?.assigned, 1, 'IT Equipment has 1 assigned asset');
    eq(catRow?.available, 1, 'IT Equipment has 1 available asset');
    eq(catRow?.retired, 0, 'retired = 0');
    eq(catRow?.disposed, 0, 'disposed = 0');
}

// ------------------------------------------------------------
// 18. getAssetLifecycleReport — category scoped
// ------------------------------------------------------------
console.log('--- getAssetLifecycleReport (categoryID filter) ---');
{
    const rows = await srv.send({
        event: 'getAssetLifecycleReport',
        data:  { categoryID: RPT_CAT1_ID }
    });
    ok(Array.isArray(rows), 'returns array');
    eq(rows.length, 1, 'exactly 1 row when scoped to one category');
    eq(rows[0]?.categoryID, RPT_CAT1_ID, 'category ID matches filter');
}

// ------------------------------------------------------------
// 19. getNotificationStatistics
// ------------------------------------------------------------
console.log('--- getNotificationStatistics ---');
{
    const rows = await srv.send({ event: 'getNotificationStatistics', data: {} });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 2, 'at least 2 category groups (PurchaseRequest + Approval)');
    const prRow = rows.find(r => r.category === 'PurchaseRequest');
    ok(prRow != null, 'PurchaseRequest category present');
    eq(prRow?.total, 1, 'PurchaseRequest total = 1');
    eq(prRow?.unread, 1, 'PurchaseRequest unread = 1');
    eq(prRow?.read, 0, 'PurchaseRequest read = 0');
    ok(prRow?.readRate === 0, 'PurchaseRequest readRate = 0%');
    const apprRow = rows.find(r => r.category === 'Approval');
    ok(apprRow != null, 'Approval category present');
    eq(apprRow?.total, 1, 'Approval total = 1');
    eq(apprRow?.read, 1, 'Approval read = 1');
    ok(apprRow?.readRate === 100, 'Approval readRate = 100%');
}

// ------------------------------------------------------------
// 20. getAuditSummary — no filter
// ------------------------------------------------------------
console.log('--- getAuditSummary (no filter) ---');
{
    const rows = await srv.send({ event: 'getAuditSummary', data: {} });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.length >= 2, 'at least 2 audit rows (PR Create + PO Create)');
    const prAudit = rows.find(r => r.entityName === 'PurchaseRequest' && r.operation === 'Create');
    ok(prAudit != null, 'PurchaseRequest Create audit row present');
    eq(prAudit?.count, 1, 'PurchaseRequest Create count = 1');
    const poAudit = rows.find(r => r.entityName === 'PurchaseOrder' && r.operation === 'Create');
    ok(poAudit != null, 'PurchaseOrder Create audit row present');
}

// ------------------------------------------------------------
// 21. getAuditSummary — entityName filter
// ------------------------------------------------------------
console.log('--- getAuditSummary (entityName=PurchaseRequest) ---');
{
    const rows = await srv.send({
        event: 'getAuditSummary',
        data:  { entityName: 'PurchaseRequest' }
    });
    ok(Array.isArray(rows), 'returns array');
    ok(rows.every(r => r.entityName === 'PurchaseRequest'), 'all rows match entityName filter');
    ok(rows.length >= 1, 'at least 1 row for PurchaseRequest');
}

// ------------------------------------------------------------
// 22. getAuditSummary — date range that excludes all data
// ------------------------------------------------------------
console.log('--- getAuditSummary (date range excludes all data) ---');
{
    const rows = await srv.send({
        event: 'getAuditSummary',
        data:  { fromDate: '2000-01-01', toDate: '2000-12-31' }
    });
    ok(Array.isArray(rows), 'returns empty array for excluded date range');
    eq(rows.length, 0, 'no audit rows in 2000');
}

// ============================================================
// Final report
// ============================================================
const total = pass + fail;
console.log('\n========================================');
console.log(`  ${total} assertions: ${pass} PASS / ${fail} FAIL`);
console.log('========================================\n');

if (fail > 0) {
    console.error('Failed assertions:');
    failures.forEach(f => console.error('  -', f));
    process.exit(1);
}

console.log('All TICKET-009 reporting tests passed.\n');
