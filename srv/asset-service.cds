using { smartprocurex.asset as asset } from '../db/asset';

service AssetService {

    entity AssetCategories
        as projection on asset.AssetCategory;

    entity Assets
        as projection on asset.Asset;

    entity AssetAssignments
        as projection on asset.AssetAssignment;

}