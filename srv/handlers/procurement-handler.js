import cds from '@sap/cds';

export default cds.service.impl(function () {

    const { PurchaseRequests } = this.entities;

    this.before('CREATE', PurchaseRequests, async (req) => {

        const {
            requestedBy,
            department
        } = req.data;

        if (!requestedBy) {
            req.reject(400, 'Requested By is mandatory.');
        }

        if (!department) {
            req.reject(400, 'Department is mandatory.');
        }

    });

    this.on('submitPurchaseRequest', async (req) => {

        return {
            success: true,
            message: 'Purchase Request submitted successfully.'
        };

    });

    this.on('approvePurchaseRequest', async (req) => {

        return {
            success: true,
            message: 'Purchase Request approved successfully.'
        };

    });

    this.on('rejectPurchaseRequest', async (req) => {

        return {
            success: true,
            message: 'Purchase Request rejected successfully.'
        };

    });

    this.on('cancelPurchaseRequest', async (req) => {

        return {
            success: true,
            message: 'Purchase Request cancelled successfully.'
        };

    });

});