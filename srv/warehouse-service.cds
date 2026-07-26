using { smartprocurex.warehouse as warehouse } from '../db/warehouse';
using { smartprocurex.identity as identity } from '../db/identity';

service WarehouseService {

    entity Warehouses
        as projection on warehouse.Warehouse;

    entity GoodsReceipts
        as projection on warehouse.GoodsReceipt;

    entity GoodsReceiptItems
        as projection on warehouse.GoodsReceiptItem;

    entity InventoryItems
        as projection on warehouse.InventoryItem;

    entity InventoryTransactions
        as projection on warehouse.InventoryTransaction;

    // Inventory actions
    action adjustInventory(
        inventoryItemID : UUID,
        newQuantity : Decimal(13, 3),
        remarks : String
    ) returns Boolean;

    action reserveInventory(
        inventoryItemID : UUID,
        quantity : Decimal(13, 3),
        remarks : String
    ) returns Boolean;

    action unreserveInventory(
        inventoryItemID : UUID,
        quantity : Decimal(13, 3),
        remarks : String
    ) returns Boolean;

    action markDamaged(
        inventoryItemID : UUID,
        quantity : Decimal(13, 3),
        remarks : String
    ) returns Boolean;

    action transferInventory(
        inventoryItemID : UUID,
        destinationWarehouseID : UUID,
        quantity : Decimal(13, 3),
        remarks : String
    ) returns Boolean;

    // Goods receipt actions
    action postGoodsReceipt(
        goodsReceiptID : UUID
    ) returns Boolean;

    action cancelGoodsReceipt(
        goodsReceiptID : UUID,
        reason : String
    ) returns Boolean;
}
