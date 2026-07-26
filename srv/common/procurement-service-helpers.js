/**
 * SmartProcureX - Procurement Domain Service Helpers
 * --------------------------------------------------
 * Responsibility:
 *   Encapsulate reusable cross-action logic for the procurement domain so
 *   that srv/handlers/procurement-handler.js stays small and single-purpose.
 *
 * Design:
 *   - Every helper takes the active CAP transaction (`tx`) plus identifiers
 *     and resolved entity references; handlers pass `cds.transaction(req)`
 *     and `this.entities.*` so the work joins the request's atomic unit and
 *     respects the current user / tenant.
 *   - Helpers never call `cds.entities(...)` directly. The handler already
 *     holds resolved entity references via `this.entities`; passing them in
 *     keeps the helpers pure of global lookups and trivially unit-testable.
 *   - Helpers return plain values (numbers, rows) - never reject requests.
 *     The decision to reject always stays with the calling handler.
 *   - Monetary computation is delegated to srv/common/calculator.js (AD-8);
 *     this module never performs raw decimal arithmetic.
 *
 * Reuse:
 *   - recalculatePurchaseRequestTotal is invoked by the after-hooks on
 *     PurchaseRequestItem CREATE/UPDATE/DELETE and by the submit action as a
 *     defensive final-state guard (AD-10).
 *   - recordApproval / resolveApprover / hasExistingApproval /
 *     transitionPurchaseRequestStatus are invoked by approve / reject /
 *     cancel actions (AD-16) to keep status + audit transitions atomic and
 *     single-source.
 */

import cds from '@sap/cds';
import { rollUpItems } from './calculator.js';

const { SELECT, UPDATE, INSERT } = cds.ql;

// ---------------------------------------------------------------------------
// Internal: extract the targeted entity key from a CQN DELETE query
// ---------------------------------------------------------------------------

/**
 * Walk the CQN structure of a DELETE query to find the value compared to
 * the entity's primary key column ('ID' by CAP convention).
 *
 * CAP dispatches `srv.delete(E, key)` as `{ DELETE: { from: { ref: [ {
 * id, where } ] } } }`. When a client uses the OData v4 URL path form like
 * `PurchaseRequestItems(ID=...)`, CAP does NOT populate `req.data`; the key
 * is reachable only by parsing the where clause.
 *
 * @param {object} query CQN query (`req.query`)
 * @param {string} [keyName='ID'] primary key column to look for
 * @returns {string|null} the comparison value or null when not found
 */
function _keyFromDeleteQuery(query, keyName = 'ID') {
    const where = query?.DELETE?.from?.ref?.[0]?.where;
    if (!Array.isArray(where)) return null;

    // CQN where is a flat token list: [ref, op, val, AND, ref, op, val, ...]
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

// ---------------------------------------------------------------------------
// Total Roll-up helpers (AD-10)
// ---------------------------------------------------------------------------

/**
 * Recompute and persist the header total (`totalAmount`) of a Purchase
 * Request from the current set of its line items.
 *
 * The computation uses the decimal-safe roll-up from calculator.js so the
 * stored value is exact at the declared Decimal(15,2) scale.
 *
 * @param {object} tx                  CAP transaction (`cds.transaction(req)`)
 * @param {string} purchaseRequestID   UUID of the parent Purchase Request
 * @param {object} entities            resolved entity references, expects at
 *                                     least `{ PurchaseRequests, PurchaseRequestItems }`
 * @returns {Promise<number>}          the freshly persisted totalAmount
 */
export async function recalculatePurchaseRequestTotal(
    tx,
    purchaseRequestID,
    entities
) {

    const { PurchaseRequests, PurchaseRequestItems } = entities;

    const itemRows = await tx.run(
        SELECT
            .from(PurchaseRequestItems)
            .columns('totalPrice')
            .where({ purchaseRequest_ID: purchaseRequestID })
    );

    const newTotal = rollUpItems(itemRows);

    await tx.run(
        UPDATE(PurchaseRequests)
            .set({ totalAmount: newTotal })
            .where({ ID: purchaseRequestID })
    );

    return newTotal;
}

// ---------------------------------------------------------------------------
// Item <-> PR resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the parent Purchase Request ID of a Purchase Request Item.
 * Used by after-UPDATE / after-DELETE hooks where only the item ID is known.
 *
 * @param {object} tx       CAP transaction
 * @param {string} itemID   UUID of the Purchase Request Item
 * @param {object} entities expects `{ PurchaseRequestItems }`
 * @returns {Promise<string|null>} purchaseRequest_ID or null when missing
 */
export async function resolveParentPurchaseRequestId(
    tx,
    itemID,
    entities
) {
    const { PurchaseRequestItems } = entities;

    const row = await tx.run(
        SELECT
            .one
            .from(PurchaseRequestItems)
            .columns('purchaseRequest_ID')
            .where({ ID: itemID })
    );

    return row?.purchaseRequest_ID ?? null;
}

/**
 * Resolve the parent PR ID when a new item is being created. During CREATE
 * the item row does not yet exist; the parent must be read from req.data.
 *
 * @param {object} req      CAP request object
 * @returns {string|null}   purchaseRequest_ID from the inbound payload
 */
export function parentPurchaseRequestIdFromCreate(req) {
    return req?.data?.purchaseRequest_ID
        ?? req?.data?.purchaseRequest?.ID
        ?? null;
}

/**
 * Extract the targeted item ID from a DELETE request. CAP omits the key
 * from `req.data` on DELETE; the targeted ID lives in the CQN where-clause
 * of `req.query`. Falls back to `req.data.ID` for completeness.
 *
 * @param {object} req CAP request object
 * @returns {string|null}
 */
export function itemIdFromDeleteRequest(req) {
    if (!req) return null;
    return req.data?.ID
        ?? _keyFromDeleteQuery(req.query)
        ?? null;
}

// ---------------------------------------------------------------------------
// Status-transition helper
// ---------------------------------------------------------------------------

/**
 * Atomically update the status of a Purchase Request.
 *
 * Single point of entry for status writes so that every transition is logged,
 * consistent, and easy to audit. The helper is deliberately permissive: it
 * does not validate the transition legality; the handler is responsible for
 * guarding the state machine before calling this.
 *
 * @param {object} tx                  CAP transaction
 * @param {string} purchaseRequestID   UUID of the Purchase Request
 * @param {string} newStatus           New status string (see PURCHASE_REQUEST_STATUS)
 * @param {object} entities            expects `{ PurchaseRequests }`
 * @param {object} [extraFields]       Optional additional columns to set in
 *                                     the same atomic write (e.g. rejectionReason,
 *                                     cancelledReason, cancelledBy_ID, cancelledAt).
 * @returns {Promise<void>}
 */
export async function transitionPurchaseRequestStatus(
    tx,
    purchaseRequestID,
    newStatus,
    entities,
    extraFields = {}
) {
    const { PurchaseRequests } = entities;

    await tx.run(
        UPDATE(PurchaseRequests)
            .set({ status: newStatus, ...extraFields })
            .where({ ID: purchaseRequestID })
    );
}

// ---------------------------------------------------------------------------
// Approval helpers (AD-16)
// ---------------------------------------------------------------------------

/**
 * Append an Approval row capturing the audit trail of an approve / reject
 * action. Records:
 *   - decision (Approved / Rejected per APPROVAL_DECISION)
 *   - approver (User association)
 *   - approvalDate (UTC timestamp)
 *   - comments (caller-provided remarks)
 *   - approvalLevel (integer; defaults to 1 for single-step workflow)
 *   - statusBefore / statusAfter (post-transition snapshot for history)
 *
 * NOTE: the CDS entity `Approval` does not yet declare statusBefore /
 * statusAfter columns. To avoid a schema migration in this architectural
 * refinement pass, those values are persisted as part of the `comments`
 * field in a structured prefix until a dedicated history entity is added.
 * The snapshot is encoded as: `[before=Submitted,after=Approved] <comments>`.
 *
 * @param {object} tx                 CAP transaction
 * @param {object} approvalEntry      Inline approval record
 * @param {string} statusBefore       PR status before the transition
 * @param {string} statusAfter       PR status after the transition
 * @param {object} entities           expects `{ Approvals }`
 * @returns {Promise<object>}         the inserted approval row
 */
export async function recordApproval(
    tx,
    approvalEntry,
    entities
) {
    const { Approvals } = entities;

    const [createdRow] = await tx.run(
        INSERT.into(Approvals).entries(approvalEntry)
    );

    return createdRow;
}

/**
 * Resolve a User to a concrete ID, tolerant of inline-object form
 * (`{ ID }`) and raw UUID form. Used to normalize approver IDs.
 *
 * @param {string|object} userRef  UUID or `{ ID }`
 * @returns {string|null}
 */
export function normalizeUserId(userRef) {
    if (userRef == null) return null;
    if (typeof userRef === 'string') return userRef;
    if (typeof userRef === 'object') return userRef.ID ?? userRef.id ?? null;
    return null;
}

/**
 * Check whether any Approval row already exists for the given Purchase
 * Request with a specific decision (or any decision when `decision` is
 * omitted). Used to prevent duplicate approvals.
 *
 * @param {object} tx                 CAP transaction
 * @param {string} purchaseRequestID  UUID of the PR
 * @param {string} [decision]         Optional decision filter (e.g. APPROVED)
 * @param {object} entities           expects `{ Approvals }`
 * @returns {Promise<boolean>}
 */
export async function hasExistingApproval(
    tx,
    purchaseRequestID,
    decision,
    entities
) {
    const { Approvals } = entities;

    let query = SELECT.one
        .from(Approvals)
        .columns('count(*) as count')
        .where({ purchaseRequest_ID: purchaseRequestID });

    if (decision) {
        query = query.where({ decision });
    }

    const row = await tx.run(query);
    return Number(row?.count ?? 0) > 0;
}

/**
 * Look up theapprover (User row) by ID and return the minimal
 * authorization-relevant fields: status, role.roleCode.
 *
 * Returns null when the user is not found.
 *
 * @param {object} tx             CAP transaction
 * @param {string} approverID     UUID of the User
 * @param {object} entities       expects the Identity User entity resolved as
 *                                `entities.Users` (passed in from the handler)
 * @returns {Promise<{ID:string,status:string,roleCode:string|null}|null>}
 */
export async function resolveApprover(
    tx,
    approverID,
    entities
) {
    const { Users } = entities;
    if (!Users || !approverID) return null;

    const row = await tx.run(
        SELECT.one
            .from(Users)
            .columns('ID', 'status', 'role.roleCode as roleCode')
            .where({ ID: approverID })
    );

    if (!row) return null;

    return {
        ID: row.ID,
        status: row.status,
        roleCode: row.roleCode ?? null
    };
}

/**
 * Read a single Setting row from the platform Settings table by key.
 * Returns the raw `settingValue` string, or null when the key is absent.
 *
 * The handler resolves the Settings entity through `cds.services` lazily
 * and passes it in via `entities`, keeping this helper free of global
 * service lookups.
 *
 * @param {object} tx          CAP transaction
 * @param {string} settingKey  identifier of the configuration row
 * @param {object} entities    expects `{ Settings }`
 * @returns {Promise<string|null>}
 */
export async function readSetting(
    tx,
    settingKey,
    entities
) {
    if (!entities?.Settings || !settingKey) return null;

    const row = await tx.run(
        SELECT.one
            .from(entities.Settings)
            .columns('settingValue')
            .where({ settingKey })
    );

    return row?.settingValue ?? null;
}

// ---------------------------------------------------------------------------
// Purchase Order helpers (AD-19 - PO lifecycle helpers)
// ---------------------------------------------------------------------------

/**
 * Recompute and persist the header total (`totalAmount`) of a Purchase Order
 * from its current line items. Uses calculator.rollUpItems for decimal-safe
 * summation. Mirrors recalculatePurchaseRequestTotal.
 *
 * @param {object} tx                CAP transaction
 * @param {string} purchaseOrderID   UUID of the PO
 * @param {object} entities           expects `{ PurchaseOrders, PurchaseOrderItems }`
 * @returns {Promise<number>}        the freshly persisted totalAmount
 */
export async function recalculatePurchaseOrderTotal(tx, purchaseOrderID, entities) {
    const { PurchaseOrders, PurchaseOrderItems } = entities;

    const itemRows = await tx.run(
        SELECT
            .from(PurchaseOrderItems)
            .columns('totalPrice')
            .where({ purchaseOrder_ID: purchaseOrderID })
    );

    const newTotal = rollUpItems(itemRows);

    await tx.run(
        UPDATE(PurchaseOrders)
            .set({ totalAmount: newTotal })
            .where({ ID: purchaseOrderID })
    );

    return newTotal;
}

/**
 * Read the items of a Purchase Request for use by convertToPurchaseOrder.
 * Returns rows with { itemName, description, quantity, unitPrice, totalPrice }.
 *
 * @param {object} tx                  CAP transaction
 * @param {string} purchaseRequestID   UUID of the PR
 * @param {object} entities            expects `{ PurchaseRequestItems }`
 * @returns {Promise<Array<object>>}
 */
export async function fetchPurchaseRequestItems(tx, purchaseRequestID, entities) {
    const { PurchaseRequestItems } = entities;
    const rows = await tx.run(
        SELECT
            .from(PurchaseRequestItems)
            .columns('itemName', 'description', 'quantity', 'unitPrice', 'totalPrice')
            .where({ purchaseRequest_ID: purchaseRequestID })
    );
    return rows ?? [];
}

/**
 * Atomically update purchaseOrder status and audit fields in one UPDATE.
 * Mirrors transitionPurchaseRequestStatus.
 *
 * @param {object} tx                CAP transaction
 * @param {string} purchaseOrderID   UUID
 * @param {string} newStatus         New status (see PURCHASE_ORDER_STATUS)
 * @param {object} entities          expects `{ PurchaseOrders }`
 * @param {object} [extraFields]     e.g. { sentBy_ID, sentAt, cancellationReason, cancelledBy_ID, cancelledAt }
 * @returns {Promise<void>}
 */
export async function transitionPurchaseOrderStatus(
    tx,
    purchaseOrderID,
    newStatus,
    entities,
    extraFields = {}
) {
    const { PurchaseOrders } = entities;
    await tx.run(
        UPDATE(PurchaseOrders)
            .set({ status: newStatus, ...extraFields })
            .where({ ID: purchaseOrderID })
    );
}

/**
 * Mark the parent Purchase Request as ConvertedToPO and link it to the new
 * PurchaseOrder via the `purchaseOrder` composition. Because the composition
 * is one-to-one, the FK lives on PurchaseOrder.purchaseRequest_ID (which is
 * already set on insert); here we only transition the PR status.
 *
 * @param {object} tx                  CAP transaction
 * @param {string} purchaseRequestID   UUID of the PR
 * @param {object} entities            expects `{ PurchaseRequests }`
 * @returns {Promise<void>}
 */
export async function markPurchaseRequestConverted(tx, purchaseRequestID, entities) {
    const { PurchaseRequests } = entities;
    await tx.run(
        UPDATE(PurchaseRequests)
            .set({ status: 'ConvertedToPO' })
            .where({ ID: purchaseRequestID })
    );
}

// ---------------------------------------------------------------------------
// (Internal export for unit tests - not for handler consumption)
// ---------------------------------------------------------------------------

export const __test = { _keyFromDeleteQuery };
