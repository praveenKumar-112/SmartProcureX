/**
 * SmartProcureX - ReportingService entry point
 * --------------------------------------------------
 * Responsibility:
 *   Re-export the ReportingService handler so CAP's service
 *   auto-loader picks up the implementation when it boots
 *   ReportingService from reporting-service.cds.
 *
 * Design:
 *   One-liner per CODING_STANDARDS.md §3. All implementation
 *   lives in srv/handlers/reporting-handler.js.
 */
export { default } from './handlers/reporting-handler.js';
