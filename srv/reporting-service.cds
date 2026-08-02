/**
 * SmartProcureX - ReportingService Definition
 * ---------------------------------------------------------
 * Responsibility:
 *   Expose read-only aggregation reports that span the Procurement,
 *   Warehouse, Asset, Platform, Identity, and Supplier domains.
 *
 * Design:
 *   - All operations are CAP unbound functions (HTTP GET, safe,
 *     idempotent) per AD-24. Functions never modify state.
 *   - No transactional entities are projected into this service;
 *     all data is fetched cross-domain via the shared cds.db facade
 *     and returned as pre-computed typed result structures.
 *   - Result types are defined below the service block and referenced
 *     by function return signatures. All types are globally unique to
 *     avoid conflicts with domain-schema types.
 *   - Every function parameter is optional. Omitting a filter returns
 *     unfiltered results; the handler and helpers guard each param.
 */

service ReportingService @(requires: 'authenticated-user') {

    // ============================================================
    // Dashboard
    // ============================================================

    /**
     * Top-level KPIs across all SmartProcureX domains in a single
     * call. Suitable for a management dashboard landing page.
     */
    function getDashboardSummary() returns DashboardSummary
    @(requires: ['ProcurementManager', 'Admin']);

    // ============================================================
    // Purchase Request Reports
    // ============================================================

    /**
     * Count and total spend of Purchase Requests grouped by status.
     * All parameters are optional filters that can be combined.
     */
    function getPurchaseRequestSummary(
        fromDate     : Date,
        toDate       : Date,
        departmentID : UUID,
        status       : String
    ) returns array of PurchaseRequestStat
    @(requires: ['ProcurementManager', 'Admin']);

    /**
     * Total spend on Purchase Requests grouped by department.
     * Distinguishes approved spend (Approved + ConvertedToPO)
     * from total submitted spend for budget-vs-actual analysis.
     */
    function getDepartmentSpendAnalysis(
        fromDate : Date,
        toDate   : Date
    ) returns array of DepartmentSpend
    @(requires: ['ProcurementManager', 'Admin']);

    // ============================================================
    // Approval Reports
    // ============================================================

    /**
     * Approval decision breakdown with counts and percentage share
     * of total decisions across all Purchase Requests.
     */
    function getApprovalPerformance(
        fromDate : Date,
        toDate   : Date
    ) returns array of ApprovalStat
    @(requires: ['ProcurementManager', 'Admin']);

    // ============================================================
    // Purchase Order Reports
    // ============================================================

    /**
     * Count and total value of Purchase Orders grouped by status.
     */
    function getPurchaseOrderSummary(
        fromDate : Date,
        toDate   : Date,
        status   : String
    ) returns array of PurchaseOrderStat
    @(requires: ['ProcurementManager', 'Admin']);

    /**
     * Total spend grouped by supplier across all Purchase Orders,
     * including order count and average order value per supplier.
     */
    function getSupplierSpendAnalysis(
        fromDate : Date,
        toDate   : Date
    ) returns array of SupplierSpend
    @(requires: ['ProcurementManager', 'Admin']);

    // ============================================================
    // Goods Receipt Reports
    // ============================================================

    /**
     * Count of Goods Receipts grouped by status and warehouse.
     * Optionally scoped to a single warehouse and date range.
     */
    function getGoodsReceiptSummary(
        fromDate    : Date,
        toDate      : Date,
        warehouseID : UUID
    ) returns array of GoodsReceiptStat
    @(requires: ['ProcurementManager', 'Admin']);

    // ============================================================
    // Inventory Reports
    // ============================================================

    /**
     * Current stock balance summary (on-hand, reserved, damaged)
     * aggregated per warehouse. Optionally scoped to one warehouse.
     */
    function getWarehouseInventorySummary(
        warehouseID : UUID
    ) returns array of WarehouseInventoryStat
    @(requires: ['ProcurementManager', 'Admin']);

    /**
     * Inventory transaction ledger aggregated by transaction type.
     * Supports date range, warehouse, and transaction-type filters.
     */
    function getInventoryMovementReport(
        fromDate        : DateTime,
        toDate          : DateTime,
        warehouseID     : UUID,
        transactionType : String
    ) returns array of InventoryMovementStat
    @(requires: ['ProcurementManager', 'Admin']);

    // ============================================================
    // Asset Reports
    // ============================================================

    /**
     * Asset count grouped by status with percentage of total fleet.
     * Provides a quick utilization snapshot across the asset register.
     */
    function getAssetUtilizationReport() returns array of AssetUtilizationStat
    @(requires: ['ProcurementManager', 'Admin']);

    /**
     * Asset count broken down by lifecycle status per asset category.
     * Optionally scoped to a single category.
     */
    function getAssetLifecycleReport(
        categoryID : UUID
    ) returns array of AssetLifecycleStat
    @(requires: ['ProcurementManager', 'Admin']);

    // ============================================================
    // Notification Statistics
    // ============================================================

    /**
     * Notification counts grouped by category with read / unread
     * breakdown and computed read-rate percentage. Only non-deleted
     * notifications are included in the statistics.
     */
    function getNotificationStatistics(
        fromDate : Date,
        toDate   : Date
    ) returns array of NotificationStat
    @(requires: ['ProcurementManager', 'Admin']);

    // ============================================================
    // Audit Summary
    // ============================================================

    /**
     * AuditLog entries grouped by entity name and operation type.
     * Supports date range and optional entity-name filter for
     * targeted compliance reporting.
     */
    function getAuditSummary(
        fromDate   : Date,
        toDate     : Date,
        entityName : String
    ) returns array of AuditStat
    @(requires: ['ProcurementManager', 'Admin']);
}

// ============================================================
// Result types - used exclusively as function return shapes
// ============================================================

/**
 * getDashboardSummary return type.
 * All fields default to 0 on the service side; never null.
 */
type DashboardSummary {
    totalPurchaseRequests : Integer;
    openPurchaseRequests  : Integer;
    totalPurchaseOrders   : Integer;
    openPurchaseOrders    : Integer;
    pendingApprovals      : Integer;
    totalInventoryItems   : Integer;
    lowStockItems         : Integer;
    totalAssets           : Integer;
    assignedAssets        : Integer;
    unreadNotifications   : Integer;
}

/** getPurchaseRequestSummary element */
type PurchaseRequestStat {
    status      : String;
    count       : Integer;
    totalAmount : Decimal(15,2);
}

/** getDepartmentSpendAnalysis element */
type DepartmentSpend {
    departmentID   : UUID;
    departmentName : String;
    requestCount   : Integer;
    totalAmount    : Decimal(15,2);
    approvedAmount : Decimal(15,2);
}

/** getApprovalPerformance element */
type ApprovalStat {
    decision          : String;
    count             : Integer;
    percentageOfTotal : Decimal(5,2);
}

/** getPurchaseOrderSummary element */
type PurchaseOrderStat {
    status      : String;
    count       : Integer;
    totalAmount : Decimal(15,2);
}

/** getSupplierSpendAnalysis element */
type SupplierSpend {
    supplierID        : UUID;
    supplierName      : String;
    orderCount        : Integer;
    totalAmount       : Decimal(15,2);
    averageOrderValue : Decimal(15,2);
}

/** getGoodsReceiptSummary element */
type GoodsReceiptStat {
    warehouseID   : UUID;
    warehouseName : String;
    status        : String;
    count         : Integer;
}

/** getWarehouseInventorySummary element */
type WarehouseInventoryStat {
    warehouseID   : UUID;
    warehouseName : String;
    totalItems    : Integer;
    totalOnHand   : Decimal(13,3);
    totalReserved : Decimal(13,3);
    totalDamaged  : Decimal(13,3);
}

/** getInventoryMovementReport element */
type InventoryMovementStat {
    transactionType : String;
    count           : Integer;
    totalQuantity   : Decimal(13,3);
}

/** getAssetUtilizationReport element */
type AssetUtilizationStat {
    status            : String;
    count             : Integer;
    percentageOfTotal : Decimal(5,2);
}

/** getAssetLifecycleReport element */
type AssetLifecycleStat {
    categoryID   : UUID;
    categoryName : String;
    totalAssets  : Integer;
    available    : Integer;
    assigned     : Integer;
    maintenance  : Integer;
    retired      : Integer;
    disposed     : Integer;
}

/** getNotificationStatistics element */
type NotificationStat {
    category : String;
    total    : Integer;
    read     : Integer;
    unread   : Integer;
    readRate : Decimal(5,2);
}

/** getAuditSummary element */
type AuditStat {
    entityName : String;
    operation  : String;
    count      : Integer;
}
