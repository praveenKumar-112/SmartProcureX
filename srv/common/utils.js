/**
 * SmartProcureX - Common Utility Helpers
 * --------------------------------------------------
 * Responsibility:
 *   Provide cross-cutting helpers used by multiple handlers.
 *
 * Design:
 *   - Pure functions (no CAP runtime dependency) where possible.
 *   - Date helpers normalize to UTC and emit ISO strings consistent with
 *     CAP `Date` / `DateTime` element types.
 *   - Identifier helpers are defensive about null/undefined inputs.
 */

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Return today's date as an ISO date string (yyyy-mm-dd).
 * Suitable for CAP `Date` element types. UTC is used to avoid timezone drift.
 */
export function todayIsoDate() {
    return new Date().toISOString().split('T')[0];
}

/**
 * Return the current timestamp as an ISO string with milliseconds.
 * Suitable for CAP `DateTime` element types.
 */
export function nowIsoTimestamp() {
    return new Date().toISOString();
}

/**
 * Return the current calendar year as an integer (UTC).
 * Used by the number-range generator and reporting helpers.
 */
export function currentYear() {
    return new Date().getUTCFullYear();
}

/**
 * Format any date-y input as an ISO date string (yyyy-mm-dd).
 * Returns null when the input cannot be parsed.
 */
export function toIsoDate(value) {
    if (value == null || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
}

/**
 * Compare two date-like values.
 * @returns {number} 0 equal, -1 when a < b, 1 when a > b, NaN on invalid input
 */
export function compareDates(a, b) {
    const da = a instanceof Date ? a : new Date(a);
    const db = b instanceof Date ? b : new Date(b);
    if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return NaN;
    if (da.getTime() === db.getTime()) return 0;
    return da.getTime() < db.getTime() ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Identifier helpers
// ---------------------------------------------------------------------------

/**
 * True when the value is present and not an empty/whitespace string.
 * Equivalent semantically to validation.isNonEmpty but kept here as a
 * dependency-free convenience used outside of request validation flows.
 */
export function isPresent(value) {
    return value != null && String(value).trim().length > 0;
}

/**
 * Coerce a possibly-undefined association payload into its foreign key.
 * CAP accepts either `{ ID }` or a raw UUID for association fields; this
 * normalizer extracts the UUID so handlers can run DB lookups against it.
 */
export function associationId(associationValue) {
    if (associationValue == null) return null;
    if (typeof associationValue === 'string') return associationValue;
    if (typeof associationValue === 'object') {
        return associationValue.ID ?? associationValue.id ?? null;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Collection helpers
// ---------------------------------------------------------------------------

/**
 * Return a stable hash-free key for deduplication of arrays of objects.
 * Used by roll-up aggregators (e.g. distinct suppliers on a PO).
 */
export function uniqueBy(items, keyFn) {
    const seen = new Set();
    const result = [];
    for (const item of items ?? []) {
        const key = keyFn(item);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(item);
        }
    }
    return result;
}

/**
 * Group an array of items by a key produced by keyFn.
 * Returns a Map<key, Array<item>>.
 */
export function groupBy(items, keyFn) {
    const groups = new Map();
    for (const item of items ?? []) {
        const key = keyFn(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return groups;
}

// ---------------------------------------------------------------------------
// Safe execution wrapper
// ---------------------------------------------------------------------------

/**
 * Run an async operation and return a { ok, value, error } envelope.
 * Allows callers to keep the happy path linear without try/catch noise.
 */
export async function tryAsync(operation) {
    try {
        const value = await operation();
        return { ok: true, value, error: null };
    } catch (error) {
        return { ok: false, value: null, error };
    }
}
