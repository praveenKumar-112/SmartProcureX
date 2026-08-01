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
                path: "/PurchaseRequests(" + sRequestId + ")",
                parameters: {
                    $expand: "purchaseOrder"
                }
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

},

        onViewPurchaseOrder: function () {
            const oContext = this.getView().getBindingContext();
            const poId = oContext.getProperty("purchaseOrder_ID");
            
            if (poId) {
                this.getOwnerComponent().getRouter().navTo("RoutePurchaseOrderDetails", {
                    poId: poId
                });
            } else {
                MessageBox.error("No Purchase Order linked to this request.");
            }
        },

        onOpenConvertToPODialog: async function () {
            if (!this._oDialog) {
                sap.ui.require([
                    "sap/m/Dialog",
                    "sap/m/Button",
                    "sap/m/Label",
                    "sap/m/Select",
                    "sap/ui/core/Item",
                    "sap/m/DatePicker",
                    "sap/ui/layout/VerticalLayout",
                    "sap/ui/model/json/JSONModel"
                ], async (Dialog, Button, Label, Select, Item, DatePicker, VerticalLayout, JSONModel) => {
                    
                    var oSelect = new Select("supplierSelect", {
                        width: "100%",
                        items: {
                            path: "suppliersModel>/value",
                            template: new Item({
                                key: "{suppliersModel>ID}",
                                text: "{suppliersModel>supplierName} ({suppliersModel>supplierCode})"
                            })
                        }
                    });

                    var oDatePicker = new DatePicker("deliveryDatePicker", {
                        width: "100%",
                        displayFormat: "yyyy-MM-dd",
                        valueFormat: "yyyy-MM-dd"
                    });

                    this._oDialog = new Dialog({
                        title: "Convert to Purchase Order",
                        content: new VerticalLayout({
                            width: "100%",
                            content: [
                                new Label({ text: "Select Supplier", required: true }),
                                oSelect,
                                new Label({ text: "Expected Delivery Date", required: true, class: "sapUiSmallMarginTop" }),
                                oDatePicker
                            ]
                        }).addStyleClass("sapUiContentPadding"),
                        beginButton: new Button({
                            type: "Emphasized",
                            text: "Convert",
                            press: this.onConvertToPO.bind(this)
                        }),
                        endButton: new Button({
                            text: "Cancel",
                            press: () => {
                                this._oDialog.close();
                            }
                        })
                    });

                    this.getView().addDependent(this._oDialog);

                    // Fetch suppliers
                    try {
                        var response = await fetch("/odata/v4/supplier/Suppliers");
                        var data = await response.json();
                        this._oDialog.setModel(new JSONModel(data), "suppliersModel");
                    } catch (error) {
                        MessageBox.error("Failed to load suppliers.");
                    }

                    this._oDialog.open();
                });
            } else {
                this._oDialog.open();
            }
        },

        onConvertToPO: async function () {
            const oContext = this.getView().getBindingContext();
            const sID = oContext.getProperty("ID");

            const sSupplierId = sap.ui.getCore().byId("supplierSelect").getSelectedKey();
            const sDeliveryDate = sap.ui.getCore().byId("deliveryDatePicker").getValue();

            if (!sSupplierId || !sDeliveryDate) {
                MessageBox.error("Please provide both Supplier and Expected Delivery Date.");
                return;
            }

            try {
                const response = await fetch(
                    "/odata/v4/procurement/convertToPurchaseOrder",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            purchaseRequestID: sID,
                            supplierID: sSupplierId,
                            expectedDeliveryDate: sDeliveryDate
                        })
                    }
                );

                if (response.ok) {
                    const responseData = await response.json();
                    const newPoId = responseData.value;
                    
                    MessageToast.show("Purchase Order created successfully");
                    this._oDialog.close();
                    
                    // User requested to navigate to the new PO Details page
                    if (newPoId) {
                        this.getOwnerComponent().getRouter().navTo("RoutePurchaseOrderDetails", {
                            poId: newPoId
                        });
                    } else {
                        oContext.refresh(); // Fallback if ID is somehow not returned
                    }
                    
                } else {
                    const errorData = await response.json();
                    MessageBox.error(errorData.error?.message || "Conversion Failed");
                }
            } catch (error) {
                MessageBox.error(error.message);
            }
        }

    });
});