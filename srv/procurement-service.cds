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

}