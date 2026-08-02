sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel"
], function (Controller, History, MessageToast, MessageBox, JSONModel) {
    "use strict";

    return Controller.extend("smartprocurex.controller.SupplierDetails", {

        onInit: function () {
            this.getOwnerComponent().getRouter()
                .getRoute("RouteSupplierDetails")
                .attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched: function (oEvent) {
            const sSupplierId = oEvent.getParameter("arguments").supplierId;
            this.sSupplierId = sSupplierId;

            this.getView().bindElement({
                path: "/Suppliers(" + sSupplierId + ")",
                model: "supplierModel",
                parameters: {
                    $expand: "contacts"
                }
            });

            this._setEditMode(false);
            this._loadSupplierAnalytics(sSupplierId);
        },

        _loadSupplierAnalytics: async function (sSupplierId) {
            try {
                // Fetch Purchase Orders for this supplier
                const response = await fetch(`/odata/v4/procurement/PurchaseOrders?$filter=supplier_ID eq ${sSupplierId}`);
                if (!response.ok) return;

                const data = await response.json();
                const aPOs = data.value || [];

                let totalPOs = aPOs.length;
                let totalValue = 0;
                let activePOs = 0;
                let lastOrderDate = null;

                aPOs.forEach(po => {
                    if (po.totalAmount) {
                        totalValue += parseFloat(po.totalAmount);
                    }
                    if (po.status === "Created" || po.status === "Sent") {
                        activePOs++;
                    }
                    if (po.orderDate) {
                        const dDate = new Date(po.orderDate);
                        if (!lastOrderDate || dDate > lastOrderDate) {
                            lastOrderDate = dDate;
                        }
                    }
                });

                // Update UI Texts manually (simpler than full model for 4 fields)
                this.byId("txtTotalPOs").setText(totalPOs);
                this.byId("txtTotalValue").setText("₹" + totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2 }));
                this.byId("txtActivePOs").setText(activePOs);
                this.byId("txtLastOrder").setText(lastOrderDate ? lastOrderDate.toISOString().split('T')[0] : "-");

                // Bind the related POs table
                const oTable = this.byId("relatedPOTable");
                const oModel = new JSONModel({ POs: aPOs });
                oTable.setModel(oModel, "relatedPOModel");
                
                oTable.bindItems({
                    path: "relatedPOModel>/POs",
                    template: new sap.m.ColumnListItem({
                        type: "Navigation",
                        press: this.onPOPress.bind(this),
                        cells: [
                            new sap.m.Text({ text: "{relatedPOModel>poNumber}" }),
                            new sap.m.Text({ text: "{relatedPOModel>orderDate}" }),
                            new sap.m.ObjectNumber({ number: "{relatedPOModel>totalAmount}", unit: "INR" }),
                            new sap.m.ObjectStatus({ 
                                text: "{relatedPOModel>status}",
                                state: "{ path: 'relatedPOModel>status', formatter: '.getPOStatusState' }"
                            })
                        ]
                    })
                });

            } catch (error) {
                console.error("Failed to load supplier analytics", error);
            }
        },

        getPOStatusState: function (sStatus) {
            switch (sStatus) {
                case "Created": return "Information";
                case "Sent": return "Warning";
                case "Closed": return "Success";
                case "Cancelled": return "Error";
                default: return "None";
            }
        },

        onPOPress: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext("relatedPOModel");
            const poId = oContext.getProperty("ID");
            this.getOwnerComponent().getRouter().navTo("RoutePurchaseOrderDetails", {
                poId: poId
            });
        },

        _setEditMode: function (bEdit) {
            this.byId("inSupplierName").setEditable(bEdit);
            this.byId("inSupplierType").setEditable(bEdit);
            this.byId("inStatus").setEditable(bEdit);
            this.byId("inEmail").setEditable(bEdit);
            this.byId("inPhone").setEditable(bEdit);
            this.byId("inWebsite").setEditable(bEdit);
            this.byId("inGstNumber").setEditable(bEdit);
            this.byId("inTaxNumber").setEditable(bEdit);

            this.byId("btnEdit").setVisible(!bEdit);
            this.byId("btnSave").setVisible(bEdit);
            this.byId("btnCancel").setVisible(bEdit);
        },

        onEdit: function () {
            this._setEditMode(true);
        },

        onCancelEdit: function () {
            // Reset pending changes
            this.getView().getModel("supplierModel").resetChanges();
            this._setEditMode(false);
        },

        onSave: async function () {
            // Check mandatory fields
            const sName = this.byId("inSupplierName").getValue().trim();
            if (!sName) {
                MessageBox.error("Supplier Name is required.");
                return;
            }

            try {
                // Get the OData v4 model context
                const oContext = this.getView().getBindingContext("supplierModel");
                
                // Set the values back to the model (in case UI binding didn't flush)
                oContext.setProperty("supplierName", sName);
                oContext.setProperty("supplierType", this.byId("inSupplierType").getValue().trim());
                oContext.setProperty("status", this.byId("inStatus").getSelectedKey());
                oContext.setProperty("email", this.byId("inEmail").getValue().trim());
                oContext.setProperty("phone", this.byId("inPhone").getValue().trim());
                oContext.setProperty("website", this.byId("inWebsite").getValue().trim());
                oContext.setProperty("gstNumber", this.byId("inGstNumber").getValue().trim());
                oContext.setProperty("taxNumber", this.byId("inTaxNumber").getValue().trim());

                if (this.getView().getModel("supplierModel").hasPendingChanges()) {
                    await this.getView().getModel("supplierModel").submitBatch("$auto");
                    MessageToast.show("Supplier details updated successfully.");
                } else {
                    MessageToast.show("No changes made.");
                }
                
                this._setEditMode(false);
            } catch (error) {
                MessageBox.error("Failed to save changes.");
            }
        },

        onNavBack: function () {
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getOwnerComponent().getRouter().navTo("RouteSupplierList", {}, true);
            }
        }
    });
});
