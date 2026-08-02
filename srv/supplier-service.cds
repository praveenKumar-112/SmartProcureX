using { smartprocurex.supplier as supplier } from '../db/supplier';

service SupplierService @(requires: 'authenticated-user') {

    entity Suppliers
        @(restrict: [
            { grant: ['READ'], to: ['Requester', 'Approver'] },
            { grant: '*', to: ['ProcurementManager', 'Admin'] }
        ])
        as projection on supplier.Supplier;

    entity SupplierContacts
        @(restrict: [
            { grant: ['READ'], to: ['Requester', 'Approver'] },
            { grant: '*', to: ['ProcurementManager', 'Admin'] }
        ])
        as projection on supplier.SupplierContact;

}