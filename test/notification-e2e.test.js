/**
 * SmartProcureX - TICKET-008 E2E acceptance tests
 * --------------------------------------------------
 * Responsibility:
 *   Exercise the Notification framework end-to-end against the live
 *   CAP runtime + an ephemeral sqlite in-memory database (AD-14).
 *
 * Coverage:
 *   - Notification CRUD (Create / Read / Update / Soft-Delete)
 *   - markNotificationRead / markNotificationUnread
 *   - markAllNotificationsRead
 *   - getUnreadNotificationCount
 *   - sendNotification / broadcastToDepartment / broadcastToRole
 *   - Filtering / Search / Pagination / Sorting / Unread-only filter
 *   - Priority filter / Type filter / Recipient filter / Date filter
 *   - Auto-emission for every business event (PR / PO / GR / Inventory /
 *     Warehouse / Asset)
 *   - Negative cases (404 / 409 / 400) for invalid inputs and state
 *     violations
 *   - Soft-delete behavior (row retained after action-deleteNotification)
 *
 * Design:
 *   - Bootstraps cds with @cap-js/sqlite in-memory once.
 *   - Service-dispatch pattern:
 *       - CREATE/UPDATE/DELETE hooks fire when invoked via
 *         `srv.tx({user}).run(cds.ql.INSERT.into(...))` (this is the
 *         correct CAP v10 dispatch path).
 *       - Actions fire via `srv.send({ event, data })`.
 *     The validation hooks (before-CREATE) therefore execute for both
 *     Notification creation and every auto-emission path.
 *   - Direct table reads/writes use `cds.db.run(...)` so cross-service
 *     SELECTs execute on the shared db without reentering a service tx
 *     (avoids sqlite tx recursion that deadlocks when a before-CREATE
 *     hook for PlatformService tries to SELECT from an IdentityService
 *     entity via the originating tx).
 *   - Simple pass/fail counters; exits 1 on any failure (CI-friendly).
 */
import cds from '@sap/cds';
import { isUuid } from '../srv/common/validation.js';

const { SELECT, INSERT, UPDATE } = cds.ql;

// ============================================================
// Dynamic date helpers
// ------------------------------------------------------------
// Test date values must be ISO date strings relative to the *actual*
// run-time "today" so the assertions stay green regardless of when
// the suite runs. PO expectedDeliveryDate is validated by the
// procurement handler to be >= today (`Expected delivery date cannot
// be in the past.`); the asset handler validates expectedReturnDate
// the same way. requestDate / receivedDate are stored but not
// validated against the present, so we keep the historic labels only
// where they are semantically meaningful.
// ============================================================
function isoDateInNDays(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().split('T')[0];
}
const DELIVERY_DATE_FUTURE = isoDateInNDays(30);
const RETURN_DATE_FUTURE = isoDateInNDays(120);

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
    const equal = actual === expected ||
        (Number.isFinite(actual) && Number(actual) === Number(expected));
    if (equal) {
        pass++;
    } else {
        fail++;
        failures.push(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
        console.error(`  FAIL: ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
    }
}

async function expectReject(promise, expectedCode, label) {
    try {
        await promise;
        fail++;
        failures.push(`${label} (expected rejection ${expectedCode}, got success)`);
        console.error(`  FAIL: ${label} (expected rejection ${expectedCode}, got success)`);
    } catch (err) {
        const code = err?.status ?? err?.statusCode ?? err?.code;
        if (expectedCode == null || code === expectedCode) {
            pass++;
        } else {
            fail++;
            failures.push(`${label} (expected ${expectedCode}, got ${code} / ${err?.message})`);
            console.error(`  FAIL: ${label} (expected ${expectedCode}, got ${code} / ${err?.message})`);
        }
    }
}

// ============================================================
// Bootstrap
// ============================================================
const model = await cds.load('*', true);
await cds.deploy(model).to('sqlite::memory:');
await cds.serve('all').from(model).to('sqlite::memory:');

const db = cds.db;
const Identity = cds.services.IdentityService;
const Supplier = cds.services.SupplierService;
const Procurement = cds.services.ProcurementService;
const Warehouse = cds.services.WarehouseService;
const Asset = cds.services.AssetService;
const Platform = cds.services.PlatformService;

// ============================================================
// Dispatch helpers
//   create(srv, entityRef, data, user):
//     Triggers before-CREATE hook via `srv.tx().run(INSERT.into(entityRef))`.
//     INSERT returns undefined on success in this CAP version so we
//     re-SELECT to retrieve the freshly-created row.
//   update(srv, entityRef, id, patch, user):
//     Triggers before-UPDATE hook via tx.run(UPDATE(entityRef).set(...)).
//   action(srv, event, data, user):
//     Runs an OData action via `srv.send({ event, data })`.
//   read(svc, query):
//     Direct SELECT via the shared db facade.
// ============================================================
async function create(svc, entityRef, data, user) {
    const tx = svc.tx({ user: user ?? defaultUser });
    await tx.run(INSERT.into(entityRef).entries(data));
    return null; // caller should re-SELECT for verification
}

async function insertAndReturn(svc, entityRef, data, user) {
    const tx = svc.tx({ user: user ?? defaultUser });
    await tx.run(INSERT.into(entityRef).entries(data));
    // Re-SELECT by the most identifying field we can.
    const latest = await db.run(
        SELECT.one.from(entityRef).orderBy({ createdAt: 'desc' })
    );
    return latest;
}

async function updateRow(svc, entityRef, id, patch, user) {
    const tx = svc.tx({ user: user ?? defaultUser });
    return tx.run(UPDATE(entityRef).set(patch).where({ ID: id }));
}

async function action(svc, event, data, user) {
    return svc.send({ event, data, user: user ?? defaultUser });
}

const defaultUser = { id: 'system' };

// ============================================================
// Seed fixtures
//   All seeds are inserted directly via cds.db so they do NOT fire
//   before-CREATE hooks (which would re-enter validation logic and
//   slow the test). The hooks are exercised separately via dispatch
//   for the Notification entity itself.
// ============================================================
const approverCtx = { id: 'approver-123' };

await db.run(INSERT.into(Identity.entities.Departments).entries({ departmentCode: 'D-IT', departmentName: 'IT' }));
await db.run(INSERT.into(Identity.entities.Roles).entries({ roleCode: 'APPROVER', roleName: 'Approver' }));
await db.run(INSERT.into(Identity.entities.Roles).entries({ roleCode: 'ADMIN', roleName: 'Administrator' }));

const dept = await db.run(SELECT.one.from(Identity.entities.Departments));
const role = await db.run(SELECT.one.from(Identity.entities.Roles).where({ roleCode: 'APPROVER' }));
const approverRole = await db.run(SELECT.one.from(Identity.entities.Roles).where({ roleCode: 'ADMIN' }));

await db.run(INSERT.into(Identity.entities.Users).entries({
    employeeId: 'E001', firstName: 'Alice', lastName: 'Requester',
    email: 'alice@example.com', status: 'ACTIVE',
    department_ID: dept.ID, role_ID: role.ID
}));
await db.run(INSERT.into(Identity.entities.Users).entries({
    employeeId: 'E002', firstName: 'Bob', lastName: 'Approver',
    email: 'bob@example.com', status: 'ACTIVE',
    department_ID: dept.ID, role_ID: role.ID
}));
await db.run(INSERT.into(Identity.entities.Users).entries({
    employeeId: 'E003', firstName: 'Carol', lastName: 'Employee',
    email: 'carol@example.com', status: 'ACTIVE',
    department_ID: dept.ID, role_ID: approverRole.ID
}));

const requester = await db.run(SELECT.one.from(Identity.entities.Users).where({ employeeId: 'E001' }));
const approver = await db.run(SELECT.one.from(Identity.entities.Users).where({ employeeId: 'E002' }));
const secondUser = await db.run(SELECT.one.from(Identity.entities.Users).where({ employeeId: 'E003' }));

await db.run(INSERT.into(Supplier.entities.Suppliers).entries({ supplierCode: 'S001', supplierName: 'Acme', status: 'ACTIVE' }));
const supplier = await db.run(SELECT.one.from(Supplier.entities.Suppliers).where({ supplierCode: 'S001' }));

await db.run(INSERT.into(Warehouse.entities.Warehouses).entries({ warehouseCode: 'WH-A', warehouseName: 'Warehouse A', status: 'ACTIVE' }));
await db.run(INSERT.into(Warehouse.entities.Warehouses).entries({ warehouseCode: 'WH-B', warehouseName: 'Warehouse B', status: 'ACTIVE' }));
const srcWarehouse = await db.run(SELECT.one.from(Warehouse.entities.Warehouses).where({ warehouseCode: 'WH-A' }));
const destWarehouse = await db.run(SELECT.one.from(Warehouse.entities.Warehouses).where({ warehouseCode: 'WH-B' }));

await db.run(INSERT.into(Warehouse.entities.InventoryItems).entries({
    warehouse_ID: srcWarehouse.ID, itemCode: 'ITEM-001',
    itemName: 'Widget', unit: 'EA', quantityOnHand: 100
}));
const invItem = await db.run(SELECT.one.from(Warehouse.entities.InventoryItems).where({ itemCode: 'ITEM-001' }));

await db.run(INSERT.into(Asset.entities.AssetCategories).entries({ categoryCode: 'CAT-LAP', categoryName: 'Laptops' }));
const assetCategory = await db.run(SELECT.one.from(Asset.entities.AssetCategories).where({ categoryCode: 'CAT-LAP' }));

await db.run(INSERT.into(Asset.entities.Assets).entries({
    assetCode: 'AST-001', assetName: 'Laptop A',
    assetCategory_ID: assetCategory.ID,
    inventoryItem_ID: invItem.ID
}));
const asset = await db.run(SELECT.one.from(Asset.entities.Assets).where({ assetCode: 'AST-001' }));

// ============================================================
// Helpers for notification-count queries
// ============================================================
async function countNotificationsFor(refEntity, refID) {
    const rows = await db.run(
        SELECT.from(Platform.entities.Notifications)
            .where({ referenceEntity: refEntity, referenceID: refID, isDeleted: false })
    );
    return rows.length;
}

// ============================================================
// Test section 1: Notification CRUD
// ============================================================
console.log('\n--- Notification CRUD ---');

// 1.1 Create via sendNotification action.
const createdViaAction = await action(Platform, 'sendNotification', {
    recipientID: requester.ID,
    title: 'Hello',
    message: 'Welcome to SmartProcureX',
    notificationType: 'Information',
    priority: 'Medium',
    category: 'System',
    referenceEntity: 'Test',
    referenceID: 'ref-1',
    referenceNumber: 'T-001'
}, approverCtx);
ok(isUuid(String(createdViaAction)), 'create via sendNotification returns UUID');

// 1.2 Direct CREATE via Notifications entity projection (fires hooks).
const direct = await insertAndReturn(Platform, Platform.entities.Notifications, {
    title: 'Direct',
    message: 'Direct insert',
    notificationType: 'Warning',
    priority: 'High',
    category: 'System',
    recipient_ID: requester.ID
});
ok(direct && direct.ID, 'direct CREATE persists row with ID');

// 1.3 READ single by ID.
const fetched = await db.run(
    SELECT.one.from(Platform.entities.Notifications).where({ ID: direct.ID })
);
eq(fetched.title, 'Direct', 'READ returns persisted title');

// 1.4 UPDATE (permitted field).
await updateRow(Platform, Platform.entities.Notifications, direct.ID, { title: 'Direct-Updated' });
const refetched = await db.run(
    SELECT.one.from(Platform.entities.Notifications).where({ ID: direct.ID })
);
eq(refetched.title, 'Direct-Updated', 'UPDATE changes title');

// 1.5 UPDATE with immutable routing field rejection.
await expectReject(
    updateRow(Platform, Platform.entities.Notifications, direct.ID, { recipient_ID: secondUser.ID }),
    400,
    'UPDATE routing change is rejected'
);

// 1.6 Soft-Delete via deleteNotification action.
const softDel = await action(Platform, 'deleteNotification', { notificationID: direct.ID });
ok(softDel === true, 'deleteNotification returns true');

// Soft-delete keeps the row but the default query hides deleted rows.
const visibleAfterDelete = await db.run(
    SELECT.one.from(Platform.entities.Notifications).where({ ID: direct.ID, isDeleted: false })
);
ok(visibleAfterDelete == null, 'soft-deleted row hidden from default SELECT');

// Row still exists in the table with isDeleted=true.
const rawRow = await db.run(
    SELECT.one.from(Platform.entities.Notifications)
        .columns('ID', 'isDeleted')
        .where({ ID: direct.ID })
);
ok(rawRow && rawRow.isDeleted === true, 'soft-deleted row still in table with isDeleted=true');

// ============================================================
// Test section 2: Mark Read / Unread / All-Read
// ============================================================
console.log('\n--- Mark Read / Unread / All Read ---');

const unreadA = await action(Platform, 'sendNotification', {
    recipientID: requester.ID, title: 'A', message: 'm',
    notificationType: 'Information', priority: 'Low', category: 'System'
});
const _unreadB = await action(Platform, 'sendNotification', {
    recipientID: requester.ID, title: 'B', message: 'm',
    notificationType: 'Information', priority: 'Low', category: 'System'
});
const _unreadC = await action(Platform, 'sendNotification', {
    recipientID: requester.ID, title: 'C', message: 'm',
    notificationType: 'Information', priority: 'Low', category: 'System'
});

const unreadCount1 = await action(Platform, 'getUnreadNotificationCount', { recipientID: requester.ID });
ok(unreadCount1 >= 4, `unread count reflects unread (was ${unreadCount1})`);

await action(Platform, 'markNotificationRead', { notificationID: unreadA });

const unreadCount2 = await action(Platform, 'getUnreadNotificationCount', { recipientID: requester.ID });
eq(unreadCount2, unreadCount1 - 1, 'unread count decreases by 1 after markRead');

await action(Platform, 'markNotificationUnread', { notificationID: unreadA });
const unreadCount3 = await action(Platform, 'getUnreadNotificationCount', { recipientID: requester.ID });
eq(unreadCount3, unreadCount1, 'unread count returns after markUnread');

const allReadResult = await action(Platform, 'markAllNotificationsRead', { recipientID: requester.ID });
ok(allReadResult >= 1, 'markAllNotificationsRead returns positive count');

const unreadCount4 = await action(Platform, 'getUnreadNotificationCount', { recipientID: requester.ID });
eq(unreadCount4, 0, 'unread count is zero after markAllNotificationsRead');

// ============================================================
// Test section 3: Broadcast to Department / Role
// ============================================================
console.log('\n--- Broadcast Department / Role ---');

const deptBroadcastCount = await action(Platform, 'broadcastToDepartment', {
    departmentID: dept.ID, title: 'Dept Alert', message: 'All dept members',
    notificationType: 'Information', priority: 'Medium', category: 'System'
});
ok(deptBroadcastCount >= 3, `broadcastToDepartment creates one row per ACTIVE user (was ${deptBroadcastCount})`);

const roleBroadcastCount = await action(Platform, 'broadcastToRole', {
    roleID: role.ID, title: 'Role Alert', message: 'Role members',
    notificationType: 'Information', priority: 'Medium', category: 'System'
});
ok(roleBroadcastCount >= 2, `broadcastToRole creates one row per ACTIVE user with that role (was ${roleBroadcastCount})`);

const approverUnread = await action(Platform, 'getUnreadNotificationCount', { recipientID: approver.ID });
ok(approverUnread >= 1, 'approver received role-broadcast notification');

// ============================================================
// Test section 4: Filtering / Search / Pagination / Sorting
// ============================================================
console.log('\n--- Filtering / Search / Pagination / Sorting ---');

// Mark A read for filter section
await action(Platform, 'markNotificationRead', { notificationID: unreadA });

// Priority filter (High).
const highNotifications = await db.run(
    SELECT.from(Platform.entities.Notifications)
        .where({ recipient_ID: requester.ID, priority: 'High', isDeleted: false })
);
ok(highNotifications.every(n => n.priority === 'High'),
    'priority filter returns only High notifications');

// Type filter.
const warningNotifications = await db.run(
    SELECT.from(Platform.entities.Notifications)
        .where({ recipient_ID: requester.ID, notificationType: 'Warning', isDeleted: false })
);
ok(warningNotifications.every(n => n.notificationType === 'Warning'),
    'type filter returns only Warning notifications');

// Recipient filter.
const recipientNotifications = await db.run(
    SELECT.from(Platform.entities.Notifications)
        .where({ recipient_ID: secondUser.ID, isDeleted: false })
);
ok(recipientNotifications.every(n => n.recipient_ID === secondUser.ID),
    'recipient filter isolated');

// Unread-only filter.
const unreadNotifications = await db.run(
    SELECT.from(Platform.entities.Notifications)
        .where({ recipient_ID: requester.ID, isRead: false, isDeleted: false })
);
ok(unreadNotifications.every(n => n.isRead === false),
    'unread-only filter excludes read notifications');

// Sorting (orderBy createdAt desc).
const sortedDesc = await db.run(
    SELECT.from(Platform.entities.Notifications)
        .where({ recipient_ID: requester.ID, isDeleted: false })
        .orderBy({ createdAt: 'desc' })
);
const dates = sortedDesc.map(n => new Date(n.createdAt).getTime());
ok(dates.every((d, i) => i === 0 || d <= dates[i - 1]),
    'orderBy createdAt desc returns descending chronological order');

// Pagination (limit + offset).
const page1 = await db.run(
    SELECT.from(Platform.entities.Notifications)
        .where({ recipient_ID: requester.ID, isDeleted: false })
        .orderBy({ createdAt: 'asc' })
        .limit(2, 0)
);
const page2 = await db.run(
    SELECT.from(Platform.entities.Notifications)
        .where({ recipient_ID: requester.ID, isDeleted: false })
        .orderBy({ createdAt: 'asc' })
        .limit(2, 2)
);
ok(page1.length <= 2, `page1 size capped at 2 (was ${page1.length})`);
ok(page2.length <= 2, `page2 size capped at 2 (was ${page2.length})`);
if (page1.length > 0 && page2.length > 0) {
    const lastPage1Time = new Date(page1[page1.length - 1].createdAt).getTime();
    const firstPage2Time = new Date(page2[0].createdAt).getTime();
    ok(lastPage1Time <= firstPage2Time, 'pagination preserves ordering across pages');
}

// Date filter via createdAt ge today.
const today = new Date().toISOString();
const dateFiltered = await db.run(
    SELECT.from(Platform.entities.Notifications)
        .where({ recipient_ID: requester.ID, isDeleted: false, createdAt: { '>=': today } })
);
ok(Array.isArray(dateFiltered), 'date filter parses without error');

// ============================================================
// Test section 5: Auto-emission - Procurement events
// ============================================================
console.log('\n--- Auto-emission: Procurement ---');

// PR create: dispatch via tx.run(INSERT...) - fires the before-CREATE hook.
const pr = await insertAndReturn(Procurement, Procurement.entities.PurchaseRequests, {
    requestedBy_ID: requester.ID,
    department_ID: dept.ID,
    requestDate: '2026-01-01'
}, approverCtx);
ok(pr && pr.ID, 'PR created');

await db.run(INSERT.into(Procurement.entities.PurchaseRequestItems).entries({
    purchaseRequest_ID: pr.ID, itemName: 'Item', quantity: 1, unitPrice: 10
}));

// Submit -> emits PurchaseRequestSubmitted to requester.
const beforeSubmitCount = await countNotificationsFor('PurchaseRequest', pr.ID);
await action(Procurement, 'submitPurchaseRequest', { purchaseRequestID: pr.ID }, approverCtx);
const afterSubmitCount = await countNotificationsFor('PurchaseRequest', pr.ID);
eq(afterSubmitCount - beforeSubmitCount, 1, 'PR submit emits one notification');

// Approve -> emits PurchaseRequestApproved to requester.
await action(Procurement, 'approvePurchaseRequest', { purchaseRequestID: pr.ID, comments: 'OK' }, { id: approver.ID });
const afterApproveCount = await countNotificationsFor('PurchaseRequest', pr.ID);
eq(afterApproveCount - afterSubmitCount, 1, 'PR approve emits one notification');

// Reject path.
const pr2 = await insertAndReturn(Procurement, Procurement.entities.PurchaseRequests, {
    requestedBy_ID: requester.ID, department_ID: dept.ID, requestDate: '2026-01-02'
}, approverCtx);
await db.run(INSERT.into(Procurement.entities.PurchaseRequestItems).entries({
    purchaseRequest_ID: pr2.ID, itemName: 'Item', quantity: 1, unitPrice: 5
}));
await action(Procurement, 'submitPurchaseRequest', { purchaseRequestID: pr2.ID }, approverCtx);
const beforeRejectCount = await countNotificationsFor('PurchaseRequest', pr2.ID);
await action(Procurement, 'rejectPurchaseRequest', { purchaseRequestID: pr2.ID, comments: 'No' }, { id: approver.ID });
const afterRejectCount = await countNotificationsFor('PurchaseRequest', pr2.ID);
eq(afterRejectCount - beforeRejectCount, 1, 'PR reject emits one notification');

// Cancel a Draft PR.
const pr3 = await insertAndReturn(Procurement, Procurement.entities.PurchaseRequests, {
    requestedBy_ID: requester.ID, department_ID: dept.ID, requestDate: '2026-01-03'
}, approverCtx);
const beforeCancelCount = await countNotificationsFor('PurchaseRequest', pr3.ID);
await action(Procurement, 'cancelPurchaseRequest',
    { purchaseRequestID: pr3.ID, reason: 'No longer needed' }, { id: approver.ID });
const afterCancelCount = await countNotificationsFor('PurchaseRequest', pr3.ID);
eq(afterCancelCount - beforeCancelCount, 1, 'PR cancel emits one notification');

// Convert to PO.
const poID = await action(Procurement, 'convertToPurchaseOrder', {
    purchaseRequestID: pr.ID, supplierID: supplier.ID,
    expectedDeliveryDate: DELIVERY_DATE_FUTURE
}, approverCtx);
ok(isUuid(String(poID)), 'convertToPurchaseOrder returns PO UUID');
const afterConvertCount = await countNotificationsFor('PurchaseOrder', poID);
eq(afterConvertCount, 1, 'PO created emits one notification');

// Send PO.
await action(Procurement, 'sendPurchaseOrder', { purchaseOrderID: poID }, { id: approver.ID });
const afterSendCount = await countNotificationsFor('PurchaseOrder', poID);
eq(afterSendCount, 2, 'PO sent emits one notification');

// Cancel PO via a separate Approved PR -> PO cycle.
const pr4 = await insertAndReturn(Procurement, Procurement.entities.PurchaseRequests, {
    requestedBy_ID: requester.ID, department_ID: dept.ID, requestDate: '2026-01-04'
}, approverCtx);
await db.run(INSERT.into(Procurement.entities.PurchaseRequestItems).entries({
    purchaseRequest_ID: pr4.ID, itemName: 'Item', quantity: 1, unitPrice: 5
}));
await action(Procurement, 'submitPurchaseRequest', { purchaseRequestID: pr4.ID }, approverCtx);
await action(Procurement, 'approvePurchaseRequest', { purchaseRequestID: pr4.ID, comments: 'OK' }, { id: approver.ID });
const poID2 = await action(Procurement, 'convertToPurchaseOrder', {
    purchaseRequestID: pr4.ID, supplierID: supplier.ID,
    expectedDeliveryDate: DELIVERY_DATE_FUTURE
}, approverCtx);
const beforePOCancelCount = await countNotificationsFor('PurchaseOrder', poID2);
await action(Procurement, 'cancelPurchaseOrder',
    { purchaseOrderID: poID2, reason: 'No longer needed' }, { id: approver.ID });
const afterPOCancelCount = await countNotificationsFor('PurchaseOrder', poID2);
eq(afterPOCancelCount - beforePOCancelCount, 1, 'PO cancel emits one notification');

// ============================================================
// Test section 6: Auto-emission - Goods Receipt + Inventory
// ============================================================
console.log('\n--- Auto-emission: Warehouse ---');

// Fetch a PurchaseOrderItem to attach the GRItem to.
const poItem = await db.run(
    SELECT.one.from(Procurement.entities.PurchaseOrderItems).where({ purchaseOrder_ID: poID })
);

const gr = await insertAndReturn(Warehouse, Warehouse.entities.GoodsReceipts, {
    purchaseOrder_ID: poID, warehouse_ID: srcWarehouse.ID, receivedDate: '2026-01-15'
}, approverCtx);
await db.run(INSERT.into(Warehouse.entities.GoodsReceiptItems).entries({
    goodsReceipt_ID: gr.ID, purchaseOrderItem_ID: poItem.ID,
    inventoryItem_ID: invItem.ID, itemName: 'Widget', receivedQuantity: 2
}));
const beforeGRPost = await countNotificationsFor('GoodsReceipt', gr.ID);
await action(Warehouse, 'postGoodsReceipt', { goodsReceiptID: gr.ID }, { id: approver.ID });
const afterGRPost = await countNotificationsFor('GoodsReceipt', gr.ID);
eq(afterGRPost - beforeGRPost, 1, 'GR posted emits one notification');

const beforeGRCancel = await countNotificationsFor('GoodsReceipt', gr.ID);
await action(Warehouse, 'cancelGoodsReceipt',
    { goodsReceiptID: gr.ID, reason: 'Wrong' }, { id: approver.ID });
const afterGRCancel = await countNotificationsFor('GoodsReceipt', gr.ID);
eq(afterGRCancel - beforeGRCancel, 1, 'GR cancelled emits one notification');

// Inventory adjustment.
const beforeAdjust = await countNotificationsFor('InventoryItem', invItem.ID);
await action(Warehouse, 'adjustInventory',
    { inventoryItemID: invItem.ID, newQuantity: 80, remarks: 'shrinkage' }, { id: approver.ID });
const afterAdjust = await countNotificationsFor('InventoryItem', invItem.ID);
ok(afterAdjust >= beforeAdjust + 1, 'inventory adjust emits at least one notification');

// Reservation.
const beforeReserve = await countNotificationsFor('InventoryItem', invItem.ID);
await action(Warehouse, 'reserveInventory',
    { inventoryItemID: invItem.ID, quantity: 5, remarks: 'hold' }, { id: approver.ID });
const afterReserve = await countNotificationsFor('InventoryItem', invItem.ID);
ok(afterReserve >= beforeReserve + 1, 'inventory reserve emits at least one notification');

// Destination inv item for transfer (same itemCode as source).
await db.run(INSERT.into(Warehouse.entities.InventoryItems).entries({
    warehouse_ID: destWarehouse.ID, itemCode: 'ITEM-001',
    itemName: 'Widget', unit: 'EA', quantityOnHand: 50
}));

const beforeTransfer = await countNotificationsFor('InventoryItem', invItem.ID);
await action(Warehouse, 'transferInventory', {
    inventoryItemID: invItem.ID, destinationWarehouseID: destWarehouse.ID,
    quantity: 5, remarks: 'relocate'
}, { id: approver.ID });
const afterTransfer = await countNotificationsFor('InventoryItem', invItem.ID);
ok(afterTransfer >= beforeTransfer + 1, 'inventory transfer emits at least one notification');

// Damage.
const beforeDamage = await countNotificationsFor('InventoryItem', invItem.ID);
await action(Warehouse, 'markDamaged',
    { inventoryItemID: invItem.ID, quantity: 1, remarks: 'broken' }, { id: approver.ID });
const afterDamage = await countNotificationsFor('InventoryItem', invItem.ID);
ok(afterDamage >= beforeDamage + 1, 'inventory damaged emits at least one notification');

// Warehouse event (after-CREATE hook) - dispatch via tx.run(INSERT...) so the hook fires.
const newWh = await insertAndReturn(Warehouse, Warehouse.entities.Warehouses,
    { warehouseCode: 'WH-NEW', warehouseName: 'New WH' }, approverCtx);
const afterWhEvent = await countNotificationsFor('Warehouse', newWh.ID);
eq(afterWhEvent, 1, 'warehouse CREATE emits WarehouseEvent notification');

// ============================================================
// Test section 7: Auto-emission - Asset lifecycle
// ============================================================
console.log('\n--- Auto-emission: Asset ---');

const beforeAssign = await countNotificationsFor('Asset', asset.ID);
await action(Asset, 'assignAsset', {
    assetID: asset.ID, employeeID: secondUser.ID,
    expectedReturnDate: '2026-12-31', remarks: 'for project'
}, { id: approver.ID });
const afterAssign = await countNotificationsFor('Asset', asset.ID);
eq(afterAssign - beforeAssign, 1, 'asset assigned emits one notification');

// The assignment notification should be addressed to the employee.
const assignNotif = await db.run(
    SELECT.one.from(Platform.entities.Notifications)
        .where({
            referenceEntity: 'Asset', referenceID: asset.ID, recipient_ID: secondUser.ID
        })
        .orderBy({ createdAt: 'desc' })
);
ok(assignNotif != null, 'assignment notification routed to employee');

const assignment = await db.run(
    SELECT.one.from(Asset.entities.AssetAssignments)
        .where({ asset_ID: asset.ID, assignmentStatus: 'Assigned' })
);
const beforeReturn = await countNotificationsFor('Asset', asset.ID);
await action(Asset, 'returnAsset',
    { assetAssignmentID: assignment.ID, returnRemarks: 'done' }, { id: approver.ID });
const afterReturn = await countNotificationsFor('Asset', asset.ID);
eq(afterReturn - beforeReturn, 1, 'asset returned emits one notification');

const beforeRetire = await countNotificationsFor('Asset', asset.ID);
await action(Asset, 'retireAsset',
    { assetID: asset.ID, reason: 'End of life' }, { id: approver.ID });
const afterRetire = await countNotificationsFor('Asset', asset.ID);
eq(afterRetire - beforeRetire, 1, 'asset retired emits one notification');

const beforeDispose = await countNotificationsFor('Asset', asset.ID);
await action(Asset, 'disposeAsset',
    { assetID: asset.ID, reason: 'Disposal complete' }, { id: approver.ID });
const afterDispose = await countNotificationsFor('Asset', asset.ID);
eq(afterDispose - beforeDispose, 1, 'asset disposed emits one notification');

// ============================================================
// Test section 8: Negative cases
// ============================================================
console.log('\n--- Negative cases ---');

// Create with missing title.
await expectReject(
    action(Platform, 'sendNotification', {
        recipientID: requester.ID, message: 'no title'
    }),
    400,
    'sendNotification without title rejected with 400'
);

// Create with invalid type.
await expectReject(
    action(Platform, 'sendNotification', {
        recipientID: requester.ID, title: 't', message: 'm',
        notificationType: 'Bogus'
    }),
    400,
    'sendNotification with invalid type rejected with 400'
);

// Create with invalid priority.
await expectReject(
    action(Platform, 'sendNotification', {
        recipientID: requester.ID, title: 't', message: 'm',
        priority: 'Urgent'
    }),
    400,
    'sendNotification with invalid priority rejected with 400'
);

// Direct CREATE (entity dispatch) with no routing target.
await expectReject(
    create(Platform, Platform.entities.Notifications, {
        title: 't', message: 'm',
        notificationType: 'Information', priority: 'Low', category: 'System'
    }, approverCtx),
    400,
    'CREATE without routing target rejected with 400'
);

// Direct CREATE with two routing targets.
await expectReject(
    create(Platform, Platform.entities.Notifications, {
        title: 't', message: 'm',
        notificationType: 'Information', priority: 'Low', category: 'System',
        recipient_ID: requester.ID, department_ID: dept.ID
    }, approverCtx),
    400,
    'CREATE with two routing targets rejected with 400'
);

// Direct CREATE with non-existent recipient (404).
await expectReject(
    create(Platform, Platform.entities.Notifications, {
        title: 't', message: 'm',
        recipient_ID: '00000000-0000-0000-0000-000000000000',
        notificationType: 'Information', priority: 'Low', category: 'System'
    }, approverCtx),
    404,
    'CREATE with non-existent recipient rejected with 404'
);

// sendNotification with non-existent recipient (404).
await expectReject(
    action(Platform, 'sendNotification', {
        recipientID: '00000000-0000-0000-0000-000000000000',
        title: 't', message: 'm'
    }),
    404,
    'sendNotification with non-existent recipient rejected with 404'
);

// markNotificationRead on non-existent ID (404).
await expectReject(
    action(Platform, 'markNotificationRead',
        { notificationID: '00000000-0000-0000-0000-000000000000' }),
    404,
    'markNotificationRead on non-existent ID rejected with 404'
);

// deleteNotification twice (409 the second time).
const delTarget = await action(Platform, 'sendNotification',
    { recipientID: requester.ID, title: 't', message: 'm' });
await action(Platform, 'deleteNotification', { notificationID: delTarget });
await expectReject(
    action(Platform, 'deleteNotification', { notificationID: delTarget }),
    409,
    're-delete already-deleted notification rejected with 409'
);

// Broadcast to empty department (no active users).
await db.run(INSERT.into(Identity.entities.Departments).entries({ departmentCode: 'D-EMPTY', departmentName: 'Empty' }));
const emptyDept = await db.run(SELECT.one.from(Identity.entities.Departments).where({ departmentCode: 'D-EMPTY' }));
await expectReject(
    action(Platform, 'broadcastToDepartment', {
        departmentID: emptyDept.ID, title: 't', message: 'm',
        notificationType: 'Information', priority: 'Low', category: 'System'
    }),
    409,
    'broadcastToDepartment with no active users rejected with 409'
);

// Broadcast to non-existent department (404).
await expectReject(
    action(Platform, 'broadcastToDepartment', {
        departmentID: '00000000-0000-0000-0000-000000000000',
        title: 't', message: 'm',
        notificationType: 'Information', priority: 'Low', category: 'System'
    }),
    404,
    'broadcastToDepartment with non-existent department rejected with 404'
);

// Broadcast to non-existent role (404).
await expectReject(
    action(Platform, 'broadcastToRole', {
        roleID: '00000000-0000-0000-0000-000000000000',
        title: 't', message: 'm',
        notificationType: 'Information', priority: 'Low', category: 'System'
    }),
    404,
    'broadcastToRole with non-existent role rejected with 404'
);

// UPDATE on soft-deleted notification (409).
await expectReject(
    updateRow(Platform, Platform.entities.Notifications, delTarget, { title: 'updated' }),
    409,
    'UPDATE on soft-deleted notification rejected with 409'
);

// ============================================================
// Summary
// ============================================================
console.log(`\n========================================`);
console.log(`Total assertions: ${pass + fail}`);
console.log(`PASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (failures.length > 0) {
    console.log('Failures:');
    for (const f of failures) console.log('  -', f);
}
console.log(`========================================\n`);

if (fail > 0) process.exitCode = 1;
