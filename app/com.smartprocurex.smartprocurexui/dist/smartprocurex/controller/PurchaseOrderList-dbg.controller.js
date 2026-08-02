sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History"
], function (Controller, History) {
    "use strict";

    return Controller.extend("smartprocurex.controller.PurchaseOrderList", {

        onInit: function () {
            this.getOwnerComponent().getRouter()
                .getRoute("RoutePurchaseOrderList")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this.getView().getModel().refresh();
        },

        getPOStatusState: function (sStatus) {
            switch (sStatus) {
                case "Created":
                    return "Information";
                case "Sent":
                    return "Warning";
                case "Closed":
                    return "Success";
                case "Cancelled":
                    return "Error";
                default:
                    return "None";
            }
        },

        onPOPress: function (oEvent) {
            const oItem = oEvent.getSource();
            const oContext = oItem.getBindingContext();
            const sId = oContext.getProperty("ID");

            this.getOwnerComponent()
                .getRouter()
                .navTo("RoutePurchaseOrderDetails", {
                    poId: sId
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
