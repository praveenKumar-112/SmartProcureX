# SmartProcureX - Project Decisions

> Permanent record of architecture and design decisions.
> Append-only. Never remove prior decisions. Only append new ones.

---

## Decision Record Format

```
### AD-<n>
Decision : <one-line decision>
Reason   : <why>
Impact   : <files / modules affected>
Status   : Accepted | Superseded by AD-<m>
Date     : <YYYY-MM-DD>
```

---

### AD-1
Decision : Adopt SAP CAP Node.js + CDS as the application platform.
Reason   : CAP provides first-class OData V4, HANA persistence, draft handling, and a
           well-defined service/handler layer. Standard choice for SAP BTP applications.
Impact   : Whole project (package.json, db/, srv/).
Status   : Accepted
Date     : 2025-01-01

### AD-2
Decision : Use ES Modules (`"type": "module"`) and explicit `.js` extensions in imports.
Reason   : CAP v10 supports ES Modules natively. Modern semantics, static analysis
           friendly, elimination of require/module.exports boilerplate.
Impact   : All JavaScript files under srv/.
Status   : Accepted
Date     : 2025-01-01

### AD-3
Decision : Namespace scheme `smartprocurex.<domain>` (e.g. `smartprocurex.procurement`).
Reason   : Predictable, conflict-free entity naming; mirrors domain boundaries.
Impact   : All db/*.cds files.
Status   : Accepted
Date     : 2025-01-01

### AD-4
Decision : Every persistent entity uses `cuid` + `managed` aspects.
Reason   : Provides UUID key, plus createdAt/createdBy/modifiedAt/modifiedBy audit
           fields automatically maintained by CAP.
Impact   : All db entity definitions.
Status   : Accepted
Date     : 2025-01-01

### AD-5
Decision : Service layer exposes one service per domain (Identity, Supplier,
           Procurement, Warehouse, Asset, Platform).
Reason   : Domain isolation, separate OData endpoints, independent authorization scopes
           when XSUAA is introduced later.
Impact   : srv/*-service.cds, srv/handlers/*-handler.js.
Status   : Accepted
Date     : 2025-01-01

### AD-6
Decision : Reusable cross-handler logic lives in `srv/common/*.js`, never inside handlers.
Reason   : Single responsibility, no duplicated code, unit-testable.
Impact   : srv/common/{constants,errors,validation,utils,calculator,number-range}.js
           plus future per-domain helpers.
Status   : Accepted
Date     : 2025-01-15

### AD-7
Decision : Business document numbers are sequential and year-scoped via the
           `NumberRanges` entity (format `<PREFIX>-<YYYY>-<000000>`).
Reason   : Human-readable, gap-revealing (audit friendly), year-bound so the
           sequence resets annually and the table stays small.
Impact   : db/common/number-range.cds, srv/common/number-range.js.
Status   : Accepted
Date     : 2025-01-15

### AD-8
Decision : Decimal math is performed via the `calculator.js` integer-minor-unit library.
Reason   : JavaScript IEEE-754 floats drift on financial sums. Scaling to integer
           minor units and rounding half-up at scale 2 (amounts) / scale 3 (quantities)
           matches HANA decimal behaviour and prevents ledger drift.
Impact   : srv/common/calculator.js; any handler computing line totals or header totals.
Status   : Accepted
Date     : 2025-01-15

### AD-9
Decision : Error responses are issued exclusively via `req.reject(code, msg, target)`
           with HTTP codes from the shared `HTTP_STATUS` map.
Reason   : Produces consistent OData V4 error envelopes; no throwing of raw Errors
           from handlers.
Impact   : All handlers; srv/common/errors.js.
Status   : Accepted
Date     : 2025-01-15

### AD-10
Decision : Purchase Request header total (`totalAmount`) is recomputed via an `after`
           hook on every Create / Update / Delete of its child items, and a final
           recalculation is performed during `submitPurchaseRequest` as a defensive guard.
Reason   : Keeps the header total authoritative at all times without forcing the client
           to recompute it; the submit-time guard protects against transactions that
           modified items outside the service (e.g. direct DB seeding).
Impact   : srv/handlers/procurement-handler.js, srv/common/procurement-service-helpers.js.
Status   : Accepted
Date     : 2025-07-24

### AD-11
Decision : Per-domain reusable helpers go into `srv/common/<domain>-service-helpers.js`
           when shared by multiple actions of that domain.
Reason   : Keeps `srv/handlers/*.js` small and single-purpose; avoids duplicating
           read/recompute logic across submit/approve/cancel actions.
Impact   : Future srv/common/*-service-helpers.js files.
Status   : Accepted
Date     : 2025-07-24

### AD-12
Decision : Association-field validation in `before` hooks must tolerate both the
           foreign-key form (`requestedBy_ID`) and the inline-object form
           (`requestedBy: { ID }`); resolution is delegated to
           `associationId(...)` in srv/common/utils.js.
Reason   : CAP exposes association payloads as `<assoc>_ID` on POST, but clients (and
           deep-insert flows) may instead submit a `{ ID }` object. Validating only
           the inline form silently rejected every standard OData POST.
Impact   : srv/handlers/procurement-handler.js (PR-create); future handlers that
           validate association payloads.
Status   : Accepted
Date     : 2025-07-25

### AD-13
Decision : In `before` hooks for DELETE events, the targeted entity ID is read from
           the CQN where-clause via `itemIdFromDeleteRequest(req)`, never from
           `req.data.ID`.
Reason   : CAP leaves `req.data` empty on DELETE; the targeted key lives in
           `req.query.DELETE.from.ref[0].where`. Reading `req.data.ID` returned
           `undefined`, which caused the existing production guard to misfire and the
           delete-roll-up hook to silently no-op.
Impact   : srv/handlers/procurement-handler.js (item-DELETE) and any future
           before-DELETE hooks; the helper is in
           srv/common/procurement-service-helpers.js.
Status   : Accepted
Date     : 2025-07-25

### AD-14
Decision : E2E runtime validation against an in-memory sqlite database (via
           `cds.deploy(model).to('sqlite::memory:')` + `cds.serve('all')`) is the
           authoritative test gate for every coding ticket, in addition to
           `node --check` and `cds compile`.
Reason   : The CAP runtime behaves subtly (after-hook signatures, empty req.data
           on DELETE, entries() return shape) which static checks cannot catch.
           Project AD-12 and AD-13 were both discovered via this gate.
Impact   : All coding tickets going forward must include at least one E2E run.
Status   : Accepted
Date     : 2025-07-25

### AD-15
Decision : Removed `srv/handlers/purchase-request-item-handler.js`. The Purchase
           Request Item lifecycle is owned exclusively by the single handler
           `srv/handlers/procurement-handler.js`; no per-entity handler files
           exist within the Procurement bounded context.
Reason   : `purchase-request-item-handler.js` was an unreferenced duplicate of
           the same `before('CREATE', PurchaseRequestItems)` hook already in
           `procurement-handler.js:82-128`, with diverging status codes (400 vs
           409) and without decimal-safe `computeLineTotal`. It was never
           imported or auto-loaded by CAP (its filename did not match any
           service basename), but its presence violated §9 / §13 of
           CODING_STANDARDS.md, AD-5, and AD-11, and represented a latent DDD
           violation (child entity treated as a separate bounded context).
           Keeping the file would have been a real architectural defect, not
           a cosmetic concern.
Impact   : Deleted the file; updated PROJECT_TREE.md. No runtime behavior
           change; the existing 19-assertion E2E run remained green because
           the file was never invoked by CAP.
Status   : Accepted
Date     : 2025-07-25

### AD-16
Decision : Approver authorization for `approvePurchaseRequest` and
           `rejectPurchaseRequest` is configurable via the platform `Settings`
           table. The setting key `approverRoleCode` (defined in
           `constants.js:SETTING_KEYS`) overrides the role a User must hold
           to be considered an eligible approver. When no Setting row is
           present, the default role code `APPROVER` (from
           `constants.js:APPROVER_DEFAULTS.ROLE_CODE`) is used. A second
           setting `approverUserStatusRequired` (default `ACTIVE`) gates the
           user-status check.
Reason   : The identity domain has `User.role` plus a `status` flag but no
           auth layer is wired in dev (CAP mocked auth). A Settings-driven
           model keeps dev zero-config (every ACTIVE User with the default
           role is an approver) while letting production override the role
           code (e.g. to `MANAGER`) without a code change. Centralizing the
           keys in `SETTING_KEYS` prevents the III-defined-key drift that
           would otherwise break business rules silently.
Impact   : `constants.js` (new `SETTING_KEYS` + `APPROVER_DEFAULTS` maps);
           `procurement-service-helpers.js` (new `resolveApprover`,
           `readSetting` helpers); `procurement-handler.js` (auth checks
           in approve / reject). Cross-service reads of `IdentityService`
           and `PlatformService` entity references happen via the global
           `cds.services` lookup rather than `this.entities`, preserving
           the one-service-per-domain boundary (AD-5).
Status   : Accepted
Date     : 2025-07-25

### AD-17
Decision : Rejection and cancellation audit metadata lives on the
           `PurchaseRequest` header as the columns `rejectionReason`,
           `rejectedBy`, `rejectedAt`, `cancellationReason`, `cancelledBy`,
           `cancelledAt`. The dedicated `Approval` entity remains the system
           of record for the approve / reject decision audit (decision,
           approver, comments, timestamp, approvalLevel), while the header
           columns provide a single-row view of the last terminal transition
           without requiring a join.
Reason   : UIs and downstream consumers (PO creation, reporting) need quick
           access to the rejection / cancellation reason and actor. Storing
           them on the header row keeps the read path join-free for the
           common case; the `Approval` composition still carries the
           multi-step audit detail for the rare case where it is needed.
Impact   : `db/procurement.cds` (six new fields on PurchaseRequest);
           `procurement-service-helpers.js` (`transitionPurchaseRequestStatus`
           helper accepts an `extraFields` map so the status write and the
           audit write are a single atomic UPDATE, eliminating the
           possibility of a status transition without an audit);
           `procurement-handler.js` (reject / cancel supply the audit map).
Status   : Accepted
Date     : 2025-07-25

### AD-18
Decision : In `approvePurchaseRequest` and `rejectPurchaseRequest`,
           authorization checks (401 unauthenticated / 403 unauthorized)
           fire BEFORE the Purchase Request existence (404) and
           state-transition (409) checks.
Reason   : Checking state before authorization would leak the existence
           and current state of a Purchase Request to an unauthenticated
           or unauthorized caller (the caller could distinguish "PR X
           exists and is Submitted" from "PR X does not exist" purely via
           the error code). The auth-first ordering eliminates that
           information leak and follows the secure-by-default principle from
           OWASP API Top-10 (API3:2023 - Broken Object Property Level
           Authorization).
Impact   : `srv/handlers/procurement-handler.js` (approve / reject action
           ordering). The cancel action is exempt because it does not
           require a privileged role - any authenticated user may cancel,
           so its 404 may legitimately precede the auth context.
Status   : Accepted
Date     : 2025-07-25
