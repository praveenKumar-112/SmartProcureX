using { smartprocurex.asset as asset } from '../db/asset';

service AssetService @(requires: 'authenticated-user') {

    entity AssetCategories
        @(restrict: [
            { grant: ['READ'], to: 'ProcurementManager' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on asset.AssetCategory;

    entity Assets
        @(restrict: [
            { grant: ['READ'], to: 'ProcurementManager' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on asset.Asset;

    entity AssetAssignments
        @(restrict: [
            { grant: ['READ'], to: 'ProcurementManager' },
            { grant: '*', to: 'Admin' }
        ])
        as projection on asset.AssetAssignment;

    // -------- Asset lifecycle --------

    action assignAsset(
        assetID : UUID,
        employeeID : UUID,
        expectedReturnDate : Date,
        remarks : String
    ) returns Boolean
    @(requires: 'Admin');

    action returnAsset(
        assetAssignmentID : UUID,
        returnRemarks : String
    ) returns Boolean
    @(requires: 'Admin');

    action transferAsset(
        assetID : UUID,
        destinationInventoryItemID : UUID,
        remarks : String
    ) returns Boolean
    @(requires: 'Admin');

    action retireAsset(
        assetID : UUID,
        reason : String
    ) returns Boolean
    @(requires: 'Admin');

    action disposeAsset(
        assetID : UUID,
        reason : String
    ) returns Boolean
    @(requires: 'Admin');
}
