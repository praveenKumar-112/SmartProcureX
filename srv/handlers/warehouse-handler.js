import cds from '@sap/cds';
import { generateBusinessNumber } from '../common/number-range.js';
import { DOCUMENT_PREFIX, NOTIFICATION_EVENT } from '../common/constants.js';
import { todayIsoDate, nowIsoTimestamp, associationId } from '../common/utils.js';
import {
    applyInventoryMovement,
    getInventoryItem,
    findInventoryItemByCode,
    createInventoryItem,
    getGoodsReceiptWithDetails,
    syncPurchaseOrderReceiptStatus,
    incrementPurchaseOrderItemReceived,
    dbRun
} from '../common/warehouse-service-helpers.js';
import { normalizeUserId } from '../common/procurement-service-helpers.js';
import { emitBusinessNotification } from '../common/notification-service-helpers.js';

const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;

// ---------------------------------------------------------------------------
// Cross-service lookups (mirrors the procurement-handler pattern). The
// warehouse handler needs the ProcurementService entities to validate
// purchase orders and update the POItem receivedQuantity.
// ---------------------------------------------------------------------------
function procurementEntities() {
    const svc = cds.services.ProcurementService;
    return {
        PurchaseOrders: svc?.entities?.PurchaseOrders ?? null,
        PurchaseOrderItems: svc?.entities?.PurchaseOrderItems ?? null
    };
}

function platformNotifications() {
    return cds.services.PlatformService?.entities?.Notifications ?? null;
}

// ---------------------------------------------------------------------------
// Notification auto-emission wrapper for the warehouse domain. Joins the
// new Notification row to the originating tx so emission is atomic with
// the business action (AD-21). Silently skips when the PlatformService
// is unavailable so the warehouse flow stays robust even when
// notifications are quenched.
// ---------------------------------------------------------------------------
async function emitWarehouseNotification(tx, event, payload) {
    const Notifications = platformNotifications();
    if (!Notifications) return null;
    return emitBusinessNotification(tx, event, payload, { Notifications });
}

// ---------------------------------------------------------------------------
// Convert a raw OData path-key into a UUID (mirrors itemIdFromDeleteRequest
// but for the simpler goodsReceipt / inventoryItem context). req.data on
// a Goods Receipts DELETE is also empty.
// ---------------------------------------------------------------------------
function _keyFromDeleteQuery(query, keyName = 'ID') {
    const where = query?.DELETE?.from?.ref?.[0]?.where;
    if (!Array.isArray(where)) return null;
    for (let i = 0; i < where.length - 2; i += 4) {
        const left = where[i];
        const operator = where[i + 1];
        const right = where[i + 2];
        const leftRef = left?.ref?.[0];
        const rightVal = right?.val;
        if (leftRef === keyName && operator === '=' && rightVal != null) {
            return String(rightVal);
        }
    }
    return null;
}

function grIdFromDeleteRequest(req) {
    if (!req) return null;
    return req.data?.ID ?? _keyFromDeleteQuery(req.query) ?? null;
}

export default cds.service.impl(function () {

    const {
        Warehouses,
        GoodsReceipts,
        GoodsReceiptItems,
        InventoryItems,
        InventoryTransactions
    } = this.entities;

    const _helperEntities = {
        Warehouses,
        GoodsReceipts,
        GoodsReceiptItems,
        InventoryItems,
        InventoryTransactions
    };

    // ============================================================
    // Warehouse - before-CREATE validation
    // ============================================================
    this.before('CREATE', Warehouses, async (req) => {
        const { warehouseCode, warehouseName } = req.data;
        if (!warehouseCode?.trim()) {
            return req.reject(400, 'Warehouse Code is mandatory.');
        }
        if (!warehouseName?.trim()) {
            return req.reject(400, 'Warehouse Name is mandatory.');
        }
        const tx = cds.transaction(req);
        const existing = await tx.run(
            SELECT.one.from(Warehouses).columns('ID').where({ warehouseCode })
        );
        if (existing) {
            return req.reject(409, `Warehouse with code '${warehouseCode}' already exists.`);
        }
        req.data.status = req.data.status || 'ACTIVE';
    });

    // ============================================================
    // Warehouse - after-CREATE: emit WarehouseEvent notification
    // ============================================================
    // The ticket lists "Warehouse Events" among the auto-emission
    // categories. The natural warehouse-level event is the creation of
    // a new warehouse. We notify the actor so the audit trail is
    // self-contained, mirroring the inventory-event recipient policy.
    // ------------------------------------------------------------
    this.after('CREATE', Warehouses, async (results, req) => {
        const actorID = normalizeUserId(req?.user?.id);
        const warehouseID = results?.ID ?? req?.data?.ID ?? null;
        if (!actorID || !warehouseID) return;
        const tx = cds.transaction(req);
        await emitWarehouseNotification(tx, NOTIFICATION_EVENT.WAREHOUSE_EVENT, {
            documentNumber: req.data.warehouseCode,
            actor: actorID,
            recipientID: actorID,
            referenceEntity: 'Warehouse',
            referenceID: warehouseID,
            reason: `Warehouse ${req.data.warehouseCode} created`
        });
    });

    // ============================================================
    // Goods Receipt - before-CREATE validation
    // ============================================================
    this.before('CREATE', GoodsReceipts, async (req) => {

        const purchaseOrderID = associationId(
            req.data.purchaseOrder_ID ?? req.data.purchaseOrder
        );
        const warehouseID = associationId(
            req.data.warehouse_ID ?? req.data.warehouse
        );

        if (!purchaseOrderID) {
            return req.reject(400, 'Purchase Order is mandatory.');
        }
        if (!warehouseID) {
            return req.reject(400, 'Warehouse is mandatory.');
        }

        const tx = cds.transaction(req);

        const { PurchaseOrders } = procurementEntities();
        if (!PurchaseOrders) {
            return req.reject(500, 'Procurement service is not available.');
        }

        // PurchaseOrders is a ProcurementService entity that is NOT
        // projected into WarehouseService; routing the SELECT through
        // the shared `cds.db` facade (wrapped by `dbRun` for the
        // @cap-js/sqlite nested-tx deadlock workaround; see
        // warehouse-service-helpers.js header) lets the WarehouseService
        // tx resolve it without raising
        // "Target ProcurementService.PurchaseOrders cannot be resolved
        //  for service WarehouseService".
        const po = await dbRun(
            SELECT.one
                .from(PurchaseOrders)
                .columns('ID', 'status')
                .where({ ID: purchaseOrderID })
        );

        if (!po) {
            return req.reject(404, 'Purchase Order not found.');
        }

        if (po.status === 'Created') {
            return req.reject(409, 'Purchase Order has not been sent yet. Cannot receive goods against an unsent Order.');
        }

        if (po.status === 'Cancelled' || po.status === 'Closed') {
            return req.reject(409, `Purchase Order is '${po.status}' and cannot receive goods.`);
        }

        const warehouse = await tx.run(
            SELECT.one
                .from(Warehouses)
                .columns('ID', 'status')
                .where({ ID: warehouseID })
        );

        if (!warehouse) {
            return req.reject(404, 'Warehouse not found.');
        }

        if (warehouse.status !== 'ACTIVE') {
            return req.reject(409, 'Warehouse is not active.');
        }

        req.data.purchaseOrder_ID = purchaseOrderID;
        req.data.warehouse_ID = warehouseID;
        req.data.goodsReceiptNumber = await generateBusinessNumber(
            tx,
            DOCUMENT_PREFIX.GOODS_RECEIPT
        );
        req.data.receivedDate = req.data.receivedDate || todayIsoDate();
        req.data.status = 'Draft';
        req.data.receivedBy_ID = normalizeUserId(req?.user?.id) ?? req.data.receivedBy_ID ?? null;

        // Multiple partial Goods Receipts against the same PO are permitted
        // (requirement: Partial Receipt + Complete Receipt). Over-receipt is
        // prevented at the GoodsReceiptItem level via the cumulative-received
        // guard, so no PO-level duplicate-posted block is needed here.
    });

    // ============================================================
    // Goods Receipt Item - before-CREATE validation
    //     Over-receipt prevention + linkage checks.
    // ============================================================
    this.before('CREATE', GoodsReceiptItems, async (req) => {

        const {
            goodsReceipt_ID,
            purchaseOrderItem_ID,
            inventoryItem_ID,
            itemName,
            receivedQuantity
        } = req.data;

        if (!goodsReceipt_ID) return req.reject(400, 'Goods Receipt is mandatory.');
        if (!purchaseOrderItem_ID) return req.reject(400, 'Purchase Order Item is mandatory.');
        if (!inventoryItem_ID) return req.reject(400, 'Inventory Item is mandatory.');
        if (!itemName?.trim()) return req.reject(400, 'Item Name is mandatory.');
        if (receivedQuantity == null || Number(receivedQuantity) <= 0) {
            return req.reject(400, 'Received Quantity must be greater than zero.');
        }

        const tx = cds.transaction(req);

        // GR must be in Draft state to allow items to be added.
        const gr = await tx.run(
            SELECT.one
                .from(GoodsReceipts)
                .columns('status', 'purchaseOrder_ID', 'warehouse_ID')
                .where({ ID: goodsReceipt_ID })
        );
        if (!gr) return req.reject(404, 'Goods Receipt not found.');
        if (gr.status !== 'Draft') {
            return req.reject(409, `Items cannot be added to a Goods Receipt in status '${gr.status}'.`);
        }

        // Validate the linked POItem belongs to the linked PO.
        const { PurchaseOrderItems } = procurementEntities();
        if (!PurchaseOrderItems) return req.reject(500, 'Procurement service is not available.');

        // PurchaseOrderItems is a ProcurementService entity not projected
        // into WarehouseService -> route through the shared `cds.db`
        // facade via `dbRun` (see helpers header for rationale).
        const poItem = await dbRun(
            SELECT.one
                .from(PurchaseOrderItems)
                .columns('ID', 'quantity', 'receivedQuantity')
                .where({ ID: purchaseOrderItem_ID })
        );
        if (!poItem) return req.reject(404, 'Purchase Order Item not found.');

        // Compute total previously-received for this POItem across all
        // Goods Receipt items (Draft + Posted). The cumulative quantity
        // across GRs cannot exceed poItem.quantity (over-receipt prevent).
        const grItems = await tx.run(
            SELECT.from(GoodsReceiptItems)
                .columns('receivedQuantity')
                .where({ purchaseOrderItem_ID })
        );
        let alreadyReceived = 0;
        for (const gri of grItems) {
            alreadyReceived += Number(gri.receivedQuantity);
        }
        const remaining = Number(poItem.quantity) - alreadyReceived;

        if (Number(receivedQuantity) > remaining) {
            return req.reject(
                400,
                `Over-receipt is not permitted. Ordered: ${poItem.quantity}, already received or in draft: ${alreadyReceived}, attempted: ${receivedQuantity}.`
            );
        }

        // Validate inventoryItem belongs to the same warehouse as the GR.
        const invItem = await tx.run(
            SELECT.one
                .from(InventoryItems)
                .columns('ID', 'warehouse_ID', 'status', 'itemCode', 'itemName', 'unit')
                .where({ ID: inventoryItem_ID })
        );
        if (!invItem) return req.reject(404, 'Inventory Item not found.');
        if (invItem.warehouse_ID !== gr.warehouse_ID) {
            return req.reject(400, 'Inventory Item does not belong to the Goods Receipt warehouse.');
        }
        if (invItem.status !== 'ACTIVE') {
            return req.reject(409, 'Inventory Item is not active.');
        }
    });

    // ============================================================
    // postGoodsReceipt - Draft -> Posted (atomic inventory update)
    // ============================================================
    // Business rules:
    //   - GR must be in Draft state
    //   - GR must have at least one item
    //   - For each item: apply Inbound inventory movement, link GRItem to
    //     the InventoryItem, increment the POItem receivedQuantity
    //   - After every item is applied: sync PO status (Sent / Partially /
    //     Received) and persist a single InventoryTransaction ledger row
    //     per item so the stock ledger is auditable
    //   - Finally transition GR status to Posted
    // ---------------------------------------------------------
    this.on('postGoodsReceipt', async (req) => {

        const { goodsReceiptID } = req.data;

        if (!goodsReceiptID) {
            return req.reject(400, 'Goods Receipt ID is mandatory.');
        }

        const tx = cds.transaction(req);

        const gr = await getGoodsReceiptWithDetails(tx, goodsReceiptID, _helperEntities);

        if (!gr) {
            return req.reject(404, 'Goods Receipt not found.');
        }

        if (gr.status !== 'Draft') {
            return req.reject(
                409,
                `Goods Receipt cannot be posted because its status is '${gr.status}'. Only Draft Goods Receipts can be posted.`
            );
        }

        if (!gr.items || gr.items.length === 0) {
            return req.reject(400, 'Goods Receipt has no items to post.');
        }

        const userId = normalizeUserId(req?.user?.id);

        // Snapshot the PO PurchaseOrderItem IDs we will write to.
        const { PurchaseOrderItems: POItems } = procurementEntities();
        if (!POItems) {
            return req.reject(500, 'Procurement service is not available.');
        }

        const poEntities = { PurchaseOrderItems: POItems };

        // Apply each item: inbound inventory movement + POItem receivedQuantity bump.
        for (const item of gr.items) {
            await applyInventoryMovement(tx, {
                inventoryItem_ID: item.inventoryItem_ID,
                warehouse_ID: gr.warehouse_ID,
                goodsReceipt_ID: goodsReceiptID,
                transactionType: 'Inbound',
                quantity: item.receivedQuantity,
                referenceDocument: gr.goodsReceiptNumber,
                remarks: `Goods Receipt ${gr.goodsReceiptNumber} for ${item.itemName}`,
                performedBy_ID: userId
            }, _helperEntities);

            await incrementPurchaseOrderItemReceived(
                tx,
                item.purchaseOrderItem_ID,
                Number(item.receivedQuantity),
                poEntities
            );
        }

        // Sync the PO status based on the new cumulative receivedQuantity.
        await syncPurchaseOrderReceiptStatus(
            tx,
            gr.purchaseOrder_ID,
            { ...procurementEntities(), PurchaseOrders: procurementEntities().PurchaseOrders }
        );

        // Transition the GR to Posted.
        await tx.run(
            UPDATE(GoodsReceipts)
                .set({ status: 'Posted' })
                .where({ ID: goodsReceiptID })
        );

        // Auto-emit GR posted notification. The recipient is the actor who
        // performed the posting (they hold the authoritative audit trace).
        if (userId) {
            await emitWarehouseNotification(tx, NOTIFICATION_EVENT.GOODS_RECEIPT_POSTED, {
                documentNumber: gr.goodsReceiptNumber,
                actor: userId,
                recipientID: userId,
                referenceEntity: 'GoodsReceipt',
                referenceID: goodsReceiptID,
                parentDocument: gr.purchaseOrder_ID
            });
        }

        return true;

    });

    // ============================================================
    // cancelGoodsReceipt - Posted -> Cancelled (reverse inventory)
    // ============================================================
    this.on('cancelGoodsReceipt', async (req) => {

        const { goodsReceiptID, reason } = req.data;

        if (!goodsReceiptID) return req.reject(400, 'Goods Receipt ID is mandatory.');
        if (!reason || !String(reason).trim()) {
            return req.reject(400, 'Cancellation reason is mandatory.');
        }

        const tx = cds.transaction(req);

        const gr = await getGoodsReceiptWithDetails(tx, goodsReceiptID, _helperEntities);

        if (!gr) return req.reject(404, 'Goods Receipt not found.');

        if (gr.status !== 'Posted') {
            return req.reject(409, `Only Posted Goods Receipts can be cancelled; current status is '${gr.status}'.`);
        }

        const userId = normalizeUserId(req?.user?.id);
        const { PurchaseOrderItems: POItems } = procurementEntities();
        if (!POItems) return req.reject(500, 'Procurement service is not available.');
        const poEntities = { PurchaseOrderItems: POItems };

        // Reverse every prior movement with an Outbound transaction of the
        // same quantity, and decrement the POItem receivedQuantity.
        for (const item of gr.items) {
            await applyInventoryMovement(tx, {
                inventoryItem_ID: item.inventoryItem_ID,
                warehouse_ID: gr.warehouse_ID,
                goodsReceipt_ID: goodsReceiptID,
                transactionType: 'Outbound',
                quantity: item.receivedQuantity,
                referenceDocument: `CANCEL-${gr.goodsReceiptNumber}`,
                remarks: `Reversal of Goods Receipt ${gr.goodsReceiptNumber}: ${reason}`,
                performedBy_ID: userId
            }, _helperEntities);

            await incrementPurchaseOrderItemReceived(
                tx,
                item.purchaseOrderItem_ID,
                -Number(item.receivedQuantity),
                poEntities
            );
        }

        // Re-evaluate the PO status after the reversal.
        await syncPurchaseOrderReceiptStatus(
            tx,
            gr.purchaseOrder_ID,
            { ...procurementEntities(), PurchaseOrders: procurementEntities().PurchaseOrders }
        );

        await tx.run(
            UPDATE(GoodsReceipts)
                .set({
                    status: 'Cancelled',
                    cancellationReason: String(reason).slice(0, 1000),
                    cancelledBy_ID: userId,
                    cancelledAt: nowIsoTimestamp()
                })
                .where({ ID: goodsReceiptID })
        );

        // Auto-emit GR cancelled notification.
        if (userId) {
            await emitWarehouseNotification(tx, NOTIFICATION_EVENT.GOODS_RECEIPT_CANCELLED, {
                documentNumber: gr.goodsReceiptNumber,
                actor: userId,
                recipientID: userId,
                referenceEntity: 'GoodsReceipt',
                referenceID: goodsReceiptID,
                reason: String(reason).slice(0, 500)
            });
        }

        return true;

    });

    // ============================================================
    // Inventory Item - before-CREATE validation
    // ============================================================
    this.before('CREATE', InventoryItems, async (req) => {

        const { warehouse_ID, itemCode, itemName, unit } = req.data;

        if (!warehouse_ID) return req.reject(400, 'Warehouse is mandatory.');
        if (!itemCode?.trim()) return req.reject(400, 'Item Code is mandatory.');
        if (!itemName?.trim()) return req.reject(400, 'Item Name is mandatory.');
        if (!unit?.trim()) return req.reject(400, 'Unit is mandatory.');

        const tx = cds.transaction(req);

        const existing = await tx.run(
            SELECT.one.from(InventoryItems)
                .columns('ID')
                .where({ warehouse_ID, itemCode })
        );
        if (existing) {
            return req.reject(409, `Inventory Item with code '${itemCode}' already exists in this warehouse.`);
        }

        req.data.quantityOnHand = req.data.quantityOnHand ?? 0;
        req.data.quantityReserved = req.data.quantityReserved ?? 0;
        req.data.quantityDamaged = req.data.quantityDamaged ?? 0;
        req.data.status = req.data.status || 'ACTIVE';
    });

    // ============================================================
    // Inventory Actions
    // ============================================================

    this.on('adjustInventory', async (req) => {

        const { inventoryItemID, newQuantity, remarks } = req.data;

        if (!inventoryItemID) return req.reject(400, 'Inventory Item ID is mandatory.');
        if (newQuantity == null || Number(newQuantity) < 0) {
            return req.reject(400, 'New quantity must be a non-negative number.');
        }

        const tx = cds.transaction(req);
        const item = await getInventoryItem(tx, inventoryItemID, _helperEntities);
        if (!item) return req.reject(404, 'Inventory Item not found.');
        if (item.status !== 'ACTIVE') return req.reject(409, 'Inventory Item is not active.');

        await applyInventoryMovement(tx, {
            inventoryItem_ID: inventoryItemID,
            warehouse_ID: item.warehouse_ID,
            transactionType: 'Adjustment',
            quantity: Number(newQuantity),
            referenceDocument: 'ADJUSTMENT',
            remarks: remarks || 'Manual stock adjustment',
            performedBy_ID: normalizeUserId(req?.user?.id)
        }, _helperEntities);

        // Auto-emit inventory adjustment notification to the actor.
        const adjActorID = normalizeUserId(req?.user?.id);
        if (adjActorID) {
            await emitWarehouseNotification(tx, NOTIFICATION_EVENT.INVENTORY_ADJUSTMENT, {
                documentNumber: item.itemCode,
                actor: adjActorID,
                recipientID: adjActorID,
                referenceEntity: 'InventoryItem',
                referenceID: inventoryItemID,
                quantity: String(newQuantity)
            });
        }

        return true;
    });

    this.on('reserveInventory', async (req) => {

        const { inventoryItemID, quantity, remarks } = req.data;

        if (!inventoryItemID) return req.reject(400, 'Inventory Item ID is mandatory.');
        if (!quantity || Number(quantity) <= 0) {
            return req.reject(400, 'Quantity must be greater than zero.');
        }

        const tx = cds.transaction(req);
        const item = await getInventoryItem(tx, inventoryItemID, _helperEntities);
        if (!item) return req.reject(404, 'Inventory Item not found.');
        if (item.status !== 'ACTIVE') return req.reject(409, 'Inventory Item is not active.');

        const onHand = Number(item.quantityOnHand);
        const reserved = Number(item.quantityReserved);
        const available = onHand - reserved;

        if (Number(quantity) > available) {
            return req.reject(409, `Insufficient available stock to reserve. On hand: ${onHand}, already reserved: ${reserved}, attempted to reserve: ${quantity}.`);
        }

        await applyInventoryMovement(tx, {
            inventoryItem_ID: inventoryItemID,
            warehouse_ID: item.warehouse_ID,
            transactionType: 'Reserved',
            quantity: Number(quantity),
            referenceDocument: 'RESERVATION',
            remarks: remarks || 'Stock reservation',
            performedBy_ID: normalizeUserId(req?.user?.id)
        }, _helperEntities);

        // Auto-emit inventory reservation notification to the actor.
        const resvActorID = normalizeUserId(req?.user?.id);
        if (resvActorID) {
            await emitWarehouseNotification(tx, NOTIFICATION_EVENT.INVENTORY_RESERVATION, {
                documentNumber: item.itemCode,
                actor: resvActorID,
                recipientID: resvActorID,
                referenceEntity: 'InventoryItem',
                referenceID: inventoryItemID,
                quantity: String(quantity)
            });
        }

        return true;
    });

    this.on('unreserveInventory', async (req) => {

        const { inventoryItemID, quantity, remarks } = req.data;

        if (!inventoryItemID) return req.reject(400, 'Inventory Item ID is mandatory.');
        if (!quantity || Number(quantity) <= 0) {
            return req.reject(400, 'Quantity must be greater than zero.');
        }

        const tx = cds.transaction(req);
        const item = await getInventoryItem(tx, inventoryItemID, _helperEntities);
        if (!item) return req.reject(404, 'Inventory Item not found.');

        const reserved = Number(item.quantityReserved);

        if (Number(quantity) > reserved) {
            return req.reject(409, `Cannot unreserve more than is currently reserved. Reserved: ${reserved}, attempted: ${quantity}.`);
        }

        await applyInventoryMovement(tx, {
            inventoryItem_ID: inventoryItemID,
            warehouse_ID: item.warehouse_ID,
            transactionType: 'Unreserved',
            quantity: Number(quantity),
            referenceDocument: 'UNRESERVE',
            remarks: remarks || 'Stock reservation release',
            performedBy_ID: normalizeUserId(req?.user?.id)
        }, _helperEntities);

        return true;
    });

    this.on('markDamaged', async (req) => {

        const { inventoryItemID, quantity, remarks } = req.data;

        if (!inventoryItemID) return req.reject(400, 'Inventory Item ID is mandatory.');
        if (!quantity || Number(quantity) <= 0) {
            return req.reject(400, 'Quantity must be greater than zero.');
        }

        const tx = cds.transaction(req);
        const item = await getInventoryItem(tx, inventoryItemID, _helperEntities);
        if (!item) return req.reject(404, 'Inventory Item not found.');

        const onHand = Number(item.quantityOnHand);
        if (Number(quantity) > onHand) {
            return req.reject(409, `Cannot mark more stock as damaged than is on hand. On hand: ${onHand}, attempted: ${quantity}.`);
        }

        await applyInventoryMovement(tx, {
            inventoryItem_ID: inventoryItemID,
            warehouse_ID: item.warehouse_ID,
            transactionType: 'Damaged',
            quantity: Number(quantity),
            referenceDocument: 'DAMAGED',
            remarks: remarks || 'Markdamaged stock',
            performedBy_ID: normalizeUserId(req?.user?.id)
        }, _helperEntities);

        // Auto-emit inventory damage notification to the actor.
        const dmgActorID = normalizeUserId(req?.user?.id);
        if (dmgActorID) {
            await emitWarehouseNotification(tx, NOTIFICATION_EVENT.INVENTORY_DAMAGE, {
                documentNumber: item.itemCode,
                actor: dmgActorID,
                recipientID: dmgActorID,
                referenceEntity: 'InventoryItem',
                referenceID: inventoryItemID,
                quantity: String(quantity)
            });
        }

        return true;
    });

    // ============================================================
    // transferInventory - move stock between two warehouses
    // ============================================================
    this.on('transferInventory', async (req) => {

        const { inventoryItemID, destinationWarehouseID, quantity, remarks } = req.data;

        if (!inventoryItemID) return req.reject(400, 'Inventory Item ID is mandatory.');
        if (!destinationWarehouseID) return req.reject(400, 'Destination Warehouse ID is mandatory.');
        if (!quantity || Number(quantity) <= 0) {
            return req.reject(400, 'Quantity must be greater than zero.');
        }

        const tx = cds.transaction(req);
        const srcItem = await getInventoryItem(tx, inventoryItemID, _helperEntities);
        if (!srcItem) return req.reject(404, 'Source Inventory Item not found.');
        if (srcItem.status !== 'ACTIVE') {
            return req.reject(409, 'Source inventory item is not active.');
        }

        if (srcItem.warehouse_ID === destinationWarehouseID) {
            return req.reject(400, 'Source and destination warehouses must differ.');
        }

        const onHand = Number(srcItem.quantityOnHand);
        const reserved = Number(srcItem.quantityReserved);
        const available = onHand - reserved;

        if (Number(quantity) > available) {
            return req.reject(409, `Insufficient available stock to transfer. Available: ${available}, attempted: ${quantity}.`);
        }

        // Validate destination warehouse exists and is ACTIVE.
        const destWarehouse = await tx.run(
            SELECT.one.from(Warehouses).columns('ID', 'status').where({ ID: destinationWarehouseID })
        );
        if (!destWarehouse) return req.reject(404, 'Destination Warehouse not found.');
        if (destWarehouse.status !== 'ACTIVE') return req.reject(409, 'Destination Warehouse is not active.');

        const userId = normalizeUserId(req?.user?.id);

        // Outbound from source.
        await applyInventoryMovement(tx, {
            inventoryItem_ID: srcItem.ID,
            warehouse_ID: srcItem.warehouse_ID,
            transactionType: 'Transfer',
            quantity: Number(quantity),
            referenceDocument: 'TRANSFER-OUT',
            remarks: `Transfer to ${destinationWarehouseID}: ${remarks || ''}`,
            performedBy_ID: userId
        }, _helperEntities);

        // Find or create destination inventory item.
        let destItem = await findInventoryItemByCode(
            tx,
            destinationWarehouseID,
            srcItem.itemCode,
            _helperEntities
        );
        if (!destItem) {
            destItem = await createInventoryItem(tx, {
                warehouse_ID: destinationWarehouseID,
                itemCode: srcItem.itemCode,
                itemName: srcItem.itemName,
                unit: srcItem.unit
            }, _helperEntities);
        }

        // Inbound to destination.
        await applyInventoryMovement(tx, {
            inventoryItem_ID: destItem.ID,
            warehouse_ID: destinationWarehouseID,
            transactionType: 'Inbound',
            quantity: Number(quantity),
            referenceDocument: 'TRANSFER-IN',
            remarks: `Transfer from ${srcItem.warehouse_ID}: ${remarks || ''}`,
            performedBy_ID: userId
        }, _helperEntities);

        // Auto-emit inventory transfer notification to the actor.
        if (userId) {
            await emitWarehouseNotification(tx, NOTIFICATION_EVENT.INVENTORY_TRANSFER, {
                documentNumber: srcItem.itemCode,
                actor: userId,
                recipientID: userId,
                referenceEntity: 'InventoryItem',
                referenceID: inventoryItemID,
                quantity: String(quantity)
            });
        }

        return true;
    });

    // ============================================================
    // Inventory Transaction - read access is projection default; no
    // custom handlers required.
    // ============================================================

    // ============================================================
    // Goods Receipt - DELETE prevention on Posted rows
    // ============================================================
    this.before('DELETE', GoodsReceipts, async (req) => {
        const id = grIdFromDeleteRequest(req);
        if (!id) return req.reject(400, 'Goods Receipt ID is mandatory.');
        const tx = cds.transaction(req);
        const gr = await tx.run(
            SELECT.one.from(GoodsReceipts).columns('status').where({ ID: id })
        );
        if (!gr) return req.reject(404, 'Goods Receipt not found.');
        if (gr.status === 'Posted') {
            return req.reject(409, 'Posted Goods Receipts cannot be deleted. Use cancelGoodsReceipt to reverse the receipt.');
        }
    });

    // ============================================================
    // Warehouse - DELETE prevention while associated Items exist
    // ============================================================
    this.before('DELETE', Warehouses, async (req) => {
        const id = grIdFromDeleteRequest(req);
        if (!id) return req.reject(400, 'Warehouse ID is mandatory.');
        const tx = cds.transaction(req);
        const items = await tx.run(
            SELECT.one.from(InventoryItems)
                .columns('count(*) as count')
                .where({ warehouse_ID: id })
        );
        if (Number(items?.count ?? 0) > 0) {
            return req.reject(409, 'Warehouse cannot be deleted while it contains Inventory Items.');
        }
    });

});
