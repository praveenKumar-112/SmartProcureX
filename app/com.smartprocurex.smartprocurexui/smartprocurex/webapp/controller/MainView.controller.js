sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (Controller, JSONModel, MessageToast) {
    "use strict";

    return Controller.extend("smartprocurex.controller.MainView", {

        onInit: function () {
            // Initialize dashboard counts model
            var oDashboardModel = new JSONModel({
                totalPR: 0,
                draft: 0,
                submitted: 0,
                approved: 0,
                rejected: 0
            });
            this.getView().setModel(oDashboardModel, "dashboardModel");

            // Refresh counts every time the dashboard route is matched
            this.getOwnerComponent().getRouter()
                .getRoute("RouteMainView")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._loadDashboardCounts();
            // Refresh the OData model so the table shows newly created requests
            this.getView().getModel().refresh();
        },

        /**
         * Fetches all Purchase Requests and computes tile counts.
         */
        _loadDashboardCounts: async function () {
            try {
                var response = await fetch("/odata/v4/procurement/PurchaseRequests");
                var data = await response.json();
                var aRequests = data.value || [];

                var oCounts = {
                    totalPR: aRequests.length,
                    draft: 0,
                    submitted: 0,
                    approved: 0,
                    rejected: 0
                };

                aRequests.forEach(function (req) {
                    switch (req.status) {
                        case "Draft":
                            oCounts.draft++;
                            break;
                        case "Submitted":
                            oCounts.submitted++;
                            break;
                        case "Approved":
                            oCounts.approved++;
                            break;
                        case "Rejected":
                            oCounts.rejected++;
                            break;
                    }
                });

                this.getView().getModel("dashboardModel").setData(oCounts);
            } catch (error) {
                // Silently fail — tiles will show 0
            }
        },

        getStatusState: function (sStatus) {

            switch (sStatus) {

                case "Approved":
                    return "Success";

                case "Submitted":
                    return "Warning";

                case "Rejected":
                    return "Error";

                default:
                    return "None";
            }
        },

        onCreateRequest: function () {
            this.getOwnerComponent().getRouter().navTo("RouteCreateRequest");
        },
        onRequestPress: function (oEvent) {

    const oItem = oEvent.getSource();

    const oContext = oItem.getBindingContext();

    const sId = oContext.getProperty("ID");

    this.getOwnerComponent()
        .getRouter()
        .navTo("RouteRequestDetails", {
            requestId: sId
        });
}

    });
});