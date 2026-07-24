# Project Roadmap

## Phase 1: Foundation - Complete

Status: Complete

Scope:

- Initialize SAP CAP Node.js project.
- Prepare HANA Cloud readiness.
- Prepare MTA deployment descriptor.
- Initialize Git repository.
- Install initial CAP dependencies.
- Create setup report.

Exit criteria:

- Project foundation exists.
- No business entities, services, logic, UI, or demo data are present.

## Phase 2: Architecture

Status: In progress

Scope:

- Define business requirements.
- Define system architecture.
- Define workflow and module boundaries.
- Define domain responsibilities.
- Define API and coding standards.

Exit criteria:

- Development team can begin implementation from approved design documentation.

## Phase 3: Authentication

Scope:

- Select authentication provider approach.
- Define role model and authorization strategy.
- Prepare XSUAA or IAS configuration decision.
- Define object-level authorization requirements.

Exit criteria:

- Security architecture is approved before business APIs are implemented.

## Phase 4: Supplier

Scope:

- Design supplier domain.
- Define supplier lifecycle and source of truth.
- Plan supplier integration strategy.

Exit criteria:

- Supplier master approach is ready for implementation.

## Phase 5: Purchase Requests

Scope:

- Implement employee request lifecycle.
- Support request submission and tracking.
- Establish request validation and statuses.

Exit criteria:

- Employees can create and track requests in a controlled flow.

## Phase 6: Approval Workflow

Scope:

- Implement manager approval worklist.
- Support approval, rejection, and partial approval.
- Capture approval comments and audit records.

Exit criteria:

- Request approval lifecycle is operational and auditable.

## Phase 7: Purchase Orders

Scope:

- Implement procurement review.
- Support purchase order preparation and status tracking.
- Support cancellation rules.

Exit criteria:

- Approved requests can proceed into purchase order lifecycle.

## Phase 8: Inventory

Scope:

- Implement goods receipt.
- Update inventory availability.
- Support return and exception scenarios.

Exit criteria:

- Received goods are reflected in inventory records and reports.

## Phase 9: Assets

Scope:

- Register trackable assets.
- Assign assets to employees, departments, locations, or cost centers.
- Track asset lifecycle status.

Exit criteria:

- Procured assets can be assigned and audited.

## Phase 10: Notifications

Scope:

- Define notification templates.
- Trigger notifications for workflow events.
- Prepare future channel integrations.

Exit criteria:

- Users receive relevant process notifications.

## Phase 11: Reports

Scope:

- Create operational and management reporting views.
- Support request, approval, purchase order, inventory, asset, and audit reporting.

Exit criteria:

- Authorized users can inspect process performance and compliance data.

## Phase 12: Deployment

Scope:

- Validate Cloud Foundry deployment.
- Build MTA archive.
- Deploy to SAP BTP.
- Validate SAP HANA Cloud HDI deployment.

Exit criteria:

- Application deploys successfully to the target BTP landscape.

## Phase 13: Testing

Scope:

- Unit testing.
- Service testing.
- UI testing.
- Integration testing.
- Regression testing.
- Authorization testing.

Exit criteria:

- Release candidate meets agreed quality gates.

## Phase 14: Production Readiness

Scope:

- Logging and monitoring.
- Security review.
- Performance validation.
- Backup and recovery alignment.
- Operational runbook.
- Support process definition.

Exit criteria:

- Application is ready for controlled production release.
