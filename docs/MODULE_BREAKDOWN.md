# Module Breakdown

This document describes planned modules only. It does not implement APIs, UI screens, CAP services, entities, or database objects.

## Employee Portal

Purpose:

- Provide employees with a focused interface for procurement requests and personal status visibility.

Responsibilities:

- Request creation and submission.
- Request status tracking.
- Visibility into assigned assets or fulfilled items.
- Notification display.

Future APIs:

- Purchase request APIs.
- Employee profile and authorization context APIs.
- Notification APIs.
- Asset assignment visibility APIs.

Future UI:

- Request creation form.
- My Requests list.
- Request detail page.
- My Assets page.
- Notification center.

Dependencies:

- Identity domain.
- Procurement domain.
- Asset domain.
- Notification domain.

## Manager Portal

Purpose:

- Provide managers with an approval worklist and request decision tools.

Responsibilities:

- Review submitted requests.
- Approve, reject, or partially approve requests.
- Provide decision comments.
- Track pending and completed approvals.

Future APIs:

- Approval worklist APIs.
- Request review APIs.
- Approval decision APIs.
- Delegation or substitute approval APIs.

Future UI:

- Approval inbox.
- Request detail review.
- Approval decision dialog.
- Approval history view.

Dependencies:

- Identity domain.
- Procurement domain.
- Notification domain.
- Audit domain.

## Procurement Portal

Purpose:

- Support procurement officers from approved request review through purchase order lifecycle.

Responsibilities:

- Review approved requests.
- Evaluate sourcing context.
- Prepare purchase orders.
- Track order status.
- Coordinate goods receipt and returns.

Future APIs:

- Approved request queue APIs.
- Supplier lookup APIs.
- Purchase order APIs.
- Goods receipt coordination APIs.
- Purchase order cancellation APIs.

Future UI:

- Procurement workbench.
- Approved request detail.
- Purchase order draft and detail views.
- Supplier selection view.
- Goods receipt exception view.

Dependencies:

- Procurement domain.
- Supplier domain.
- Inventory domain.
- Notification domain.
- Audit domain.

## Admin Portal

Purpose:

- Provide controlled administration for configuration, reference data, and operational support.

Responsibilities:

- Manage business configuration.
- Maintain reference values.
- Manage user-role mappings.
- Monitor operational exceptions.
- Support audit and compliance review.

Future APIs:

- Configuration APIs.
- Reference data APIs.
- Role administration APIs.
- Audit query APIs.
- Operational monitoring APIs.

Future UI:

- Configuration dashboard.
- Role administration screens.
- Reference data maintenance.
- Audit search.
- System health summary.

Dependencies:

- Identity domain.
- Administration domain.
- Audit domain.
- Reporting domain.

## CAP Backend

Purpose:

- Provide business services, domain orchestration, security enforcement points, and integration boundaries.

Responsibilities:

- Validate business operations.
- Enforce workflow state transitions.
- Expose APIs to SAPUI5 applications.
- Manage persistence through CAP.
- Prepare future integration adapters.

Future APIs:

- Domain-specific REST/OData services.
- Reporting projections.
- Administration services.
- Notification orchestration services.

Future UI:

- No direct UI. Consumed by SAPUI5 portals.

Dependencies:

- SQLite for local development.
- SAP HANA Cloud for production.
- SAP BTP services for security, connectivity, destinations, and logging in future phases.

## Database Layer

Purpose:

- Persist transactional, reference, reporting, and audit-relevant data.

Responsibilities:

- Local development persistence with SQLite.
- Production persistence with SAP HANA Cloud.
- Support transactional consistency and reporting needs.
- Provide HDI-based deployment lifecycle.

Future APIs:

- Not directly exposed. Access occurs through CAP services.

Future UI:

- No direct UI.

Dependencies:

- CAP persistence layer.
- MTA DB deployer.
- SAP HANA HDI container.

## Notification Module

Purpose:

- Coordinate user-facing and operational notifications.

Responsibilities:

- Trigger notifications for approvals, rejections, procurement events, receipts, returns, and administration alerts.
- Maintain consistent notification templates.
- Support future channel integrations.

Future APIs:

- Notification preference APIs.
- Notification event APIs.
- Notification delivery status APIs.

Future UI:

- Notification center.
- Notification preferences.
- Admin notification template management.

Dependencies:

- Procurement domain.
- Inventory domain.
- Asset domain.
- Administration domain.

## Reporting Module

Purpose:

- Provide operational and management insights across procurement and asset processes.

Responsibilities:

- Expose reporting views.
- Support dashboards and exports.
- Preserve role-based reporting access.
- Support audit and compliance reporting.

Future APIs:

- Request analytics APIs.
- Approval analytics APIs.
- Purchase order reporting APIs.
- Inventory and asset reporting APIs.
- Audit reporting APIs.

Future UI:

- Operational dashboard.
- Management dashboard.
- Audit reports.
- Filtered export views.

Dependencies:

- Procurement domain.
- Inventory domain.
- Asset domain.
- Audit domain.
