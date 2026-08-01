sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    Controller,
    MessageToast,
    MessageBox
) {
    "use strict";

    return Controller.extend("smartprocurex.controller.RequestDetails", {

        onInit: function () {

            const oRouter = this.getOwnerComponent().getRouter();

            oRouter.getRoute("RouteRequestDetails")
                .attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched: function (oEvent) {

            const sRequestId = oEvent.getParameter("arguments").requestId;

            this.getView().bindElement({
                path: "/PurchaseRequests(" + sRequestId + ")"
            });

        },

        onNavBack: function () {
            window.history.back();
        },

        onApprove: async function () {

            const oContext = this.getView().getBindingContext();

            const sID = oContext.getProperty("ID");

            try {

                const response = await fetch(
                    "/odata/v4/procurement/approvePurchaseRequest",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            purchaseRequestID: sID,
                            comments: "Approved from UI"
                        })
                    }
                );

                if (response.ok) {

                    MessageToast.show(
                        "Purchase Request Approved"
                    );

                    oContext.refresh();

                } else {

                    const errorData = await response.json();

                    MessageBox.error(
                        errorData.error?.message || "Approval Failed"
                    );
                }

            } catch (error) {

                MessageBox.error(error.message);

            }
        },

        onReject: async function () {

            const oContext = this.getView().getBindingContext();

            const sID = oContext.getProperty("ID");

            try {

                const response = await fetch(
                    "/odata/v4/procurement/rejectPurchaseRequest",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            purchaseRequestID: sID,
                            comments: "Rejected from UI"
                        })
                    }
                );

                if (response.ok) {

                    MessageToast.show(
                        "Purchase Request Rejected"
                    );

                    oContext.refresh();

                } else {

                    const errorData = await response.json();

                    MessageBox.error(
                        errorData.error?.message || "Rejection Failed"
                    );
                }

            } catch (error) {

                MessageBox.error(error.message);

            }
        },
        onSubmit: async function () {

    const oContext = this.getView().getBindingContext();

    const sID = oContext.getProperty("ID");

    try {

        const response = await fetch(
            "/odata/v4/procurement/submitPurchaseRequest",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    purchaseRequestID: sID
                })
            }
        );

        if (response.ok) {

            MessageToast.show(
                "Purchase Request Submitted"
            );

            oContext.refresh();

        } else {

            const errorData = await response.json();

            MessageBox.error(
                errorData.error?.message || "Submit Failed"
            );

        }

    } catch (error) {

        MessageBox.error(error.message);

    }

}

    });
});