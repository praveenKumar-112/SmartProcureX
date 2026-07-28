import cds from '@sap/cds';
const { INSERT, UPDATE, SELECT } = cds.ql;
(async () => {
    try {
        const model = await cds.load('*', true);
        await cds.deploy(model).to('sqlite::memory:');
        await cds.serve('all').from(model).to('sqlite::memory:');

        const db = cds.db;
        const Identity = cds.services.IdentityService;
        const Platform = cds.services.PlatformService;

        await db.run(INSERT.into(Identity.entities.Departments).entries({ departmentCode: 'D-IT', departmentName: 'IT' }));
        const dept = await db.run(SELECT.one.from(Identity.entities.Departments));

        await db.run(INSERT.into(Identity.entities.Users).entries({
            employeeId: 'E001', firstName: 'A', lastName: 'B',
            email: 'a@b.com', status: 'ACTIVE',
            department_ID: dept.ID
        }));
        const userRow = await db.run(SELECT.one.from(Identity.entities.Users));

        // Approach A: srv.send with entity as canonical string name + a cds.ql query
        const variants = [
            { event: 'CREATE', entity: 'PlatformService.Notifications', data: { title: 'T1', message: 'M', notificationType: 'Warning', priority: 'High', category: 'System', recipient_ID: userRow.ID } },
            { event: 'CREATE', entity: 'Notifications', data: { title: 'T2', message: 'M', notificationType: 'Warning', priority: 'High', category: 'System', recipient_ID: userRow.ID } },
        ];
        for (const v of variants) {
            try {
                console.log('trying:', v.entity);
                const r = await Platform.send({ ...v, user: { id: 'u1' } });
                console.log('  ok:', r?.ID);
            } catch (e) {
                console.log('  err:', e.code || e.status, e.message);
            }
        }

        // Approach B: action dispatch with cds.ql as INSERT
        try {
            console.log('Trying direct tx.run(INSERT) to see the hang...');
            const r = await Platform.tx({ user: { id: 'u1' } }).run(INSERT.into(Platform.entities.Notifications).entries({ title: 'Tx', message: 'M', notificationType: 'Warning', priority: 'High', category: 'System', recipient_ID: userRow.ID }));
            console.log('tx.run INSERT ok (returned):', r);
        } catch (e) {
            console.log('tx.run INSERT err:', e.code || e.status, e.message);
        }

        // Verify what's now in the table.
        const rows = await db.run(SELECT.from(Platform.entities.Notifications));
        console.log('rows count:', rows.length);
        for (const r of rows) console.log('  row:', r.ID, r.title);
    } catch (e) {
        console.log('outer err:', e?.code || e?.status, e.message, '\n', e.stack);
    }
})();
