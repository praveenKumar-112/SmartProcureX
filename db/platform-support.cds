namespace smartprocurex.platform;

using { cuid, managed } from '@sap/cds/common';
using { smartprocurex.identity.User } from './identity';
using { smartprocurex.identity.Department } from './identity';
using { smartprocurex.identity.Role } from './identity';

type NotificationType : String enum {
  Information;
  Success;
  Warning;
  Error;
  Critical;
}

type NotificationPriority : String enum {
  Low;
  Medium;
  High;
  Critical;
}

type NotificationCategory : String enum {
  PurchaseRequest;
  Approval;
  PurchaseOrder;
  GoodsReceipt;
  Inventory;
  Warehouse;
  Asset;
  System;
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

entity Notification : cuid, managed {
  title            : String(150) not null;
  message          : String(1000) not null;
  notificationType : NotificationType not null default #Information;
  priority         : NotificationPriority not null default #Medium;
  category         : NotificationCategory not null default #System;

  // Routing - exactly one of recipient / department / role is non-null.
  // If recipient is null but department or role is set, the notification is
  // a broadcast that must be fanned out to the matching users on read time
  // (or pre-expanded by the helper at create time).
  recipient        : Association to User;
  department       : Association to Department;
  role             : Association to Role;

  // Lifecycle flags
  isRead           : Boolean not null default false;
  readOn           : DateTime;
  readBy           : Association to User;
  isArchived       : Boolean not null default false;
  archivedOn       : DateTime;

  // Soft-delete flag (AD-23). Notification rows are retained for audit
  // even after the user "deletes" them. The before-DELETE hook flips
  // this flag and aborts the physical DELETE, keeping the row queryable
  // for compliance / reporting.
  isDeleted        : Boolean not null default false;
  deletedOn        : DateTime;
  deletedBy        : Association to User;

  // Document linkage for the UI to deep-link back to the source document.
  referenceEntity  : String(150);
  referenceID      : String(36);
  referenceNumber  : String(50);

  // Sender optional (system notifications may have no human sender).
  sender           : Association to User;
}

entity AuditLog : cuid, managed {
  entityName  : String(150) not null;
  entityId    : String(36);
  operation   : AuditOperation not null;
  performedBy : Association to User;
  performedOn : DateTime not null;
  oldValue    : LargeString;
  newValue    : LargeString;
  ipAddress   : String(45);
}

entity Settings : cuid, managed {
  settingKey   : String(150) not null;
  settingValue : String(1000);
  description  : String(500);
  category     : String(100);
  isActive     : Boolean not null default true;
}
