using { smartprocurex.platform as platform } from '../db/platform-support';

service PlatformService @(requires: 'Admin') {

    entity Notifications
        as projection on platform.Notification;

    entity AuditLogs
        as projection on platform.AuditLog;

    entity Settings
        as projection on platform.Settings;

    // -------- Notification actions (TICKET-008) --------
    // Action names follow the TICKET-008 contract verbatim:
    //   markNotificationRead / markNotificationUnread /
    //   markAllNotificationsRead / deleteNotification /
    //   getUnreadNotificationCount. The legacy `markRead`,
    //   `unreadCount`, `archiveNotification`, `sendNotification`,
    //   `broadcastToDepartment`, `broadcastToRole` action set that
    //   existed as a stub design has been superseded per AD-21.

    // Mark a single Notification row as read.
    action markNotificationRead(
        notificationID : UUID
    ) returns Boolean;

    // Mark a single Notification row as unread.
    action markNotificationUnread(
        notificationID : UUID
    ) returns Boolean;

    // Mark every non-archived, non-deleted Notification for the
    // given recipient as read. Returns the count of rows updated.
    action markAllNotificationsRead(
        recipientID : UUID
    ) returns Integer;

    // Soft-delete a single Notification. The row is retained in
    // the database with isDeleted=true so that the audit / report
    // queries can still reconstruct the timeline (AD-23).
    action deleteNotification(
        notificationID : UUID
    ) returns Boolean;

    // Return the count of unread, non-archived, non-deleted
    // Notifications for the given recipient. Computed server-side
    // so the UI avoids client-side aggregation.
    action getUnreadNotificationCount(
        recipientID : UUID
    ) returns Integer;

    // Send a notification to a single recipient. Encapsulates the
    // create flow with full validation (recipient existence,
    // type/priority/category enum check, dedupe guard). Used by
    // both manual callers and the framework's auto-emitter.
    action sendNotification(
        recipientID      : UUID,
        title             : String,
        message           : String,
        notificationType : String,
        priority          : String,
        category          : String,
        referenceEntity   : String,
        referenceID       : String,
        referenceNumber   : String
    ) returns UUID;

    // Broadcast a notification to every ACTIVE user that belongs
    // to the given Department. Pre-expands the recipient set into
    // one Notification row per user so the read-time query stays
    // single-table. Returns the count of rows created.
    action broadcastToDepartment(
        departmentID     : UUID,
        title            : String,
        message          : String,
        notificationType : String,
        priority         : String,
        category         : String,
        referenceEntity  : String,
        referenceID      : String,
        referenceNumber  : String
    ) returns Integer;

    // Broadcast a notification to every ACTIVE user that holds
    // the given Role. Same pre-expansion contract as
    // `broadcastToDepartment`. Returns the count of rows created.
    action broadcastToRole(
        roleID           : UUID,
        title            : String,
        message          : String,
        notificationType : String,
        priority         : String,
        category         : String,
        referenceEntity  : String,
        referenceID      : String,
        referenceNumber  : String
    ) returns Integer;
}
