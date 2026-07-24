using { smartprocurex.procurement as procurement } from '../db/procurement';

service ProcurementService {

    entity PurchaseRequests
        as projection on procurement.PurchaseRequest;

    entity PurchaseRequestItems
        as projection on procurement.PurchaseRequestItem;

    entity Approvals
        as projection on procurement.Approval;

    entity PurchaseOrders
        as projection on procurement.PurchaseOrder;

    entity PurchaseOrderItems
        as projection on procurement.PurchaseOrderItem;

    action submitPurchaseRequest(
        purchaseRequestID : UUID
    );

    action approvePurchaseRequest(
        purchaseRequestID : UUID,
        comments : String
    );

    action rejectPurchaseRequest(
        purchaseRequestID : UUID,
        comments : String
    );

    action cancelPurchaseRequest(
        purchaseRequestID : UUID,
        reason : String
    );

}