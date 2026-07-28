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

// Monkeypatch cds.db.run to log every cross-service call.
const _dbRun = cds.db.run.bind(cds.db);
let depth = 0;
cds.db.run = async (q, ...rest) => {
    depth++;
    const tag = q?.SELECT ? 'SELECT '+(q.SELECT.from?.ref?.[0] || '?') :
                q?.INSERT ? 'INSERT '+(q.INSERT.into?.target?.name || q.INSERT.into?.ref?.[0]?.id || '?') :
                q?.UPDATE ? 'UPDATE '+(q.UPDATE.entity?.name || q.UPDATE?.update?._target?.name || '?') :
                '???';
    console.log('  '.repeat(depth) + 'â†’ cds.db.run [' + tag + ']');
    try {
        const r = await _dbRun(q, ...rest);
        console.log('  '.repeat(depth) + 'â† ok');
        return r;
    } catch (e) {
        console.log('  '.repeat(depth) + 'â† ERR:', e?.message ?? e);
        throw e;
    } finally {
        depth--;
    }
};

console.log('test: Wh.tx(...).run(INSERT into GoodsReceipts) - log all cds.db.run calls');
const ticker = setTimeout(() => console.log('still pending 4s...'), 4000);
try {
    const grTx = Wh.tx({ user });
    await grTx.run(INSERT.into(Wh.entities.GoodsReceipts).entries({
        purchaseOrder_ID: poID, warehouse_ID: wh.ID, receivedDate: '2026-01-15'
    }));
    clearTimeout(ticker);
    console.log('GR INSERT returned');
} catch (e) {
    clearTimeout(ticker);
    console.log('GR INSERT failed:', e?.message ?? e);
}
process.exit(0);
