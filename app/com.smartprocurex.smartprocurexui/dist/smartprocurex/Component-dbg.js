sap.ui.define([
    "sap/ui/core/UIComponent",
    "smartprocurex/model/models",
    "sap/ui/model/json/JSONModel"
], (UIComponent, models, JSONModel) => {
    "use strict";

    return UIComponent.extend("smartprocurex.Component", {
        metadata: {
            manifest: "json",
            interfaces: [
                "sap.ui.core.IAsyncContentCreation"
            ]
        },

        init() {
            // call the base component's init function
            UIComponent.prototype.init.apply(this, arguments);

            // set the device model
            this.setModel(models.createDeviceModel(), "device");

            // enable routing
            this.getRouter().initialize();

            // Fetch user roles
            fetch("/user-api/currentUser")
                .then(res => res.json())
                .then(user => {
                    const scopes = user.scopes || [];
                    const roles = {
                        isRequester: scopes.some(s => s.includes('Requester')),
                        isApprover: scopes.some(s => s.includes('Approver')),
                        isManager: scopes.some(s => s.includes('ProcurementManager')),
                        isAdmin: scopes.some(s => s.includes('Admin'))
                    };
                    this.setModel(new JSONModel(roles), "userRole");
                })
                .catch(err => {
                    // Fallback if not authenticated (e.g., local dev without Approuter)
                    this.setModel(new JSONModel({ isAdmin: true, isRequester: true, isApprover: true, isManager: true }), "userRole");
                });
        }
    });
});