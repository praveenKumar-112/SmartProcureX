/**
 * SmartProcureX - Notification Domain Service Helpers
 * --------------------------------------------------
 * Responsibility:
 *   Encapsulate reusable cross-action logic for the notification
 *   domain so srv/handlers/notification-handler.js stays focused on
 *   request orchestration. Mirrors the per-domain helper pattern
 *   established by procurement-service-helpers / warehouse-service-
 *   helpers / asset-service-helpers (AD-11).
 *
 * Design:
 *   - Every helper takes the active CAP transaction (`tx`) plus
 *     resolved entity references (`entities`) passed by the handler.
 *   - Helpers never reject requests; that responsibility stays with
 *     the calling handler so that the response shape stays consistent
 *     (AD-9).
 *   - Auto-emission of business notifications is centralised in
 *     `emitBusinessNotification` so the procurement / warehouse /
 *     asset handlers can fire notifications with a single call and
 *     the new Notification row joins the originating request's
 *     atomic unit (AD-21). If the originating action rolls back,
 *     the notification rolls back too.
 *   - Department / Role broadcasts are pre-expanded into one
 *     Notification row per matching user at create time so the
 *     read path remains single-table (AD-22).
 *
 * Reuse:
 *   - resolveRecipient / resolveDepartment / resolveRole: shared
 *     by the create hook, the broadcast actions and the auto-emitter.
 *   - createNotification: atomic insert used by sendNotification,
 *     broadcast helpers and emitBusinessNotification.
 *   - markRead / markUnread / markAllRead / softDelete /
 *     countUnread: thin atomic UPDATE wrappers used by the actions.
 *   - emitBusinessNotification: maps a NOTIFICATION_EVENT to a
 *     {title, message, type, priority, category} shape and persists
 *     a single Notification row joined to the caller's tx.
 */

import cds from '@sap/cds';
import { dbRun } from './db-run.js';
import {
    NOTIFICATION_TYPE,
    NOTIFICATION_PRIORITY,
    NOTIFICATION_CATEGORY,
    NOTIFICATION_EVENT
} from './constants.js';
import { nowIsoTimestamp } from './utils.js';

const { SELECT, INSERT, UPDATE } = cds.ql;

// ---------------------------------------------------------------------------
// Enum membership helpers (pure)
// ---------------------------------------------------------------------------

/**
 * True when `value` is one of the NotificationType enum symbols.
 */
export function isValidNotificationType(value) {
    return Object.values(NOTIFICATION_TYPE).includes(value);
}

/**
 * True when `value` is one of the NotificationPriority enum symbols.
 */
export function isValidNotificationPriority(value) {
    return Object.values(NOTIFICATION_PRIORITY).includes(value);
}

/**
 * True when `value` is one of the NotificationCategory enum symbols.
 */
export function isValidNotificationCategory(value) {
    return Object.values(NOTIFICATION_CATEGORY).includes(value);
}

// ---------------------------------------------------------------------------
// Reference-data lookups (recipient / department / role)
// ---------------------------------------------------------------------------

/**
 * Resolve a recipient User row by ID.
 * Returns `{ ID, status, employeeId, firstName, lastName }` or null.
 *
 * NOTE: the lookup is performed via `cds.db.run` (the shared database
 * facade) rather than the caller's `tx` because the Notification
 * before-CREATE hook is still mid-insert on the PlatformService
 * transaction. Re-entering the same tx to SELECT from an
 * IdentityService entity deadlocks in sqlite (verified empirically).
 * Reading via the shared db avoids the recursion and still respects
 * the active transaction's read isolation for the just-committed
 * reference data (Departments / Users / Roles are seeded long before
 * any Notification is created).
 *
 * @param {object} _tx      CAP transaction (unused - kept for signature parity)
 * @param {string} userID   UUID of the User
 * @param {object} entities  expects `{ Users }` from the IdentityService
 * @returns {Promise<object|null>}
 */
export async function resolveRecipient(_tx, userID, entities) {
    const { Users } = entities;
    if (!Users || !userID) return null;
    const row = await dbRun(
        SELECT.one
            .from(Users)
            .columns('ID', 'status', 'employeeId', 'firstName', 'lastName')
            .where({ ID: userID })
    );
    return row ?? null;
}

/**
 * Resolve a Department row by ID. See `resolveRecipient` for why the
 * lookup goes through the shared db facade and not the caller tx.
 *
 * @param {object} _tx            CAP transaction (unused)
 * @param {string} departmentID UUID
 * @param {object} entities      expects `{ Departments }`
 * @returns {Promise<object|null>}
 */
export async function resolveDepartment(_tx, departmentID, entities) {
    const { Departments } = entities;
    if (!Departments || !departmentID) return null;
    const row = await dbRun(
        SELECT.one
            .from(Departments)
            .columns('ID', 'departmentCode', 'departmentName')
            .where({ ID: departmentID })
    );
    return row ?? null;
}

/**
 * Resolve a Role row by ID. See `resolveRecipient` for why the
 * lookup goes through the shared db facade.
 *
 * @param {object} _tx       CAP transaction (unused)
 * @param {string} roleID   UUID
 * @param {object} entities expects `{ Roles }`
 * @returns {Promise<object|null>}
 */
export async function resolveRole(_tx, roleID, entities) {
    const { Roles } = entities;
    if (!Roles || !roleID) return null;
    const row = await dbRun(
        SELECT.one
            .from(Roles)
            .columns('ID', 'roleCode', 'roleName')
            .where({ ID: roleID })
    );
    return row ?? null;
}

/**
 * Collect every ACTIVE User ID that belongs to the given Department.
 * Uses `cds.db.run` for the same reason as `resolveRecipient`.
 *
 * @param {object} _tx            CAP transaction (unused)
 * @param {string} departmentID  UUID
 * @param {object} entities      expects `{ Users }`
 * @returns {Promise<Array<{ID:string}>>}
 */
export async function findUsersByDepartment(_tx, departmentID, entities) {
    const { Users } = entities;
    if (!Users || !departmentID) return [];
    const rows = await dbRun(
        SELECT.from(Users)
            .columns('ID')
            .where({ department_ID: departmentID, status: 'ACTIVE' })
    );
    return rows ?? [];
}

/**
 * Collect every ACTIVE User ID that holds the given Role. Same shared-db
 * pattern as `findUsersByDepartment`.
 *
 * @param {object} _tx       CAP transaction (unused)
 * @param {string} roleID   UUID
 * @param {object} entities expects `{ Users }`
 * @returns {Promise<Array<{ID:string}>>}
 */
export async function findUsersByRole(_tx, roleID, entities) {
    const { Users } = entities;
    if (!Users || !roleID) return [];
    const rows = await dbRun(
        SELECT.from(Users)
            .columns('ID')
            .where({ role_ID: roleID, status: 'ACTIVE' })
    );
    return rows ?? [];
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Read a Notification row by ID.
 *
 * Like `resolveRecipient` / `resolveDepartment` / `resolveRole` below,
 * the lookup is performed via `cds.db.run` (the shared database facade)
 * rather than the caller's `tx`. The reason is identical: the
 * before-UPDATE / before-DELETE / action handlers issuing the SELECT
 * are still mid-write on the originating tx under sqlite, and re-entering
 * the same tx to SELECT the row that is about to be updated deadlocks
 * (SQLITE_BUSY on a single shared connection). Reading via the shared
 * db respects the most-recently committed state, which is exactly the
 * state the hook needs to inspect (the row that the user is asking to
 * mutate). For the Notification domain the committed state is fully
 * sufficient because the validation hooks never rely on un-committed
 * in-tx column writes from the same hook chain.
 *
 * @param {object} _tx            CAP transaction (unused - kept for
 *                               signature parity so handlers pass `tx`
 *                               uniformly across all helper calls).
 * @param {string} notificationID
 * @param {object} entities       expects `{ Notifications }`
 * @returns {Promise<object|null>}
 */
export async function getNotification(_tx, notificationID, entities) {
    const { Notifications } = entities;
    if (!Notifications || !notificationID) return null;
    const row = await dbRun(
        SELECT.one
            .from(Notifications)
            .columns(
                'ID',
                'title',
                'message',
                'notificationType',
                'priority',
                'category',
                'recipient_ID',
                'department_ID',
                'role_ID',
                'isRead',
                'readOn',
                'readBy_ID',
                'isArchived',
                'archivedOn',
                'isDeleted',
                'deletedOn',
                'deletedBy_ID',
                'referenceEntity',
                'referenceID',
                'referenceNumber',
                'sender_ID'
            )
            .where({ ID: notificationID })
    );
    return row ?? null;
}

/**
 * Count the unread, non-archived, non-deleted notifications for a
 * recipient. Returns 0 when no rows match.
 *
 * @param {object} tx          CAP transaction
 * @param {string} recipientID
 * @param {object} entities   expects `{ Notifications }`
 * @returns {Promise<number>}
 */
export async function countUnread(tx, recipientID, entities) {
    const { Notifications } = entities;
    if (!Notifications || !recipientID) return 0;
    const row = await tx.run(
        SELECT.one
            .from(Notifications)
            .columns('count(*) as count')
            .where({
                recipient_ID: recipientID,
                isRead: false,
                isArchived: false,
                isDeleted: false
            })
    );
    return Number(row?.count ?? 0);
}

/**
 * Find the latest non-archived, non-deleted Notification row that
 * matches a (recipient_ID, referenceEntity, referenceID) tuple.
 * Returns null when none exists. Used by the dedupe guard.
 *
 * Uses `cds.db.run` for the same reason as `getNotification`
 * (avoid sqlite write-then-SELECT deadlock inside a hook tx).
 *
 * @param {object} _tx       CAP transaction (unused)
 * @param {object} filter    `{ recipient_ID, referenceEntity, referenceID }`
 * @param {object} entities  expects `{ Notifications }`
 * @returns {Promise<object|null>}
 */
export async function findExistingNotification(_tx, filter, entities) {
    const { Notifications } = entities;
    if (!Notifications) return null;
    const where = {};
    if (filter.recipient_ID) where.recipient_ID = filter.recipient_ID;
    if (filter.referenceEntity) where.referenceEntity = filter.referenceEntity;
    if (filter.referenceID) where.referenceID = filter.referenceID;
    where.isDeleted = false;
    const row = await dbRun(
        SELECT.one
            .from(Notifications)
            .columns('ID', 'title', 'message', 'notificationType')
            .where(where)
            .orderBy({ createdAt: 'desc' })
    );
    return row ?? null;
}

// ---------------------------------------------------------------------------
// Atomic state-transition helpers
// ---------------------------------------------------------------------------

/**
 * Atomically mark a single Notification as read. Updates `isRead`,
 * `readOn`, `readBy` in one UPDATE so partial writes cannot occur.
 *
 * @param {object} tx
 * @param {string} notificationID
 * @param {string} [readByID]   UUID of the acting user
 * @param {object} entities      expects `{ Notifications }`
 * @returns {Promise<number>}   number of rows updated (0 when not found)
 */
export async function markRead(tx, notificationID, readByID, entities) {
    const { Notifications } = entities;
    const fields = {
        isRead: true,
        readOn: nowIsoTimestamp()
    };
    if (readByID) fields.readBy_ID = readByID;
    return tx.run(
        UPDATE(Notifications)
            .set(fields)
            .where({ ID: notificationID, isDeleted: false })
    );
}

/**
 * Atomically mark a single Notification as unread.
 *
 * @param {object} tx
 * @param {string} notificationID
 * @param {object} entities      expects `{ Notifications }`
 * @returns {Promise<number>}
 */
export async function markUnread(tx, notificationID, entities) {
    const { Notifications } = entities;
    return tx.run(
        UPDATE(Notifications)
            .set({ isRead: false, readOn: null, readBy_ID: null })
            .where({ ID: notificationID, isDeleted: false })
    );
}

/**
 * Mark every non-archived, non-deleted Notification for the given
 * recipient as read in a single UPDATE.
 *
 * @param {object} tx
 * @param {string} recipientID
 * @param {string} [readByID]
 * @param {object} entities      expects `{ Notifications }`
 * @returns {Promise<number>}   rows updated
 */
export async function markAllRead(tx, recipientID, readByID, entities) {
    const { Notifications } = entities;
    const fields = {
        isRead: true,
        readOn: nowIsoTimestamp()
    };
    if (readByID) fields.readBy_ID = readByID;
    return tx.run(
        UPDATE(Notifications)
            .set(fields)
            .where({
                recipient_ID: recipientID,
                isRead: false,
                isArchived: false,
                isDeleted: false
            })
    );
}

/**
 * Soft-delete a Notification. Sets isDeleted=true + deletedOn +
 * deletedBy; the row remains in the table (AD-23).
 *
 * @param {object} tx
 * @param {string} notificationID
 * @param {string} [deletedByID]
 * @param {object} entities      expects `{ Notifications }`
 * @returns {Promise<number>}
 */
export async function softDelete(tx, notificationID, deletedByID, entities) {
    const { Notifications } = entities;
    const fields = {
        isDeleted: true,
        deletedOn: nowIsoTimestamp()
    };
    if (deletedByID) fields.deletedBy_ID = deletedByID;
    return tx.run(
        UPDATE(Notifications)
            .set(fields)
            .where({ ID: notificationID, isDeleted: false })
    );
}

/**
 * Archive a Notification (separate from soft-delete so that an
 * unread/archived Notification can still be soft-deleted later).
 *
 * @param {object} tx
 * @param {string} notificationID
 * @param {object} entities      expects `{ Notifications }`
 * @returns {Promise<number>}
 */
export async function archive(tx, notificationID, entities) {
    const { Notifications } = entities;
    return tx.run(
        UPDATE(Notifications)
            .set({ isArchived: true, archivedOn: nowIsoTimestamp() })
            .where({ ID: notificationID, isDeleted: false })
    );
}

// ---------------------------------------------------------------------------
// Create helpers (used by sendNotification, broadcast actions and emitter)
// ---------------------------------------------------------------------------

/**
 * Insert a single Notification row atomically.
 *
 * @param {object} tx
 * @param {object} entry   Notification row payload
 * @param {object} entities expects `{ Notifications }`
 * @returns {Promise<object>} the inserted row
 */
export async function createNotification(tx, entry, entities) {
    const { Notifications } = entities;
    const [row] = await tx.run(
        INSERT.into(Notifications).entries(entry)
    );
    return row;
}

/**
 * Insert one Notification row per recipient in `recipientIDs`.
 * Returns the count of rows created.
 *
 * @param {object} tx
 * @param {Array<string>} recipientIDs
 * @param {object} template    Notification row template lacking recipient_ID
 * @param {object} entities    expects `{ Notifications }`
 * @returns {Promise<number>}
 */
export async function createNotificationsFor(
    tx,
    recipientIDs,
    template,
    entities
) {
    const { Notifications } = entities;
    if (!Array.isArray(recipientIDs) || recipientIDs.length === 0) return 0;
    const entries = recipientIDs.map((id) => ({ ...template, recipient_ID: id }));
    await tx.run(INSERT.into(Notifications).entries(entries));
    return entries.length;
}

// ---------------------------------------------------------------------------
// Auto-emission - business event catalog -> Notification row
// ---------------------------------------------------------------------------

/**
 * Map a NOTIFICATION_EVENT to the deterministic
 * `{ title, message, notificationType, priority, category }` tuple.
 * The payload carries the reference document(s) and any extra
 * context the template needs. Keeping this map in the helper keeps
 * the calling handlers free of templating strings (AD-21).
 *
 * Returns null when the event is unknown.
 *
 * @param {string} event    One of NOTIFICATION_EVENT
 * @param {object} payload  `{ documentNumber, actor, recipient, ... }`
 * @returns {object|null}
 */
export function buildNotificationFromEvent(event, payload = {}) {
    const doc = payload.documentNumber ?? '(no-number)';
    const actor = payload.actor ?? 'system';
    const refEntity = payload.referenceEntity ?? null;
    const refID = payload.referenceID ?? null;

    switch (event) {

        case NOTIFICATION_EVENT.PURCHASE_REQUEST_SUBMITTED:
            return {
                title: `Purchase Request ${doc} submitted`,
                message: `Purchase Request ${doc} has been submitted by ${actor} and is awaiting approval.`,
                notificationType: NOTIFICATION_TYPE.INFORMATION,
                priority: NOTIFICATION_PRIORITY.MEDIUM,
                category: NOTIFICATION_CATEGORY.PURCHASE_REQUEST,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.PURCHASE_REQUEST_APPROVED:
            return {
                title: `Purchase Request ${doc} approved`,
                message: `Purchase Request ${doc} has been approved by ${actor}.`,
                notificationType: NOTIFICATION_TYPE.SUCCESS,
                priority: NOTIFICATION_PRIORITY.MEDIUM,
                category: NOTIFICATION_CATEGORY.APPROVAL,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.PURCHASE_REQUEST_REJECTED:
            return {
                title: `Purchase Request ${doc} rejected`,
                message: `Purchase Request ${doc} has been rejected by ${actor}. Reason: ${payload.reason ?? 'N/A'}`,
                notificationType: NOTIFICATION_TYPE.ERROR,
                priority: NOTIFICATION_PRIORITY.HIGH,
                category: NOTIFICATION_CATEGORY.APPROVAL,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.PURCHASE_REQUEST_CANCELLED:
            return {
                title: `Purchase Request ${doc} cancelled`,
                message: `Purchase Request ${doc} has been cancelled by ${actor}. Reason: ${payload.reason ?? 'N/A'}`,
                notificationType: NOTIFICATION_TYPE.WARNING,
                priority: NOTIFICATION_PRIORITY.MEDIUM,
                category: NOTIFICATION_CATEGORY.PURCHASE_REQUEST,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.PURCHASE_ORDER_CREATED:
            return {
                title: `Purchase Order ${doc} created`,
                message: `Purchase Order ${doc} has been created from Purchase Request ${payload.parentDocument ?? 'N/A'} by ${actor}.`,
                notificationType: NOTIFICATION_TYPE.INFORMATION,
                priority: NOTIFICATION_PRIORITY.MEDIUM,
                category: NOTIFICATION_CATEGORY.PURCHASE_ORDER,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.PURCHASE_ORDER_SENT:
            return {
                title: `Purchase Order ${doc} sent`,
                message: `Purchase Order ${doc} has been sent to the supplier by ${actor}.`,
                notificationType: NOTIFICATION_TYPE.SUCCESS,
                priority: NOTIFICATION_PRIORITY.MEDIUM,
                category: NOTIFICATION_CATEGORY.PURCHASE_ORDER,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.PURCHASE_ORDER_CANCELLED:
            return {
                title: `Purchase Order ${doc} cancelled`,
                message: `Purchase Order ${doc} has been cancelled by ${actor}. Reason: ${payload.reason ?? 'N/A'}`,
                notificationType: NOTIFICATION_TYPE.WARNING,
                priority: NOTIFICATION_PRIORITY.HIGH,
                category: NOTIFICATION_CATEGORY.PURCHASE_ORDER,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.GOODS_RECEIPT_POSTED:
            return {
                title: `Goods Receipt ${doc} posted`,
                message: `Goods Receipt ${doc} for ${payload.parentDocument ?? 'N/A'} has been posted by ${actor}.`,
                notificationType: NOTIFICATION_TYPE.SUCCESS,
                priority: NOTIFICATION_PRIORITY.MEDIUM,
                category: NOTIFICATION_CATEGORY.GOODS_RECEIPT,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.GOODS_RECEIPT_CANCELLED:
            return {
                title: `Goods Receipt ${doc} cancelled`,
                message: `Goods Receipt ${doc} has been cancelled by ${actor}. Reason: ${payload.reason ?? 'N/A'}`,
                notificationType: NOTIFICATION_TYPE.WARNING,
                priority: NOTIFICATION_PRIORITY.HIGH,
                category: NOTIFICATION_CATEGORY.GOODS_RECEIPT,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.INVENTORY_ADJUSTMENT:
            return {
                title: `Inventory adjusted for ${doc}`,
                message: `Inventory for item ${doc} has been adjusted by ${actor} to ${payload.quantity ?? 'N/A'}.`,
                notificationType: NOTIFICATION_TYPE.INFORMATION,
                priority: NOTIFICATION_PRIORITY.MEDIUM,
                category: NOTIFICATION_CATEGORY.INVENTORY,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.INVENTORY_RESERVATION:
            return {
                title: `Inventory reserved for ${doc}`,
                message: `${payload.quantity ?? 'N/A'} units of item ${doc} have been reserved by ${actor}.`,
                notificationType: NOTIFICATION_TYPE.INFORMATION,
                priority: NOTIFICATION_PRIORITY.LOW,
                category: NOTIFICATION_CATEGORY.INVENTORY,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.INVENTORY_TRANSFER:
            return {
                title: `Inventory transfer for ${doc}`,
                message: `${payload.quantity ?? 'N/A'} units of item ${doc} have been transferred by ${actor}.`,
                notificationType: NOTIFICATION_TYPE.INFORMATION,
                priority: NOTIFICATION_PRIORITY.MEDIUM,
                category: NOTIFICATION_CATEGORY.INVENTORY,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.INVENTORY_DAMAGE:
            return {
                title: `Inventory damaged for ${doc}`,
                message: `${payload.quantity ?? 'N/A'} units of item ${doc} have been marked damaged by ${actor}.`,
                notificationType: NOTIFICATION_TYPE.WARNING,
                priority: NOTIFICATION_PRIORITY.HIGH,
                category: NOTIFICATION_CATEGORY.INVENTORY,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.WAREHOUSE_EVENT:
            return {
                title: `Warehouse event for ${doc}`,
                message: `Warehouse ${doc} reported an event by ${actor}: ${payload.reason ?? 'N/A'}`,
                notificationType: NOTIFICATION_TYPE.INFORMATION,
                priority: NOTIFICATION_PRIORITY.LOW,
                category: NOTIFICATION_CATEGORY.WAREHOUSE,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.ASSET_ASSIGNED:
            return {
                title: `Asset ${doc} assigned`,
                message: `Asset ${doc} has been assigned to ${payload.parentDocument ?? 'an employee'} by ${actor}.`,
                notificationType: NOTIFICATION_TYPE.INFORMATION,
                priority: NOTIFICATION_PRIORITY.MEDIUM,
                category: NOTIFICATION_CATEGORY.ASSET,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.ASSET_RETURNED:
            return {
                title: `Asset ${doc} returned`,
                message: `Asset ${doc} has been returned by ${actor}.`,
                notificationType: NOTIFICATION_TYPE.SUCCESS,
                priority: NOTIFICATION_PRIORITY.LOW,
                category: NOTIFICATION_CATEGORY.ASSET,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.ASSET_RETIRED:
            return {
                title: `Asset ${doc} retired`,
                message: `Asset ${doc} has been retired by ${actor}. Reason: ${payload.reason ?? 'N/A'}`,
                notificationType: NOTIFICATION_TYPE.WARNING,
                priority: NOTIFICATION_PRIORITY.HIGH,
                category: NOTIFICATION_CATEGORY.ASSET,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        case NOTIFICATION_EVENT.ASSET_DISPOSED:
            return {
                title: `Asset ${doc} disposed`,
                message: `Asset ${doc} has been disposed by ${actor}. Reason: ${payload.reason ?? 'N/A'}`,
                notificationType: NOTIFICATION_TYPE.WARNING,
                priority: NOTIFICATION_PRIORITY.CRITICAL,
                category: NOTIFICATION_CATEGORY.ASSET,
                referenceEntity: refEntity,
                referenceID: refID,
                referenceNumber: doc
            };

        default:
            return null;
    }
}

/**
 * Emit a Notification row for a business event. Persists a single
 * Notification addressed to `payload.recipientID` joined to the
 * caller's transaction (AD-21). Returns the inserted row, or null
 * when the event is unknown or the recipient is missing.
 *
 * Auto-emission never rejects the caller: a missing recipient
 * silently skips the notification so the originating business
 * action (PR approval, GR posting, ...) still completes. The decision
 * to require-a-recipient on manual `sendNotification` is enforced
 * by the handler, not the emitter.
 *
 * @param {object} tx
 * @param {string} event    A NOTIFICATION_EVENT symbol
 * @param {object} payload  `{ documentNumber, actor, recipientID,
 *                           referenceEntity, referenceID, reason, ... }`
 * @param {object} entities expects `{ Notifications }`
 * @returns {Promise<object|null>} inserted Notification row or null
 */
export async function emitBusinessNotification(tx, event, payload, entities) {
    const built = buildNotificationFromEvent(event, payload);
    if (!built) return null;

    const recipientID = payload.recipientID;
    if (!recipientID) return null;

    const entry = {
        title: built.title,
        message: built.message,
        notificationType: built.notificationType,
        priority: built.priority,
        category: built.category,
        recipient_ID: recipientID,
        referenceEntity: built.referenceEntity,
        referenceID: built.referenceID,
        referenceNumber: built.referenceNumber,
        isRead: false,
        isArchived: false,
        isDeleted: false,
        // Auto-emission from trusted internal handlers passes this flag so
        // the PlatformService `before('CREATE', Notifications)` hook skips
        // recipient-existence validation. This avoids rejecting an
        // auto-emission because the sender's `req.user.id` is not a
        // registered Identity Service user (which is legitimate for
        // service-side integration identities). The flag is stripped
        // from the entry before the row is persisted (see
        // `notification-handler.js` before-CREATE cleanup).
        bypassRecipientValidation: true
    };
    if (payload.senderID) entry.sender_ID = payload.senderID;

    // Auto-emission MUST never reject the originating business action.
    // If `createNotification` raises (e.g. because the recipient is not a
    // registered Identity Service user - which can legitimately happen when
    // a service-side integration identity issues a cross-service API call
    // rather than a human user) we swallow the rejection and return null so
    // the surrounding business handler continues unaffected. The
    // originating tx is rolled back for the failed notification row ONLY
    // at the row level because the rejection aborts the inner INSERT, not
    // the parent event tx.
    try {
        return await createNotification(tx, entry, entities);
    } catch {
        return null;
    }
}
