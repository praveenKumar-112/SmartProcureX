namespace smartprocurex.warehouse;

using { cuid, managed } from '@sap/cds/common';
using { smartprocurex.identity.User } from './identity';
using { smartprocurex.procurement.PurchaseOrder } from './procurement';

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
}

entity GoodsReceipt : cuid, managed {
  goodsReceiptNumber : String(30) not null;
  purchaseOrder      : Association to PurchaseOrder;
  warehouse          : Association to Warehouse;
  receivedBy         : Association to User;
  receivedDate       : Date not null;
  remarks            : String(1000);
}

entity InventoryItem : cuid, managed {
  warehouse      : Association to Warehouse;
  itemCode       : String(50)  not null;
  itemName       : String(150) not null;
  quantityOnHand : Decimal(13, 3) not null default 0;
  minimumStock   : Decimal(13, 3) default 0;
  maximumStock   : Decimal(13, 3);
  unit           : String(30)  not null;
  status         : String(30)  not null default 'ACTIVE';
}
