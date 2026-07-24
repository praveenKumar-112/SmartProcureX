# System Architecture

## High-Level Architecture

SmartProcureX follows a layered SAP BTP architecture:

- SAPUI5 frontend applications provide role-specific user experiences.
- SAP CAP Node.js provides service orchestration, validation, workflow state management, and integration boundaries.
- SQLite supports local development.
- SAP HANA Cloud provides production persistence through an HDI container.
- SAP BTP Cloud Foundry hosts the CAP runtime and database deployer.
- MTA packages and deploys the complete application landscape.

## Component Diagram

```text
+----------------------+     +----------------------+
| Employee Portal      |     | Manager Portal       |
| SAPUI5               |     | SAPUI5               |
+----------+-----------+     +----------+-----------+
           |                            |
+----------v-----------+     +----------v-----------+
| Procurement Portal   |     | Admin Portal         |
| SAPUI5               |     | SAPUI5               |
+----------+-----------+     +----------+-----------+
           |                            |
           +-------------+--------------+
                         |
                         v
              +----------------------+
              | SAP CAP Node.js      |
              | Service Layer        |
              +----------+-----------+
                         |
       +-----------------+-----------------+
       |                                   |
       v                                   v
+--------------+                  +------------------+
| SQLite       |                  | SAP HANA Cloud   |
| Local Dev    |                  | Production HDI   |
+--------------+                  +------------------+
                         |
                         v
              +----------------------+
              | SAP BTP CF + MTA     |
              | Deployment Runtime   |
              +----------------------+
```

## Frontend Architecture

The frontend will use SAPUI5 with four role-specific applications:

| Application | Purpose |
| --- | --- |
| Employee Portal | Request creation, request tracking, and personal asset visibility. |
| Manager Portal | Approval worklist, request review, partial approval, and rejection. |
| Procurement Portal | Procurement review, supplier context, purchase order preparation, and goods receipt coordination. |
| Admin Portal | Configuration, reference data, role administration, and operational oversight. |

Frontend principles:

- Keep each portal focused on role-specific tasks.
- Use SAP Fiori design guidelines for consistency and accessibility.
- Consume CAP services through stable APIs.
- Avoid duplicating business rules in the UI.
- Use UI-level validation for usability, while enforcing rules in CAP.
- Plan future shell integration with SAP Build Work Zone or central launchpad if required.

## Backend Architecture

The backend is SAP CAP Node.js.

Responsibilities:

- Expose business APIs for procurement, inventory, assets, reporting, notifications, and administration.
- Own validation, authorization hooks, workflow state changes, and transactional consistency.
- Encapsulate domain logic behind service boundaries.
- Provide integration abstraction for future external systems.
- Support local development with SQLite and production deployment with SAP HANA Cloud.

Backend design principles:

- Use CAP service boundaries aligned to business domains.
- Keep domain-specific behavior close to the relevant service layer.
- Use declarative CAP features where appropriate before adding custom logic.
- Separate technical concerns such as security, logging, and integration adapters.
- Preserve audit-relevant state transitions.

## Database Architecture

Local development:

- SQLite is used for lightweight development and fast feedback.
- Local SQLite files must remain excluded from Git.

Production:

- SAP HANA Cloud is used through an HDI container.
- MTA deploys the database artifacts using a dedicated DB deployer module.
- HANA Cloud is the source of truth for transactional procurement, inventory, asset, reporting, and audit data.

Database principles:

- Model business ownership by domain.
- Avoid cross-domain data duplication unless explicitly required for reporting.
- Plan technical audit fields and lifecycle status fields before entity implementation.
- Design for reporting needs without compromising transactional integrity.

## Deployment Architecture

Deployment target:

- SAP BTP Cloud Foundry.

Packaging:

- MTA with `mta.yaml`.

Current deployment modules:

- CAP service module for Node.js runtime.
- HANA DB deployer module.
- SAP HANA HDI container resource.

Future deployment additions may include:

- Approuter or managed application router.
- XSUAA or IAS configuration.
- Destination service.
- Connectivity service.
- Application Logging service.
- HTML5 Application Repository if SAPUI5 apps are deployed as HTML5 apps.

## Integration Points

Potential future integrations:

| Integration | Purpose |
| --- | --- |
| Identity Provider | Enterprise authentication and role mapping. |
| SAP S/4HANA or ERP | Supplier, purchasing, finance, and material master synchronization. |
| SAP BTP Destination Service | Secure destination management for outbound calls. |
| SAP BTP Connectivity Service | Secure on-premise connectivity if required. |
| Notification Channels | Email, SAP Build Work Zone, Microsoft Teams, or enterprise messaging. |
| Reporting Platforms | SAP Analytics Cloud or embedded analytical views. |
| Supplier Systems | Purchase order communication and supplier confirmation. |

## Future Scalability

Scalability strategies:

- Keep portals independently deployable or packageable as the UI footprint grows.
- Split CAP services by bounded domain when service complexity increases.
- Use asynchronous messaging for long-running or cross-system events.
- Add caching only after measurable performance needs.
- Introduce multitenancy only if the product must serve multiple legal entities or customers.
- Add read-optimized reporting projections when reporting volume grows.
- Use SAP BTP observability services for runtime monitoring and operational diagnostics.
