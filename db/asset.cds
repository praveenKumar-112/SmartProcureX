namespace smartprocurex.asset;

using { cuid, managed } from '@sap/cds/common';
using { smartprocurex.identity.User } from './identity';
using { smartprocurex.warehouse.InventoryItem } from './warehouse';

type AssetStatus : String enum {
  Available;
  Assigned;
  Maintenance;
  Retired;
  Disposed;
}

type AssignmentStatus : String enum {
  Assigned;
  Returned;
  Lost;
  Damaged;
}

entity AssetCategory : cuid, managed {
  categoryCode : String(30)  not null;
  categoryName : String(100) not null;
  description  : String(500);
  assets       : Association to many Asset on assets.assetCategory = $self;
}

entity Asset : cuid, managed {
  assetCode         : String(50)  not null;
  assetName         : String(150) not null;
  assetCategory     : Association to AssetCategory;
  inventoryItem     : Association to InventoryItem;
  serialNumber      : String(100);
  purchaseDate      : Date;
  warrantyExpiry    : Date;
  assetStatus       : AssetStatus not null default #Available;
  condition         : String(30) default 'Good';

  // Lifecycle audit fields (AD-20 - asset audit columns).
  assignedTo        : Association to User;
  assignedAt        : DateTime;
  currentAssignment : Association to AssetAssignment;
  retiredAt         : DateTime;
  retiredBy         : Association to User;
  retirementReason  : String(1000);
  disposedAt        : DateTime;
  disposedBy        : Association to User;
  disposalReason    : String(1000);
  cancellationReason: String(1000);

  assignments       : Composition of many AssetAssignment
                        on assignments.asset = $self;
}

entity AssetAssignment : cuid, managed {
  asset              : Association to Asset;
  employee           : Association to User;
  assignedDate       : Date not null;
  expectedReturnDate : Date;
  returnedDate       : Date;
  assignmentStatus   : AssignmentStatus not null default #Assigned;
  returnRemarks      : String(1000);
  assignedBy         : Association to User;
  returnedBy         : Association to User;
}
