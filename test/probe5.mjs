import cds from '@sap/cds';

const model = await cds.load('*', true);
await cds.deploy(model).to('sqlite::memory:');
await cds.serve('all').from(model).to('sqlite::memory:');

const Proc = cds.services.ProcurementService;
const Wh = cds.services.WarehouseService;
const Iden = cds.services.IdentityService;
const Sup = cds.services.SupplierService;
const db = cds.db;
const { SELECT, INSERT } = cds.ql;

await db.run(INSERT.into(Iden.entities.Departments).entries({ departmentCode: 'D-IT', departmentName: 'IT' }));
await db.run(INSERT.into(Iden.entities.Roles).entries({ roleCode: 'APPROVER', roleName: 'Approver' }));
const dept = await db.run(SELECT.one.from(Iden.entities.Departments));
const role = await db.run(SELECT.one.from(Iden.entities.Roles).where({ roleCode: 'APPROVER' }));
await db.run(INSERT.into(Iden.entities.Users).entries({
    employeeId: 'E001', firstName: 'Alice', lastName: 'R',
    email: 'a@example.com', status: 'ACTIVE',
    department_ID: dept.ID, role_ID: role.ID
}));
await db.run(INSERT.into(Iden.entities.Users).entries({
    employeeId: 'E002', firstName: 'Bob', lastName: 'Approver',
    email: 'b@example.com', status: 'ACTIVE',
    department_ID: dept.ID, role_ID: role.ID
}));
const usr = await db.run(SELECT.one.from(Iden.entities.Users).where({ employeeId: 'E001' }));
const approver = await db.run(SELECT.one.from(Iden.entities.Users).where({ employeeId: 'E002' }));
await db.run(INSERT.into(Sup.entities.Suppliers).entries({ supplierCode: 'S1', supplierName: 'Acme', status: 'ACTIVE' }));
const sup = await db.run(SELECT.one.from(Sup.entities.Suppliers).where({ supplierCode: 'S1' }));
await db.run(INSERT.into(Wh.entities.Warehouses).entries({ warehouseCode: 'WH-A', warehouseName: 'A', status: 'ACTIVE' }));
const wh = await db.run(SELECT.one.from(Wh.entities.Warehouses).where({ warehouseCode: 'WH-A' }));
await db.run(INSERT.into(Wh.entities.InventoryItems).entries({
    warehouse_ID: wh.ID, itemCode: 'ITEM-001', itemName: 'Widget', unit: 'EA', quantityOnHand: 100
}));
const inv = await db.run(SELECT.one.from(Wh.entities.InventoryItems).where({ itemCode: 'ITEM-001' }));
console.log('seeded');

function dISO(n) { const d = new Date(); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().split('T')[0]; }
const DELIVERY = dISO(30);
const user = { id: approver.ID };

const prTx = Proc.tx({ user });
await prTx.run(INSERT.into(Proc.entities.PurchaseRequests).entries({
    requestedBy_ID: usr.ID, department_ID: dept.ID, requestDate: '2026-01-01'
}));
const pr = await db.run(SELECT.one.from(Proc.entities.PurchaseRequests).orderBy({ createdAt: 'desc' }));
console.log('PR', pr.ID);

await db.run(INSERT.into(Proc.entities.PurchaseRequestItems).entries({
    purchaseRequest_ID: pr.ID, itemName: 'I', quantity: 1, unitPrice: 10
}));
await Proc.send({ event: 'submitPurchaseRequest', data: { purchaseRequestID: pr.ID }, user });
console.log('submitted');
await Proc.send({ event: 'approvePurchaseRequest', data: { purchaseRequestID: pr.ID, comments: 'OK' }, user });
console.log('approved');

const poID = await Proc.send({
    event: 'convertToPurchaseOrder',
    data: { purchaseRequestID: pr.ID, supplierID: sup.ID, expectedDeliveryDate: DELIVERY },
    user
});
console.log('PO', poID);
await Proc.send({ event: 'sendPurchaseOrder', data: { purchaseOrderID: poID }, user });
console.log('sent');

const poItem = await db.run(SELECT.one.from(Proc.entities.PurchaseOrderItems).where({ purchaseOrder_ID: poID }));
console.log('POItem', poItem.ID);

// Now: this is where the e2e test hangs.
const grTx = Wh.tx({ user });
console.log('INSERT GR start (this triggers warehouse before-CREATE which reads PurchaseOrders) ...');
const ticker = setTimeout(() => console.log('still pending after 5s...'), 5000);
try {
    await grTx.run(INSERT.into(Wh.entities.GoodsReceipts).entries({
        purchaseOrder_ID: poID, warehouse_ID: wh.ID, receivedDate: '2026-01-15'
    }));
    clearTimeout(ticker);
    console.log('GR INSERT returned OK');
} catch (e) {
    clearTimeout(ticker);
    console.log('GR INSERT failed:', e?.message ?? e, e?.code ?? '');
}
process.exit(0);
