namespace smartprocurex.procurement;

using { cuid, managed } from '@sap/cds/common';
using {
  smartprocurex.identity.User,
  smartprocurex.identity.Department
} from './identity';
using { smartprocurex.supplier.Supplier } from './supplier';

type PurchaseRequestStatus : String enum {
  Draft;
  Submitted;
  Approved;
  Rejected;
  ConvertedToPO;
  Cancelled;
}

type ApprovalDecision : String enum {
  Pending;
  Approved;
  Rejected;
  Returned;
}

type PurchaseOrderStatus : String enum {
  Created;
  Sent;
  PartiallyReceived;
  Received;
  Closed;
  Cancelled;
}

entity PurchaseRequest : cuid, managed {
  requestNumber      : String(30) not null;
  requestDate        : Date       not null;
  requestedBy        : Association to User;
  department         : Association to Department;
  priority           : String(30);
  justification      : String(1000);
  totalAmount        : Decimal(15, 2) default 0;
  status             : PurchaseRequestStatus not null default #Draft;

  // Audit fields populated by reject/cancel actions (AD-17).
  // Stored on the header row so the document carries its own lifecycle
  // history without requiring a join to the Approval composition.
  rejectionReason    : String(1000);
  rejectedBy         : Association to User;
  rejectedAt         : DateTime;
  cancellationReason : String(1000);
  cancelledBy        : Association to User;
  cancelledAt        : DateTime;

  items              : Composition of many PurchaseRequestItem
                         on items.purchaseRequest = $self;
  approvals          : Composition of many Approval
                         on approvals.purchaseRequest = $self;
  purchaseOrder      : Composition of one PurchaseOrder
                         on purchaseOrder.purchaseRequest = $self;
}

entity PurchaseRequestItem : cuid, managed {
  purchaseRequest : Association to PurchaseRequest;
  itemName        : String(150)    not null;
  description     : String(500);
  quantity        : Decimal(13, 3) not null;
  unitPrice       : Decimal(15, 2) not null;
  totalPrice      : Decimal(15, 2) default 0;
  requiredDate    : Date;
}

entity Approval : cuid, managed {
  // One of purchaseRequest / purchaseOrder is non-null depending on the
  // document being audited (AD-19 - re-usable Approval entity).
  purchaseRequest : Association to PurchaseRequest;
  purchaseOrder   : Association to PurchaseOrder;
  approver        : Association to User;
  approvalLevel   : Integer not null;
  approvalDate    : DateTime;
  decision        : ApprovalDecision not null default #Pending;
  comments        : String(1000);
}

entity PurchaseOrder : cuid, managed {
  poNumber             : String(30) not null;
  supplier             : Association to Supplier;
  purchaseRequest      : Association to PurchaseRequest;
  orderDate            : Date       not null;
  expectedDeliveryDate : Date;
  totalAmount          : Decimal(15, 2) default 0;
  status               : PurchaseOrderStatus not null default #Created;

  // Audit fields populated by send / cancel actions (AD-17 extended to PO).
  sentBy               : Association to User;
  sentAt               : DateTime;
  cancellationReason   : String(1000);
  cancelledBy          : Association to User;
  cancelledAt          : DateTime;

  items                : Composition of many PurchaseOrderItem
                           on items.purchaseOrder = $self;
  approvals            : Composition of many Approval
                           on approvals.purchaseOrder = $self;
}

entity PurchaseOrderItem : cuid, managed {
  purchaseOrder : Association to PurchaseOrder;
  itemName      : String(150)    not null;
  description   : String(500);
  quantity      : Decimal(13, 3) not null;
  unitPrice     : Decimal(15, 2) not null;
  totalPrice    : Decimal(15, 2) default 0;
  receivedQuantity : Decimal(13, 3) not null default 0;
}
