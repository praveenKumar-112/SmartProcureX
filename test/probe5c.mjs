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
console.log('seeded');

function dISO(n) { const d = new Date(); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().split('T')[0]; }
const DELIVERY = dISO(30);
const user = { id: approver.ID };

const prTx = Proc.tx({ user });
await prTx.run(INSERT.into(Proc.entities.PurchaseRequests).entries({
    requestedBy_ID: usr.ID, department_ID: dept.ID, requestDate: '2026-01-01'
}));
const pr = await db.run(SELECT.one.from(Proc.entities.PurchaseRequests).orderBy({ createdAt: 'desc' }));
await db.run(INSERT.into(Proc.entities.PurchaseRequestItems).entries({
    purchaseRequest_ID: pr.ID, itemName: 'I', quantity: 1, unitPrice: 10
}));
await Proc.send({ event: 'submitPurchaseRequest', data: { purchaseRequestID: pr.ID }, user });
await Proc.send({ event: 'approvePurchaseRequest', data: { purchaseRequestID: pr.ID, comments: 'OK' }, user });
const poID = await Proc.send({
    event: 'convertToPurchaseOrder',
    data: { purchaseRequestID: pr.ID, supplierID: sup.ID, expectedDeliveryDate: DELIVERY },
    user
});
await Proc.send({ event: 'sendPurchaseOrder', data: { purchaseOrderID: poID }, user });
console.log('PO setup done', poID);

const PO = Proc.entities.PurchaseOrders;

// Test: open warehouse tx, INSERT a row (no hook yet) so the INSERT locks the GR table,
// THEN cds.db.run(SELECT.from(PurchaseOrders)).
console.log('test C: INSERT into GoodsReceipts via Wh.tx (no before-CREATE registered)');
const wtx2 = Wh.tx({ user });
await wtx2.run(INSERT.into(Wh.entities.GoodsReceipts).entries({
    ID: '11111111-1111-1111-1111-111111111111',
    purchaseOrder_ID: poID, warehouse_ID: wh.ID, receivedDate: '2026-01-15'
}));
console.log('C INSERT ok');
const ticker = setTimeout(() => console.log('C cds.db.run still pending 3s...'), 3000);
try {
    const c = await cds.db.run(SELECT.one.from(PO).columns('ID','status').where({ID: poID}));
    clearTimeout(ticker);
    console.log('C ok:', c && c.ID, c && c.status);
} catch (e) {
    clearTimeout(ticker);
    console.log('C failed:', e?.message ?? e);
}
process.exit(0);
