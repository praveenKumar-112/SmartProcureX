# SmartProcureX - Project Progress

> Source of truth for all development. Read before writing any code.

---

## Completed Modules

- **Phase 1 - Database Layer**: All domain schemas defined and compiling cleanly.
  - `db/schema.cds`, `db/identity.cds`, `db/supplier.cds`, `db/procurement.cds`,
    `db/warehouse.cds`, `db/asset.cds`, `db/platform-support.cds`,
    `db/common/number-range.cds`, `db/data/smartprocurex.common-NumberRanges.csv`
- **Phase 1 - Service Layer (definitions only)**: Six OData V4 services.
  - `srv/identity-service.cds`, `srv/supplier-service.cds`, `srv/warehouse-service.cds`,
    `srv/asset-service.cds`, `srv/procurement-service.cds`, `srv/platform-service.cds`
- **Phase 1 - Number Range utility**: `srv/common/number-range.js` (year-aware sequence).
- **Phase 1 - Constants**: `srv/common/constants.js` (document prefixes, PR statuses).
- **Phase 2 - Constants extended**: `SUBMITTED` status added.
- **Phase 2 - Error library**: `srv/common/errors.js` (HTTP_STATUS + reject factories).
- **Phase 2 - Validation library**: `srv/common/validation.js` (pure checks + require* rejecters).
- **Phase 2 - Utilities library**: `srv/common/utils.js` (dates, ids, collections, tryAsync).
- **Phase 2 - Calculator library**: `srv/common/calculator.js` (decimal-safe monetary math).
- **Phase 3 - Purchase Request**: Create validation (association payload normalized, number
  generated, Draft defaulted, requestedBytes mandatory via associationId helper).
- **Phase 3 - Purchase Request Items**: Create / Update / Delete handlers with Draft-state guard,
  decimal-safe line totals via calculator.computeLineTotal.
- **Phase 3 - Submission workflow**: `submitPurchaseRequest` action (Draft -> Submitted,
  item-count validation, defensive final roll-up before transition).
- **Phase 3 - Total Roll-up TICKET-004**: Header `totalAmount` recomputed atomically after every
  PurchaseRequestItem CREATE / UPDATE / DELETE via `after` hooks, and one final time at submit.
  Bug-fix: PR-create association-FK normalization; DELETE hook target-key resolution from CQN.
- **Phase 3 - Procurement service helpers**: `srv/common/procurement-service-helpers.js`
  (recalculatePurchaseRequestTotal, resolveParentPurchaseRequestId,
  parentPurchaseRequestIdFromCreate, itemIdFromDeleteRequest).
- **Phase 3 - Approval Workflow TICKET-005**: `approvePurchaseRequest` and `rejectPurchaseRequest`
  actions implemented with Settings-driven approver authorization (AD-16), duplicate-approval
  prevention, Approval audit-history rows, atomic status transition, and information-leak-safe
  authorization-before-state ordering.
- **Phase 3 - Purchase Request Cancellation TICKET-005**: `cancelPurchaseRequest` implemented
  with cancellable-state guard (Draft / Submitted / Approved), audit fields
  (cancellationReason / cancelledBy / cancelledAt) persisted atomically with the status
  transition (AD-17).
- **Phase 4 - Purchase Order Module TICKET-006**: Full PO lifecycle implemented.
  `convertToPurchaseOrder` (Approved PR -> PO with auto-copied items, decimal-safe header
  roll-up, PR transitions to ConvertedToPO). PO before-CREATE validates supplier existence +
  ACTIVE status + orderDate / expectedDeliveryDate ordering. POItem before-CREATE validates
  quantity / unitPrice and computes decimal-safe lineTotal. POItem UPDATE / DELETE guarded on
  PO state. `sendPurchaseOrder` (Created -> Sent, sentBy / sentAt audit). `cancelPurchaseOrder`
  (Created / Sent -> Cancelled, reason + cancelledBy + cancelledAt audit). `closePurchaseOrder`
  (Sent / PartiallyReceived / Received -> Closed). Approval entity re-used for PO thanks to
  nullable `purchaseOrder` association (AD-19).
- **Phase 4 - Goods Receipt TICKET-006**: Full GR lifecycle. GR before-CREATE validates PO
  exists + in valid state (Sent / PartiallyReceived) + warehouse ACTIVE + auto-generates
  goodsReceiptNumber. GRItem before-CREATE enforces over-receipt prevention
  (cumulative received across all Draft + Posted GRs <= ordered). `postGoodsReceipt`
  atomically applies Inbound `InventoryTransaction` ledger rows + updates InventoryItem balance
  + increments PurchaseOrderItem receivedQuantity + re-evaluates PO status (Sent /
  PartiallyReceived / Received). `cancelGoodsReceipt` reverses every prior movement with
  matching Outbound transactions and decrements POItem receivedQuantity (Cancelled is
  terminal). DELETE prevention on Posted GRs. Multiple partial receipts against the same PO
  are supported.
- **Phase 4 - Inventory Module TICKET-006**: Inventory ledger via `applyInventoryMovement`
  (Inbound / Outbound / Transfer / Adjustment / Reserved / Unreserved / Damaged). Actions
  `adjustInventory`, `reserveInventory`, `unreserveInventory`, `markDamaged`,
  `transferInventory` with validation (positive quantity, sufficient on-hand / reserved /
  unreserved, source != destination, destination warehouse ACTIVE). Auto-creates destination
  InventoryItem on stock transfer when itemCode not yet present. InventoryItem duplicate-code
  prevention per warehouse. Warehouse duplicate-code prevention. Warehouse DELETE guard while
  inventory is present.
- **Phase 4 - Warehouse Helpers TICKET-006**: `srv/common/warehouse-service-helpers.js` with
  `applyInventoryMovement`, `getInventoryItem`, `findInventoryItemByCode`,
  `createInventoryItem`, `getGoodsReceiptWithDetails`, `syncPurchaseOrderReceiptStatus`,
  `incrementPurchaseOrderItemReceived`. All tx+entities signature per AD-11.
- **Phase 5 - Asset Management TICKET-007**: Full Asset lifecycle. Extended
  `db/asset.cds` with lifecycle audit fields (assignedTo / assignedAt / currentAssignment /
  retiredBy / retiredAt / retirementReason / disposedBy / disposedAt / disposalReason) and
  assignment audit (assignedBy / returnedBy / returnRemarks). Asset CRUD with duplicate-code
  guard, inventory-link validation, warranty-after-purchase guard, assetCode immutability.
  AssetCategory CRUD with duplicate-code guard. Lifecycle actions `assignAsset`,
  `returnAsset`, `transferAsset`, `retireAsset`, `disposeAsset` with full state-transition
  guards (Available -> Assigned -> Available; Available/Assigned/Maintenance -> Retired ->
  Disposed). State-machine enforcement (e.g. cannot retire an Assigned asset without first
  returning it). DELETE restricted to Disposed assets only.
- **Phase 5 - Asset Helpers TICKET-007**: `srv/common/asset-service-helpers.js` with
  `getAsset`, `getActiveAssignment`, `hasActiveAssignment`, `transitionAssetStatus`,
  `recordAssignment`, `getInventoryItemForAsset`, `resolveUser`, `assetCodeExists`,
  `categoryCodeExists`. All tx+entities signature per AD-11.
- **Phase 5 - Notifications TICKET-008**: Notification framework complete.
  `db/platform-support.cds` finalized with notification enums + lifecycle flags.
  `srv/common/notification-service-helpers.js` implements notification creation,
  read/unread state transitions, soft-delete, unread counts, direct send,
  department/role broadcast expansion, and business-event auto-emission.
  `srv/handlers/notification-handler.js` implements CRUD guards, filtering,
  pagination, mark-read actions, deleteNotification, sendNotification,
  broadcastToDepartment, and broadcastToRole. Procurement / Warehouse / Asset
  handlers emit workflow notifications atomically with the originating
  transaction. `srv/common/db-run.js` is in place for sqlite cross-service
  deadlock avoidance. Notification E2E now passes 59 / 59 assertions.

---

## Current Ticket

(none - TICKET-009 complete; awaiting next assignment)

---

## Files Created

- `PROJECT_DECISIONS.md` (this session - permanent architecture decisions AD-1 .. AD-11)
- `PROJECT_TREE.md` (this session - live project structure)
- `CODING_STANDARDS.md` (this session - all coding conventions for the project)
- `srv/common/procurement-service-helpers.js` (procurement domain reusable helpers)
- `srv/common/warehouse-service-helpers.js` (warehouse domain reusable helpers, TICKET-006)
- `srv/warehouse-service.js` (re-export of warehouse handler, TICKET-006)
- `srv/common/asset-service-helpers.js` (asset domain reusable helpers, TICKET-007)
- `srv/asset-service.js` (re-export of asset handler, TICKET-007)
- `srv/common/db-run.js` (shared cross-service `cds.db.run` wrapper, TICKET-008)
- `srv/common/notification-service-helpers.js` (notification domain reusable helpers, TICKET-008)
- `srv/platform-service.js` (re-export of notification handler, TICKET-008)
- `test/notification-e2e.test.js` (Notification E2E acceptance suite, TICKET-008)
- `srv/reporting-service.cds` (ReportingService OData V4 interface, TICKET-009)
- `srv/reporting-service.js` (ReportingService entry point re-export, TICKET-009)
- `srv/handlers/reporting-handler.js` (all 13 reporting function handlers, TICKET-009)
- `srv/common/reporting-service-helpers.js` (cross-domain aggregation helpers, TICKET-009)
- `test/reporting-e2e.test.js` (Reporting E2E acceptance suite, 121 assertions, TICKET-009)

---

## Files Modified

This ticket (TICKET-008):
- `srv/common/notification-service-helpers.js`
  - implemented notification create/read/update helpers, unread counts,
    soft-delete, broadcast expansion, and business-event auto-emission
- `srv/common/db-run.js`
  - centralized sqlite-safe cross-service `cds.db.run` wrapper used by the
    notification framework and related cross-service helpers
- `srv/handlers/notification-handler.js`
  - implemented notification CRUD guards, mark read/unread actions,
    mark-all-read, deleteNotification, sendNotification, broadcast actions,
    and default soft-delete filtering
- `srv/handlers/procurement-handler.js`
  - integrated Purchase Request / Purchase Order notification emission
- `srv/handlers/warehouse-handler.js`
  - integrated Warehouse / Goods Receipt / Inventory notification emission
  - **bug fix**: Warehouse CREATE after-hook now resolves the created
    warehouse ID from `results.ID ?? req.data.ID`, fixing the final missing
    WarehouseEvent notification on CAP INSERT dispatch
- `srv/handlers/asset-handler.js`
  - integrated Asset lifecycle notification emission
- `srv/common/number-range.js`
  - switched number-range access to the shared cross-service db facade
- `srv/common/warehouse-service-helpers.js`
  - routed cross-service Procurement reads/writes through the shared db facade
- `test/notification-e2e.test.js`
  - added 59-assertion Notification E2E suite covering CRUD, actions,
    filtering, pagination, broadcast, and auto-emission

Previous tickets:
- `srv/common/errors.js` (TICKET-003)
- `srv/common/validation.js` (TICKET-003)
- `srv/common/utils.js` (TICKET-003)
- `srv/common/calculator.js` (TICKET-003)
- `srv/common/constants.js` (TICKET-002 - SUBMITTED added)

---

## Pending Modules

- **Phase 6 - Testing / Performance** - not started.

---

## Database Status

- **State**: Stable. All domains modelled with `cuid` + `managed` aspects.
- **Compile**: `cds compile db/schema.cds` -> OK
- **HANA readiness**: Yes (standard CAP types, no SQLite-only constructs).
- **Open DDL gaps**: none.

---

## Service Status

- **Defined services**: 7 (Identity, Supplier, Warehouse, Asset, Procurement, Platform, Reporting).
- **Procurement actions declared**: `submitPurchaseRequest`, `approvePurchaseRequest`,
  `rejectPurchaseRequest`, `cancelPurchaseRequest`, `convertToPurchaseOrder`,
  `sendPurchaseOrder`, `cancelPurchaseOrder`, `closePurchaseOrder`.
- **Warehouse actions declared**: `adjustInventory`, `reserveInventory`,
  `unreserveInventory`, `markDamaged`, `transferInventory`, `postGoodsReceipt`,
  `cancelGoodsReceipt`.
- **Platform actions declared**: `markNotificationRead`, `markNotificationUnread`,
  `markAllNotificationsRead`, `deleteNotification`, `getUnreadNotificationCount`,
  `sendNotification`, `broadcastToDepartment`, `broadcastToRole`.
- **Reporting functions declared**: `getDashboardSummary`, `getPurchaseRequestSummary`,
  `getDepartmentSpendAnalysis`, `getApprovalPerformance`, `getPurchaseOrderSummary`,
  `getSupplierSpendAnalysis`, `getGoodsReceiptSummary`, `getWarehouseInventorySummary`,
  `getInventoryMovementReport`, `getAssetUtilizationReport`, `getAssetLifecycleReport`,
  `getNotificationStatistics`, `getAuditSummary`.
- **Implemented actions**: all of the above (PR lifecycle + PO lifecycle + Goods Receipt +
  Inventory + Warehouse + Asset + Notification actions + all 13 Reporting functions).
- **Stub actions**: (none).
- **Empty handlers**: (none).
- **Compile**: `cds compile db/schema.cds` + all 7 service definitions -> OK
- **End-to-end**: 73 assertions covering the full PR -> PO -> GR -> Inventory pipeline
  (PR submission + approval + conversion, PO send/close/cancel, GR partial + complete +
  over-receipt prevention, GR cancellation + inventory reversal, reserve/unreserve/damage/
  adjust/transfer with over-quantity guards, warehouse duplicate-code, delete-with-inventory
  guard, posted-GR delete guard, InventoryItem duplicate-code guard, POItem add to
  Cancelled-PO guard), plus 59 assertions covering the full Notification framework
  (CRUD, read/unread transitions, broadcast, filters, pagination, and auto-emission),
  plus 121 assertions covering all 13 Reporting functions with date/status/UUID filtering
  and invalid-UUID rejection cases.

---

## Business Logic Status

| Domain                    | Status                                |
|---------------------------|---------------------------------------|
| Purchase Request Create   | Done (incl. assoc normalization)      |
| Purchase Request Items    | Done (C/U/D validated, roll-up fires) |
| PR Submission             | Done                                  |
| PR Total Roll-up          | Done (TICKET-004)                     |
| PR Approval               | Done (TICKET-005)                     |
| PR Approval History       | Done (TICKET-005)                     |
| PR Cancellation           | Done (TICKET-005)                     |
| Purchase Order            | Done (TICKET-006 - lifecycle + items + supplier) |
| Purchase Order Total Roll-up | Done (TICKET-006 - after-hooks)    |
| Goods Receipt             | Done (TICKET-006 - create/post/cancel/over-receipt/cumulative) |
| Inventory                 | Done (TICKET-006 - ledger + reserve/unreserve/damage/adjust/transfer) |
| Warehouse                 | Done (TICKET-006 - CRUD + guards)     |
| Assets                    | Done (TICKET-007 - CRUD + lifecycle + audit)    |
| Notifications             | Done (TICKET-008 - framework + E2E green) |
| Reporting                 | Done (TICKET-009 - 13 functions + E2E green)  |

---

## Overall Completion %

**82%**

(Breakdown: Phase 1 foundation = 100%; Phase 2 common = 100%;
Phase 3 PR lifecycle = 100%; Phase 4 PO + GR + Inventory + Warehouse = 100%;
Phase 5 Asset = 100%, Notifications = 100%; Phase 6 Reporting = 100%; Phase 7 = 0%.
Weighted across the 7-phase plan.)

---

## Change Log

- TICKET-003 (complete): shared common libraries implemented.
- ARCH-001 (complete): Removed orphan duplicate
  `srv/handlers/purchase-request-item-handler.js`. See AD-15.
- TICKET-004 (complete): Purchase Request Total Roll-up.
- TICKET-005 (complete): Approval Workflow + Cancellation.
- TICKET-006 (complete): Purchase Order + Goods Receipt + Inventory + Warehouse.
  - Extended `db/procurement.cds`: PO audit fields (sentBy / sentAt / cancellationReason /
    cancelledBy / cancelledAt), POItem receivedQuantity, Approval.purchaseOrder (re-use per AD-19).
  - Extended `db/warehouse.cds`: GoodsReceipt status enum, GoodsReceiptItem entity,
    InventoryTransaction ledger, InventoryItem extension (quantityReserved / quantityDamaged),
    GoodsReceipt cancellation fields.
  - Extended `srv/procurement-service.cds`: 4 new PO lifecycle actions.
  - Extended `srv/warehouse-service.cds`: 5 new Inventory actions + 2 GR actions +
    projections for GoodsReceiptItems + InventoryTransactions.
  - Created `srv/common/warehouse-service-helpers.js` (applyInventoryMovement,
    getInventoryItem, findInventoryItemByCode, createInventoryItem,
    getGoodsReceiptWithDetails, syncPurchaseOrderReceiptStatus,
    incrementPurchaseOrderItemReceived) - all tx+entities signature per AD-11.
  - Created `srv/warehouse-service.js` (re-export of warehouse handler).
  - Extended `srv/common/procurement-service-helpers.js` with
    recalculatePurchaseOrderTotal, fetchPurchaseRequestItems,
    transitionPurchaseOrderStatus, markPurchaseRequestConverted.
  - Extended `srv/common/constants.js` with PURCHASE_ORDER_STATUS (already added in TICKET-005).
  - Extended `srv/handlers/procurement-handler.js` with PO before-CREATE / POItem C/U/D
    hooks + 4 PO lifecycle actions (convertToPurchaseOrder / sendPurchaseOrder /
    cancelPurchaseOrder / closePurchaseOrder); refactored `submitPurchaseRequest` to use
    `PurchaseRequestItems` entity ref (no inline-string entities) per Phase 3 commitment.
  - Implemented `srv/handlers/warehouse-handler.js` with Warehouse / GR / GRItem
    before-CREATE hooks + postGoodsReceipt / cancelGoodsReceipt actions + 5 inventory actions.
  - Bug fix found and corrected via E2E: GRItem before-CREATE was selecting
    `('status', 'purchaseOrder_ID')` and omitting `warehouse_ID`, causing the
    same-warehouse validation to fire incorrectly; fixed by adding 'warehouse_ID' column.
  - Bug fix found and corrected via E2E: GR before-CREATE blocked legitimate partial
    receipts with "Multiple posted receipts are not permitted"; removed the
    over-strict block. Over-receipt is correctly prevented at the GRItem level via the
    cumulative-received guard. Removed unused `isGoodsReceiptPosted` /
    `hasPostedGoodsReceiptForPO` helpers.
  - Validated via `node --check` on all 5 affected JS files, `cds compile` on
    db/schema.cds + srv/procurement-service.cds + srv/warehouse-service.cds, and a
    73-assertion E2E run against real CAP runtime + sqlite in-memory.
    72 PASS / 1 test-harness expectation mismatch (over-transfer with
    source==destination returns 400 for the input validation; test wrongly expected 409;
    production code is correct because input validation should precede state checks).
- TICKET-007 (complete): Asset lifecycle + audit + assignment management.
- TICKET-008 (complete): Notification framework + cross-service runtime hardening.
  - Finalized `db/platform-support.cds` notification enums and lifecycle fields
    (`isRead`, `isArchived`, `isDeleted`, reference linkage, recipient/department/role routing).
  - Added `srv/common/notification-service-helpers.js` with notification CRUD helpers,
    unread counts, soft-delete, broadcast expansion, event catalog mapping, and
    auto-emission joined to the originating transaction.
  - Added `srv/common/db-run.js` and aligned notification / warehouse / number-range
    cross-service database access to the shared sqlite-safe wrapper.
  - Implemented `srv/handlers/notification-handler.js` with CRUD validation,
    mark read/unread, mark-all-read, deleteNotification, unread counts,
    sendNotification, broadcastToDepartment, and broadcastToRole.
  - Integrated auto-emission into `procurement-handler.js`, `warehouse-handler.js`,
    and `asset-handler.js`.
  - Fixed the final production bug revealed by E2E: Warehouse CREATE used
    `results.ID` only in the after-hook, but CAP's INSERT dispatch path left
    `results.ID` null while `req.data.ID` was populated. The hook now falls back
    to `req.data.ID`, restoring WarehouseEvent notification persistence.
  - Validated via `node test/notification-e2e.test.js` -> 59 PASS / 0 FAIL,
    `node --check` on all modified TICKET-008 JS files, and `cds compile` on
    `db/schema.cds` plus every service definition.
- TICKET-009 (complete): Enterprise Reporting Module.
  - Created `srv/reporting-service.cds` with 13 unbound functions (getDashboardSummary,
    getPurchaseRequestSummary, getDepartmentSpendAnalysis, getApprovalPerformance,
    getPurchaseOrderSummary, getSupplierSpendAnalysis, getGoodsReceiptSummary,
    getWarehouseInventorySummary, getInventoryMovementReport, getAssetUtilizationReport,
    getAssetLifecycleReport, getNotificationStatistics, getAuditSummary) and 13 custom
    return types (DashboardSummary, PurchaseRequestStat, DepartmentSpend, ApprovalStat,
    PurchaseOrderStat, SupplierSpend, GoodsReceiptStat, WarehouseInventoryStat,
    InventoryMovementStat, AssetUtilizationStat, AssetLifecycleStat, NotificationStat,
    AuditStat).
  - Created `srv/common/reporting-service-helpers.js` with 13 pure aggregation functions
    following the (tx, entities, filters) convention (AD-11). All reads route through
    `dbRun` (AD-24 - read-only). Monetary aggregation uses `sumAmounts` + `toMonetary`
    from `calculator.js` (AD-8). Quantity aggregation uses `toQuantity`. Date-range
    filtering uses ISO-string lexicographic comparison.
  - Created `srv/handlers/reporting-handler.js` with UUID validation (via `isUuid`) and
    dispatch to reporting helpers for all 13 functions.
  - Created `srv/reporting-service.js` (one-liner re-export per CODING_STANDARDS §3).
  - Created `test/reporting-e2e.test.js` (121-assertion E2E covering all 13 functions,
    filtered/unfiltered variants, date-range exclusion, and invalid-UUID rejection cases).
  - Validated: `node --check` on all 4 new JS files (0 errors), `cds compile
    srv/reporting-service.cds` (clean), `node test/reporting-e2e.test.js` (121/121 PASS),
    `node test/notification-e2e.test.js` (59/59 PASS - no regression).
