using { smartprocurex.platform as platform } from '../db/platform-support';

service PlatformService {

    entity Notifications
        as projection on platform.Notification;

    entity AuditLogs
        as projection on platform.AuditLog;

    entity Settings
        as projection on platform.Settings;

}