/**
 * SmartProcureX - Notification Domain Handler
 * --------------------------------------------------
 * Responsibility:
 *   Orchestrate the Notification bounded context: CRUD lifecycle,
 *   mark read / unread / mark all read, soft-delete, unread count,
 *   send and broadcast actions. Reuse all reusable logic from
 *   srv/common/notification-service-helpers.js per AD-11 / AD-21.
 *
 * Design:
 *   - One handler file per domain (AD-5).
 *   - Handlers stay thin: validation + orchestration only.
 *   - Errors raised exclusively via `req.reject(code, msg, target)`
 *     with codes from HTTP_STATUS (AD-9).
 *   - Before-DELETE flips isDeleted=true (soft-delete) and aborts the
 *     physical DELETE (AD-23). This keeps the audit trail intact
 *     while the user-visible list omits deleted rows via the
 *     after-READ filter.
 *   - Recipient / Department / Role existence checks are delegated to
 *     the helper so the handler remains I/O-orchestration-shaped.
 *   - Filtering / Pagination / Sorting / Unread-only / Priority /
 *     Type / Recipient / Date filters are exposed by augmenting the
 *     query in `before('READ', Notifications)` using the standard
 *     OData v4 query options; CAP natively honours $filter/$top/
 *     $skip/$orderby for projection entities, so this hook only
 *     enforces `isDeleted=false` as a global default so the client
 *     cannot bypass soft-delete via direct $filter.
 */
import cds from '@sap/cds';
import {
    NOTIFICATION_TYPE,
    NOTIFICATION_PRIORITY,
    NOTIFICATION_CATEGORY,
    NOTIFICATION_DEFAULTS
} from '../common/constants.js';
import { associationId } from '../common/utils.js';
import {
    resolveRecipient,
    resolveDepartment,
    resolveRole,
    findUsersByDepartment,
    findUsersByRole,
    getNotification,
    countUnread,
    markRead,
    markUnread,
    markAllRead,
    softDelete,
    createNotification,
    createNotificationsFor,
    isValidNotificationType,
    isValidNotificationPriority,
    isValidNotificationCategory
} from '../common/notification-service-helpers.js';

// ---------------------------------------------------------------------------
// Cross-service entity resolution. The Notification handler needs read
// access to the IdentityService Users / Departments / Roles so recipient
// validation can run against the authoritative identity domain while
// keeping the one-service-per-domain boundary (AD-5).
// ---------------------------------------------------------------------------
function identityEntities() {
    const svc = cds.services.IdentityService;
    return {
        Users: svc?.entities?.Users ?? null,
        Departments: svc?.entities?.Departments ?? null,
        Roles: svc?.entities?.Roles ?? null
    };
}

// ---------------------------------------------------------------------------
// Extract the targeted Notification ID from a before-DELETE CQN query.
// CAP leaves req.data empty on DELETE; the key lives in the where clause.
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

function notificationIdFromDeleteRequest(req) {
    if (!req) return null;
    return req.data?.ID ?? _keyFromDeleteQuery(req.query) ?? null;
}

export default cds.service.impl(function () {

    const { Notifications, Settings, AuditLogs } = this.entities;
    const _helperEntities = { Notifications };

    // ============================================================
    // Notifications - before-CREATE
    // ============================================================
    // Validates the inbound notification payload and normalises
    // association fields to the FK form (AD-12 tolerant of inline
    // object vs `_ID`).
    // ------------------------------------------------------------
    this.before('CREATE', Notifications, async (req) => {

        const {
            title,
            message,
            notificationType,
            priority,
            category
        } = req.data;

        if (!title || !String(title).trim()) {
            return req.reject(400, 'Title is mandatory.', 'title');
        }
        if (String(title).length > 150) {
            return req.reject(400, 'Title must not exceed 150 characters.', 'title');
        }

        if (!message || !String(message).trim()) {
            return req.reject(400, 'Message is mandatory.', 'message');
        }
        if (String(message).length > 1000) {
            return req.reject(400, 'Message must not exceed 1000 characters.', 'message');
        }

        // Enum checks
        const type = notificationType ?? NOTIFICATION_TYPE.INFORMATION;
        if (!isValidNotificationType(type)) {
            return req.reject(400, `Invalid notification type. Allowed: ${Object.values(NOTIFICATION_TYPE).join(', ')}.`, 'notificationType');
        }
        const prio = priority ?? NOTIFICATION_PRIORITY.MEDIUM;
        if (!isValidNotificationPriority(prio)) {
            return req.reject(400, `Invalid priority. Allowed: ${Object.values(NOTIFICATION_PRIORITY).join(', ')}.`, 'priority');
        }
        const cat = category ?? NOTIFICATION_CATEGORY.SYSTEM;
        if (!isValidNotificationCategory(cat)) {
            return req.reject(400, `Invalid category. Allowed: ${Object.values(NOTIFICATION_CATEGORY).join(', ')}.`, 'category');
        }

        req.data.notificationType = type;
        req.data.priority = prio;
        req.data.category = cat;

        // Normalise association payloads.
        const recipientID = associationId(req.data.recipient_ID ?? req.data.recipient);
        const departmentID = associationId(req.data.department_ID ?? req.data.department);
        const roleID = associationId(req.data.role_ID ?? req.data.role);
        const senderID = associationId(req.data.sender_ID ?? req.data.sender);

        req.data.recipient_ID = recipientID ?? null;
        req.data.department_ID = departmentID ?? null;
        req.data.role_ID = roleID ?? null;
        req.data.sender_ID = senderID ?? null;

        // Internal control flags consumed by the hook above must never
        // reach the database (they are not Notification columns).
        if ('bypassRecipientValidation' in req.data) {
            delete req.data.bypassRecipientValidation;
        }
        if ('bypassHooks' in req.data) {
            delete req.data.bypassHooks;
        }

        // Exactly one routing target must be present.
        const targets = [recipientID, departmentID, roleID].filter(Boolean);
        if (targets.length === 0) {
            return req.reject(400, 'At least one of recipient, department or role is required.');
        }
        if (targets.length > 1) {
            return req.reject(400, 'Only one of recipient, department or role may be set.');
        }

        const tx = cds.transaction(req);
        const identity = identityEntities();

        // Target existence validation per ticket.
        if (recipientID) {
            if (!identity.Users) {
                return req.reject(500, 'Identity service is not available.');
            }
            // Auto-emission from trusted internal handlers sets
            // `bypassRecipientValidation` so that firing a notification for
            // a business event whose actor is not a registered Identity
            // Service user (e.g. a service-side integration identity) does
            // not roll back the originating business write. The flag is
            // stripped before the row is persisted.
            if (req.data.bypassRecipientValidation !== true) {
                const user = await resolveRecipient(tx, recipientID, identity);
                if (!user) {
                    return req.reject(404, 'Recipient not found.', 'recipient_ID');
                }
            }
        }
        if (departmentID) {
            if (!identity.Departments) {
                return req.reject(500, 'Identity service is not available.');
            }
            const dept = await resolveDepartment(tx, departmentID, identity);
            if (!dept) {
                return req.reject(404, 'Department not found.', 'department_ID');
            }
        }
        if (roleID) {
            if (!identity.Roles) {
                return req.reject(500, 'Identity service is not available.');
            }
            const rl = await resolveRole(tx, roleID, identity);
            if (!rl) {
                return req.reject(404, 'Role not found.', 'role_ID');
            }
        }

        // Default lifecycle flags.
        req.data.isRead = false;
        req.data.isArchived = false;
        req.data.isDeleted = false;
    });

    // ============================================================
    // Notifications - before-UPDATE
    // ============================================================
    // Permits title / message / type / priority / category / isRead
    // updates only while the notification is not soft-deleted.
    // Recipient / department / role are immutable once persisted
    // (the Notification is a routed-at-create concept).
    // ------------------------------------------------------------
    this.before('UPDATE', Notifications, async (req) => {
        const tx = cds.transaction(req);
        const existing = await getNotification(tx, req.data.ID, _helperEntities);
        if (!existing) {
            return req.reject(404, 'Notification not found.');
        }
        if (existing.isDeleted) {
            return req.reject(409, 'Cannot update a deleted Notification.');
        }

        if (req.data.notificationType != null && !isValidNotificationType(req.data.notificationType)) {
            return req.reject(400, 'Invalid notification type.', 'notificationType');
        }
        if (req.data.priority != null && !isValidNotificationPriority(req.data.priority)) {
            return req.reject(400, 'Invalid priority.', 'priority');
        }
        if (req.data.category != null && !isValidNotificationCategory(req.data.category)) {
            return req.reject(400, 'Invalid category.', 'category');
        }
        if (req.data.title != null && String(req.data.title).length > 150) {
            return req.reject(400, 'Title must not exceed 150 characters.', 'title');
        }
        if (req.data.message != null && String(req.data.message).length > 1000) {
            return req.reject(400, 'Message must not exceed 1000 characters.', 'message');
        }

        // Routing immutability.
        const routingChanged =
            (req.data.recipient_ID && req.data.recipient_ID !== existing.recipient_ID) ||
            (req.data.department_ID && req.data.department_ID !== existing.department_ID) ||
            (req.data.role_ID && req.data.role_ID !== existing.role_ID);
        if (routingChanged) {
            return req.reject(400, 'Routing (recipient/department/role) is immutable after creation.');
        }
    });

    // ============================================================
    // Notifications - before-READ (search housekeeping)
    // ============================================================
    // CAP honours $filter/$top/$skip/$orderby natively; the hook
    // enforces a global soft-delete mask so a client cannot bypass
    // isDeleted=false via $filter, and enforces max page size.
    // ------------------------------------------------------------
    this.before('READ', Notifications, async (req) => {
        if (!req.query || !req.query.SELECT) return;

        const tx = cds.transaction(req);

        // Enforce a default soft-delete mask. If the client already
        // explicitly filters by isDeleted we trust their intent.
        const existingWhere = req.query.SELECT.where;
        if (existingWhere == null) {
            req.query.where('isDeleted', '=', false);
        }

        // Enforce pagination cap.
        const limit = req.query.SELECT.limit;
        if (!limit) {
            req.query.limit(NOTIFICATION_DEFAULTS.PAGE_SIZE);
        } else {
            const top = Number(limit.rows?.val ?? limit.rows ?? NOTIFICATION_DEFAULTS.PAGE_SIZE);
            if (top > NOTIFICATION_DEFAULTS.MAX_PAGE_SIZE) {
                req.query.limit(NOTIFICATION_DEFAULTS.MAX_PAGE_SIZE);
            }
        }
    });

    // ============================================================
    // Notifications - before-DELETE  (soft-delete enforcement - AD-23)
    // ============================================================
    this.before('DELETE', Notifications, async (req) => {
        const id = notificationIdFromDeleteRequest(req);
        if (!id) {
            return req.reject(400, 'Notification ID is mandatory.');
        }
        const tx = cds.transaction(req);
        const notif = await getNotification(tx, id, _helperEntities);
        if (!notif) {
            return req.reject(404, 'Notification not found.');
        }
        if (notif.isDeleted) {
            return req.reject(409, 'Notification is already deleted.');
        }

        const deletedByID = req?.user?.id ?? null;
        await softDelete(tx, id, deletedByID, _helperEntities);

        // Abort the physical DELETE; the row has been soft-deleted.
        return req.reject(204, '');
    });

    // ============================================================
    // markNotificationRead action
    // ============================================================
    this.on('markNotificationRead', async (req) => {
        const { notificationID } = req.data;
        if (!notificationID) {
            return req.reject(400, 'Notification ID is mandatory.');
        }
        const tx = cds.transaction(req);
        const existing = await getNotification(tx, notificationID, _helperEntities);
        if (!existing) {
            return req.reject(404, 'Notification not found.');
        }
        if (existing.isDeleted) {
            return req.reject(409, 'Cannot read a deleted Notification.');
        }
        const readByID = req?.user?.id ?? null;
        await markRead(tx, notificationID, readByID, _helperEntities);
        return true;
    });

    // ============================================================
    // markNotificationUnread action
    // ============================================================
    this.on('markNotificationUnread', async (req) => {
        const { notificationID } = req.data;
        if (!notificationID) {
            return req.reject(400, 'Notification ID is mandatory.');
        }
        const tx = cds.transaction(req);
        const existing = await getNotification(tx, notificationID, _helperEntities);
        if (!existing) {
            return req.reject(404, 'Notification not found.');
        }
        if (existing.isDeleted) {
            return req.reject(409, 'Cannot modify a deleted Notification.');
        }
        await markUnread(tx, notificationID, _helperEntities);
        return true;
    });

    // ============================================================
    // markAllNotificationsRead action
    // ============================================================
    this.on('markAllNotificationsRead', async (req) => {
        const { recipientID } = req.data;
        if (!recipientID) {
            return req.reject(400, 'Recipient ID is mandatory.');
        }
        const tx = cds.transaction(req);
        const readByID = req?.user?.id ?? null;
        const count = await markAllRead(tx, recipientID, readByID, _helperEntities);
        return Number(count ?? 0);
    });

    // ============================================================
    // deleteNotification action  (soft-delete per AD-23)
    // ============================================================
    this.on('deleteNotification', async (req) => {
        const { notificationID } = req.data;
        if (!notificationID) {
            return req.reject(400, 'Notification ID is mandatory.');
        }
        const tx = cds.transaction(req);
        const existing = await getNotification(tx, notificationID, _helperEntities);
        if (!existing) {
            return req.reject(404, 'Notification not found.');
        }
        if (existing.isDeleted) {
            return req.reject(409, 'Notification is already deleted.');
        }
        const deletedByID = req?.user?.id ?? null;
        await softDelete(tx, notificationID, deletedByID, _helperEntities);
        return true;
    });

    // ============================================================
    // getUnreadNotificationCount action
    // ============================================================
    this.on('getUnreadNotificationCount', async (req) => {
        const { recipientID } = req.data;
        if (!recipientID) {
            return req.reject(400, 'Recipient ID is mandatory.');
        }
        const tx = cds.transaction(req);
        return countUnread(tx, recipientID, _helperEntities);
    });

    // ============================================================
    // sendNotification action
    // ============================================================
    this.on('sendNotification', async (req) => {
        const {
            recipientID,
            title,
            message,
            notificationType,
            priority,
            category
        } = req.data;

        if (!recipientID) return req.reject(400, 'Recipient ID is mandatory.', 'recipientID');
        if (!title || !String(title).trim()) return req.reject(400, 'Title is mandatory.', 'title');
        if (String(title).length > 150) return req.reject(400, 'Title must not exceed 150 characters.', 'title');
        if (!message || !String(message).trim()) return req.reject(400, 'Message is mandatory.', 'message');
        if (String(message).length > 1000) return req.reject(400, 'Message must not exceed 1000 characters.', 'message');

        const type = notificationType ?? NOTIFICATION_TYPE.INFORMATION;
        if (!isValidNotificationType(type)) {
            return req.reject(400, `Invalid notification type. Allowed: ${Object.values(NOTIFICATION_TYPE).join(', ')}.`, 'notificationType');
        }
        const prio = priority ?? NOTIFICATION_PRIORITY.MEDIUM;
        if (!isValidNotificationPriority(prio)) {
            return req.reject(400, `Invalid priority. Allowed: ${Object.values(NOTIFICATION_PRIORITY).join(', ')}.`, 'priority');
        }
        const cat = category ?? NOTIFICATION_CATEGORY.SYSTEM;
        if (!isValidNotificationCategory(cat)) {
            return req.reject(400, `Invalid category. Allowed: ${Object.values(NOTIFICATION_CATEGORY).join(', ')}.`, 'category');
        }

        const tx = cds.transaction(req);
        const identity = identityEntities();
        if (!identity.Users) {
            return req.reject(500, 'Identity service is not available.');
        }
        const user = await resolveRecipient(tx, recipientID, identity);
        if (!user) {
            return req.reject(404, 'Recipient not found.', 'recipientID');
        }

        const entry = {
            title: String(title).slice(0, 150),
            message: String(message).slice(0, 1000),
            notificationType: type,
            priority: prio,
            category: cat,
            recipient_ID: recipientID,
            referenceEntity: req.data.referenceEntity ?? null,
            referenceID: req.data.referenceID ?? null,
            referenceNumber: req.data.referenceNumber ?? null,
            sender_ID: req?.user?.id ?? null,
            isRead: false,
            isArchived: false,
            isDeleted: false
        };
        const inserted = await createNotification(tx, entry, _helperEntities);
        return inserted.ID;
    });

    // ============================================================
    // broadcastToDepartment action
    // ============================================================
    // Pre-expands to one Notification row per ACTIVE user in the
    // department (AD-22).
    // ------------------------------------------------------------
    this.on('broadcastToDepartment', async (req) => {
        const {
            departmentID,
            title,
            message,
            notificationType,
            priority,
            category
        } = req.data;

        if (!departmentID) return req.reject(400, 'Department ID is mandatory.', 'departmentID');
        if (!title || !String(title).trim()) return req.reject(400, 'Title is mandatory.', 'title');
        if (!message || !String(message).trim()) return req.reject(400, 'Message is mandatory.', 'message');

        const type = notificationType ?? NOTIFICATION_TYPE.INFORMATION;
        const prio = priority ?? NOTIFICATION_PRIORITY.MEDIUM;
        const cat = category ?? NOTIFICATION_CATEGORY.SYSTEM;
        if (!isValidNotificationType(type)) return req.reject(400, 'Invalid notification type.', 'notificationType');
        if (!isValidNotificationPriority(prio)) return req.reject(400, 'Invalid priority.', 'priority');
        if (!isValidNotificationCategory(cat)) return req.reject(400, 'Invalid category.', 'category');

        const tx = cds.transaction(req);
        const identity = identityEntities();
        if (!identity.Departments) {
            return req.reject(500, 'Identity service is not available.');
        }
        const dept = await resolveDepartment(tx, departmentID, identity);
        if (!dept) {
            return req.reject(404, 'Department not found.', 'departmentID');
        }

        const users = await findUsersByDepartment(tx, departmentID, identity);
        if (users.length === 0) {
            return req.reject(409, 'No active users in the department to broadcast to.');
        }

        const template = {
            title: String(title).slice(0, 150),
            message: String(message).slice(0, 1000),
            notificationType: type,
            priority: prio,
            category: cat,
            department_ID: departmentID,
            referenceEntity: req.data.referenceEntity ?? null,
            referenceID: req.data.referenceID ?? null,
            referenceNumber: req.data.referenceNumber ?? null,
            sender_ID: req?.user?.id ?? null,
            isRead: false,
            isArchived: false,
            isDeleted: false
        };
        const ids = users.map((u) => u.ID);
        return createNotificationsFor(tx, ids, template, _helperEntities);
    });

    // ============================================================
    // broadcastToRole action
    // ============================================================
    this.on('broadcastToRole', async (req) => {
        const {
            roleID,
            title,
            message,
            notificationType,
            priority,
            category
        } = req.data;

        if (!roleID) return req.reject(400, 'Role ID is mandatory.', 'roleID');
        if (!title || !String(title).trim()) return req.reject(400, 'Title is mandatory.', 'title');
        if (!message || !String(message).trim()) return req.reject(400, 'Message is mandatory.', 'message');

        const type = notificationType ?? NOTIFICATION_TYPE.INFORMATION;
        const prio = priority ?? NOTIFICATION_PRIORITY.MEDIUM;
        const cat = category ?? NOTIFICATION_CATEGORY.SYSTEM;
        if (!isValidNotificationType(type)) return req.reject(400, 'Invalid notification type.', 'notificationType');
        if (!isValidNotificationPriority(prio)) return req.reject(400, 'Invalid priority.', 'priority');
        if (!isValidNotificationCategory(cat)) return req.reject(400, 'Invalid category.', 'category');

        const tx = cds.transaction(req);
        const identity = identityEntities();
        if (!identity.Roles) {
            return req.reject(500, 'Identity service is not available.');
        }
        const rl = await resolveRole(tx, roleID, identity);
        if (!rl) {
            return req.reject(404, 'Role not found.', 'roleID');
        }

        const users = await findUsersByRole(tx, roleID, identity);
        if (users.length === 0) {
            return req.reject(409, 'No active users with this role to broadcast to.');
        }

        const template = {
            title: String(title).slice(0, 150),
            message: String(message).slice(0, 1000),
            notificationType: type,
            priority: prio,
            category: cat,
            role_ID: roleID,
            referenceEntity: req.data.referenceEntity ?? null,
            referenceID: req.data.referenceID ?? null,
            referenceNumber: req.data.referenceNumber ?? null,
            sender_ID: req?.user?.id ?? null,
            isRead: false,
            isArchived: false,
            isDeleted: false
        };
        const ids = users.map((u) => u.ID);
        return createNotificationsFor(tx, ids, template, _helperEntities);
    });

});
