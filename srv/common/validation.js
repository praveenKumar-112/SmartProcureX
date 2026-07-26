/**
 * SmartProcureX - Reusable Validation Primitives
 * --------------------------------------------------
 * Responsibility:
 *   Provide pure, side-effect-free validation helpers that handlers can
 *   invoke before performing business operations.
 *
 * Design:
 *   - Functions return Boolean verdicts (true = valid) rather than throwing,
 *     so handlers retain full control over the error response.
 *   - `require*` helpers combine the check with the rejection and return
 *     `false` when a rejection was issued, allowing the early-return idiom:
 *         if (!requireNonEmpty(req, req.data.itemName, 'itemName')) return;
 *   - No CAP imports required for the pure check helpers, keeping them
 *     unit-testable without a CAP runtime.
 */

import { rejectValidation } from './errors.js';

// ---------------------------------------------------------------------------
// Field-level checks (pure)
// ---------------------------------------------------------------------------

/**
 * True when the value is neither null nor undefined nor an empty/whitespace string.
 */
export function isNonEmpty(value) {
    return value != null && String(value).trim().length > 0;
}

/**
 * True when the value is a valid finite number.
 */
export function isNumber(value) {
    if (value == null || value === '') return false;
    const n = Number(value);
    return Number.isFinite(n);
}

/**
 * True when the value is a strictly positive finite number.
 */
export function isPositive(value) {
    return isNumber(value) && Number(value) > 0;
}

/**
 * True when the value is a finite number greater than or equal to zero.
 */
export function isNonNegative(value) {
    return isNumber(value) && Number(value) >= 0;
}

/**
 * True when the value parses to a valid Date instance.
 */
export function isDate(value) {
    if (value == null || value === '') return false;
    const d = value instanceof Date ? value : new Date(value);
    return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * True when the provided identifier looks like a UUID (v1-v5, case-insensitive).
 */
export function isUuid(value) {
    if (typeof value !== 'string') return false;
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

/**
 * True when `value` is within [min, max] inclusive.
 */
export function isInRange(value, min, max) {
    if (!isNumber(value)) return false;
    const n = Number(value);
    return n >= min && n <= max;
}

/**
 * True when `value` string length does not exceed `max`.
 */
export function isWithinLength(value, max) {
    if (value == null) return false;
    return String(value).length <= max;
}

// ---------------------------------------------------------------------------
// Composition helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Returns the first failing predicate description for an object, or null when all pass.
 * @param {object} data           Object to validate
 * @param {Array<{field:string, check:Function, message:string}>} rules
 * @returns {{field:string, message:string}|null}
 */
export function findFirstViolation(data, rules) {
    for (const rule of rules) {
        const fieldValue = data?.[rule.field];
        if (!rule.check(fieldValue, data)) {
            return { field: rule.field, message: rule.message };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Rejection helpers (combine check + reject + boolean result)
// ---------------------------------------------------------------------------

/**
 * Require a non-empty field; rejects and returns false when invalid.
 * @returns {boolean} true when valid (caller continues), false when rejected.
 */
export function requireNonEmpty(req, value, fieldName, message) {
    if (!isNonEmpty(value)) {
        rejectValidation(req, message || `${fieldName} is mandatory.`, fieldName);
        return false;
    }
    return true;
}

/**
 * Require a positive number field; rejects and returns false when invalid.
 */
export function requirePositive(req, value, fieldName, message) {
    if (!isPositive(value)) {
        rejectValidation(req, message || `${fieldName} must be greater than zero.`, fieldName);
        return false;
    }
    return true;
}

/**
 * Require a non-negative number field; rejects and returns false when invalid.
 */
export function requireNonNegative(req, value, fieldName, message) {
    if (!isNonNegative(value)) {
        rejectValidation(req, message || `${fieldName} cannot be negative.`, fieldName);
        return false;
    }
    return true;
}

/**
 * Require a UUID-shaped identifier; rejects and returns false when invalid.
 */
export function requireUuid(req, value, fieldName, message) {
    if (!isUuid(value)) {
        rejectValidation(req, message || `${fieldName} must be a valid UUID.`, fieldName);
        return false;
    }
    return true;
}

/**
 * Apply a ruleset to `data`; reject on the first violation and return false.
 * @returns {boolean} true when all rules pass, false when a rejection was issued.
 */
export function requireValid(req, data, rules, genericMessage) {
    const violation = findFirstViolation(data, rules);
    if (!violation) return true;
    rejectValidation(req, genericMessage || violation.message, violation.field);
    return false;
}
