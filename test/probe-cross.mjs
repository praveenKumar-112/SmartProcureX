import cds from '@sap/cds';
const { SELECT } = cds.ql;

const model = await cds.load('*', true);
await cds.deploy(model).to('sqlite::memory:');
await cds.serve('all').from(model).to('sqlite::memory:');

const Procurement = cds.services.ProcurementService;
const Warehouse = cds.services.WarehouseService;

const PurchaseOrders = Procurement.entities.PurchaseOrders;
console.log('Attempting WarehouseService tx.run(SELECT.from(PurchaseOrders))...');
try {
    const tx = Warehouse.tx({ user: { id: 'sys' } });
    const r = await tx.run(SELECT.one.from(PurchaseOrders).columns('ID').where({ ID: '00000000-0000-0000-0000-000000000000' }));
    await tx.commit();
    console.log('  OK result:', r);
} catch (e) {
    console.log('  ERR:', e.code ?? 'no-code', e.message);
}
process.exit(0);
