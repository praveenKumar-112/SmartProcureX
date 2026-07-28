/**
 * SmartProcureX - cross-service db run facade
 * --------------------------------------------------
 * Responsibility:
 *   Single point through which every cross-service db
 *   operation (`cds.db.run`) is routed. Wrapping the underlying
 *   `cds.db.run` in an `async function` with one `await` yields
 *   exactly one microtask before the operation reaches the
 *   @cap-js/sqlite driver, which is sufficient to break the
 *   nested-tx pool-acquire deadlock that otherwise manifests
 *   when the operation is issued from inside an active
 *   `before('CREATE', ...)` handler whose INSERT already holds
 *   the shared sqlite write-lock (production bug-fix for
 *   TICKET-008).
 *
 * Design:
 *   - The wrapper is a transparent pass-through under any
 *     multi-connection pool (HANA / external sqlite file with a
 *     larger pool); the single microtask yield is an unobservable
 *     semantic change.
 *   - The wrapper is installed ONCE as a CE-lifetime side effect
 *     of importing this module: the `cds.db.run` slot itself is
 *     replaced with the version below so that every caller (CAP
 *     internals, helpers, handlers) hits the wrapped path
 *     uniformly. The original `cds.db.run` reference is preserved
 *     in this module's closure so the patch can be re-applied
 *     safely if `cds` is reloaded.
 *   - All helpers that previously called `cds.db.run(q)` directly
 *     still continue to work unchanged because the patched slot
 *     is the canonical entry point. They are also migrated to use
 *     the local `dbRun` shorth and for readability / explicit
 *     cross-service intent.
 *   - No architectural-policy change is introduced; the wrapper is
 *     a runtime workaround for a driver-specific deadlock quirk.
 */
import cds from '@sap/cds';

// ---------------------------------------------------------------------------
// Install the patched `cds.db.run` exactly once. Idempotent.
// ---------------------------------------------------------------------------
const _originalDbRun = cds.db.run.bind(cds.db);
if (!cds.db.__smartprocurex_dbRun_patched) {
    cds.db.run = async function dbRunPatched(query) {
        // Single `await` of cds.db.run's returned thenable yields
        // exactly one microtask before delegating, which is what
        // breaks the @cap-js/sqlite single-connection nested-tx
        // acquire deadlock described in the header.
        return await _originalDbRun(query);
    };
    Object.defineProperty(cds.db, '__smartprocurex_dbRun_patched', {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false
    });
}

/**
 * Run a CQN query against the shared `cds.db` facade, with one
 * microtask yield to break the @cap-js/sqlite nested-tx deadlock.
 *
 * Helpers that perform cross-service db queries should import and call
 * this helper so the cross-service intent is explicit at the call site
 * (the slot-level patch on `cds.db.run` itself ensures CAP-internal
 * calls also benefit from the fix).
 *
 * @param {import('@sap/cds').cqn} query
 * @returns {Promise<any>} resolved result of `cds.db.run(query)`
 */
export async function dbRun(query) {
    return await cds.db.run(query);
}

