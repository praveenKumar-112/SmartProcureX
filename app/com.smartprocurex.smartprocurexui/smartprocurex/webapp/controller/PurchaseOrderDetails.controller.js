sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/routing/History"
], function (Controller, MessageToast, MessageBox, History) {
    "use strict";

    return Controller.extend("smartprocurex.controller.PurchaseOrderDetails", {

        onInit: function () {
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("RoutePurchaseOrderDetails")
                .attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched: function (oEvent) {
            const sPoId = oEvent.getParameter("arguments").poId;
            this.getView().bindElement({
                path: "/PurchaseOrders(" + sPoId + ")",
                parameters: {
                    $expand: "purchaseRequest"
                }
            });
        },

        onNavBack: function () {
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getOwnerComponent().getRouter().navTo("RoutePurchaseOrderList", {}, true);
            }
        },

        onSendPO: async function () {
            const oContext = this.getView().getBindingContext();
            const sID = oContext.getProperty("ID");

            try {
                const response = await fetch(
                    "/odata/v4/procurement/sendPurchaseOrder",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            purchaseOrderID: sID
                        })
                    }
                );

                if (response.ok) {
                    MessageToast.show("Purchase Order Sent");
                    oContext.refresh();
                } else {
                    const errorData = await response.json();
                    MessageBox.error(errorData.error?.message || "Send Failed");
                }
            } catch (error) {
                MessageBox.error(error.message);
            }
        },

        onClosePO: async function () {
            const oContext = this.getView().getBindingContext();
            const sID = oContext.getProperty("ID");

            try {
                const response = await fetch(
                    "/odata/v4/procurement/closePurchaseOrder",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            purchaseOrderID: sID
                        })
                    }
                );

                if (response.ok) {
                    MessageToast.show("Purchase Order Closed");
                    oContext.refresh();
                } else {
                    const errorData = await response.json();
                    MessageBox.error(errorData.error?.message || "Close Failed");
                }
            } catch (error) {
                MessageBox.error(error.message);
            }
        },

        onCancelPO: async function () {
            const oContext = this.getView().getBindingContext();
            const sID = oContext.getProperty("ID");

            try {
                const response = await fetch(
                    "/odata/v4/procurement/cancelPurchaseOrder",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            purchaseOrderID: sID,
                            reason: "Cancelled from UI"
                        })
                    }
                );

                if (response.ok) {
                    MessageToast.show("Purchase Order Cancelled");
                    oContext.refresh();
                } else {
                    const errorData = await response.json();
                    MessageBox.error(errorData.error?.message || "Cancellation Failed");
                }
            } catch (error) {
                MessageBox.error(error.message);
            }
        }
    });
});
