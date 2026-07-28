import cds from '@sap/cds';
import { generateBusinessNumber } from '../common/number-range.js';
import { DOCUMENT_PREFIX, NOTIFICATION_EVENT } from '../common/constants.js';
import { todayIsoDate, nowIsoTimestamp, associationId } from '../common/utils.js';
import {
    getAsset,
    getActiveAssignment,
    hasActiveAssignment,
    transitionAssetStatus,
    recordAssignment,
    getInventoryItemForAsset,
    resolveUser,
    assetCodeExists,
    categoryCodeExists
} from '../common/asset-service-helpers.js';
import { normalizeUserId } from '../common/procurement-service-helpers.js';
import { emitBusinessNotification } from '../common/notification-service-helpers.js';

const { SELECT, UPDATE } = cds.ql;

// ---------------------------------------------------------------------------
// Cross-service entity resolution. The Asset handler needs read access to
// the IdentityService Users (employee + asset approver validation) and the
// WarehouseService InventoryItems (for purchase-date stock linkage and the
// transferAsset action). These are resolved lazily via cds.services so the
// handler does not boot-fail if a sibling service is not yet instantiated.
// ---------------------------------------------------------------------------
function identityUsers() {
    return cds.services.IdentityService?.entities?.Users ?? null;
}

function warehouseInventoryItems() {
    return cds.services.WarehouseService?.entities?.InventoryItems ?? null;
}

function platformNotifications() {
    return cds.services.PlatformService?.entities?.Notifications ?? null;
}

// ---------------------------------------------------------------------------
// Notification auto-emission wrapper for the asset domain. Joins the new
// Notification row to the originating tx so emission is atomic with the
// business action (AD-21). Silently skips when PlatformService is
// unavailable so the asset flow stays robust when notifications are
// quenched in a deployment that does not need them.
// ---------------------------------------------------------------------------
async function emitAssetNotification(tx, event, payload) {
    const Notifications = platformNotifications();
    if (!Notifications) return null;
    return emitBusinessNotification(tx, event, payload, { Notifications });
}

// ---------------------------------------------------------------------------
// Helper to extract the targeted ID from a CQN DELETE query. Mirrors the
// same pattern used by itemIdFromDeleteRequest for procurement items.
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

function assetIdFromDeleteRequest(req) {
    if (!req) return null;
    return req.data?.ID ?? _keyFromDeleteQuery(req.query) ?? null;
}

export default cds.service.impl(function () {

    const {
        AssetCategories,
        Assets,
        AssetAssignments
    } = this.entities;

    const _helperEntities = { AssetCategories, Assets, AssetAssignments };

    // ============================================================
    // AssetCategory - before-CREATE
    // ============================================================
    this.before('CREATE', AssetCategories, async (req) => {
        const { categoryCode, categoryName } = req.data;
        if (!categoryCode?.trim()) {
            return req.reject(400, 'Category Code is mandatory.');
        }
        if (!categoryName?.trim()) {
            return req.reject(400, 'Category Name is mandatory.');
        }
        const tx = cds.transaction(req);
        if (await categoryCodeExists(tx, categoryCode, _helperEntities)) {
            return req.reject(409, `Asset Category with code '${categoryCode}' already exists.`);
        }
    });

    // ============================================================
    // Asset - before-CREATE
    // ============================================================
    // Validates the inbound Asset payload:
    //   - assetCode mandatory; uniqueness enforced
    //   - assetName mandatory
    //   - assetCategory_ID optional but validated for active-use later
    //   - serialNumber optional
    //   - purchaseDate defaulted to today when missing
    //   - warrantyExpiry - when provided must be >= purchaseDate
    //   - inventoryItem link validated against WarehouseService when present
    //   - assetStatus defaulted to Available
    // ------------------------------------------------------------
    this.before('CREATE', Assets, async (req) => {

        const {
            assetCode,
            assetName,
            purchaseDate,
            warrantyExpiry,
            inventoryItem_ID
        } = req.data;

        if (!assetCode?.trim()) {
            return req.reject(400, 'Asset Code is mandatory.');
        }
        if (!assetName?.trim()) {
            return req.reject(400, 'Asset Name is mandatory.');
        }

        const tx = cds.transaction(req);

        if (await assetCodeExists(tx, assetCode, _helperEntities)) {
            return req.reject(409, `Asset with code '${assetCode}' already exists.`);
        }

        // Map association payload to FK form.
        if (req.data.assetCategory && !req.data.assetCategory_ID) {
            req.data.assetCategory_ID = associationId(req.data.assetCategory);
        }
        if (req.data.inventoryItem && !req.data.inventoryItem_ID) {
            req.data.inventoryItem_ID = associationId(req.data.inventoryItem);
        }

        req.data.purchaseDate = purchaseDate || todayIsoDate();
        req.data.assetStatus = req.data.assetStatus || 'Available';
        req.data.condition = req.data.condition || 'Good';

        // Validate the linked InventoryItem exists + ACTIVE when supplied.
        if (inventoryItem_ID) {
            const InventoryEntity = warehouseInventoryItems();
            if (!InventoryEntity) {
                return req.reject(500, 'Warehouse service is not available.');
            }
            const inv = await getInventoryItemForAsset(
                tx,
                inventoryItem_ID,
                { InventoryItems: InventoryEntity }
            );
            if (!inv) {
                return req.reject(404, 'Inventory Item not found.');
            }
            if (inv.status !== 'ACTIVE') {
                return req.reject(409, 'Inventory Item is not active.');
            }
        }

        if (warrantyExpiry) {
            const purchased = new Date(req.data.purchaseDate);
            const warranty = new Date(warrantyExpiry);
            if (warranty < purchased) {
                return req.reject(400, 'Warranty expiry cannot be before purchase date.');
            }
        }
    });

    // ============================================================
    // Asset - before-UPDATE
    //   - prevent modification of assetCode (immutable identity)
    // ============================================================
    this.before('UPDATE', Assets, async (req) => {
        const tx = cds.transaction(req);
        const existing = await tx.run(
            SELECT.one.from(Assets).columns('assetCode', 'assetStatus').where({ ID: req.data.ID })
        );
        if (!existing) {
            return req.reject(404, 'Asset not found.');
        }
        if (req.data.assetCode && req.data.assetCode !== existing.assetCode) {
            return req.reject(400, 'Asset Code is immutable and cannot be changed.');
        }
        // Disposed / Retired assets cannot be edited except for status fields.
        const terminalStatus = existing.assetStatus === 'Disposed' || existing.assetStatus === 'Retired';
        if (terminalStatus && req.data.assetStatus && req.data.assetStatus !== existing.assetStatus) {
            return req.reject(409, `Asset is '${existing.assetStatus}' and cannot be reactivated.`);
        }
    });

    // ============================================================
    // Asset - before-DELETE
    //   - Disposed assets: physically removable (audit trail elsewhere)
    //   - All other states: deletion blocked unless Disposed
    // ============================================================
    this.before('DELETE', Assets, async (req) => {
        const assetID = assetIdFromDeleteRequest(req);
        if (!assetID) {
            return req.reject(400, 'Asset ID is mandatory.');
        }
        const tx = cds.transaction(req);
        const asset = await getAsset(tx, assetID, _helperEntities);
        if (!asset) {
            return req.reject(404, 'Asset not found.');
        }
        if (asset.assetStatus !== 'Disposed') {
            return req.reject(409, 'Only Disposed assets may be deleted.');
        }
    });

    // ============================================================
    // AssetAssignment - before-CREATE
    // ============================================================
    this.before('CREATE', AssetAssignments, async (req) => {
        const { asset_ID, employee_ID, assignedDate } = req.data;
        if (!asset_ID) return req.reject(400, 'Asset is mandatory.');
        if (!employee_ID) return req.reject(400, 'Employee is mandatory.');
        if (!assignedDate) return req.reject(400, 'Assigned Date is mandatory.');

        const tx = cds.transaction(req);

        const asset = await getAsset(tx, asset_ID, _helperEntities);
        if (!asset) return req.reject(404, 'Asset not found.');
        if (asset.assetStatus !== 'Available' && asset.assetStatus !== 'Assigned') {
            return req.reject(409, `Asset cannot be assigned because its status is '${asset.assetStatus}'.`);
        }

        // Reject duplicate (still-Assigned) assignments for the same asset.
        if (await hasActiveAssignment(tx, asset_ID, _helperEntities)) {
            return req.reject(409, 'Asset already has an active assignment.');
        }

        // Validate the employee (User) is registered and ACTIVE.
        const UsersEntity = identityUsers();
        if (!UsersEntity) {
            return req.reject(500, 'Identity service is not available.');
        }
        const employee = await resolveUser(tx, employee_ID, { Users: UsersEntity });
        if (!employee) return req.reject(404, 'Employee not found.');
        if (employee.status !== 'ACTIVE') return req.reject(409, 'Employee is not active.');
    });

    // ============================================================
    // assignAsset action
    // ============================================================
    // Business rules:
    //   - assetID + employeeID mandatory (400)
    //   - asset must exist (404), be in Available state (409)
    //   - employee must be a registered ACTIVE User (404 / 409)
    //   - no existing active assignment (409)
    //   - expectedReturnDate optional; when provided must be >= today
    //   - atomic: insert AssetAssignment row + UPDATE Asset with
    //     assetStatus=Assigned, assignedTo_ID, assignedAt,
    //     currentAssignment_ID
    // ---------------------------------------------------------
    this.on('assignAsset', async (req) => {

        const { assetID, employeeID, expectedReturnDate, remarks } = req.data;

        if (!assetID) {
            return req.reject(400, 'Asset ID is mandatory.');
        }
        if (!employeeID) {
            return req.reject(400, 'Employee ID is mandatory.');
        }

        const tx = cds.transaction(req);

        const asset = await getAsset(tx, assetID, _helperEntities);
        if (!asset) return req.reject(404, 'Asset not found.');

        if (asset.assetStatus !== 'Available') {
            return req.reject(
                409,
                `Asset cannot be assigned because its status is '${asset.assetStatus}'. Expected status: 'Available'.`
            );
        }

        const UsersEntity = identityUsers();
        if (!UsersEntity) {
            return req.reject(500, 'Identity service is not available.');
        }
        const employee = await resolveUser(tx, employeeID, { Users: UsersEntity });
        if (!employee) return req.reject(404, 'Employee not found.');
        if (employee.status !== 'ACTIVE') {
            return req.reject(409, 'Employee is not active.');
        }

        if (await hasActiveAssignment(tx, assetID, _helperEntities)) {
            return req.reject(409, 'Asset already has an active assignment.');
        }

        if (expectedReturnDate) {
            const expected = new Date(expectedReturnDate);
            if (expected < new Date(todayIsoDate())) {
                return req.reject(400, 'Expected return date cannot be in the past.');
            }
        }

        const assignedByID = normalizeUserId(req?.user?.id);

        const assignmentEntry = {
            asset_ID: assetID,
            employee_ID: employeeID,
            assignedDate: todayIsoDate(),
            expectedReturnDate: expectedReturnDate ?? null,
            assignmentStatus: 'Assigned',
            assignedBy_ID: assignedByID
        };

        const inserted = await recordAssignment(tx, assignmentEntry, _helperEntities);

        await transitionAssetStatus(
            tx,
            assetID,
            'Assigned',
            _helperEntities,
            {
                assignedTo_ID: employeeID,
                assignedAt: nowIsoTimestamp(),
                currentAssignment_ID: inserted.ID
            }
        );

        // Auto-emit AssetAssigned notification to the employee who received
        // the asset (the natural audience of the assignment event).
        await emitAssetNotification(tx, NOTIFICATION_EVENT.ASSET_ASSIGNED, {
            documentNumber: asset.assetCode,
            actor: assignedByID ?? 'system',
            recipientID: employeeID,
            referenceEntity: 'Asset',
            referenceID: assetID,
            parentDocument: employee.employeeId
        });

        return true;

    });

    // ============================================================
    // returnAsset action
    // ============================================================
    // Business rules:
    //   - assetAssignmentID mandatory
    //   - Assignment must exist (404) and be in 'Assigned' state (409)
    //   - Atomic: write returnedDate + returnRemarks + assignmentStatus=Returned
    //     + returnedBy_ID; restore Asset.assetStatus to Available;
    //     clear currentAssignment_ID and assignedTo_ID.
    // ---------------------------------------------------------
    this.on('returnAsset', async (req) => {

        const { assetAssignmentID, returnRemarks } = req.data;

        if (!assetAssignmentID) {
            return req.reject(400, 'Asset Assignment ID is mandatory.');
        }

        const tx = cds.transaction(req);

        const assignment = await tx.run(
            SELECT.one.from(AssetAssignments)
                .columns('ID', 'asset_ID', 'assignmentStatus', 'employee_ID')
                .where({ ID: assetAssignmentID })
        );

        if (!assignment) {
            return req.reject(404, 'Asset Assignment not found.');
        }

        if (assignment.assignmentStatus !== 'Assigned') {
            return req.reject(
                409,
                `Asset Assignment cannot be returned because its status is '${assignment.assignmentStatus}'. Expected status: 'Assigned'.`
            );
        }

        const returnedByID = normalizeUserId(req?.user?.id);

        // Mark the assignment as Returned.
        await tx.run(
            UPDATE(AssetAssignments)
                .set({
                    assignmentStatus: 'Returned',
                    returnedDate: todayIsoDate(),
                    returnRemarks: returnRemarks ? String(returnRemarks).slice(0, 1000) : null,
                    returnedBy_ID: returnedByID
                })
                .where({ ID: assetAssignmentID })
        );

        // Restore the Asset to Available state.
        await transitionAssetStatus(
            tx,
            assignment.asset_ID,
            'Available',
            _helperEntities,
            {
                assignedTo_ID: null,
                assignedAt: null,
                currentAssignment_ID: null
            }
        );

        // Auto-emit AssetReturned notification to the original employee.
        await emitAssetNotification(tx, NOTIFICATION_EVENT.ASSET_RETURNED, {
            documentNumber: (await getAsset(tx, assignment.asset_ID, _helperEntities))?.assetCode ?? '',
            actor: returnedByID ?? 'system',
            recipientID: assignment.employee_ID,
            referenceEntity: 'Asset',
            referenceID: assignment.asset_ID
        });

        return true;

    });

    // ============================================================
    // transferAsset action
    // ============================================================
    // Business rules:
    //   - assetID + destinationInventoryItemID mandatory
    //   - asset must exist + be in Available / Maintenance state
    //   - destination InventoryItem must exist, be ACTIVE, belong to a
    //     different WarehouseService InventoryItem than the asset's current
    //     inventory link (must represent a different physical location)
    //   - Atomic: UPDATE Asset.inventoryItem_ID to the destination InventoryItem
    // ---------------------------------------------------------
    this.on('transferAsset', async (req) => {

        const { assetID, destinationInventoryItemID, remarks } = req.data;

        if (!assetID) {
            return req.reject(400, 'Asset ID is mandatory.');
        }
        if (!destinationInventoryItemID) {
            return req.reject(400, 'Destination Inventory Item ID is mandatory.');
        }

        const tx = cds.transaction(req);

        const asset = await getAsset(tx, assetID, _helperEntities);
        if (!asset) return req.reject(404, 'Asset not found.');

        if (asset.assetStatus !== 'Available' && asset.assetStatus !== 'Maintenance') {
            return req.reject(
                409,
                `Asset cannot be transferred because its status is '${asset.assetStatus}'. Only Available or Maintenance assets can be transferred.`
            );
        }

        const InventoryItemsEntity = warehouseInventoryItems();
        if (!InventoryItemsEntity) {
            return req.reject(500, 'Warehouse service is not available.');
        }

        const dstInv = await getInventoryItemForAsset(
            tx,
            destinationInventoryItemID,
            { InventoryItems: InventoryItemsEntity }
        );
        if (!dstInv) {
            return req.reject(404, 'Destination Inventory Item not found.');
        }
        if (dstInv.status !== 'ACTIVE') {
            return req.reject(409, 'Destination Inventory Item is not active.');
        }

        // If the asset has a current inventory link, the destination must differ.
        if (asset.inventoryItem_ID && asset.inventoryItem_ID === destinationInventoryItemID) {
            return req.reject(400, 'Destination Inventory Item is the same as the current one.');
        }

        await tx.run(
            UPDATE(Assets)
                .set({ inventoryItem_ID: destinationInventoryItemID })
                .where({ ID: assetID })
        );

        return true;

    });

    // ============================================================
    // retireAsset action  (Available / Assigned / Maintenance -> Retired)
    // ============================================================
    this.on('retireAsset', async (req) => {

        const { assetID, reason } = req.data;

        if (!assetID) {
            return req.reject(400, 'Asset ID is mandatory.');
        }
        if (!reason || !String(reason).trim()) {
            return req.reject(400, 'Retirement reason is mandatory.');
        }

        const tx = cds.transaction(req);

        const asset = await getAsset(tx, assetID, _helperEntities);
        if (!asset) return req.reject(404, 'Asset not found.');

        const validStates = ['Available', 'Assigned', 'Maintenance'];
        if (!validStates.includes(asset.assetStatus)) {
            return req.reject(
                409,
                `Asset cannot be retired because its status is '${asset.assetStatus}'. Retirement is permitted from Available, Assigned or Maintenance.`
            );
        }

        // If asset is currently assigned, the assignment should be returned
        // first; we refuse to retire an actively-Assigned asset to prevent
        // orphaned assignments.
        const activeAssignment = await getActiveAssignment(tx, assetID, _helperEntities);
        if (activeAssignment) {
            return req.reject(409, 'Cannot retire an Asset that is currently assigned. Return the asset first.');
        }

        const retiredByID = normalizeUserId(req?.user?.id);

        await transitionAssetStatus(
            tx,
            assetID,
            'Retired',
            _helperEntities,
            {
                retiredAt: nowIsoTimestamp(),
                retiredBy_ID: retiredByID,
                retirementReason: String(reason).slice(0, 1000)
            }
        );

        // Auto-emit AssetRetired notification to the actor (the asset has
        // no current assignee at this point since the retire guard
        // required the active assignment to be returned first).
        if (retiredByID) {
            await emitAssetNotification(tx, NOTIFICATION_EVENT.ASSET_RETIRED, {
                documentNumber: asset.assetCode,
                actor: retiredByID,
                recipientID: retiredByID,
                referenceEntity: 'Asset',
                referenceID: assetID,
                reason: String(reason).slice(0, 500)
            });
        }

        return true;

    });

    // ============================================================
    // disposeAsset action (Retired -> Disposed)
    // ============================================================
    // Per the Asset lifecycle, only Retired assets may be disposed. This
    // stops Available / Assigned / Maintenance assets from jumping the
    // Retired stage - the Retired stage is the official "out of service"
    // marker, while Disposed is the final physical removal state.
    // ---------------------------------------------------------
    this.on('disposeAsset', async (req) => {

        const { assetID, reason } = req.data;

        if (!assetID) {
            return req.reject(400, 'Asset ID is mandatory.');
        }
        if (!reason || !String(reason).trim()) {
            return req.reject(400, 'Disposal reason is mandatory.');
        }

        const tx = cds.transaction(req);

        const asset = await getAsset(tx, assetID, _helperEntities);
        if (!asset) return req.reject(404, 'Asset not found.');

        if (asset.assetStatus !== 'Retired') {
            return req.reject(
                409,
                `Asset cannot be disposed because its status is '${asset.assetStatus}'. Disposal is only permitted from Retired.`
            );
        }

        const disposedByID = normalizeUserId(req?.user?.id);

        await transitionAssetStatus(
            tx,
            assetID,
            'Disposed',
            _helperEntities,
            {
                disposedAt: nowIsoTimestamp(),
                disposedBy_ID: disposedByID,
                disposalReason: String(reason).slice(0, 1000)
            }
        );

        // Auto-emit AssetDisposed notification to the actor. Disposal is a
        // critical-priority event in the catalog because it represents the
        // final physical removal of the asset from the books.
        if (disposedByID) {
            await emitAssetNotification(tx, NOTIFICATION_EVENT.ASSET_DISPOSED, {
                documentNumber: asset.assetCode,
                actor: disposedByID,
                recipientID: disposedByID,
                referenceEntity: 'Asset',
                referenceID: assetID,
                reason: String(reason).slice(0, 500)
            });
        }

        return true;

    });

});
