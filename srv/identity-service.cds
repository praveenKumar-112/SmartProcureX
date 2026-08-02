using { smartprocurex.identity as identity } from '../db/identity';

service IdentityService @(requires: 'authenticated-user') {

    entity Users
        @(restrict: [
            { grant: ['READ'], to: 'authenticated-user' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on identity.User;

    entity Roles
        @(restrict: [
            { grant: '*', to: 'Admin' }
        ])
        as projection on identity.Role;

    entity Departments
        @(restrict: [
            { grant: ['READ'], to: 'authenticated-user' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on identity.Department;

}
