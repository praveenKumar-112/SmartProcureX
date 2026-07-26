/**
 * SmartProcureX - Asset Domain Service Helpers
 * --------------------------------------------------
 * Responsibility:
 *   Encapsulate reusable cross-action logic for the asset domain so
 *   srv/handlers/asset-handler.js stays small and single-purpose.
 *
 * Design:
 *   - Every helper takes the active CAP transaction (`tx`) plus the
 *     resolved entity references (`entities`) passed by the handler.
 *   - Helpers never call `cds.entities(...)` directly.
 *   - Helpers never reject requests; that responsibility stays with
 *     the handler.
 *   - State transitions are atomic and persisted via a single UPDATE.
 *
 * Reuse:
 *   - applyAssetAssignment: inserts an AssetAssignment row and flips the
 *     Asset.assetStatus to Assigned + tracks currentAssignment / assignedTo.
 *   - applyAssetReturn: marks an AssetAssignment Returned + restores
 *     the Asset.assetStatus to Available.
 *   - recordAssetAudit: writes an atomic UPDATE for status transitions
 *     (Retire / Dispose) with by / at / reason audit fields (AD-20).
 */

import cds from '@sap/cds';

const { SELECT, UPDATE, INSERT } = cds.ql;

// ---------------------------------------------------------------------------
// Asset lookup helpers
// ---------------------------------------------------------------------------

/**
 * Read an Asset row with its current state + associations.
 *
 * @param {object} tx        CAP transaction
 * @param {string} assetID   UUID of the Asset
 * @param {object} entities  expects `{ Assets }`
 * @returns {Promise<object|null>}
 */
export async function getAsset(tx, assetID, entities) {
    const { Assets } = entities;
    const row = await tx.run(
        SELECT.one
            .from(Assets)
            .columns(
                'ID',
                'assetCode',
                'assetName',
                'assetStatus',
                'inventoryItem_ID',
                'assetCategory_ID',
                'assignedTo_ID',
                'currentAssignment_ID'
            )
            .where({ ID: assetID })
    );
    return row ?? null;
}

/**
 * Read the latest (still-Assigned) AssetAssignment row for a given Asset.
 * Returns null when none exists.
 *
 * @param {object} tx        CAP transaction
 * @param {string} assetID   UUID of the Asset
 * @param {object} entities  expects `{ AssetAssignments }`
 * @returns {Promise<object|null>}
 */
export async function getActiveAssignment(tx, assetID, entities) {
    const { AssetAssignments } = entities;
    const row = await tx.run(
        SELECT.one
            .from(AssetAssignments)
            .columns('ID', 'employee_ID', 'assignedDate', 'expectedReturnDate')
            .where({ asset_ID: assetID, assignmentStatus: 'Assigned' })
            .orderBy({ createdAt: 'desc' })
    );
    return row ?? null;
}

/**
 * True when the Asset has any assignment row in ``Assigned`` state.
 *
 * @param {object} tx        CAP transaction
 * @param {string} assetID
 * @param {object} entities  expects `{ AssetAssignments }`
 * @returns {Promise<boolean>}
 */
export async function hasActiveAssignment(tx, assetID, entities) {
    const { AssetAssignments } = entities;
    const row = await tx.run(
        SELECT.one
            .from(AssetAssignments)
            .columns('count(*) as count')
            .where({ asset_ID: assetID, assignmentStatus: 'Assigned' })
    );
    return Number(row?.count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Atomic state-transition helpers
// ---------------------------------------------------------------------------

/**
 * Atomically transition an Asset status and optionally write audit fields
 * in the same UPDATE. Mirrors transitionPurchaseRequestStatus /
 * transitionPurchaseOrderStatus.
 *
 * @param {object} tx           CAP transaction
 * @param {string} assetID      UUID of the Asset
 * @param {string} newStatus     New status string (see AssetStatus enum)
 * @param {object} entities      expects `{ Assets }`
 * @param {object} [extraFields]  Optional additional columns to set
 *                                (e.g. retiredBy_ID, retiredAt, retirementReason)
 * @returns {Promise<void>}
 */
export async function transitionAssetStatus(
    tx,
    assetID,
    newStatus,
    entities,
    extraFields = {}
) {
    const { Assets } = entities;
    await tx.run(
        UPDATE(Assets)
            .set({ assetStatus: newStatus, ...extraFields })
            .where({ ID: assetID })
    );
}

/**
 * Persist a new AssetAssignment row. Used by the assignAsset action.
 *
 * @param {object} tx
 * @param {object} assignmentEntry  { asset_ID, employee_ID, assignedDate,
 *                                   expectedReturnDate, assignedBy_ID }
 * @param {object} entities          expects `{ AssetAssignments }`
 * @returns {Promise<object>}        the inserted row
 */
export async function recordAssignment(tx, assignmentEntry, entities) {
    const { AssetAssignments } = entities;
    const [row] = await tx.run(
        INSERT.into(AssetAssignments).entries(assignmentEntry)
    );
    return row;
}

/**
 * Fetch an InventoryItem with all balance columns plus its warehouse link.
 * Used by the transferAsset action.
 *
 * @param {object} tx
 * @param {string} inventoryItemID
 * @param {object} entities  expects `{ InventoryItems }` from the
 *                           WarehouseService - passed by the handler.
 * @returns {Promise<object|null>}
 */
export async function getInventoryItemForAsset(tx, inventoryItemID, entities) {
    const { InventoryItems } = entities;
    if (!InventoryItems) return null;
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

// ---------------------------------------------------------------------------
// Authorization helper - resolves a User and confirms ACTIVE
// ---------------------------------------------------------------------------

/**
 * Resolve a User by ID returning the minimal {'ID','status','role.roleCode'} tuple.
 * Mirrors resolutionApprover in procurement-service-helpers (AD-16) so the same
 * Settings-driven role-code lookup can be applied for asset actions.
 *
 * @param {object} tx          CAP transaction
 * @param {string} userID      UUID of the User
 * @param {object} entities    expects `{ Users }` from the IdentityService
 * @returns {Promise<{ID:string,status:string,roleCode:string|null}|null>}
 */
export async function resolveUser(tx, userID, entities) {
    const { Users } = entities;
    if (!Users || !userID) return null;
    const row = await tx.run(
        SELECT.one
            .from(Users)
            .columns('ID', 'status', 'role.roleCode as roleCode')
            .where({ ID: userID })
    );
    if (!row) return null;
    return {
        ID: row.ID,
        status: row.status,
        roleCode: row.roleCode ?? null
    };
}

// ---------------------------------------------------------------------------
// Asset code-uniqueness helper
// ---------------------------------------------------------------------------

/**
 * True when an Asset with the given assetCode already exists. Used by
 * the before-CREATE hook to prevent duplicate asset codes.
 *
 * @param {object} tx
 * @param {string} assetCode
 * @param {object} entities  expects `{ Assets }`
 * @returns {Promise<boolean>}
 */
export async function assetCodeExists(tx, assetCode, entities) {
    const { Assets } = entities;
    const row = await tx.run(
        SELECT.one.from(Assets).columns('ID').where({ assetCode })
    );
    return Boolean(row);
}

/**
 * True when an AssetCategory with the given categoryCode already exists.
 *
 * @param {object} tx
 * @param {string} categoryCode
 * @param {object} entities  expects `{ AssetCategories }`
 * @returns {Promise<boolean>}
 */
export async function categoryCodeExists(tx, categoryCode, entities) {
    const { AssetCategories } = entities;
    const row = await tx.run(
        SELECT.one.from(AssetCategories).columns('ID').where({ categoryCode })
    );
    return Boolean(row);
}
