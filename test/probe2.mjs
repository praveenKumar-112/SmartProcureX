import cds from '@sap/cds';
const { INSERT, UPDATE, SELECT } = cds.ql;
console.log('start');
(async () => {
    console.log('inside iife');
    try {
        console.log('loading model');
        const model = await cds.load('*', true);
        console.log('model loaded; defs:', Object.keys(model.definitions).length);
        console.log('about to deploy...');
        await cds.deploy(model).to('sqlite::memory:');
        console.log('after deploy');
        await cds.serve('all').from(model).to('sqlite::memory:');
        console.log('after serve');
        const identity = cds.services.IdentityService;
        const platform = cds.services.PlatformService;
        const user = { id: 'u1' };
        const txI = identity.tx({ user });
        console.log('inserting dept...');
        await txI.run(INSERT.into(identity.entities.Departments).entries({
            departmentCode: 'D-IT', departmentName: 'IT'
        }));
        console.log('dept inserted; reading...');
        const dept = await identity.run(SELECT.one.from(identity.entities.Departments));
        console.log('dept:', dept?.ID);
        console.log('inserting user...');
        await txI.run(INSERT.into(identity.entities.Users).entries({
            employeeId: 'E001', firstName: 'A', lastName: 'B',
            email: 'a@b.com', status: 'ACTIVE',
            department_ID: dept.ID
        }));
        console.log('user inserted; reading...');
        const userRow = await identity.run(SELECT.one.from(identity.entities.Users));
        console.log('userRow:', userRow?.ID);
        console.log('about to insert notification...');
        const txP = platform.tx({ user });
        try {
            await txP.run(INSERT.into(platform.entities.Notifications).entries({
                title: 'Direct', message: 'Direct insert',
                notificationType: 'Warning', priority: 'High', category: 'System',
                recipient_ID: userRow.ID
            }));
            console.log('notification inserted; reading...');
        } catch (innerErr) {
            console.log('insert notification failed:', innerErr?.code, innerErr?.message);
        }
        const notifs = await platform.run(SELECT.from(platform.entities.Notifications));
        console.log('rows count after INSERT:', notifs.length);
        const notif = notifs[0];
        console.log('notif ID:', notif.ID, 'isDeleted:', notif.isDeleted);
        await txP.run(UPDATE(platform.entities.Notifications).set({ title: 'Updated' }).where({ ID: notif.ID }));
        const after = await platform.run(SELECT.one.from(platform.entities.Notifications).where({ ID: notif.ID }));
        console.log('after UPDATE title:', after.title);
        try {
            await txP.run(UPDATE(platform.entities.Notifications).set({ recipient_ID: '00000000-0000-0000-0000-000000000000' }).where({ ID: notif.ID }));
            console.log('UPDATE w/ recipient did NOT reject (BAD)');
        } catch (e) {
            console.log('UPDATE w/ recipient rejected:', e.code, e.message);
        }
        // Action dispatch test
        try {
            const r = await platform.send({ event: 'getUnreadNotificationCount', data: { recipientID: userRow.ID } });
            console.log('action result for unreadcount:', r);
        } catch (e) {
            console.log('action err:', e.code || e.status, e.message);
        }
    } catch (e) {
        console.log('outer err:', e.code || e.status, e.message, '\n', e.stack);
    }
})();
