export default class WhoAmIService extends cds.ApplicationService {
    init() {
        this.on('whoami', req => {
            const user = req.user;
            return JSON.stringify({
                id: user.id,
                roles: Object.keys(user.roles || {}),
                attr: user.attr,
                isAdmin: user.is('Admin'),
                isApprover: user.is('Approver'),
                isRequester: user.is('Requester'),
                isManager: user.is('ProcurementManager')
            }, null, 2);
        });
        return super.init();
    }
}
