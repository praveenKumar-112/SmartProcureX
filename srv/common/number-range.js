/**
 * SmartProcureX - Business Document Number Range Generator
 * ---------------------------------------------------------
 * Responsibility:
 *   Generate a sequential, year-scoped business document number of the
 *   form `<PREFIX>-<YYYY>-<000000>` (e.g. `PR-2026-000001`). The current
 *   sequence value is persisted in the `NumberRanges` entity defined in
 *   `db/common/number-range.cds` and pre-seeded for the project's known
 *   prefixes (see `db/data/smartprocurex.common-NumberRanges.csv`).
 *
 * Design:
 *   - The `NumberRanges` entity lives in the `smartprocurex.common`
 *     namespace and is intentionally NOT projected into any of the
 *     domain services (IdentityService, ProcurementService, etc.).
 *     That makes it visible only via the shared `cds.db` facade, not
 *     via a domain-service `tx`. Invoking `tx.run(SELECT.from(
 *     NumberRanges))` from inside `ProcurementService.tx(...)` raises
 *     "Target smartprocurex.common.NumberRanges cannot be resolved for
 *     service ProcurementService" — a real production fault that first
 *     surfaced when TICKET-008 began dispatching `ProcurementService
 *     .tx().run(INSERT.into(PurchaseRequests))` to exercise the OData
 *     CRUD path (TICKET-007 tests bypassed the service layer via
 *     `cds.db.run(...)` and so never exercised the bug).
 *   - All NumberRanges I/O is therefore routed through `dbRun`
 *     (the canonical `cds.db.run` wrapper in `./db-run.js`), the shared
 *     db facade, which can resolve canonical entities that
 *     are not exposed by any service projection (AD-21).
 *     Because `cds.db` runs on the same sqlite connection as the
 *     caller's service tx under @cap-js/sqlite, the writes participate
 *     in the caller's open transaction and roll back atomically with
 *     the originating business action (PR CREATE / PO CREATE / GR
 *     CREATE / Asset CREATE).
 *   - `tx` is kept as the first parameter solely so call sites remain
 *     stable for any future deployment where NumberRanges IS projected
 *     into a service and the caller wants to ride on that service's tx.
 *
 * Reuse:
 *   - Called by procurement (PR + PO create), warehouse (GR create),
 *     asset (asset create) handlers.
 */
import cds from '@sap/cds';
import { dbRun } from './db-run.js';

const { SELECT, INSERT, UPDATE } = cds.ql;

export async function generateBusinessNumber(_tx, objectType) {

    const year = new Date().getFullYear();

    const { NumberRanges } = cds.entities('smartprocurex.common');

    let range = await dbRun(
        SELECT.one.from(NumberRanges).where({
            objectType,
            year
        })
    );

    if (!range) {

        range = {
            objectType,
            year,
            currentNumber: 0
        };

        await dbRun(
            INSERT.into(NumberRanges).entries(range)
        );

    }

    const nextNumber = range.currentNumber + 1;

    await dbRun(
        UPDATE(NumberRanges)
            .set({
                currentNumber: nextNumber
            })
            .where({
                objectType,
                year
            })
    );

    return `${objectType}-${year}-${String(nextNumber).padStart(6, '0')}`;
}
