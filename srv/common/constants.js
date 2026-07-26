/**
 * SmartProcureX - Domain Constants
 * --------------------------------------------------
 * Responsibility:
 *   Single source of truth for document prefixes, document-status
 *   enumerations, approval-decision enumerations, and configuration
 *   keys used across procurement handlers and helpers.
 *
 * Design:
 *   - CDS enum values are bare strings at runtime in CAP; matching JS
 *     string constants keep handler code free of magic strings.
 *   - All maps are frozen so accidental mutation is detected early.
 *   - No CAP runtime dependency, fully unit-testable.
 */

export const DOCUMENT_PREFIX = {
    PURCHASE_REQUEST: 'PR',
    PURCHASE_ORDER: 'PO',
    GOODS_RECEIPT: 'GR',
    ASSET: 'AST',
    SUPPLIER: 'SUP',
    WAREHOUSE: 'WH'
};

export const PURCHASE_REQUEST_STATUS = {
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    PENDING_APPROVAL: 'Pending Approval',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    CONVERTED_TO_PO: 'ConvertedToPO',
    CANCELLED: 'Cancelled'
};

export const APPROVAL_DECISION = {
    PENDING: 'Pending',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    RETURNED: 'Returned'
};

export const PURCHASE_ORDER_STATUS = {
    CREATED: 'Created',
    SENT: 'Sent',
    PARTIALLY_RECEIVED: 'PartiallyReceived',
    RECEIVED: 'Received',
    CLOSED: 'Closed',
    CANCELLED: 'Cancelled'
};

/**
 * NotificationType enum values mirrored from
 * `db/platform-support.cds:type NotificationType`. The ticket requires
 * "Information" (full word) plus "Critical" to satisfy the
 * Information / Success / Warning / Error / Critical spectrum.
 *
 * Handlers must validate inbound notificationType strictly against
 * this map to prevent silent CDS enum fallback to NULL.
 */
export const NOTIFICATION_TYPE = {
    INFORMATION: 'Information',
    SUCCESS: 'Success',
    WARNING: 'Warning',
    ERROR: 'Error',
    CRITICAL: 'Critical'
};

/**
 * NotificationPriority enum values mirrored from
 * `db/platform-support.cds:type NotificationPriority`.
 */
export const NOTIFICATION_PRIORITY = {
    LOW: 'Low',
    MEDIUM: 'Medium',
    HIGH: 'High',
    CRITICAL: 'Critical'
};

/**
 * NotificationCategory enum values mirrored from
 * `db/platform-support.cds:type NotificationCategory`.
 * Centralizing them here keeps the auto-emission map and the
 * handler validation free of magic strings.
 */
export const NOTIFICATION_CATEGORY = {
    PURCHASE_REQUEST: 'PurchaseRequest',
    APPROVAL: 'Approval',
    PURCHASE_ORDER: 'PurchaseOrder',
    GOODS_RECEIPT: 'GoodsReceipt',
    INVENTORY: 'Inventory',
    WAREHOUSE: 'Warehouse',
    ASSET: 'Asset',
    SYSTEM: 'System'
};

/**
 * Business-event catalog auto-emitted by the Notification Framework.
 * Each event maps deterministically to a NotificationType,
 * NotificationPriority, NotificationCategory and message-template
 * builder in the helper (`emitBusinessNotification`). Keeping the
 * catalog in a single frozen map prevents drift between the
 * procurement / warehouse / asset handlers and the notification
 * helper (AD-21).
 *
 * Keys are intentionally descriptive of the triggering domain
 * action + the resulting business state, so the auto-emission
 * call site reads aloud as `emitBusinessNotification(tx, event,
 * payload, entities)`.
 */
export const NOTIFICATION_EVENT = {
    PURCHASE_REQUEST_SUBMITTED: 'PurchaseRequestSubmitted',
    PURCHASE_REQUEST_APPROVED: 'PurchaseRequestApproved',
    PURCHASE_REQUEST_REJECTED: 'PurchaseRequestRejected',
    PURCHASE_REQUEST_CANCELLED: 'PurchaseRequestCancelled',
    PURCHASE_ORDER_CREATED: 'PurchaseOrderCreated',
    PURCHASE_ORDER_SENT: 'PurchaseOrderSent',
    PURCHASE_ORDER_CANCELLED: 'PurchaseOrderCancelled',
    GOODS_RECEIPT_POSTED: 'GoodsReceiptPosted',
    GOODS_RECEIPT_CANCELLED: 'GoodsReceiptCancelled',
    INVENTORY_ADJUSTMENT: 'InventoryAdjustment',
    INVENTORY_RESERVATION: 'InventoryReservation',
    INVENTORY_TRANSFER: 'InventoryTransfer',
    INVENTORY_DAMAGE: 'InventoryDamage',
    WAREHOUSE_EVENT: 'WarehouseEvent',
    ASSET_ASSIGNED: 'AssetAssigned',
    ASSET_RETURNED: 'AssetReturned',
    ASSET_RETIRED: 'AssetRetired',
    ASSET_DISPOSED: 'AssetDisposed'
};

/**
 * Keys used to look up configurable behaviour in the platform
 * Settings table. III-defined keys would silently break business
 * rules; centralizing them here prevents drift across handlers.
 */
export const SETTING_KEYS = {
    APPROVER_ROLE_CODE: 'approverRoleCode',
    APPROVER_USER_STATUS_REQUIRED: 'approverUserStatusRequired'
};

/**
 * Default user attribute used to gate approval actions when no
 * overriding Setting row is present. ACTIVE users are considered
 * eligible approvers in the default (zero-config) configuration.
 */
export const APPROVER_DEFAULTS = Object.freeze({
    ROLE_CODE: 'APPROVER',
    USER_STATUS: 'ACTIVE'
});

/**
 * Default pagination size when no `$top` is requested on
 * Notification reads. Capped at 100 to prevent unbounded scans.
 */
export const NOTIFICATION_DEFAULTS = Object.freeze({
    PAGE_SIZE: 50,
    MAX_PAGE_SIZE: 100
});

Object.freeze(DOCUMENT_PREFIX);
Object.freeze(PURCHASE_REQUEST_STATUS);
Object.freeze(APPROVAL_DECISION);
Object.freeze(PURCHASE_ORDER_STATUS);
Object.freeze(NOTIFICATION_TYPE);
Object.freeze(NOTIFICATION_PRIORITY);
Object.freeze(NOTIFICATION_CATEGORY);
Object.freeze(NOTIFICATION_EVENT);
Object.freeze(SETTING_KEYS);
