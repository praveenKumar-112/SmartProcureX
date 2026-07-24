using { smartprocurex.identity as identity } from '../db/identity';

service IdentityService {

    entity Users
        as projection on identity.User;

    entity Roles
        as projection on identity.Role;

    entity Departments
        as projection on identity.Department;

}
