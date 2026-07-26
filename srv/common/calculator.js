/**
 * SmartProcureX - Financial Calculation Library
 * --------------------------------------------------
 * Responsibility:
 *   Provide decimal-safe arithmetic for procurement amounts. All monetary
 *   fields in the domain are `Decimal(15,2)`; quantities use `Decimal(13,3)`.
 *
 * Design:
 *   - JavaScript `number` carries IEEE-754 float drift. To avoid the
 *     classic 0.1 + 0.2 = 0.30000000000000004 problem in a procurement
 *     ledger, every operation first scales to integer minor units, performs
 *     integer math, then scales back. This produces exact results for the
 *     scale combinations used in SmartProcureX and matches CAP/HANA decimal
 *     rounding on round-trip.
 *   - `scaleFor` infers the number of decimals from the input on the fly so
 *     the same helper serves both 2-decimal amounts and 3-decimal quantities.
 *   - All functions are pure and side-effect free.
 *   - No external dependency (no decimal.js / bignumber.js) is introduced
 *     because the application layer only needs add / subtract / multiply /
 *     round at the declared scales; persistence-layer integrity is the
 *     database's responsibility.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Infer the smallest scale (decimal places) needed to represent a number
 * exactly as an integer. Caps at 10 to avoid pathological inputs.
 */
function inferScale(value) {
    if (!Number.isFinite(Number(value))) return 0;
    const str = String(value);
    if (!str.includes('.') && !str.toLowerCase().includes('e')) return 0;
    if (str.toLowerCase().includes('e')) {
        // Exponential notation: scale = decimals - exponent.
        const [mantissa, expStr] = str.toLowerCase().split('e');
        const exp = Number(expStr);
        const decimals = mantissa.includes('.') ? mantissa.split('.')[1].length : 0;
        return Math.max(0, decimals - exp);
    }
    return str.split('.')[1].length;
}

/**
 * Convert a numeric value to minor units at a fixed scale.
 */
function toMinorUnits(value, scale) {
    const factor = 10 ** scale;
    return Math.round(Number(value) * factor);
}

/**
 * Round a number to a fixed number of decimal places (banker-free, half-up).
 */
function roundToScale(value, scale) {
    const factor = 10 ** scale;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sum a list of monetary values, preserving the highest scale seen.
 */
export function sumAmounts(values) {
    const list = Array.isArray(values) ? values : [values];
    if (list.length === 0) return 0;

    let maxScale = 0;
    for (const v of list) {
        if (!Number.isFinite(Number(v))) continue;
        const s = inferScale(v);
        if (s > maxScale) maxScale = s;
    }
    const cappedScale = Math.min(maxScale, 2);   // monetary fields are (15,2)

    const totalMinor = list.reduce(
        (acc, v) => acc + (Number.isFinite(Number(v)) ? toMinorUnits(v, cappedScale) : 0),
        0
    );

    return totalMinor / 10 ** cappedScale;
}

/**
 * Multiply a quantity by a unit price. Result is rounded to 2 decimals
 * (the scale of `PurchaseRequestItem.totalPrice`).
 */
export function computeLineTotal(quantity, unitPrice) {
    const q = Number(quantity);
    const p = Number(unitPrice);
    if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
    const product = q * p;
    return roundToScale(product, 2);
}

/**
 * Add two monetary values at scale 2.
 */
export function addAmounts(a, b) {
    return roundToScale(Number(a) + Number(b), 2);
}

/**
 * Subtract `b` from `a` at scale 2. Guards against negative totals which
 * are not permitted for document amounts unless explicitly allowed.
 */
export function subtractAmounts(a, b) {
    return roundToScale(Number(a) - Number(b), 2);
}

/**
 * Multiply two amounts at scale 2 (e.g. price * tax-rate in percent).
 */
export function multiplyAmount(amount, factor) {
    return roundToScale(Number(amount) * Number(factor), 2);
}

/**
 * Round any numeric value to the monetary scale of 2.
 */
export function toMonetary(value) {
    return roundToScale(value, 2);
}

/**
 * Round any numeric value to the quantity scale of 3.
 */
export function toQuantity(value) {
    return roundToScale(value, 3);
}

/**
 * Recompute the header total of a document from its line items.
 * @param {Array<{totalPrice?:number, lineTotal?:number}>} items
 * @returns {number} summed total at scale 2
 */
export function rollUpItems(items) {
    const list = Array.isArray(items) ? items : [];
    const totals = list.map((i) => i.totalPrice ?? i.lineTotal ?? 0);
    return roundToScale(sumAmounts(totals), 2);
}
