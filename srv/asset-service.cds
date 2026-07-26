using { smartprocurex.asset as asset } from '../db/asset';

service AssetService {

    entity AssetCategories
        as projection on asset.AssetCategory;

    entity Assets
        as projection on asset.Asset;

    entity AssetAssignments
        as projection on asset.AssetAssignment;

    // -------- Asset lifecycle --------

    action assignAsset(
        assetID : UUID,
        employeeID : UUID,
        expectedReturnDate : Date,
        remarks : String
    ) returns Boolean;

    action returnAsset(
        assetAssignmentID : UUID,
        returnRemarks : String
    ) returns Boolean;

    action transferAsset(
        assetID : UUID,
        destinationInventoryItemID : UUID,
        remarks : String
    ) returns Boolean;

    action retireAsset(
        assetID : UUID,
        reason : String
    ) returns Boolean;

    action disposeAsset(
        assetID : UUID,
        reason : String
    ) returns Boolean;
}
