import cds from '@sap/cds';
const { INSERT, UPDATE, SELECT } = cds.ql;
(async () => {
    try {
        const model = await cds.load('*', true);
        await cds.deploy(model).to('sqlite::memory:');
        await cds.serve('all').from(model).to('sqlite::memory:');

        // Seed via the shared cds.db directly - commits immediately, no tx
        // to leak locks into a later cross-service SELECT.
        const db = cds.db;
        const Identity = cds.services.IdentityService;
        const Platform = cds.services.PlatformService;

        await db.run(INSERT.into(Identity.entities.Departments).entries({ departmentCode: 'D-IT', departmentName: 'IT' }));
        const dept = await db.run(SELECT.one.from(Identity.entities.Departments));
        console.log('dept:', dept?.ID);

        await db.run(INSERT.into(Identity.entities.Users).entries({
            employeeId: 'E001', firstName: 'A', lastName: 'B',
            email: 'a@b.com', status: 'ACTIVE',
            department_ID: dept.ID
        }));
        const userRow = await db.run(SELECT.one.from(Identity.entities.Users));
        console.log('user:', userRow?.ID);

        // Now trigger Notification CREATE via the Platform service so that
        // before-CREATE validation hook fires (uses tx.send).
        console.log('dispatching notification CREATE...');
        const inserted = await Platform.send({
            event: 'CREATE',
            entity: Platform.entities.Notifications,
            data: {
                title: 'Direct', message: 'Direct insert',
                notificationType: 'Warning', priority: 'High', category: 'System',
                recipient_ID: userRow.ID
            },
            user: { id: 'u1' }
        });
        console.log('dispatched:', inserted?.ID);

        // Action dispatch test
        const unread = await Platform.send({ event: 'getUnreadNotificationCount', data: { recipientID: userRow.ID }, user: { id: 'u1' } });
        console.log('unread:', unread);
    } catch (e) {
        console.log('err:', e?.code || e?.status, e.message, '\n', e.stack);
    }
})();
