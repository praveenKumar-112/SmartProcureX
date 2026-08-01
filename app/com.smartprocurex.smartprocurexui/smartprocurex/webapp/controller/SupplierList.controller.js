sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History"
], function (Controller, History) {
    "use strict";

    return Controller.extend("smartprocurex.controller.SupplierList", {

        onInit: function () {
            this.getOwnerComponent().getRouter()
                .getRoute("RouteSupplierList")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            // Refresh model so we see newly added suppliers immediately
            this.getView().getModel("supplierModel").refresh();
        },

        getSupplierStatusState: function (sStatus) {
            if (!sStatus) {
                return "None";
            }
            const sUpperStatus = sStatus.toUpperCase();
            if (sUpperStatus === "ACTIVE") {
                return "Success";
            } else if (sUpperStatus === "INACTIVE") {
                return "Error";
            }
            return "None";
        },

        onSupplierPress: function (oEvent) {
            const oItem = oEvent.getSource();
            const oContext = oItem.getBindingContext("supplierModel");
            const sId = oContext.getProperty("ID");

            this.getOwnerComponent()
                .getRouter()
                .navTo("RouteSupplierDetails", {
                    supplierId: sId
                });
        },

        onNavBack: function () {
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getOwnerComponent().getRouter().navTo("RouteMainView", {}, true);
            }
        }
    });
});
