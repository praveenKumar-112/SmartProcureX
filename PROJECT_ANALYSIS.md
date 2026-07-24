# SmartProcureX — Project Analysis

> **Prepared by:** Senior SAP CAP Developer review
> **Date:** 2026-07-24
> **Scope:** Full read-only analysis of all project files — no code was modified.

---

## 1. Overall Architecture

SmartProcureX is a full-stack enterprise procurement and asset management platform built on
SAP Business Technology Platform (BTP). It follows a layered, domain-driven architecture:

```
+----------------------------------------------------------+
|                  Frontend Layer  (Planned)               |
|  Employee Portal | Manager Portal | Procurement | Admin  |
|                     SAPUI5 / SAP Fiori                   |
+-------------------------+--------------------------------+
                          |  OData / REST
+-------------------------v--------------------------------+
|              Service Layer  (NOT YET BUILT)              |
|         SAP CAP Node.js -- srv/  (currently empty)       |
+----------+-----------------------------------+-----------+
           |                                   |
+----------v-----------+         +-------------v----------+
| Local Development    |         | Production Persistence |
| SQLite (dev only)    |         | SAP HANA Cloud (HDI)   |
+----------------------+         +------------------------+
                          |
+-------------------------v--------------------------------+
|              Deployment Runtime  (Planned)               |
|        SAP BTP Cloud Foundry  +  MTA Packaging           |
+----------------------------------------------------------+
```

### Architecture Pattern Decisions

| Characteristic        | Decision                                                    |
| --------------------- | ----------------------------------------------------------- |
| Pattern               | Domain-Driven Design with bounded context separation        |
| Backend               | SAP CAP Node.js (ESM, `"type": "module"`)                  |
| Persistence — Dev     | SQLite via `@cap-js/sqlite`                                 |
| Persistence — Prod    | SAP HANA Cloud via `@cap-js/hana` and HDI container         |
| Deployment            | MTA on SAP BTP Cloud Foundry                                |
| Frontend              | SAPUI5 (four role-specific portals — planned, not built)   |
| Data Modeling         | CDS — Core Data Services                                    |
| API Exposure          | OData v4 (CAP default) + REST actions — planned             |

---

## 2. Technologies Used

### Runtime Dependencies

| Package          | Version Constraint | Installed | Role                                          |
| ---------------- | ------------------ | --------- | --------------------------------------------- |
| `@sap/cds`       | `^10`              | `10.0.4`  | CAP Node.js runtime and OData framework       |
| `@cap-js/hana`   | `^3`               | `3.0.1`   | SAP HANA Cloud adapter for production         |

### Development Dependencies

| Package           | Version Constraint | Installed | Role                                                      |
| ----------------- | ------------------ | --------- | --------------------------------------------------------- |
| `@cap-js/sqlite`  | `^3`               | `3.0.2`   | SQLite adapter for local development                      |
| `@sap/cds-dk`     | `^10`              | `10.0.5`  | CDS CLI tooling (cds watch, cds compile, cds build)       |

### Platform and Tooling

| Technology                         | Purpose                                     |
| ---------------------------------- | ------------------------------------------- |
| SAP BTP Cloud Foundry              | Deployment runtime                          |
| MTA (`mta.yaml`)                   | Multi-Target Application packaging          |
| HDI Container (`hdi-shared` plan)  | HANA DB artifact deployment                 |
| Git                                | Source control                              |
| VS Code                            | IDE (`.vscode/tasks.json` — cds watch task) |

### Planned Technologies (Not Yet Added)

| Technology                    | Planned Phase                       |
| ----------------------------- | ----------------------------------- |
| XSUAA or IAS                  | Phase 3 — Authentication            |
| Approuter                     | Phase 3 — Authentication            |
| SAP BTP Destination Service   | Future external integrations        |
| SAP BTP Connectivity Service  | Future on-premise integrations      |
| SAP Analytics Cloud           | Phase 11 — Reports                  |
| Application Logging Service   | Phase 14 — Production Readiness     |
| MBT (MTA Build Tool)          | Phase 12 — Deployment               |

---

## 3. Existing CDS Entities

All entities live in `db/`. There are **6 CDS files** and **zero CAP services**.

### 3.1 Identity Domain — `db/identity.cds`

Namespace: `smartprocurex.identity`

| Entity       | Key Fields                              | Notes                                |
| ------------ | --------------------------------------- | ------------------------------------ |
| `Department` | `departmentCode`, `departmentName`      | Parent of many `User`                |
| `Role`       | `roleCode`, `roleName`                  | Classification for many `User`       |
| `User`       | `employeeId`, `firstName`, `lastName`, `email` | Core actor entity; has `department` and `role` associations |

CDS Aspects applied: `cuid` (UUID PK), `managed` (adds `createdAt`, `modifiedAt`, `createdBy`, `modifiedBy`)

---

### 3.2 Supplier Domain — `db/supplier.cds`

Namespace: `smartprocurex.supplier`

| Entity            | Key Fields                    | Notes                                             |
| ----------------- | ----------------------------- | ------------------------------------------------- |
| `Supplier`        | `supplierCode`, `supplierName`| Has `gstNumber`, `taxNumber`; `status` = `ACTIVE` |
| `SupplierContact` | `firstName`, `lastName`       | Contact persons linked to a `Supplier`            |

CDS Aspects applied: `cuid`, `managed`

---

### 3.3 Procurement Domain — `db/procurement.cds`

Namespace: `smartprocurex.procurement`

| Entity                | Key Fields                            | Notes                                          |
| --------------------- | ------------------------------------- | ---------------------------------------------- |
| `PurchaseRequest`     | `requestNumber`, `requestDate`        | Central procurement entity; status enum-driven |
| `PurchaseRequestItem` | `itemName`, `quantity`, `unitPrice`   | Child items (Composition)                      |
| `Approval`            | `approvalLevel`, `decision`           | Multi-level approval records per request       |
| `PurchaseOrder`       | `poNumber`, `orderDate`               | Generated from an approved request             |
| `PurchaseOrderItem`   | `itemName`, `quantity`, `unitPrice`   | Line items owned by a PurchaseOrder            |

CDS Aspects applied: `cuid`, `managed`

Enum Types defined in this namespace:

| Enum Type               | Values                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| `PurchaseRequestStatus` | `Draft`, `Submitted`, `Approved`, `Rejected`, `ConvertedToPO`, `Cancelled` |
| `ApprovalDecision`      | `Pending`, `Approved`, `Rejected`, `Returned`                       |
| `PurchaseOrderStatus`   | `Created`, `Sent`, `PartiallyReceived`, `Received`, `Closed`, `Cancelled` |

---

### 3.4 Warehouse Domain — `db/warehouse.cds`

Namespace: `smartprocurex.warehouse`

| Entity          | Key Fields                              | Notes                                             |
| --------------- | --------------------------------------- | ------------------------------------------------- |
| `Warehouse`     | `warehouseCode`, `warehouseName`        | Storage location; `status` defaults to `ACTIVE`   |
| `GoodsReceipt`  | `goodsReceiptNumber`, `receivedDate`    | Links a `PurchaseOrder` to a `Warehouse`           |
| `InventoryItem` | `itemCode`, `itemName`, `quantityOnHand`| Stock record; supports `minimumStock`, `maximumStock` |

CDS Aspects applied: `cuid`, `managed`

---

### 3.5 Asset Domain — `db/asset.cds`

Namespace: `smartprocurex.asset`

| Entity            | Key Fields                        | Notes                                     |
| ----------------- | --------------------------------- | ----------------------------------------- |
| `AssetCategory`   | `categoryCode`, `categoryName`    | Classification of company assets          |
| `Asset`           | `assetCode`, `assetName`          | Trackable asset; links to `InventoryItem` |
| `AssetAssignment` | `assignedDate`, `assignmentStatus`| Assignment history per asset and employee |

CDS Aspects applied: `cuid`, `managed`

Enum Types defined in this namespace:

| Enum Type          | Values                                             |
| ------------------ | -------------------------------------------------- |
| `AssetStatus`      | `Available`, `Assigned`, `Maintenance`, `Retired`, `Disposed` |
| `AssignmentStatus` | `Assigned`, `Returned`, `Lost`, `Damaged`          |

---

### 3.6 Platform Support Domain — `db/platform-support.cds`

Namespace: `smartprocurex.platform`

| Entity         | Key Fields                              | Notes                                          |
| -------------- | --------------------------------------- | ---------------------------------------------- |
| `Notification` | `title`, `message`, `createdOn`         | User-facing notifications; `isRead` flag       |
| `AuditLog`     | `entityName`, `operation`, `performedOn`| Immutable audit trail; `oldValue`/`newValue` as `LargeString` |
| `Settings`     | `settingKey`, `settingValue`            | Application-level configurable settings        |

CDS Aspect applied: `cuid` only — `managed` intentionally omitted; explicit timestamp fields are used instead.

Enum Types defined in this namespace:

| Enum Type             | Values                                                     |
| --------------------- | ---------------------------------------------------------- |
| `NotificationType`    | `Info`, `Success`, `Warning`, `Error`                      |
| `NotificationPriority`| `Low`, `Medium`, `High`, `Critical`                        |
| `AuditOperation`      | `Create`, `Update`, `Delete`, `Login`, `Logout`, `Approve`, `Reject` |

---

## 4. Existing Services

> **Current status: ZERO CAP services exist.**

The `srv/` directory is **completely empty**. No `.cds` service definition files, no `.js`
service handler files, and no business logic have been written. The application cannot be
started, called, or tested as a running service today.

This is the single most significant implementation gap in the project.

---

## 5. Relationships Between Entities

### Full Relationship Map

```
smartprocurex.identity  (foundational — no external dependencies)
══════════════════════════════════════════════════════════
  Department ──── Association(1:N) ───► User
  Role       ──── Association(1:N) ───► User

smartprocurex.supplier  (independent — no external dependencies)
══════════════════════════════════════════════════════════
  Supplier ──── Association(1:N) ───► SupplierContact

smartprocurex.procurement  (depends on: identity, supplier)
══════════════════════════════════════════════════════════
  PurchaseRequest ──── Composition(1:N) ───► PurchaseRequestItem
  PurchaseRequest ──── Composition(1:N) ───► Approval
  PurchaseRequest ──── Composition(1:1) ───► PurchaseOrder
  PurchaseOrder   ──── Composition(1:N) ───► PurchaseOrderItem

  PurchaseRequest.requestedBy ───► identity.User
  PurchaseRequest.department  ───► identity.Department
  Approval.approver           ───► identity.User
  PurchaseOrder.supplier      ───► supplier.Supplier

smartprocurex.warehouse  (depends on: identity, procurement)
══════════════════════════════════════════════════════════
  Warehouse ──── Composition(1:N) ───► GoodsReceipt
  Warehouse ──── Composition(1:N) ───► InventoryItem

  GoodsReceipt.purchaseOrder ───► procurement.PurchaseOrder
  GoodsReceipt.receivedBy    ───► identity.User

smartprocurex.asset  (depends on: identity, warehouse)
══════════════════════════════════════════════════════════
  AssetCategory ──── Association(1:N) ───► Asset
  Asset         ──── Composition(1:N) ───► AssetAssignment

  Asset.inventoryItem      ───► warehouse.InventoryItem
  AssetAssignment.employee ───► identity.User

smartprocurex.platform  (depends on: identity)
══════════════════════════════════════════════════════════
  Notification.recipient ───► identity.User
  AuditLog.performedBy   ───► identity.User
```

### Cross-Domain Dependency Summary

| Domain       | Depends On                    |
| ------------ | ----------------------------- |
| `identity`   | None (root domain)            |
| `supplier`   | None (independent domain)     |
| `procurement`| `identity`, `supplier`        |
| `warehouse`  | `identity`, `procurement`     |
| `asset`      | `identity`, `warehouse`       |
| `platform`   | `identity`                    |

---

## 6. Project Strengths

### S1 — Clean Domain Separation
All six domains are modeled in individual CDS files with distinct namespaces. There is no
entity sprawl. Each file is independently readable and maintainable.

### S2 — Correct CAP Conventions Applied
`cuid` and `managed` are used correctly and consistently. The deliberate omission of `managed`
from platform support entities (using explicit timestamp fields instead) demonstrates advanced
CAP design judgment and avoids redundant audit field duplication.

### S3 — Enum-Driven State Machines
All lifecycle statuses (`PurchaseRequestStatus`, `PurchaseOrderStatus`, `AssetStatus`,
`ApprovalDecision`, `AssignmentStatus`) are modeled as CDS enums. This prevents free-text
status values at the persistence level and makes state transitions auditable and type-safe.

### S4 — Composition vs. Association Applied Correctly
The model correctly uses `Composition of many` for child ownership (line items, approvals,
assignments) and regular `Association` for cross-domain references. This enables correct CAP
deep-insert, cascade delete, and draft handling behavior.

### S5 — Complete End-to-End Domain Coverage
The data model spans the full business workflow: Request → Approval → PurchaseOrder →
GoodsReceipt → InventoryItem → Asset → AssetAssignment. This is a complete procurement
lifecycle data model.

### S6 — Production-Ready MTA Deployment Skeleton
`mta.yaml` correctly configures a CAP Node.js service module, HANA DB deployer module, and
HDI container resource with the `hdi-shared` plan. Ready for CF deployment once services and
authentication are added.

### S7 — Comprehensive Architecture Documentation
The `docs/` folder contains 8 architecture documents covering: business requirements, system
architecture, business workflow, domain model, API strategy, coding standards, module
breakdown, and project roadmap. The project is better documented than most teams achieve.

### S8 — Dual-Persistence Strategy Ready
`@cap-js/sqlite` (dev) and `@cap-js/hana` (prod) packages are both installed. The project
switches between them via CDS configuration with no code changes required.

### S9 — All CDS Models Compile Without Errors
Per implementation reports, `cds compile db --to csn` and `cds compile db --to sql` passed
for all domain files. The CDS model is syntactically and semantically valid.

### S10 — ESM Module Support
The project uses `"type": "module"` in `package.json`, making it compatible with modern
Node.js ESM patterns required by `@sap/cds` v10.

---

## 7. Missing Implementation (Gap Analysis)

### 7.1 Service Layer — CRITICAL GAP

| Missing Item                          | Impact                                                   |
| ------------------------------------- | -------------------------------------------------------- |
| No `.cds` service definitions in `srv/` | Zero API endpoints exist; nothing is callable            |
| No `.js` service handlers              | No business logic, validation, or event handling         |
| No `@restrict` or `@requires` annotations | No authorization enforcement anywhere                |
| No custom CAP actions or functions     | No state transitions (submit, approve, reject, etc.)     |

### 7.2 Business Logic — CRITICAL GAP

| Missing Item                                  | Impact                                                     |
| --------------------------------------------- | ---------------------------------------------------------- |
| No status transition guards                   | Any client can write any status value freely               |
| No `totalPrice` / `totalAmount` calculation   | Line item totals are never computed on save                |
| No approval routing rules                     | No logic determines who receives a request for approval    |
| No uniqueness constraints enforced            | `requestNumber`, `poNumber`, `employeeId`, `email` can duplicate |
| No GR → inventory quantity update             | Receiving goods does not update `InventoryItem.quantityOnHand` |
| No partial approval amount/quantity modeling  | `Approval` entity lacks approved quantity or partial value field |

### 7.3 Authentication and Authorization — CRITICAL GAP

| Missing Item                        | Impact                                             |
| ----------------------------------- | -------------------------------------------------- |
| No XSUAA or IAS configuration       | APIs are completely open to anonymous calls        |
| No `xs-security.json`               | No role scopes or templates defined for BTP        |
| No approuter or managed router      | No authenticated entry point for UI applications   |
| No `@requires` on service entities  | All data would be readable and writable by anyone  |

### 7.4 Frontend (UI) — NOT STARTED

| Missing Item                        | Impact                                             |
| ----------------------------------- | -------------------------------------------------- |
| `app/` directory is empty           | No UI exists for any of the four planned portals   |
| No SAPUI5 manifests or views        | Employee, Manager, Procurement, Admin — all missing |
| No Fiori Launchpad configuration    | No role-based entry point for end users            |

### 7.5 Seed / Sample Data — MISSING

| Missing Item                            | Impact                                               |
| --------------------------------------- | ---------------------------------------------------- |
| No CSV files under `db/data/`           | `cds watch` runs but serves empty data               |
| No demo departments, roles, users       | Cannot manually test any procurement workflow locally |
| No demo suppliers or inventory items    | Procurement workflow cannot be tested end-to-end     |

### 7.6 Structural and Supporting Gaps

| Missing Item                          | Impact                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| No `cds.requires` in `package.json`   | CDS db binding must be configured before running locally |
| No `GoodsReceiptItem` entity          | GR captures header only; no per-PO-line receipt detail  |
| No `Budget` / cost center entity      | No budget-aware approval rules possible yet             |
| No file attachment support            | No documents can be attached to purchase requests       |
| No CDS reporting views or projections | No analytical entities for dashboards or reports        |
| No messaging / event mesh             | No async notification triggering infrastructure         |

---

## 8. Recommended Next Development Phase

The data model layer is complete and validated. The entire service, business logic, UI,
authentication, and deployment execution layer is yet to be built.

The recommended next phase is: **Build the CAP Service Layer Foundation**.

### Step 1 — CDS Database Configuration

Add `cds` configuration to `package.json` so `cds watch` can start:

```json
"cds": {
  "requires": {
    "db": {
      "kind": "sqlite",
      "credentials": { "database": "db.sqlite" }
    }
  }
}
```

### Step 2 — Seed CSV Files

Create `db/data/` with CSV files to populate reference data for local development:

- `smartprocurex.identity-Department.csv`
- `smartprocurex.identity-Role.csv`
- `smartprocurex.identity-User.csv`
- `smartprocurex.supplier-Supplier.csv`
- `smartprocurex.warehouse-Warehouse.csv`

### Step 3 — CAP Service Definitions in `srv/`

Create one CDS service file per domain:

| File                         | Service Name          | Entities Exposed                                                         |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------ |
| `srv/identity-service.cds`   | `IdentityService`     | `Department`, `Role`, `User`                                             |
| `srv/supplier-service.cds`   | `SupplierService`     | `Supplier`, `SupplierContact`                                            |
| `srv/procurement-service.cds`| `ProcurementService`  | `PurchaseRequest`, `PurchaseRequestItem`, `Approval`, `PurchaseOrder`, `PurchaseOrderItem` |
| `srv/warehouse-service.cds`  | `WarehouseService`    | `Warehouse`, `GoodsReceipt`, `InventoryItem`                             |
| `srv/asset-service.cds`      | `AssetService`        | `AssetCategory`, `Asset`, `AssetAssignment`                              |
| `srv/platform-service.cds`   | `PlatformService`     | `Notification`, `AuditLog`, `Settings`                                   |

### Step 4 — Core Business Logic Handlers

Priority order for handler implementation:

| Priority | Handler                      | Trigger Event              | Logic                                                   |
| -------- | ---------------------------- | -------------------------- | ------------------------------------------------------- |
| 1        | Auto-number generation       | `BEFORE CREATE`            | Generate `requestNumber` and `poNumber` sequences       |
| 2        | Line total calculation       | `BEFORE UPSERT` on items   | Compute `totalPrice = quantity * unitPrice`             |
| 3        | Header total rollup          | `AFTER UPSERT` on items    | Sum item totals into `PurchaseRequest.totalAmount`      |
| 4        | Status transition guard      | `BEFORE UPDATE`            | Reject invalid status transitions                       |
| 5        | Submit action                | Custom CAP action          | `Draft → Submitted` with validation completeness check  |
| 6        | Approve / Reject action      | Custom CAP action          | Manager decision: `Submitted → Approved` or `Rejected`  |
| 7        | Convert to PO action         | Custom CAP action          | `Approved → ConvertedToPO`; auto-create PurchaseOrder   |
| 8        | Goods receipt inventory hook | `AFTER CREATE` on GR       | Update `InventoryItem.quantityOnHand`                   |

### Step 5 — Authentication (Phase 3)

Once services work locally:

1. Create `xs-security.json` with role templates and scopes
2. Add XSUAA service resource to `mta.yaml`
3. Add approuter module to `mta.yaml`
4. Add `@requires` and `@restrict` annotations to all service entities

### Step 6 — SAPUI5 Applications (Phase 5+)

Build one portal at a time, in this priority order:

1. **Employee Portal** — Purchase request creation and status tracking (highest user count)
2. **Manager Portal** — Approval inbox and decision dialog (critical for workflow)
3. **Admin Portal** — Reference data maintenance (required for operations)
4. **Procurement Officer Portal** — PO management and goods receipt (full lifecycle)

---

## 9. Phase Completion Status

| Phase | Name                          | Status                                  |
| ----- | ----------------------------- | --------------------------------------- |
| 1     | Foundation                    | COMPLETE                                |
| 2     | Architecture and Documentation| COMPLETE                                |
| 3     | Authentication                | NOT STARTED                             |
| 4     | Supplier Domain               | Data Model Done — No Service            |
| 5     | Purchase Requests             | Data Model Done — No Service            |
| 6     | Approval Workflow             | Data Model Done — No Service            |
| 7     | Purchase Orders               | Data Model Done — No Service            |
| 8     | Inventory / Warehouse         | Data Model Done — No Service            |
| 9     | Assets                        | Data Model Done — No Service            |
| 10    | Notifications                 | Data Model Done — No Service            |
| 11    | Reports                       | NOT STARTED                             |
| 12    | Deployment                    | NOT STARTED (mta.yaml skeleton ready)   |
| 13    | Testing                       | NOT STARTED                             |
| 14    | Production Readiness          | NOT STARTED                             |

---

## 10. Open Architecture Questions Requiring Resolution

| # | Question                                                                  | Blocks                           |
| - | ------------------------------------------------------------------------- | -------------------------------- |
| 1 | Authentication provider: XSUAA or IAS?                                    | Phase 3                          |
| 2 | Approval routing: by department, amount threshold, level, or all?         | Phase 6 handler implementation   |
| 3 | Supplier master: owned internally or synchronized from SAP ERP?           | Phase 4 service design           |
| 4 | Purchase orders: created in SmartProcureX only or replicated to ERP?      | Phase 7 service design           |
| 5 | Notification delivery: email, SAP Build Work Zone, Teams, or combination? | Phase 10 implementation          |
| 6 | Reporting: embedded CAP projections or SAP Analytics Cloud?               | Phase 11 implementation          |
| 7 | Multitenancy: is it required for the target organization model?           | Phase 3 security architecture    |
| 8 | Audit retention: what are the compliance and data retention policies?      | Platform domain configuration    |

---

*This analysis was produced from a complete read-only review of all project source files,
documentation, CDS models, package configuration, and deployment manifests.*
*No source files were modified.*
