/**
 * SmartProcureX - Procurement E2E acceptance tests
 * --------------------------------------------------
 * Responsibility:
 *   Exercise the Procurement framework end-to-end against the live
 *   CAP runtime + an ephemeral sqlite in-memory database.
 */
import cds from '@sap/cds';

const { SELECT, INSERT, UPDATE } = cds.ql;

function isoDateInNDays(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().split('T')[0];
}

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
    const isNum = (v) => v !== null && v !== '' && !isNaN(v);
    const equal = actual === expected ||
        (isNum(actual) && isNum(expected) && Number(actual) === Number(expected));
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

// Bootstrap
const model = await cds.load('*', true);
await cds.deploy(model).to('sqlite::memory:');
await cds.serve('all').from(model).to('sqlite::memory:');

const db = cds.db;
const Identity = cds.services.IdentityService;
const Supplier = cds.services.SupplierService;
const Procurement = cds.services.ProcurementService;

async function create(svc, entityRef, data, user) {
    const tx = svc.tx({ user: user ?? defaultUser });
    await tx.run(INSERT.into(entityRef).entries(data));
    const latest = await db.run(
        SELECT.one.from(entityRef).orderBy({ createdAt: 'desc' })
    );
    return latest;
}

async function updateRow(svc, entityRef, id, patch, user) {
    const tx = svc.tx({ user: user ?? defaultUser });
    return tx.run(UPDATE(entityRef).set(patch).where({ ID: id }));
}

async function del(svc, entityRef, id, user) {
    const tx = svc.tx({ user: user ?? defaultUser });
    return tx.run(cds.ql.DELETE.from(entityRef, id));
}

async function action(svc, event, data, user) {
    return svc.send({ event, data, user: user ?? defaultUser });
}

const defaultUser = { id: 'system' };

// Seed
await db.run(INSERT.into(Identity.entities.Departments).entries({ departmentCode: 'D-PRO', departmentName: 'Procurement' }));
const dept = await db.run(SELECT.one.from(Identity.entities.Departments));
await db.run(INSERT.into(Identity.entities.Roles).entries({ roleCode: 'APPROVER', roleName: 'Approver' }));
const roleApp = await db.run(SELECT.one.from(Identity.entities.Roles).where({ roleCode: 'APPROVER' }));

await db.run(INSERT.into(Identity.entities.Users).entries({
    employeeId: 'E-REQ', firstName: 'Requester', lastName: 'R',
    email: 'req@example.com', status: 'ACTIVE', department_ID: dept.ID
}));
await db.run(INSERT.into(Identity.entities.Users).entries({
    employeeId: 'E-APP', firstName: 'Approver', lastName: 'A',
    email: 'app@example.com', status: 'ACTIVE', department_ID: dept.ID, role_ID: roleApp.ID
}));

const requester = await db.run(SELECT.one.from(Identity.entities.Users).where({ employeeId: 'E-REQ' }));
const approver = await db.run(SELECT.one.from(Identity.entities.Users).where({ employeeId: 'E-APP' }));

await db.run(INSERT.into(Supplier.entities.Suppliers).entries({ supplierCode: 'S-ACTIVE', supplierName: 'Acme', status: 'ACTIVE' }));
await db.run(INSERT.into(Supplier.entities.Suppliers).entries({ supplierCode: 'S-INACT', supplierName: 'DeadCorp', status: 'INACTIVE' }));
const supplierAct = await db.run(SELECT.one.from(Supplier.entities.Suppliers).where({ supplierCode: 'S-ACTIVE' }));
const supplierIna = await db.run(SELECT.one.from(Supplier.entities.Suppliers).where({ supplierCode: 'S-INACT' }));

console.log('\n--- PR Lifecycle ---');
// 1. Missing fields rejection
await expectReject(create(Procurement, Procurement.entities.PurchaseRequests, {}, { id: requester.ID }), 400, 'PR create missing reqBy');
await expectReject(create(Procurement, Procurement.entities.PurchaseRequests, { requestedBy_ID: requester.ID }, { id: requester.ID }), 400, 'PR create missing dept');

// 2. Successful PR Create
const pr1 = await create(Procurement, Procurement.entities.PurchaseRequests, {
    requestedBy_ID: requester.ID,
    department_ID: dept.ID
}, { id: requester.ID });

ok(pr1.ID, 'PR created');
eq(pr1.status, 'Draft', 'PR status is Draft');
eq(pr1.totalAmount, 0, 'PR initial total is 0');
ok(pr1.requestNumber.startsWith('PR-'), 'PR number prefix applied (Regression: number-range generation)');

// 3. Add items
await expectReject(create(Procurement, Procurement.entities.PurchaseRequestItems, {
    purchaseRequest_ID: pr1.ID, itemName: 'Pen', quantity: -1, unitPrice: 10
}, { id: requester.ID }), 400, 'Negative quantity rejected');

await expectReject(create(Procurement, Procurement.entities.PurchaseRequestItems, {
    purchaseRequest_ID: pr1.ID, itemName: 'Pen', quantity: 1, unitPrice: -10
}, { id: requester.ID }), 400, 'Negative price rejected');

const item1 = await create(Procurement, Procurement.entities.PurchaseRequestItems, {
    purchaseRequest_ID: pr1.ID, itemName: 'Pen', quantity: 10, unitPrice: 2.5
}, { id: requester.ID });

ok(item1.ID, 'Item added');
eq(item1.totalPrice, 25, 'Line total calculated correctly');

// Check PR total rollup
const prAfterItem1 = await db.run(SELECT.one.from(Procurement.entities.PurchaseRequests).where({ ID: pr1.ID }));
eq(prAfterItem1.totalAmount, 25, 'PR totalAmount rolled up on create');

// 4. Update item
await updateRow(Procurement, Procurement.entities.PurchaseRequestItems, item1.ID, { quantity: 20 }, { id: requester.ID });
const prAfterUpdate = await db.run(SELECT.one.from(Procurement.entities.PurchaseRequests).where({ ID: pr1.ID }));
eq(prAfterUpdate.totalAmount, 50, 'PR totalAmount rolled up on update');

// 5. Submit PR
await expectReject(action(Procurement, 'submitPurchaseRequest', { purchaseRequestID: 'invalid' }, { id: requester.ID }), 404, 'Invalid UUID submit');
await action(Procurement, 'submitPurchaseRequest', { purchaseRequestID: pr1.ID }, { id: requester.ID });
const prAfterSubmit = await db.run(SELECT.one.from(Procurement.entities.PurchaseRequests).where({ ID: pr1.ID }));
eq(prAfterSubmit.status, 'Submitted', 'PR submitted');

// Items locked
await expectReject(updateRow(Procurement, Procurement.entities.PurchaseRequestItems, item1.ID, { quantity: 30 }, { id: requester.ID }), 409, 'Cannot modify item after submit');
await expectReject(del(Procurement, Procurement.entities.PurchaseRequestItems, item1.ID, { id: requester.ID }), 409, 'Cannot delete item after submit');

// 6. Approve PR
await expectReject(action(Procurement, 'approvePurchaseRequest', { purchaseRequestID: pr1.ID }, { id: requester.ID }), 403, 'Unauthorized approval');
await action(Procurement, 'approvePurchaseRequest', { purchaseRequestID: pr1.ID, comments: 'LGTM' }, { id: approver.ID });
const prAfterApprove = await db.run(SELECT.one.from(Procurement.entities.PurchaseRequests).where({ ID: pr1.ID }));
eq(prAfterApprove.status, 'Approved', 'PR approved');
await expectReject(action(Procurement, 'approvePurchaseRequest', { purchaseRequestID: pr1.ID }, { id: approver.ID }), 409, 'Duplicate approval prevented');

// 7. Convert PR to PO
await expectReject(action(Procurement, 'convertToPurchaseOrder', { purchaseRequestID: pr1.ID, supplierID: supplierIna.ID }, { id: requester.ID }), 409, 'Inactive supplier conversion prevented');
const poID = await action(Procurement, 'convertToPurchaseOrder', { purchaseRequestID: pr1.ID, supplierID: supplierAct.ID }, { id: requester.ID });
ok(poID, 'PO created from PR');

const prAfterConvert = await db.run(SELECT.one.from(Procurement.entities.PurchaseRequests).where({ ID: pr1.ID }));
eq(prAfterConvert.status, 'ConvertedToPO', 'PR status is ConvertedToPO');

const po = await db.run(SELECT.one.from(Procurement.entities.PurchaseOrders).where({ ID: poID }));
eq(po.status, 'Created', 'PO status is Created');
eq(po.totalAmount, 50, 'PO totalAmount matches PR');
ok(po.poNumber.startsWith('PO-'), 'PO number prefixed');

// 8. PO Items
const poItems = await db.run(SELECT.from(Procurement.entities.PurchaseOrderItems).where({ purchaseOrder_ID: poID }));
eq(poItems.length, 1, 'PO items copied');
eq(poItems[0].quantity, 20, 'Quantity matches');

// 9. Send PO
await action(Procurement, 'sendPurchaseOrder', { purchaseOrderID: poID }, { id: requester.ID });
const poAfterSend = await db.run(SELECT.one.from(Procurement.entities.PurchaseOrders).where({ ID: poID }));
eq(poAfterSend.status, 'Sent', 'PO sent');

// 10. Close PO
await action(Procurement, 'closePurchaseOrder', { purchaseOrderID: poID }, { id: requester.ID });
const poAfterClose = await db.run(SELECT.one.from(Procurement.entities.PurchaseOrders).where({ ID: poID }));
eq(poAfterClose.status, 'Closed', 'PO closed');

// 11. Reject flow
const pr2 = await create(Procurement, Procurement.entities.PurchaseRequests, { requestedBy_ID: requester.ID, department_ID: dept.ID }, { id: requester.ID });
await create(Procurement, Procurement.entities.PurchaseRequestItems, { purchaseRequest_ID: pr2.ID, itemName: 'Desk', quantity: 1, unitPrice: 100 }, { id: requester.ID });
await action(Procurement, 'submitPurchaseRequest', { purchaseRequestID: pr2.ID }, { id: requester.ID });
await expectReject(action(Procurement, 'rejectPurchaseRequest', { purchaseRequestID: pr2.ID }, { id: approver.ID }), 400, 'Rejection needs reason');
await action(Procurement, 'rejectPurchaseRequest', { purchaseRequestID: pr2.ID, comments: 'Too expensive' }, { id: approver.ID });
const pr2AfterReject = await db.run(SELECT.one.from(Procurement.entities.PurchaseRequests).where({ ID: pr2.ID }));
eq(pr2AfterReject.status, 'Rejected', 'PR rejected');

// 12. Cancel flow PR
const pr3 = await create(Procurement, Procurement.entities.PurchaseRequests, { requestedBy_ID: requester.ID, department_ID: dept.ID }, { id: requester.ID });
await expectReject(action(Procurement, 'cancelPurchaseRequest', { purchaseRequestID: pr3.ID }, { id: requester.ID }), 400, 'Cancel needs reason');
await action(Procurement, 'cancelPurchaseRequest', { purchaseRequestID: pr3.ID, reason: 'No longer needed' }, { id: requester.ID });
const pr3AfterCancel = await db.run(SELECT.one.from(Procurement.entities.PurchaseRequests).where({ ID: pr3.ID }));
eq(pr3AfterCancel.status, 'Cancelled', 'PR cancelled');

// 13. Cancel PO
const pr4 = await create(Procurement, Procurement.entities.PurchaseRequests, { requestedBy_ID: requester.ID, department_ID: dept.ID }, { id: requester.ID });
await create(Procurement, Procurement.entities.PurchaseRequestItems, { purchaseRequest_ID: pr4.ID, itemName: 'Chair', quantity: 1, unitPrice: 50 }, { id: requester.ID });
await action(Procurement, 'submitPurchaseRequest', { purchaseRequestID: pr4.ID }, { id: requester.ID });
await action(Procurement, 'approvePurchaseRequest', { purchaseRequestID: pr4.ID, comments: 'OK' }, { id: approver.ID });
const po2ID = await action(Procurement, 'convertToPurchaseOrder', { purchaseRequestID: pr4.ID, supplierID: supplierAct.ID }, { id: requester.ID });
await action(Procurement, 'cancelPurchaseOrder', { purchaseOrderID: po2ID, reason: 'Mistake' }, { id: requester.ID });
const po2AfterCancel = await db.run(SELECT.one.from(Procurement.entities.PurchaseOrders).where({ ID: po2ID }));
eq(po2AfterCancel.status, 'Cancelled', 'PO cancelled');
await expectReject(action(Procurement, 'sendPurchaseOrder', { purchaseOrderID: po2ID }, { id: requester.ID }), 409, 'Cancelled PO cannot be sent');

const total = pass + fail;
console.log('\n========================================');
console.log(`  ${total} assertions: ${pass} PASS / ${fail} FAIL`);
console.log('========================================\n');

if (fail > 0) {
    console.error('Failed assertions:');
    failures.forEach(f => console.error('  -', f));
    process.exit(1);
}
console.log('All procurement tests passed.');
