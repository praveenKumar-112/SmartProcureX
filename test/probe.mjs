import cds from '@sap/cds';
const { INSERT } = cds.ql;
(async () => {
    const model = await cds.load('*', true);
    await cds.deploy(model).to('sqlite::memory:');
    await cds.serve('all').from(model).to('sqlite::memory:');
    const srv = cds.services.PlatformService;
    const tx = srv.tx({ user: { id: 'u1' } });
    // Insert a Notification with no routing target - should be rejected by the before-CREATE hook
    try {
        await tx.run(INSERT.into(srv.entities.Notifications).entries({
            title: 't', message: 'm',
            notificationType: 'Information', priority: 'Low', category: 'System'
        }));
        console.log('INSERT OK - hook NOT fired (BAD)');
    } catch (e) {
        console.log('INSERT rejected with code:', e.code || e.status, 'msg:', e.message);
    }
    // Now test creating a valid notification via INSERT with recipient
    try {
        const user = await cds.services.IdentityService.tx({ user: { id: 'u1' } }).run(INSERT.into(cds.services.IdentityService.entities.Users).entries({ employeeId: 'E1', firstName: 'a', lastName: 'b', email: 'e@x.com', status: 'ACTIVE' }));
        const u = (await cds.services.IdentityService.run(cds.ql.SELECT.one.from(cds.services.IdentityService.entities.Users))).ID;
        const n = await tx.run(INSERT.into(srv.entities.Notifications).entries({ title: 't', message: 'm', notificationType: 'Information', priority: 'Low', category: 'System', recipient_ID: u }));
        console.log('INSERT valid returned:', JSON.stringify(n));
        const rows = await tx.run(cds.ql.SELECT.from(srv.entities.Notifications));
        console.log('notifications count:', rows.length);
    } catch (e) {
        console.log('second err:', e.code || e.status, e.message);
    }
})();
