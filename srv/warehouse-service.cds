using { smartprocurex.warehouse as warehouse } from '../db/warehouse';

service WarehouseService {

    entity Warehouses
        as projection on warehouse.Warehouse;

    entity GoodsReceipts
        as projection on warehouse.GoodsReceipt;

    entity InventoryItems
        as projection on warehouse.InventoryItem;

}