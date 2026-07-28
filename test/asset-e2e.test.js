/**
 * SmartProcureX - Asset E2E acceptance tests
 * --------------------------------------------------
 * Responsibility:
 *   Exercise the Asset framework end-to-end against the live CAP runtime
 *   + an ephemeral sqlite database.
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
const Asset = cds.services.AssetService;
const Warehouse = cds.services.WarehouseService;
const Identity = cds.services.IdentityService;

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

async function action(svc, event, data, user) {
    return svc.send({ event, data, user: user ?? defaultUser });
}

async function del(svc, entityRef, id, user) {
    const tx = svc.tx({ user: user ?? defaultUser });
    return tx.run(cds.ql.DELETE.from(entityRef, id));
}

const defaultUser = { id: 'system' };

// Seed prerequisites
await db.run(INSERT.into(Warehouse.entities.Warehouses).entries({ warehouseCode: 'WH-AST', warehouseName: 'Asset WH', status: 'ACTIVE' }));
const wh = await db.run(SELECT.one.from(Warehouse.entities.Warehouses).where({ warehouseCode: 'WH-AST' }));

await db.run(INSERT.into(Warehouse.entities.InventoryItems).entries({
    warehouse_ID: wh.ID, itemCode: 'INV-LAP', itemName: 'Laptop Stock', quantityOnHand: 5, unit: 'EA', status: 'ACTIVE'
}));
const inv1 = await db.run(SELECT.one.from(Warehouse.entities.InventoryItems).where({ itemCode: 'INV-LAP' }));

await db.run(INSERT.into(Warehouse.entities.InventoryItems).entries({
    warehouse_ID: wh.ID, itemCode: 'INV-LAP2', itemName: 'Laptop Stock 2', quantityOnHand: 5, unit: 'EA', status: 'ACTIVE'
}));
const inv2 = await db.run(SELECT.one.from(Warehouse.entities.InventoryItems).where({ itemCode: 'INV-LAP2' }));

await db.run(INSERT.into(Identity.entities.Departments).entries({ departmentCode: 'D-IT', departmentName: 'IT Dept' }));
const dept = await db.run(SELECT.one.from(Identity.entities.Departments));

await db.run(INSERT.into(Identity.entities.Users).entries({
    employeeId: 'EMP-01', firstName: 'Alice', lastName: 'A',
    email: 'a@example.com', status: 'ACTIVE', department_ID: dept.ID
}));
const emp1 = await db.run(SELECT.one.from(Identity.entities.Users).where({ employeeId: 'EMP-01' }));

console.log('\n--- Asset Lifecycle ---');
const cat = await create(Asset, Asset.entities.AssetCategories, { categoryCode: 'LAP', categoryName: 'Laptops' });
ok(cat.ID, 'Asset Category created');

await expectReject(create(Asset, Asset.entities.Assets, {
    assetName: 'Laptop A', assetCategory_ID: cat.ID
}), 400, 'Asset Code mandatory');

const ast1 = await create(Asset, Asset.entities.Assets, {
    assetCode: 'AST-100', assetName: 'Laptop A', assetCategory_ID: cat.ID, inventoryItem_ID: inv1.ID
});
ok(ast1.ID, 'Asset created');
eq(ast1.assetStatus, 'Available', 'Initial asset status is Available');

// Immutable assetCode check
await expectReject(updateRow(Asset, Asset.entities.Assets, ast1.ID, { assetCode: 'AST-101' }), 400, 'Asset Code is immutable');

// Delete guards
await expectReject(del(Asset, Asset.entities.Assets, ast1.ID), 409, 'Only Disposed assets can be deleted');

console.log('\n--- Asset Assignment ---');
// Assign
await expectReject(action(Asset, 'assignAsset', { assetID: ast1.ID, employeeID: 'invalid' }), 404, 'Invalid employee reference');
await action(Asset, 'assignAsset', { assetID: ast1.ID, employeeID: emp1.ID });

const astAfterAssign = await db.run(SELECT.one.from(Asset.entities.Assets).where({ ID: ast1.ID }));
eq(astAfterAssign.assetStatus, 'Assigned', 'Status updated to Assigned');
eq(astAfterAssign.assignedTo_ID, emp1.ID, 'assignedTo_ID set');
ok(astAfterAssign.currentAssignment_ID, 'currentAssignment_ID set');

const assignmentID = astAfterAssign.currentAssignment_ID;

// Double assign
await expectReject(action(Asset, 'assignAsset', { assetID: ast1.ID, employeeID: emp1.ID }), 409, 'Asset cannot be assigned while Assigned');

console.log('\n--- Asset Return ---');
await expectReject(action(Asset, 'returnAsset', { assetAssignmentID: 'invalid' }), 404, 'Invalid assignment ID');
await action(Asset, 'returnAsset', { assetAssignmentID: assignmentID, returnRemarks: 'Good condition' });

const astAfterReturn = await db.run(SELECT.one.from(Asset.entities.Assets).where({ ID: ast1.ID }));
eq(astAfterReturn.assetStatus, 'Available', 'Status updated to Available');
eq(astAfterReturn.assignedTo_ID, null, 'assignedTo_ID cleared');

console.log('\n--- Asset Transfer ---');
// Transfer inventory reference
await expectReject(action(Asset, 'transferAsset', { assetID: ast1.ID, destinationInventoryItemID: inv1.ID }), 400, 'Cannot transfer to same inventory item');
await action(Asset, 'transferAsset', { assetID: ast1.ID, destinationInventoryItemID: inv2.ID });

const astAfterTransfer = await db.run(SELECT.one.from(Asset.entities.Assets).where({ ID: ast1.ID }));
eq(astAfterTransfer.inventoryItem_ID, inv2.ID, 'inventoryItem_ID updated');

console.log('\n--- Asset Retire & Dispose ---');
await action(Asset, 'retireAsset', { assetID: ast1.ID, reason: 'Too old' });
const astAfterRetire = await db.run(SELECT.one.from(Asset.entities.Assets).where({ ID: ast1.ID }));
eq(astAfterRetire.assetStatus, 'Retired', 'Status updated to Retired');

await expectReject(action(Asset, 'assignAsset', { assetID: ast1.ID, employeeID: emp1.ID }), 409, 'Retired asset cannot be assigned');

await expectReject(action(Asset, 'disposeAsset', { assetID: 'invalid', reason: 'Trash' }), 404, 'Invalid asset disposal');
await action(Asset, 'disposeAsset', { assetID: ast1.ID, reason: 'Trash' });

const astAfterDispose = await db.run(SELECT.one.from(Asset.entities.Assets).where({ ID: ast1.ID }));
eq(astAfterDispose.assetStatus, 'Disposed', 'Status updated to Disposed');

// Now deletion should be allowed
await del(Asset, Asset.entities.Assets, ast1.ID);
const astDeleted = await db.run(SELECT.one.from(Asset.entities.Assets).where({ ID: ast1.ID }));
eq(astDeleted, undefined, 'Asset deleted successfully');

const total = pass + fail;
console.log('\n========================================');
console.log(`  ${total} assertions: ${pass} PASS / ${fail} FAIL`);
console.log('========================================\n');

if (fail > 0) {
    console.error('Failed assertions:');
    failures.forEach(f => console.error('  -', f));
    process.exit(1);
}
console.log('All asset tests passed.');
