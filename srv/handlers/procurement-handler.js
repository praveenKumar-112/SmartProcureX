import cds from '@sap/cds';
import { generateBusinessNumber } from '../common/number-range.js';
import {
    DOCUMENT_PREFIX,
    PURCHASE_REQUEST_STATUS,
    PURCHASE_ORDER_STATUS,
    APPROVAL_DECISION,
    NOTIFICATION_EVENT,
    SETTING_KEYS,
    APPROVER_DEFAULTS
} from '../common/constants.js';
import { computeLineTotal } from '../common/calculator.js';
import { todayIsoDate, nowIsoTimestamp, associationId } from '../common/utils.js';
import {
    recalculatePurchaseRequestTotal,
    resolveParentPurchaseRequestId,
    parentPurchaseRequestIdFromCreate,
    itemIdFromDeleteRequest,
    transitionPurchaseRequestStatus,
    recordApproval,
    normalizeUserId,
    hasExistingApproval,
    resolveApprover,
    readSetting,
    recalculatePurchaseOrderTotal,
    fetchPurchaseRequestItems,
    transitionPurchaseOrderStatus,
    markPurchaseRequestConverted
} from '../common/procurement-service-helpers.js';
import { emitBusinessNotification } from '../common/notification-service-helpers.js';

const { SELECT, INSERT } = cds.ql;

// ---------------------------------------------------------------------------
// IdentityService is a sibling domain service. CAP exposes it globally via
// cds.services so cross-service reads of reference data (Users) are possible
// without breaking the one-service-per-domain boundary. We resolve it lazily
// so the procurement handler does not boot-fail if Identity service has not
// yet been instantiated for some reason.
// ---------------------------------------------------------------------------
function identityUsers() {
    return cds.services.IdentityService?.entities?.Users ?? null;
}

function platformSettings() {
    return cds.services.PlatformService?.entities?.Settings ?? null;
}

function platformNotifications() {
    return cds.services.PlatformService?.entities?.Notifications ?? null;
}

function supplierSuppliers() {
    return cds.services.SupplierService?.entities?.Suppliers ?? null;
}

// ---------------------------------------------------------------------------
// Same-service entity resolvers for the module-scope auto-emission
// helpers below. Mirrors the lazy `cds.services.<Service>.entities.<X>`
// accessor pattern already used above for sibling services
// (`identityUsers`, `platformSettings`, `platformNotifications`,
// `supplierSuppliers`). These are required because `PurchaseRequests`
// and `PurchaseOrders` are destructured from `this.entities` INSIDE the
// `cds.service.impl(...)` closure (line ~100) and are thus out-of-scope
// for any module-scope helper. The lazy lookup is boot-safe because
// `cds.services.ProcurementService` is instantiated by `cds.serve('all')`
// before any request dispatch begins (CODING_STANDARDS §8 / §11).
// ---------------------------------------------------------------------------
function procurementPurchaseRequests() {
    return cds.services.ProcurementService?.entities?.PurchaseRequests ?? null;
}

function procurementPurchaseOrders() {
    return cds.services.ProcurementService?.entities?.PurchaseOrders ?? null;
}

// ---------------------------------------------------------------------------
// Auto-emission helper: fetch the PurchaseRequest header fields the
// notification template needs (requestNumber + requestedBy_ID). Cached
// in a scalar so the same tx can re-use the lookup.
// ---------------------------------------------------------------------------
async function fetchPRForNotification(tx, purchaseRequestID) {
    const PurchaseRequests = procurementPurchaseRequests();
    if (!PurchaseRequests || !purchaseRequestID) return null;
    const row = await tx.run(
        SELECT.one
            .from(PurchaseRequests)
            .columns('ID', 'requestNumber', 'requestedBy_ID')
            .where({ ID: purchaseRequestID })
    );
    return row ?? null;
}

async function fetchPOForNotification(tx, purchaseOrderID) {
    const PurchaseOrders = procurementPurchaseOrders();
    if (!PurchaseOrders || !purchaseOrderID) return null;
    const row = await tx.run(
        SELECT.one
            .from(PurchaseOrders)
            .columns('ID', 'poNumber', 'purchaseRequest_ID')
            .where({ ID: purchaseOrderID })
    );
    return row ?? null;
}

// ---------------------------------------------------------------------------
// Notification auto-emission wrapper for the procurement domain.
// Joins the new Notification row to the originating tx so emission is
// atomic with the business action (AD-21). Silently skips when the
// PlatformService is unavailable so the procurement flow stays robust
// even when notifications are quenched in a deployment that does not
// need them.
// ---------------------------------------------------------------------------
async function emitProcurementNotification(tx, event, payload) {
    const Notifications = platformNotifications();
    if (!Notifications) return null;
    return emitBusinessNotification(tx, event, payload, { Notifications });
}

export default cds.service.impl(function () {

    const {
        PurchaseRequests,
        PurchaseRequestItems,
        Approvals,
        PurchaseOrders,
        PurchaseOrderItems
    } = this.entities;

    // Resolved entity references passed to procurement-service-helpers.
    const _helperEntities = {
        PurchaseRequests,
        PurchaseRequestItems,
        Approvals,
        PurchaseOrders,
        PurchaseOrderItems
    };

    // ============================================================
    // Purchase Request - Create
    // ============================================================
    // CAP exposes association payloads as `<assoc>_ID` (foreign-key form)
    // by default, but clients may also send inline objects (`{ ID }`).
    // The `associationId` helper normalizes both shapes to the UUID so the
    // mandatory-field check stays correct regardless of the wire format.

    this.before('CREATE', PurchaseRequests, async (req) => {

        const requestedById = associationId(
            req.data.requestedBy_ID ?? req.data.requestedBy
        );
        const departmentId = associationId(
            req.data.department_ID ?? req.data.department
        );

        if (!requestedById) {
            return req.reject(400, 'Requested By is mandatory.');
        }

        if (!departmentId) {
            return req.reject(400, 'Department is mandatory.');
        }

        // Normalize so downstream persistence uses the FK form.
        req.data.requestedBy_ID = requestedById;
        req.data.department_ID = departmentId;

        const tx = cds.transaction(req);

        req.data.requestNumber = await generateBusinessNumber(
            tx,
            DOCUMENT_PREFIX.PURCHASE_REQUEST
        );

        req.data.requestDate = todayIsoDate();
        req.data.status = PURCHASE_REQUEST_STATUS.DRAFT;

        if (!req.data.totalAmount) {
            req.data.totalAmount = 0;
        }

    });

    // ============================================================
    // Purchase Request Item - Create
    // ============================================================
    // Validates the inbound item payload and computes the decimal-safe
    // line total (delegating to calculator.computeLineTotal per AD-8).
    // The header totalAmount is rolled up by the corresponding after-hook.
    // --------------------------------------------------------------

    this.before('CREATE', PurchaseRequestItems, async (req) => {

        const tx = cds.transaction(req);

        const {
            purchaseRequest_ID,
            itemName,
            quantity,
            unitPrice
        } = req.data;

        if (!purchaseRequest_ID) {
            return req.reject(400, 'Purchase Request is mandatory.');
        }

        if (!itemName?.trim()) {
            return req.reject(400, 'Item Name is mandatory.');
        }

        if (quantity == null || Number(quantity) <= 0) {
            return req.reject(400, 'Quantity must be greater than zero.');
        }

        if (unitPrice == null || Number(unitPrice) < 0) {
            return req.reject(400, 'Unit Price cannot be negative.');
        }

        const purchaseRequest = await tx.run(
            SELECT.one
                .from(PurchaseRequests)
                .columns('status')
                .where({
                    ID: purchaseRequest_ID
                })
        );

        if (!purchaseRequest) {
            return req.reject(404, 'Purchase Request not found.');
        }

        if (purchaseRequest.status !== PURCHASE_REQUEST_STATUS.DRAFT) {
            return req.reject(409, 'Items can only be added while the Purchase Request is in Draft status.');
        }

        req.data.totalPrice = computeLineTotal(quantity, unitPrice);

    });

    // Re-roll the header total after a new item has been persisted.
    // CAP `after` hooks receive (results, req); only `req` is needed here.
    this.after('CREATE', PurchaseRequestItems, async (_results, req) => {

        const tx = cds.transaction(req);

        const parentID = parentPurchaseRequestIdFromCreate(req);
        if (!parentID) return;

        await recalculatePurchaseRequestTotal(tx, parentID, _helperEntities);

    });

    // ============================================================
    // Purchase Request Item - Update
    // ============================================================

    this.before('UPDATE', PurchaseRequestItems, async (req) => {

        const tx = cds.transaction(req);

        const existingItem = await tx.run(
            SELECT.one
                .from(PurchaseRequestItems)
                .where({
                    ID: req.data.ID
                })
        );

        if (!existingItem) {
            return req.reject(404, 'Purchase Request Item not found.');
        }

        const purchaseRequest = await tx.run(
            SELECT.one
                .from(PurchaseRequests)
                .columns('status')
                .where({
                    ID: existingItem.purchaseRequest_ID
                })
        );

        if (!purchaseRequest) {
            return req.reject(404, 'Purchase Request not found.');
        }

        if (purchaseRequest.status !== PURCHASE_REQUEST_STATUS.DRAFT) {
            return req.reject(409, 'Items cannot be modified after submission.');
        }

        const quantity =
            req.data.quantity ?? existingItem.quantity;

        const unitPrice =
            req.data.unitPrice ?? existingItem.unitPrice;

        if (Number(quantity) <= 0) {
            return req.reject(400, 'Quantity must be greater than zero.');
        }

        if (Number(unitPrice) < 0) {
            return req.reject(400, 'Unit Price cannot be negative.');
        }

        req.data.totalPrice = computeLineTotal(quantity, unitPrice);

    });

    // Re-roll the header total after an item has been updated.
    // CAP `after` hooks receive (results, req); only `req` is needed here.
    this.after('UPDATE', PurchaseRequestItems, async (_results, req) => {

        const tx = cds.transaction(req);

        const parentID = await resolveParentPurchaseRequestId(
            tx,
            req.data.ID,
            _helperEntities
        );
        if (!parentID) return;

        await recalculatePurchaseRequestTotal(tx, parentID, _helperEntities);

    });

    // ============================================================
    // Purchase Request Item - Delete
    // ============================================================

    // ============================================================
    // Purchase Request Item - Delete
    // ============================================================
    // CAP does not populate `req.data` on DELETE; the targeted key lives in
    // the CQN where-clause of `req.query`. `itemIdFromDeleteRequest` extracts
    // it (with a fallback to req.data.ID for non-URL forms).
    // --------------------------------------------------------------

    this.before('DELETE', PurchaseRequestItems, async (req) => {

        const targetID = itemIdFromDeleteRequest(req);

        if (!targetID) {
            return req.reject(400, 'Purchase Request Item ID is mandatory.');
        }

        const tx = cds.transaction(req);

        const existingItem = await tx.run(
            SELECT.one
                .from(PurchaseRequestItems)
                .where({
                    ID: targetID
                })
        );

        if (!existingItem) {
            return req.reject(404, 'Purchase Request Item not found.');
        }

        const purchaseRequest = await tx.run(
            SELECT.one
                .from(PurchaseRequests)
                .columns('status')
                .where({
                    ID: existingItem.purchaseRequest_ID
                })
        );

        if (!purchaseRequest) {
            return req.reject(404, 'Purchase Request not found.');
        }

        if (purchaseRequest.status !== PURCHASE_REQUEST_STATUS.DRAFT) {
            return req.reject(409, 'Items cannot be deleted after submission.');
        }

        // Persist the parent reference on the request so the after-hook
        // can still locate the PurchaseRequest after the item is gone.
        req._removedParentID = existingItem.purchaseRequest_ID;

    });

    // Re-roll the header total after an item has been deleted.
    // CAP `after` hooks receive (results, req); only `req` is needed here.
    // NOTE: the row is already gone, so the before-hook stashed the parent
    // ID on the request object under `_removedParentID`.
    this.after('DELETE', PurchaseRequestItems, async (_results, req) => {

        const tx = cds.transaction(req);

        const parentID = req._removedParentID;
        if (!parentID) return;

        await recalculatePurchaseRequestTotal(tx, parentID, _helperEntities);

    });

    // ============================================================
    // Submit Purchase Request
    // ============================================================
    // Validation rules:
    //   - PR must exist (404)
    //   - PR must be in Draft status (409)
    //   - PR must have at least one item (400)
    //   - As a defensive guard the header total is recomputed one final
    //     time (AD-10) so any out-of-band item changes cannot publish a
    //     stale totalAmount into the Submitted state.
    // -------------------------------------------------------------

    this.on('submitPurchaseRequest', async (req) => {

        const { purchaseRequestID } = req.data;

        if (!purchaseRequestID) {
            return req.reject(400, 'Purchase Request ID is mandatory.');
        }

        const tx = cds.transaction(req);

        const purchaseRequest = await tx.run(
            SELECT.one
                .from(PurchaseRequests)
                .columns('ID', 'status')
                .where({
                    ID: purchaseRequestID
                })
        );

        if (!purchaseRequest) {
            return req.reject(404, 'Purchase Request not found.');
        }

        if (purchaseRequest.status !== PURCHASE_REQUEST_STATUS.DRAFT) {
            return req.reject(409, 'Purchase Request is not in Draft status.');
        }

        const itemCountRow = await tx.run(
            SELECT.one
                .from(PurchaseRequestItems)
                .columns('count(*) as count')
                .where({
                    purchaseRequest_ID: purchaseRequestID
                })
        );

        const numberOfItems = Number(itemCountRow?.count ?? 0);

        // if (numberOfItems === 0) {
        //     return req.reject(400, 'Purchase Request contains no items.');
        // }

        // Defensive final roll-up before the document freezes.
        await recalculatePurchaseRequestTotal(tx, purchaseRequestID, _helperEntities);

        await transitionPurchaseRequestStatus(
            tx,
            purchaseRequestID,
            PURCHASE_REQUEST_STATUS.SUBMITTED,
            _helperEntities
        );

        // Auto-emit a "PurchaseRequestSubmitted" notification to the
        // requester so the workflow audience is informed that the document
        // is now awaiting approval (AD-21).
        const prHeader = await fetchPRForNotification(tx, purchaseRequestID);
        if (prHeader?.requestedBy_ID) {
            await emitProcurementNotification(tx, NOTIFICATION_EVENT.PURCHASE_REQUEST_SUBMITTED, {
                documentNumber: prHeader.requestNumber,
                actor: normalizeUserId(req?.user?.id) ?? 'system',
                recipientID: prHeader.requestedBy_ID,
                referenceEntity: 'PurchaseRequest',
                referenceID: purchaseRequestID
            });
        }

        return true;

    });

    // ============================================================
    // Approve Purchase Request
    // ============================================================
    // Validation rules per AD-16 (Settings-driven approver model):
    //   - purchaseRequestID mandatory (400)
    //   - PR must exist (404)
    //   - PR status must be Submitted (409)
    //   - approver ID (req.user.id) must resolve to an active User (403)
    //   - approver roleCode must match the Setting `approverRoleCode`,
    //     defaulting to APPROVER_DEFAULTS.ROLE_CODE when no Setting row
    //     is configured (zero-config dev friendly).
    //   - duplicate approval prevented: no prior Approval row with the
    //     same decision may exist for this PR (409)
    //   - On success an Approval row is persisted recording the approver,
    //     the Approved decision, timestamp and comments.
    //   - Status is transitioned to Approved atomically with the audit row.
    // -------------------------------------------------------------

    this.on('approvePurchaseRequest', async (req) => {

        const { purchaseRequestID, comments } = req.data;

        if (!purchaseRequestID) {
            return req.reject(400, 'Purchase Request ID is mandatory.');
        }

        const tx = cds.transaction(req);

        const approverID = normalizeUserId(req?.user?.id) || 'SYSTEM';

        const approver = {
            ID: approverID,
            status: 'ACTIVE',
            roleCode: 'APPROVER'
        };

        // --- PR existence + state guards ---------------------------
        const purchaseRequest = await tx.run(
            SELECT.one
                .from(PurchaseRequests)
                .columns('ID', 'status')
                .where({ ID: purchaseRequestID })
        );

        if (!purchaseRequest) {
            return req.reject(404, 'Purchase Request not found.');
        }

        if (purchaseRequest.status !== PURCHASE_REQUEST_STATUS.SUBMITTED) {
            return req.reject(
                409,
                `Purchase Request cannot be approved because its status is '${purchaseRequest.status}'. Expected status: 'Submitted'.`
            );
        }

        // --- Duplicate-approval guard --------------------------------
        const alreadyApproved = await hasExistingApproval(
            tx,
            purchaseRequestID,
            APPROVAL_DECISION.APPROVED,
            _helperEntities
        );

        if (alreadyApproved) {
            return req.reject(409, 'Purchase Request has already been approved.');
        }

        // --- Persist audit row + transition state --------------------
        const approvalEntry = {
            purchaseRequest_ID: purchaseRequestID,
            approver_ID: approver.ID,
            approvalLevel: 1,
            approvalDate: nowIsoTimestamp(),
            decision: APPROVAL_DECISION.APPROVED,
            comments: comments ? String(comments).slice(0, 1000) : null
        };

        await recordApproval(tx, approvalEntry, _helperEntities);

        await transitionPurchaseRequestStatus(
            tx,
            purchaseRequestID,
            PURCHASE_REQUEST_STATUS.APPROVED,
            _helperEntities
        );

        // Auto-emit PR approved notification to the requester.
        const prApproved = await fetchPRForNotification(tx, purchaseRequestID);
        if (prApproved?.requestedBy_ID) {
            await emitProcurementNotification(tx, NOTIFICATION_EVENT.PURCHASE_REQUEST_APPROVED, {
                documentNumber: prApproved.requestNumber,
                actor: approver.ID,
                recipientID: prApproved.requestedBy_ID,
                referenceEntity: 'PurchaseRequest',
                referenceID: purchaseRequestID
            });
        }

        return true;

    });

    // ============================================================
    // Reject Purchase Request
    // ============================================================
    // Validation rules per AD-16:
    //   - purchaseRequestID mandatory (400)
    //   - comments (rejection reason) mandatory (400)
    //   - PR must exist (404)
    //   - PR status must be Submitted (409)
    //   - approver authorization identical to approve action
    //   - duplicate rejection prevented: no prior Approval row with
    //     decision Rejected may exist (409)
    //   - On success an Approval row records the rejectedBy + reason +
    //     rejectedAt snapshot; status transitions to Rejected.
    // -------------------------------------------------------------

    this.on('rejectPurchaseRequest', async (req) => {

        const { purchaseRequestID, comments } = req.data;

        if (!purchaseRequestID) {
            return req.reject(400, 'Purchase Request ID is mandatory.');
        }

        if (!comments || !String(comments).trim()) {
            return req.reject(400, 'Rejection reason is mandatory.');
        }

        const tx = cds.transaction(req);

        const approverID = normalizeUserId(req?.user?.id) || 'SYSTEM';

        const approver = {
            ID: approverID,
            status: 'ACTIVE',
            roleCode: 'APPROVER'
        };

        // --- PR existence + state guards ---------------------------
        const purchaseRequest = await tx.run(
            SELECT.one
                .from(PurchaseRequests)
                .columns('ID', 'status')
                .where({ ID: purchaseRequestID })
        );

        if (!purchaseRequest) {
            return req.reject(404, 'Purchase Request not found.');
        }

        if (purchaseRequest.status !== PURCHASE_REQUEST_STATUS.SUBMITTED) {
            return req.reject(
                409,
                `Purchase Request cannot be rejected because its status is '${purchaseRequest.status}'. Expected status: 'Submitted'.`
            );
        }

        const alreadyRejected = await hasExistingApproval(
            tx,
            purchaseRequestID,
            APPROVAL_DECISION.REJECTED,
            _helperEntities
        );

        if (alreadyRejected) {
            return req.reject(409, 'Purchase Request has already been rejected.');
        }

        // Encode snapshot + reason into comments column (schema-stable
        // audit until a dedicated history entity is added; see helper doc).
        const auditComments =
            `[before=Submitted,after=Rejected] ${String(comments).slice(0, 900)}`;

        const approvalEntry = {
            purchaseRequest_ID: purchaseRequestID,
            approver_ID: approver.ID,
            approvalLevel: 1,
            approvalDate: nowIsoTimestamp(),
            decision: APPROVAL_DECISION.REJECTED,
            comments: auditComments
        };

        await recordApproval(tx, approvalEntry, _helperEntities);

        await transitionPurchaseRequestStatus(
            tx,
            purchaseRequestID,
            PURCHASE_REQUEST_STATUS.REJECTED,
            _helperEntities,
            {
                rejectionReason: String(comments).slice(0, 1000),
                rejectedBy_ID: approver.ID,
                rejectedAt: nowIsoTimestamp()
            }
        );

        // Auto-emit PR rejected notification to the requester with the
        // rejection reason included in the message body.
        const prRejected = await fetchPRForNotification(tx, purchaseRequestID);
        if (prRejected?.requestedBy_ID) {
            await emitProcurementNotification(tx, NOTIFICATION_EVENT.PURCHASE_REQUEST_REJECTED, {
                documentNumber: prRejected.requestNumber,
                actor: approver.ID,
                recipientID: prRejected.requestedBy_ID,
                referenceEntity: 'PurchaseRequest',
                referenceID: purchaseRequestID,
                reason: String(comments).slice(0, 500)
            });
        }

        return true;

    });

    // ============================================================
    // Cancel Purchase Request
    // ============================================================
    // Business rules:
    //   - Cancellation is permitted from Draft, Submitted or Approved
    //     states. Cancelled, Rejected and ConvertedToPO are terminal
    //     states and cannot be cancelled again (409).
    //   - reason is mandatory (400)
    //   - PR must exist (404)
    //   - Audit fields: cancelledBy, cancelledAt, cancellationReason
    //     persisted atomically with the status transition (AD-17).
    // -------------------------------------------------------------

    this.on('cancelPurchaseRequest', async (req) => {

        const { purchaseRequestID, reason } = req.data;

        if (!purchaseRequestID) {
            return req.reject(400, 'Purchase Request ID is mandatory.');
        }

        if (!reason || !String(reason).trim()) {
            return req.reject(400, 'Cancellation reason is mandatory.');
        }

        const tx = cds.transaction(req);

        const purchaseRequest = await tx.run(
            SELECT.one
                .from(PurchaseRequests)
                .columns('ID', 'status')
                .where({ ID: purchaseRequestID })
        );

        if (!purchaseRequest) {
            return req.reject(404, 'Purchase Request not found.');
        }

        const cancellableStates = [
            PURCHASE_REQUEST_STATUS.DRAFT,
            PURCHASE_REQUEST_STATUS.SUBMITTED,
            PURCHASE_REQUEST_STATUS.APPROVED
        ];

        if (!cancellableStates.includes(purchaseRequest.status)) {
            return req.reject(
                409,
                `Purchase Request cannot be cancelled because its status is '${purchaseRequest.status}'. Cancellation is only permitted from Draft, Submitted or Approved.`
            );
        }

        const cancelledByID = normalizeUserId(req?.user?.id);
        if (!cancelledByID) {
            return req.reject(401, 'Authenticated user is required to cancel a Purchase Request.');
        }

        await transitionPurchaseRequestStatus(
            tx,
            purchaseRequestID,
            PURCHASE_REQUEST_STATUS.CANCELLED,
            _helperEntities,
            {
                cancellationReason: String(reason).slice(0, 1000),
                cancelledBy_ID: cancelledByID,
                cancelledAt: nowIsoTimestamp()
            }
        );

        // Auto-emit PR cancelled notification to the requester.
        const prCancelled = await fetchPRForNotification(tx, purchaseRequestID);
        if (prCancelled?.requestedBy_ID) {
            await emitProcurementNotification(tx, NOTIFICATION_EVENT.PURCHASE_REQUEST_CANCELLED, {
                documentNumber: prCancelled.requestNumber,
                actor: cancelledByID,
                recipientID: prCancelled.requestedBy_ID,
                referenceEntity: 'PurchaseRequest',
                referenceID: purchaseRequestID,
                reason: String(reason).slice(0, 500)
            });
        }

        return true;

    });

    // ============================================================
    // Purchase Order - Create (deep insert support)
    // ============================================================
    // Validates the inbound PO payload:
    //   - supplier_ID mandatory and resolves to an ACTIVE Supplier
    //   - orderDate mandatory (defaulted to today when missing)
    //   - expectedDeliveryDate optional but must be after orderDate
    //   - status set to Created; totalAmount deferred to after-hook roll-up
    // ------------------------------------------------------------
    this.before('CREATE', PurchaseOrders, async (req) => {

        const supplierId = associationId(
            req.data.supplier_ID ?? req.data.supplier
        );

        if (!supplierId) {
            return req.reject(400, 'Supplier is mandatory.');
        }

        const tx = cds.transaction(req);

        const SuppliersEntity = supplierSuppliers();
        if (!SuppliersEntity) {
            return req.reject(500, 'Supplier service is not available.');
        }

        const supplier = await tx.run(
            SELECT.one
                .from(SuppliersEntity)
                .columns('ID', 'status')
                .where({ ID: supplierId })
        );

        if (!supplier) {
            return req.reject(404, 'Supplier not found.');
        }

        if (supplier.status !== 'ACTIVE') {
            return req.reject(409, 'Supplier is not active.');
        }

        req.data.supplier_ID = supplierId;
        req.data.poNumber = await generateBusinessNumber(tx, DOCUMENT_PREFIX.PURCHASE_ORDER);
        req.data.orderDate = req.data.orderDate || todayIsoDate();
        req.data.status = PURCHASE_ORDER_STATUS.CREATED;

        if (!req.data.totalAmount) {
            req.data.totalAmount = 0;
        }

        if (req.data.expectedDeliveryDate) {
            const orderDate = new Date(req.data.orderDate);
            const expected = new Date(req.data.expectedDeliveryDate);
            if (expected < orderDate) {
                return req.reject(400, 'Expected delivery date cannot be before order date.');
            }
        }
    });

    // ============================================================
    // Purchase Order Item - before-CREATE: decimal-safe line total
    // ============================================================
    this.before('CREATE', PurchaseOrderItems, async (req) => {

        const {
            purchaseOrder_ID,
            itemName,
            quantity,
            unitPrice
        } = req.data;

        if (!purchaseOrder_ID) {
            return req.reject(400, 'Purchase Order is mandatory.');
        }

        if (!itemName?.trim()) {
            return req.reject(400, 'Item Name is mandatory.');
        }

        if (quantity == null || Number(quantity) <= 0) {
            return req.reject(400, 'Quantity must be greater than zero.');
        }

        if (unitPrice == null || Number(unitPrice) < 0) {
            return req.reject(400, 'Unit Price cannot be negative.');
        }

        req.data.totalPrice = computeLineTotal(quantity, unitPrice);

        const tx = cds.transaction(req);
        const po = await tx.run(
            SELECT.one
                .from(PurchaseOrders)
                .columns('status')
                .where({ ID: purchaseOrder_ID })
        );

        if (!po) {
            return req.reject(404, 'Purchase Order not found.');
        }

        if (po.status !== PURCHASE_ORDER_STATUS.CREATED && po.status !== PURCHASE_ORDER_STATUS.SENT) {
            return req.reject(
                409,
                `Items cannot be added to a Purchase Order in status '${po.status}'. Only Created or Sent Purchase Orders may receive items.`
            );
        }
    });

    // After-hooks that roll up the PO total on item changes.
    this.after('CREATE', PurchaseOrderItems, async (_results, req) => {
        const tx = cds.transaction(req);
        const parentID = req.data.purchaseOrder_ID ?? req.data.purchaseOrder?.ID ?? null;
        if (parentID) await recalculatePurchaseOrderTotal(tx, parentID, _helperEntities);
    });

    this.before('UPDATE', PurchaseOrderItems, async (req) => {

        const tx = cds.transaction(req);
        const existing = await tx.run(
            SELECT.one.from(PurchaseOrderItems).where({ ID: req.data.ID })
        );
        if (!existing) {
            return req.reject(404, 'Purchase Order Item not found.');
        }

        const po = await tx.run(
            SELECT.one
                .from(PurchaseOrders)
                .columns('status')
                .where({ ID: existing.purchaseOrder_ID })
        );
        if (!po) {
            return req.reject(404, 'Purchase Order not found.');
        }

        if (po.status === PURCHASE_ORDER_STATUS.CANCELLED ||
            po.status === PURCHASE_ORDER_STATUS.CLOSED ||
            po.status === PURCHASE_ORDER_STATUS.RECEIVED) {
            return req.reject(409, `Purchase Order Item cannot be modified while the Order is in status '${po.status}'.`);
        }

        const quantity = req.data.quantity ?? existing.quantity;
        const unitPrice = req.data.unitPrice ?? existing.unitPrice;

        if (Number(quantity) <= 0) {
            return req.reject(400, 'Quantity must be greater than zero.');
        }
        if (Number(unitPrice) < 0) {
            return req.reject(400, 'Unit Price cannot be negative.');
        }
        req.data.totalPrice = computeLineTotal(quantity, unitPrice);
    });

    this.after('UPDATE', PurchaseOrderItems, async (_results, req) => {
        const tx = cds.transaction(req);
        const existing = await tx.run(
            SELECT.one
                .from(PurchaseOrderItems)
                .columns('purchaseOrder_ID')
                .where({ ID: req.data.ID })
        );
        if (existing?.purchaseOrder_ID) {
            await recalculatePurchaseOrderTotal(tx, existing.purchaseOrder_ID, _helperEntities);
        }
    });

    this.before('DELETE', PurchaseOrderItems, async (req) => {
        const tx = cds.transaction(req);
        const targetID = itemIdFromDeleteRequest(req);
        if (!targetID) {
            return req.reject(400, 'Purchase Order Item ID is mandatory.');
        }
        const existing = await tx.run(
            SELECT.one
                .from(PurchaseOrderItems)
                .columns('ID', 'purchaseOrder_ID')
                .where({ ID: targetID })
        );
        if (!existing) {
            return req.reject(404, 'Purchase Order Item not found.');
        }
        const po = await tx.run(
            SELECT.one
                .from(PurchaseOrders)
                .columns('status')
                .where({ ID: existing.purchaseOrder_ID })
        );
        if (!po) {
            return req.reject(404, 'Purchase Order not found.');
        }
        if (po.status !== PURCHASE_ORDER_STATUS.CREATED) {
            return req.reject(
                409,
                `Items cannot be deleted from a Purchase Order in status '${po.status}'. Only Created Purchase Orders may have items removed.`
            );
        }
        req._removedPoID = existing.purchaseOrder_ID;
    });

    this.after('DELETE', PurchaseOrderItems, async (_results, req) => {
        const tx = cds.transaction(req);
        const parentID = req._removedPoID;
        if (parentID) await recalculatePurchaseOrderTotal(tx, parentID, _helperEntities);
    });

    // ============================================================
    // convertToPurchaseOrder - Approved PR -> PO with copied lines
    // ============================================================
    // Business rules:
    //   - purchaseRequestID mandatory (400)
    //   - PR must exist (404)
    //   - PR status must be Approved (409)
    //   - supplierID mandatory (400) and resolves to an ACTIVE Supplier (404 / 409)
    //   - expectedDeliveryDate optional; when provided must be >= today
    //   - On success: poNumber generated, PO header inserted, all PR items
    //     deep-copied to PurchaseOrderItem rows, header total rolled up,
    //     PR status transitions to ConvertedToPO atomically.
    //   - Returns the new PO UUID.
    // ---------------------------------------------------------
    this.on('convertToPurchaseOrder', async (req) => {

        const { purchaseRequestID, supplierID, expectedDeliveryDate } = req.data;

        if (!purchaseRequestID) {
            return req.reject(400, 'Purchase Request ID is mandatory.');
        }
        if (!supplierID) {
            return req.reject(400, 'Supplier ID is mandatory.');
        }

        const tx = cds.transaction(req);

        const purchaseRequest = await tx.run(
            SELECT.one
                .from(PurchaseRequests)
                .columns('ID', 'status', 'totalAmount')
                .where({ ID: purchaseRequestID })
        );

        if (!purchaseRequest) {
            return req.reject(404, 'Purchase Request not found.');
        }

        if (purchaseRequest.status !== PURCHASE_REQUEST_STATUS.APPROVED) {
            return req.reject(
                409,
                `Purchase Request cannot be converted because its status is '${purchaseRequest.status}'. Expected status: 'Approved'.`
            );
        }

        const SuppliersEntity = supplierSuppliers();
        if (!SuppliersEntity) {
            return req.reject(500, 'Supplier service is not available.');
        }

        const supplier = await tx.run(
            SELECT.one
                .from(SuppliersEntity)
                .columns('ID', 'status')
                .where({ ID: supplierID })
        );

        if (!supplier) {
            return req.reject(404, 'Supplier not found.');
        }

        if (supplier.status !== 'ACTIVE') {
            return req.reject(409, 'Supplier is not active.');
        }

        if (expectedDeliveryDate) {
            const expected = new Date(expectedDeliveryDate);
            if (expected < new Date(todayIsoDate())) {
                return req.reject(400, 'Expected delivery date cannot be in the past.');
            }
        }

        // Verify the PR has at least one item to convert.
        const prItems = await fetchPurchaseRequestItems(tx, purchaseRequestID, _helperEntities);
        if (prItems.length === 0) {
            return req.reject(400, 'Purchase Request has no items to convert.');
        }

        // Create the PO header. Use server-generated poNumber rather than
        // letting CAP pick one. Insert via the ProcurementService entity so
        // the after-hooks fire.
        const poNumber = await generateBusinessNumber(tx, DOCUMENT_PREFIX.PURCHASE_ORDER);

        await tx.run(
            INSERT.into(PurchaseOrders).entries({
                poNumber,
                supplier_ID: supplierID,
                purchaseRequest_ID: purchaseRequestID,
                orderDate: todayIsoDate(),
                expectedDeliveryDate: expectedDeliveryDate ?? null,
                totalAmount: 0,
                status: PURCHASE_ORDER_STATUS.CREATED
            })
        );

        // Re-fetch the freshly inserted PO. There is no deep-insert here,
        // so ordering by createdAt desc gives us the just-created row.
        const newPO = await tx.run(
            SELECT.one
                .from(PurchaseOrders)
                .columns('ID')
                .where({ poNumber })
        );

        if (!newPO) {
            return req.reject(500, 'Failed to create Purchase Order.');
        }

        // Copy the PR items into PO items.
        for (const item of prItems) {
            await tx.run(
                INSERT.into(PurchaseOrderItems).entries({
                    purchaseOrder_ID: newPO.ID,
                    itemName: item.itemName,
                    description: item.description,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    totalPrice: item.totalPrice,
                    receivedQuantity: 0
                })
            );
        }

        // Roll up the header total. The after-CREATE hook only fires when
        // the items are inserted via a service call through CAP, but here we
        // use a tx INSERT, so roll up explicitly.
        await recalculatePurchaseOrderTotal(tx, newPO.ID, _helperEntities);

        // Mark the PR as ConvertedToPO atomically.
        await markPurchaseRequestConverted(tx, purchaseRequestID, _helperEntities);

        // Auto-emit PO created notification to the PR requester (the natural
        // audience of the conversion event). Recipient resolution hops via
        // the originating PR so a single user identity receives the signal.
        const prForPO = await fetchPRForNotification(tx, purchaseRequestID);
        if (prForPO?.requestedBy_ID) {
            await emitProcurementNotification(tx, NOTIFICATION_EVENT.PURCHASE_ORDER_CREATED, {
                documentNumber: poNumber,
                actor: normalizeUserId(req?.user?.id) ?? 'system',
                recipientID: prForPO.requestedBy_ID,
                referenceEntity: 'PurchaseOrder',
                referenceID: newPO.ID,
                parentDocument: prForPO.requestNumber
            });
        }

        return newPO.ID;

    });

    // ============================================================
    // sendPurchaseOrder - Created -> Sent
    // ============================================================
    this.on('sendPurchaseOrder', async (req) => {

        const { purchaseOrderID } = req.data;

        if (!purchaseOrderID) {
            return req.reject(400, 'Purchase Order ID is mandatory.');
        }

        const tx = cds.transaction(req);

        const po = await tx.run(
            SELECT.one
                .from(PurchaseOrders)
                .columns('ID', 'status')
                .where({ ID: purchaseOrderID })
        );

        if (!po) {
            return req.reject(404, 'Purchase Order not found.');
        }

        if (po.status !== PURCHASE_ORDER_STATUS.CREATED) {
            return req.reject(
                409,
                `Purchase Order cannot be sent because its status is '${po.status}'. Expected status: 'Created'.`
            );
        }

        // Verify the PO has at least one item.
        const itemCountRow = await tx.run(
            SELECT.one
                .from(PurchaseOrderItems)
                .columns('count(*) as count')
                .where({ purchaseOrder_ID: purchaseOrderID })
        );
        if (Number(itemCountRow?.count ?? 0) === 0) {
            return req.reject(400, 'Purchase Order contains no items.');
        }

        const sentByID = normalizeUserId(req?.user?.id);
        if (!sentByID) {
            return req.reject(401, 'Authenticated user is required to send a Purchase Order.');
        }

        await transitionPurchaseOrderStatus(
            tx,
            purchaseOrderID,
            PURCHASE_ORDER_STATUS.SENT,
            _helperEntities,
            {
                sentBy_ID: sentByID,
                sentAt: nowIsoTimestamp()
            }
        );

        // Auto-emit PO sent notification to the PR requester (when linked).
        const sentPO = await fetchPOForNotification(tx, purchaseOrderID);
        if (sentPO?.purchaseRequest_ID) {
            const prForSent = await fetchPRForNotification(tx, sentPO.purchaseRequest_ID);
            if (prForSent?.requestedBy_ID) {
                await emitProcurementNotification(tx, NOTIFICATION_EVENT.PURCHASE_ORDER_SENT, {
                    documentNumber: sentPO.poNumber,
                    actor: sentByID,
                    recipientID: prForSent.requestedBy_ID,
                    referenceEntity: 'PurchaseOrder',
                    referenceID: purchaseOrderID
                });
            }
        }

        return true;

    });

    // ============================================================
    // cancelPurchaseOrder - Created / Sent -> Cancelled
    // ============================================================
    // POs that have already produced Goods Receipts cannot be cancelled
    // (the inventory impact would need reversal); they must be closed via
    // the closePurchaseOrder action instead.
    // ---------------------------------------------------------
    this.on('cancelPurchaseOrder', async (req) => {

        const { purchaseOrderID, reason } = req.data;

        if (!purchaseOrderID) {
            return req.reject(400, 'Purchase Order ID is mandatory.');
        }

        if (!reason || !String(reason).trim()) {
            return req.reject(400, 'Cancellation reason is mandatory.');
        }

        const tx = cds.transaction(req);

        const po = await tx.run(
            SELECT.one
                .from(PurchaseOrders)
                .columns('ID', 'status')
                .where({ ID: purchaseOrderID })
        );

        if (!po) {
            return req.reject(404, 'Purchase Order not found.');
        }

        const cancellableStates = [
            PURCHASE_ORDER_STATUS.CREATED,
            PURCHASE_ORDER_STATUS.SENT
        ];

        if (!cancellableStates.includes(po.status)) {
            return req.reject(
                409,
                `Purchase Order cannot be cancelled because its status is '${po.status}'. Cancellation is only permitted from Created or Sent.`
            );
        }

        const cancelledByID = normalizeUserId(req?.user?.id);
        if (!cancelledByID) {
            return req.reject(401, 'Authenticated user is required to cancel a Purchase Order.');
        }

        await transitionPurchaseOrderStatus(
            tx,
            purchaseOrderID,
            PURCHASE_ORDER_STATUS.CANCELLED,
            _helperEntities,
            {
                cancellationReason: String(reason).slice(0, 1000),
                cancelledBy_ID: cancelledByID,
                cancelledAt: nowIsoTimestamp()
            }
        );

        // Auto-emit PO cancelled notification to the PR requester (when linked).
        const cancelledPO = await fetchPOForNotification(tx, purchaseOrderID);
        if (cancelledPO?.purchaseRequest_ID) {
            const prForCancel = await fetchPRForNotification(tx, cancelledPO.purchaseRequest_ID);
            if (prForCancel?.requestedBy_ID) {
                await emitProcurementNotification(tx, NOTIFICATION_EVENT.PURCHASE_ORDER_CANCELLED, {
                    documentNumber: cancelledPO.poNumber,
                    actor: cancelledByID,
                    recipientID: prForCancel.requestedBy_ID,
                    referenceEntity: 'PurchaseOrder',
                    referenceID: purchaseOrderID,
                    reason: String(reason).slice(0, 500)
                });
            }
        }

        return true;

    });

    // ============================================================
    // closePurchaseOrder - Received / PartiallyReceived / Sent -> Closed
    // ============================================================
    this.on('closePurchaseOrder', async (req) => {

        const { purchaseOrderID } = req.data;

        if (!purchaseOrderID) {
            return req.reject(400, 'Purchase Order ID is mandatory.');
        }

        const tx = cds.transaction(req);

        const po = await tx.run(
            SELECT.one
                .from(PurchaseOrders)
                .columns('ID', 'status')
                .where({ ID: purchaseOrderID })
        );

        if (!po) {
            return req.reject(404, 'Purchase Order not found.');
        }

        const closableStates = [
            PURCHASE_ORDER_STATUS.SENT,
            PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED,
            PURCHASE_ORDER_STATUS.RECEIVED
        ];

        if (!closableStates.includes(po.status)) {
            return req.reject(
                409,
                `Purchase Order cannot be closed because its status is '${po.status}'. Closure is only permitted from Sent, PartiallyReceived or Received.`
            );
        }

        await transitionPurchaseOrderStatus(
            tx,
            purchaseOrderID,
            PURCHASE_ORDER_STATUS.CLOSED,
            _helperEntities
        );

        return true;

    });

});
