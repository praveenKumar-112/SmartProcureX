/**
 * SmartProcureX - Centralized Error Helpers
 * --------------------------------------------------
 * Responsibility:
 *   Provide a single, consistent vocabulary for raising
 *   CAP errors across all service handlers.
 *
 * Design:
 *   - Every helper returns a structured error object via the
 *     standard CAP `req.reject` signature (code, message, target).
 *   - No throwing of raw Error instances inside handlers; CAP error
 *     propagation relies on `req.reject` to emit OData V4 error responses.
 *   - HTTP status codes follow RFC 9110 semantics:
 *       400 -> client-side validation failure
 *       401 -> missing or invalid authentication
 *       403 -> authenticated user lacks authorization
 *       404 -> referenced resource not found
 *       409 -> state conflict / invalid state transition
 *       422 -> semantically well-formed but unprocessable payload
 *       500 -> unexpected internal failure
 *
 * Usage:
 *   import { rejectNotFound, rejectConflict, rejectValidation } from '../common/errors.js';
 *   if (!entity) return rejectNotFound(req, 'Purchase Request');
 */

// ---------------------------------------------------------------------------
// HTTP status code constants (single source of truth for handlers)
// ---------------------------------------------------------------------------

export const HTTP_STATUS = Object.freeze({
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    INTERNAL_SERVER_ERROR: 500
});

// ---------------------------------------------------------------------------
// Core rejection helpers
// ---------------------------------------------------------------------------

/**
 * Reject a request with a 400 validation error.
 * @param {object} req   CAP request object
 * @param {string} message Human-readable message
 * @param {string} [target] Optional field reference (e.g. 'quantity')
 */
export function rejectValidation(req, message, target) {
    return req.reject(HTTP_STATUS.BAD_REQUEST, message, target);
}

/**
 * Reject a request with a 404 not-found error.
 * @param {object} req     CAP request object
 * @param {string} entity  Domain name shown in the message (e.g. 'Purchase Request')
 * @param {string} [target] Optional identifier field
 */
export function rejectNotFound(req, entity, target) {
    const message = entity
        ? `${entity} not found.`
        : 'Requested resource not found.';
    return req.reject(HTTP_STATUS.NOT_FOUND, message, target);
}

/**
 * Reject a request with a 409 conflict error.
 * @param {object} req     CAP request object
 * @param {string} message  Conflict description
 * @param {string} [target] Optional field reference
 */
export function rejectConflict(req, message, target) {
    return req.reject(HTTP_STATUS.CONFLICT, message, target);
}

/**
 * Reject a request with a 403 forbidden error.
 * @param {object} req    CAP request object
 * @param {string} message Authorization failure description
 */
export function rejectForbidden(req, message) {
    return req.reject(HTTP_STATUS.FORBIDDEN, message || 'Access denied.');
}

/**
 * Reject a request with a 422 unprocessable-entity error.
 * @param {object} req    CAP request object
 * @param {string} message Semantic failure description
 * @param {string} [target] Optional field reference
 */
export function rejectUnprocessable(req, message, target) {
    return req.reject(HTTP_STATUS.UNPROCESSABLE_ENTITY, message, target);
}

/**
 * Reject a request with a 500 internal error.
 * Intended for genuinely unexpected conditions; handlers should
 * prefer the more specific helpers above.
 * @param {object} req    CAP request object
 * @param {string} message Optional override (default to generic)
 */
export function rejectInternal(req, message) {
    return req.reject(
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        message || 'An unexpected internal error occurred.'
    );
}

// ---------------------------------------------------------------------------
// Domain-specific factory helpers
// ---------------------------------------------------------------------------
// These codify the canonical messages used across the procurement domain so
// that wording stays consistent between handlers and UIs.
// ---------------------------------------------------------------------------

/**
 * Reject because a status transition is not allowed from the current state.
 * @param {object} req        CAP request object
 * @param {string} entity     Entity name (e.g. 'Purchase Request')
 * @param {string} current    Current state label
 * @param {string} expected   Expected state label required to proceed
 */
export function rejectInvalidState(req, entity, current, expected) {
    return rejectConflict(
        req,
        `${entity} cannot be processed because its status is '${current}'. Expected status: '${expected}'.`,
        'status'
    );
}
