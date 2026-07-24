namespace smartprocurex.platform;

using { cuid } from '@sap/cds/common';
using { smartprocurex.identity.User } from './identity';

type NotificationType : String enum {
  Info;
  Success;
  Warning;
  Error;
}

type NotificationPriority : String enum {
  Low;
  Medium;
  High;
  Critical;
}

type AuditOperation : String enum {
  Create;
  Update;
  Delete;
  Login;
  Logout;
  Approve;
  Reject;
}

entity Notification : cuid {
  title            : String(150) not null;
  message          : String(1000) not null;
  notificationType : NotificationType not null default #Info;
  priority         : NotificationPriority not null default #Medium;
  recipient        : Association to User;
  isRead           : Boolean not null default false;
  createdOn        : DateTime not null;
  readOn           : DateTime;
}

entity AuditLog : cuid {
  entityName  : String(150) not null;
  entityId    : String(36);
  operation   : AuditOperation not null;
  performedBy : Association to User;
  performedOn : DateTime not null;
  oldValue    : LargeString;
  newValue    : LargeString;
  ipAddress   : String(45);
}

entity Settings : cuid {
  settingKey   : String(150) not null;
  settingValue : String(1000);
  description  : String(500);
  category     : String(100);
  isActive     : Boolean not null default true;
}
