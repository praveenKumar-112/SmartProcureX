using { smartprocurex.procurement as procurement } from '../db/procurement';

service ProcurementService {

    entity PurchaseRequests
        @(restrict: [
            { grant: ['READ', 'CREATE', 'UPDATE'], to: 'Requester' },
            { grant: ['READ', 'UPDATE'], to: 'Approver' },
            { grant: ['READ'], to: 'ProcurementManager' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on procurement.PurchaseRequest;

    entity PurchaseRequestItems
        @(restrict: [
            { grant: ['READ', 'CREATE', 'UPDATE'], to: 'Requester' },
            { grant: ['READ', 'UPDATE'], to: 'Approver' },
            { grant: ['READ'], to: 'ProcurementManager' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on procurement.PurchaseRequestItem;

    entity Approvals
        @(restrict: [
            { grant: ['READ', 'CREATE', 'UPDATE'], to: 'Approver' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on procurement.Approval;

    entity PurchaseOrders
        @(restrict: [
            { grant: ['READ', 'CREATE', 'UPDATE'], to: 'ProcurementManager' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on procurement.PurchaseOrder;

    entity PurchaseOrderItems
        @(restrict: [
            { grant: ['READ', 'CREATE', 'UPDATE'], to: 'ProcurementManager' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on procurement.PurchaseOrderItem;

    // -------- Purchase Request lifecycle --------

    action submitPurchaseRequest(
        purchaseRequestID : UUID
    ) returns Boolean
    @(requires: ['Requester', 'Admin']);

    action approvePurchaseRequest(
        purchaseRequestID : UUID,
        comments : String
    ) returns Boolean
    @(requires: ['Approver', 'Admin']);

    action rejectPurchaseRequest(
        purchaseRequestID : UUID,
        comments : String
    ) returns Boolean
    @(requires: ['Approver', 'Admin']);

    action cancelPurchaseRequest(
        purchaseRequestID : UUID,
        reason : String
    ) returns Boolean
    @(requires: ['Requester', 'Admin']);

    // -------- Purchase Order lifecycle --------

    action convertToPurchaseOrder(
        purchaseRequestID : UUID,
        supplierID : UUID,
        expectedDeliveryDate : Date
    ) returns UUID
    @(requires: ['ProcurementManager', 'Admin']);

    action sendPurchaseOrder(
        purchaseOrderID : UUID
    ) returns Boolean
    @(requires: ['ProcurementManager', 'Admin']);

    action cancelPurchaseOrder(
        purchaseOrderID : UUID,
        reason : String
    ) returns Boolean
    @(requires: ['ProcurementManager', 'Admin']);

    action closePurchaseOrder(
        purchaseOrderID : UUID
    ) returns Boolean
    @(requires: ['ProcurementManager', 'Admin']);
}
