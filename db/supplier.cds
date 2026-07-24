namespace smartprocurex.supplier;

using { cuid, managed } from '@sap/cds/common';

entity Supplier : cuid, managed {
  supplierCode : String(30)  not null;
  supplierName : String(150) not null;
  supplierType : String(50);
  gstNumber    : String(30);
  taxNumber    : String(30);
  email        : String(255);
  phone        : String(30);
  website      : String(255);
  status       : String(30)  not null default 'ACTIVE';
  contacts     : Association to many SupplierContact on contacts.supplier = $self;
}

entity SupplierContact : cuid, managed {
  firstName   : String(100) not null;
  lastName    : String(100) not null;
  designation : String(100);
  email       : String(255);
  phone       : String(30);
  supplier    : Association to Supplier;
}
