namespace smartprocurex.warehouse;

using { cuid, managed } from '@sap/cds/common';
using { smartprocurex.identity.User } from './identity';
using { smartprocurex.procurement.PurchaseOrder, smartprocurex.procurement.PurchaseOrderItem } from './procurement';

type GoodsReceiptStatus : String enum {
  Draft;
  Posted;
  Cancelled;
}

type InventoryTransactionType : String enum {
  Inbound;
  Outbound;
  Transfer;
  Adjustment;
  Reserved;
  Unreserved;
  Damaged;
}

entity Warehouse : cuid, managed {
  warehouseCode  : String(30)  not null;
  warehouseName  : String(150) not null;
  location       : String(255);
  description    : String(500);
  status         : String(30)  not null default 'ACTIVE';
  goodsReceipts  : Composition of many GoodsReceipt
                     on goodsReceipts.warehouse = $self;
  inventoryItems : Composition of many InventoryItem
                     on inventoryItems.warehouse = $self;
  transactions   : Composition of many InventoryTransaction
                     on transactions.warehouse = $self;
}

entity GoodsReceipt : cuid, managed {
  goodsReceiptNumber : String(30) not null;
  purchaseOrder      : Association to PurchaseOrder;
  warehouse          : Association to Warehouse;
  receivedBy         : Association to User;
  receivedDate       : Date not null;
  status             : GoodsReceiptStatus not null default #Draft;
  remarks            : String(1000);
  cancellationReason : String(1000);
  cancelledBy        : Association to User;
  cancelledAt        : DateTime;
  items              : Composition of many GoodsReceiptItem
                       on items.goodsReceipt = $self;
}

entity GoodsReceiptItem : cuid, managed {
  goodsReceipt       : Association to GoodsReceipt;
  purchaseOrderItem  : Association to PurchaseOrderItem;
  inventoryItem      : Association to InventoryItem;
  itemName           : String(150) not null;
  receivedQuantity   : Decimal(13, 3) not null;
  remarks            : String(500);
}

entity InventoryItem : cuid, managed {
  warehouse         : Association to Warehouse;
  itemCode          : String(50)  not null;
  itemName          : String(150) not null;
  quantityOnHand    : Decimal(13, 3) not null default 0;
  quantityReserved  : Decimal(13, 3) not null default 0;
  quantityDamaged   : Decimal(13, 3) not null default 0;
  minimumStock      : Decimal(13, 3) default 0;
  maximumStock      : Decimal(13, 3);
  unit              : String(30)  not null;
  status            : String(30)  not null default 'ACTIVE';
  transactions      : Composition of many InventoryTransaction
                       on transactions.inventoryItem = $self;
}

entity InventoryTransaction : cuid, managed {
  warehouse         : Association to Warehouse;
  inventoryItem     : Association to InventoryItem;
  goodsReceipt      : Association to GoodsReceipt;
  transactionType   : InventoryTransactionType not null;
  quantity          : Decimal(13, 3) not null;
  balanceAfter      : Decimal(13, 3) not null default 0;
  referenceDocument : String(50);
  remarks           : String(1000);
  performedBy       : Association to User;
  transactionDate   : DateTime not null;
}
