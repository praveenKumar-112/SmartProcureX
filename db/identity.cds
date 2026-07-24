
namespace smartprocurex.identity;

using { cuid, managed } from '@sap/cds/common';

entity Department : cuid, managed {
  departmentCode : String(30)  not null;
  departmentName : String(100) not null;
  description    : String(500);
  users          : Association to many User on users.department = $self;
}

entity Role : cuid, managed {
  roleCode    : String(30)  not null;
  roleName    : String(100) not null;
  description : String(500);
  users       : Association to many User on users.role = $self;
}

entity User : cuid, managed {
  employeeId  : String(50)  not null;
  firstName   : String(100) not null;
  lastName    : String(100) not null;
  email       : String(255) not null;
  phone       : String(30);
  designation : String(100);
  status      : String(30)  not null default 'ACTIVE';
  department  : Association to Department;
  role        : Association to Role;
}
