using { smartprocurex.supplier as supplier } from '../db/supplier';

service SupplierService {

    entity Suppliers
        as projection on supplier.Supplier;

    entity SupplierContacts
        as projection on supplier.SupplierContact;

}