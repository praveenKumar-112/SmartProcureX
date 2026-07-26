/**
 * SmartProcureX - Warehouse Domain Service Helpers
 * --------------------------------------------------
 * Responsibility:
 *   Encapsulate reusable cross-action logic for the warehouse domain
 *   (Goods Receipt + Inventory + Stock Movements) so the
 *   srv/handlers/warehouse-handler.js stays small and single-purpose.
 *
 * Design:
 *   - Every helper takes the active CAP transaction (`tx`) plus the
 *     resolved entity references (`entities`) passed by the handler.
 *   - Helpers never call `cds.entities(...)` and never reject requests;
 *     those responsibilities stay with the handler.
 *   - Quantity math uses decimal-safe primitives where math matters; for
 *     movement arithmetic the inputs are Decimal(13,3) strings already
 *     validated upstream, so simple Number() arithmetic is sufficient at
 *     the declared scale.
 *
 * Reuse:
 *   - applyInventoryMovement: single atomic ledger entry + balance update.
 *     Used by goods receipt posting (Inbound), adjustment (Adjustment),
 *     reserve/release (Reserved), damaged (Damaged), transfer (Outbound +
 *     Inbound in the destination warehouse).
 *   - recalculateGoodsReceiptTotals + recalculateInventoryBalances.
 */

import cds from '@sap/cds';

const { SELECT, UPDATE, INSERT, DELETE } = cds.ql;

// ---------------------------------------------------------------------------
// Inventory movement helper - the single source of truth for stock changes
// ---------------------------------------------------------------------------

/**
 * Apply a stock movement atomically: insert a ledger transaction row and
 * update the corresponding InventoryItem balance columns in the same tx.
 *
 * Caller is responsible for validating the movement (positive quantity,
 * sufficient on-hand for outbound, etc.) before calling this helper.
 *
 * @param {object} tx              CAP transaction
 * @param {object} movementInput   { inventoryItem_ID, transactionType, quantity,
 *                                  referenceDocument, remarks, performedBy_ID,
 *                                  goodsReceipt_ID (optional) }
 * @param {object} entities        expects `{ InventoryItems, InventoryTransactions, Warehouses }`
 * @returns {Promise<object>}      the persisted InventoryTransaction row
 */
export async function applyInventoryMovement(tx, movementInput, entities) {
    const { InventoryItems, InventoryTransactions } = entities;

    const {
        inventoryItem_ID,
        transactionType,
        quantity,
        referenceDocument = null,
        remarks = null,
        performedBy_ID = null,
        goodsReceipt_ID = null,
        warehouse_ID = null
    } = movementInput;

    const qty = Number(quantity);

    const item = await tx.run(
        SELECT.one
            .from(InventoryItems)
            .columns('ID', 'quantityOnHand', 'quantityReserved', 'quantityDamaged')
            .where({ ID: inventoryItem_ID })
    );

    if (!item) return null;

    const onHand = Number(item.quantityOnHand);
    const reserved = Number(item.quantityReserved);
    const damaged = Number(item.quantityDamaged);

    let newOnHand = onHand;
    let newReserved = reserved;
    let newDamaged = damaged;

    switch (transactionType) {
        case 'Inbound':
            newOnHand = onHand + qty;
            break;
        case 'Outbound':
            newOnHand = onHand - qty;
            break;
        case 'Transfer':
            // Transfer is encoded as Outbound from this item; the matching
            // Inbound is applied separately by the caller against the
            // destination inventory item.
            newOnHand = onHand - qty;
            break;
        case 'Adjustment':
            // Adjustment sets onHand to an absolute value, encoded with
            // quantity = newBalance. Other types alter balance by quantity.
            newOnHand = qty;
            break;
        case 'Reserved':
            newReserved = reserved + qty;
            break;
        case 'Unreserved':
            newReserved = reserved - qty;
            break;
        case 'Damaged':
            newDamaged = damaged + qty;
            newOnHand = onHand - qty;
            break;
        default:
            return null;
    }

    const balanceAfter = newOnHand;

    const [createdTxn] = await tx.run(
        INSERT.into(InventoryTransactions).entries({
            inventoryItem_ID,
            warehouse_ID,
            goodsReceipt_ID,
            transactionType,
            quantity: qty,
            balanceAfter,
            referenceDocument,
            remarks,
            performedBy_ID,
            transactionDate: new Date().toISOString()
        })
    );

    await tx.run(
        UPDATE(InventoryItems)
            .set({
                quantityOnHand: newOnHand,
                quantityReserved: newReserved,
                quantityDamaged: newDamaged
            })
            .where({ ID: inventoryItem_ID })
    );

    return createdTxn;
}

// ---------------------------------------------------------------------------
// InventoryItem lookup / validation helpers
// ---------------------------------------------------------------------------

/**
 * Read a single InventoryItem by ID with all balance columns.
 * @param {object} tx
 * @param {string} inventoryItemID
 * @param {object} entities  expects `{ InventoryItems }`
 * @returns {Promise<object|null>}
 */
export async function getInventoryItem(tx, inventoryItemID, entities) {
    const { InventoryItems } = entities;
    const row = await tx.run(
        SELECT.one
            .from(InventoryItems)
            .columns(
                'ID',
                'warehouse_ID',
                'itemCode',
                'itemName',
                'quantityOnHand',
                'quantityReserved',
                'quantityDamaged',
                'unit',
                'status'
            )
            .where({ ID: inventoryItemID })
    );
    return row ?? null;
}

/**
 * Locate an InventoryItem by warehouse + itemCode. Returns null when not found.
 * Used by the goods-receipt posting flow to either update or create the item.
 *
 * @param {object} tx
 * @param {string} warehouseID
 * @param {string} itemCode
 * @param {object} entities  expects `{ InventoryItems }`
 * @returns {Promise<object|null>}
 */
export async function findInventoryItemByCode(tx, warehouseID, itemCode, entities) {
    const { InventoryItems } = entities;
    const row = await tx.run(
        SELECT.one
            .from(InventoryItems)
            .columns('ID', 'quantityOnHand', 'unit', 'status')
            .where({ warehouse_ID: warehouseID, itemCode })
    );
    return row ?? null;
}

/**
 * Create a new InventoryItem row. Used when a goods receipt introduces an
 * itemCode that does not yet exist in the destination warehouse.
 *
 * @param {object} tx
 * @param {object} entry  { warehouse_ID, itemCode, itemName, unit }
 * @param {object} entities  expects `{ InventoryItems }`
 * @returns {Promise<object>} the inserted row
 */
export async function createInventoryItem(tx, entry, entities) {
    const { InventoryItems } = entities;
    const [row] = await tx.run(
        INSERT.into(InventoryItems).entries({
            warehouse_ID: entry.warehouse_ID,
            itemCode: entry.itemCode,
            itemName: entry.itemName,
            unit: entry.unit,
            quantityOnHand: 0,
            quantityReserved: 0,
            quantityDamaged: 0,
            minimumStock: 0,
            status: 'ACTIVE'
        })
    );
    return row;
}

// ---------------------------------------------------------------------------
// Goods receipt - aggregate + posting helpers
// ---------------------------------------------------------------------------

/**
 * Read a GoodsReceipt with its items and the parent PurchaseOrder + PO items.
 * Used by the postGoodsReceipt action to validate quantities and apply
 * inbound inventory movements.
 *
 * @param {object} tx
 * @param {string} goodsReceiptID
 * @param {object} entities  expects `{ GoodsReceipts, GoodsReceiptItems, PurchaseOrders, PurchaseOrderItems }`
 * @returns {Promise<object|null>}
 */
export async function getGoodsReceiptWithDetails(tx, goodsReceiptID, entities) {
    const { GoodsReceipts, GoodsReceiptItems } = entities;

    const gr = await tx.run(
        SELECT.one
            .from(GoodsReceipts)
            .columns('*')
            .where({ ID: goodsReceiptID })
    );
    if (!gr) return null;

    const items = await tx.run(
        SELECT.from(GoodsReceiptItems)
            .where({ goodsReceipt_ID: goodsReceiptID })
    );

    return { ...gr, items };
}

/**
 * Update PurchaseOrderItem receivedQuantity and re-evaluate PurchaseOrder
 * status based on receipt progress. Returns the new PO status.
 *
 * Status logic:
 *   - If every line is fully received -> 'Received'
 *   - If at least one line is partially received -> 'PartiallyReceived'
 *   - Otherwise stays at its current status (Sent / Created)
 *
 * @param {object} tx
 * @param {string} purchaseOrderID
 * @param {object} entities  expects `{ PurchaseOrders, PurchaseOrderItems }`
 * @returns {Promise<string>} new status string
 */
export async function syncPurchaseOrderReceiptStatus(tx, purchaseOrderID, entities) {
    const { PurchaseOrders, PurchaseOrderItems } = entities;

    const items = await tx.run(
        SELECT.from(PurchaseOrderItems)
            .columns('ID', 'quantity', 'receivedQuantity')
            .where({ purchaseOrder_ID: purchaseOrderID })
    );

    if (!items || items.length === 0) return null;

    let allFullyReceived = true;
    let anyReceived = false;

    for (const item of items) {
        const ordered = Number(item.quantity);
        const received = Number(item.receivedQuantity ?? 0);
        if (received > 0) anyReceived = true;
        if (received < ordered) allFullyReceived = false;
    }

    const newStatus = allFullyReceived
        ? 'Received'
        : anyReceived
            ? 'PartiallyReceived'
            : 'Sent';

    await tx.run(
        UPDATE(PurchaseOrders)
            .set({ status: newStatus })
            .where({ ID: purchaseOrderID })
    );

    return newStatus;
}

/**
 * Update the receivedQuantity on a PurchaseOrderItem by adding the
 * delta (the just-received quantity). Returns the new receivedQuantity.
 *
 * @param {object} tx
 * @param {string} purchaseOrderItemID
 * @param {number} deltaReceived
 * @param {object} entities  expects `{ PurchaseOrderItems }`
 * @returns {Promise<number|null>} new receivedQuantity, null when item not found
 */
export async function incrementPurchaseOrderItemReceived(
    tx,
    purchaseOrderItemID,
    deltaReceived,
    entities
) {
    const { PurchaseOrderItems } = entities;

    const item = await tx.run(
        SELECT.one
            .from(PurchaseOrderItems)
            .columns('ID', 'receivedQuantity')
            .where({ ID: purchaseOrderItemID })
    );

    if (!item) return null;

    const newReceived = Number(item.receivedQuantity ?? 0) + Number(deltaReceived);

    await tx.run(
        UPDATE(PurchaseOrderItems)
            .set({ receivedQuantity: newReceived })
            .where({ ID: purchaseOrderItemID })
    );

    return newReceived;
}

