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

    // -------- Purchase Request lifecycle --------

    action submitPurchaseRequest(
        purchaseRequestID : UUID
    ) returns Boolean;

    action approvePurchaseRequest(
        purchaseRequestID : UUID,
        comments : String
    ) returns Boolean;

    action rejectPurchaseRequest(
        purchaseRequestID : UUID,
        comments : String
    ) returns Boolean;

    action cancelPurchaseRequest(
        purchaseRequestID : UUID,
        reason : String
    ) returns Boolean;

    // -------- Purchase Order lifecycle --------

    action convertToPurchaseOrder(
        purchaseRequestID : UUID,
        supplierID : UUID,
        expectedDeliveryDate : Date
    ) returns UUID;

    action sendPurchaseOrder(
        purchaseOrderID : UUID
    ) returns Boolean;

    action cancelPurchaseOrder(
        purchaseOrderID : UUID,
        reason : String
    ) returns Boolean;

    action closePurchaseOrder(
        purchaseOrderID : UUID
    ) returns Boolean;
}
