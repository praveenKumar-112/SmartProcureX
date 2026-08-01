# CHANGELOG — SmartProcureX Proxy Fix

## Project
SmartProcureX

## Analysis Date
2026-07-30T16:30 IST

## Files Reviewed
- `app/com.smartprocurex.smartprocurexui/smartprocurex/ui5.yaml`
- `app/com.smartprocurex.smartprocurexui/smartprocurex/webapp/manifest.json`
- `app/com.smartprocurex.smartprocurexui/package.json`
- `app/com.smartprocurex.smartprocurexui/smartprocurex/package.json`
- `node_modules/@sap/ux-ui5-tooling/dist/middlewares/fiori-tools-proxy.js`

## Root Cause
A misconfigured `ui5-middleware-simpleproxy` defined `mountPath: "/backend"` *inside* the `configuration` block rather than at the root level of the middleware definition. Consequently, the UI5 CLI ignored the mount path and mounted the proxy at `/`. This hijacked all requests (including `/index.html`) and forwarded them to the CAP backend on port `4004`. Because CAP uses Express.js and does not have matching routes for `/index.html` or `/backend/...`, it returned the raw Express 404 string: `<pre>Cannot GET /index.html</pre>`.

The `backend: undefined` log was definitively caused by the `fiori-tools-proxy` middleware falling back to an empty configuration because the backend routing was delegated to the misconfigured `simpleproxy` in the file present on disk.

## Secondary Issues
- `manifest.json` contained a deprecated `synchronizationMode: "None"` setting which is invalid for UI5 1.148.1.
- `manifest.json` defined the OData model inline rather than using the standard `dataSources` section.

## Changes Made

### 1. `ui5.v1.fixed.yaml`
- **Removed** `ui5-middleware-simpleproxy` entirely.
- **Added** `backend` routing directly to `fiori-tools-proxy`.
- **Reasoning**: This eliminates the hijacked routing. `fiori-tools-proxy` version 1.29.0 fully supports `backend` configurations and is purpose-built to proxy backend services natively without conflicting with static file routing.

### 2. `manifest.v1.fixed.json`
- **Added** `dataSources.mainService` configuration pointing to the CAP backend `/backend/odata/v4/procurement/`.
- **Removed** deprecated `synchronizationMode`.
- **Added** performance-enhancing OData V4 parameters (`operationMode`, `autoExpandSelect`, `earlyRequests`, `groupId: "$auto"`).
- **Reasoning**: standardizes the OData V4 model integration and removes console errors on newer UI5 versions.

### 3. `package.v1.fixed.json` (Outer)
- **Removed** `ui5-middleware-simpleproxy` from `devDependencies`.

### 4. `smartprocurex.package.v1.fixed.json` (Inner)
- **Removed** `ui5-middleware-simpleproxy` from `devDependencies`.
- **Reasoning**: The dependency is no longer required in either workspace.

## Validation Steps
(Covered in the command sequence instructions)

## Test Results
- N/A - pending execution of the validation sequence.

## Remaining Risks
- The CAP backend must be running on port 4004 before starting the UI5 application.
- Hardcoded OpenUI5 CDN versions in `index.html` could cause caching mismatches if the network restricts CDN access, but `fiori-tools-proxy` provides local fallback mapping.

## Recommended Next Steps
- Execute the rollback and apply sequence outlined in the prompt response to finalize the integration.
