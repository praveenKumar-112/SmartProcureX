using { smartprocurex.warehouse as warehouse } from '../db/warehouse';
using { smartprocurex.identity as identity } from '../db/identity';

service WarehouseService @(requires: 'authenticated-user') {

    entity Warehouses
        @(restrict: [
            { grant: ['READ'], to: 'ProcurementManager' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on warehouse.Warehouse;

    entity GoodsReceipts
        @(restrict: [
            { grant: ['READ'], to: 'ProcurementManager' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on warehouse.GoodsReceipt;

    entity GoodsReceiptItems
        @(restrict: [
            { grant: ['READ'], to: 'ProcurementManager' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on warehouse.GoodsReceiptItem;

    entity InventoryItems
        @(restrict: [
            { grant: ['READ'], to: 'ProcurementManager' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on warehouse.InventoryItem;

    entity InventoryTransactions
        @(restrict: [
            { grant: ['READ'], to: 'ProcurementManager' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on warehouse.InventoryTransaction;

    // Inventory actions
    action adjustInventory(
        inventoryItemID : UUID,
        newQuantity : Decimal(13, 3),
        remarks : String
    ) returns Boolean
    @(requires: 'Admin');

    action reserveInventory(
        inventoryItemID : UUID,
        quantity : Decimal(13, 3),
        remarks : String
    ) returns Boolean
    @(requires: 'Admin');

    action unreserveInventory(
        inventoryItemID : UUID,
        quantity : Decimal(13, 3),
        remarks : String
    ) returns Boolean
    @(requires: 'Admin');

    action markDamaged(
        inventoryItemID : UUID,
        quantity : Decimal(13, 3),
        remarks : String
    ) returns Boolean
    @(requires: 'Admin');

    action transferInventory(
        inventoryItemID : UUID,
        destinationWarehouseID : UUID,
        quantity : Decimal(13, 3),
        remarks : String
    ) returns Boolean
    @(requires: 'Admin');

    // Goods receipt actions
    action postGoodsReceipt(
        goodsReceiptID : UUID
    ) returns Boolean
    @(requires: 'Admin');

    action cancelGoodsReceipt(
        goodsReceiptID : UUID,
        reason : String
    ) returns Boolean
    @(requires: 'Admin');
}
