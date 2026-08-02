sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, History, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("smartprocurex.controller.CreateSupplier", {

        onInit: function () {
            this.getOwnerComponent().getRouter()
                .getRoute("RouteCreateSupplier")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._clearForm();
        },

        _clearForm: function () {
            this.byId("inSupplierCode").setValue("");
            this.byId("inSupplierName").setValue("");
            this.byId("inSupplierType").setValue("");
            this.byId("inEmail").setValue("");
            this.byId("inPhone").setValue("");
            this.byId("inWebsite").setValue("");
            this.byId("inGstNumber").setValue("");
            this.byId("inTaxNumber").setValue("");
            this.byId("inStatus").setSelectedKey("ACTIVE");
        },

        onSaveSupplier: async function () {
            const sCode = this.byId("inSupplierCode").getValue().trim();
            const sName = this.byId("inSupplierName").getValue().trim();
            const sType = this.byId("inSupplierType").getValue().trim();
            const sEmail = this.byId("inEmail").getValue().trim();
            const sPhone = this.byId("inPhone").getValue().trim();
            const sWebsite = this.byId("inWebsite").getValue().trim();
            const sGst = this.byId("inGstNumber").getValue().trim();
            const sTax = this.byId("inTaxNumber").getValue().trim();
            const sStatus = this.byId("inStatus").getSelectedKey();

            if (!sCode || !sName || !sEmail || !sPhone) {
                MessageBox.error("Please fill in all mandatory fields (Supplier Code, Name, Email, Phone).");
                return;
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(sEmail)) {
                MessageBox.error("Please enter a valid email address.");
                return;
            }

            // OData model bindings can be used, but since we want to handle success/error robustly
            // we will use fetch to POST to the service.
            try {
                const response = await fetch("/odata/v4/supplier/Suppliers", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        supplierCode: sCode,
                        supplierName: sName,
                        supplierType: sType,
                        email: sEmail,
                        phone: sPhone,
                        website: sWebsite,
                        gstNumber: sGst,
                        taxNumber: sTax,
                        status: sStatus
                    })
                });

                if (response.ok) {
                    MessageToast.show("Supplier created successfully.");
                    this.onNavBack();
                } else {
                    const errData = await response.json();
                    MessageBox.error(errData.error?.message || "Failed to create supplier.");
                }
            } catch (error) {
                MessageBox.error("An error occurred while creating the supplier.");
            }
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
