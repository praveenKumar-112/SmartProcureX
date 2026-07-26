# SmartProcureX - Coding Standards

> Authoritative and binding for every change to source code.
> Mirrors and extends `docs/CODING_STANDARDS.md`.

---

## 1. Architecture

- Two top-level folders only: `db/` (data model) and `srv/` (services + handlers).
- `app/` reserved for future Fiori UI; not used in this coding phase.
- No business logic in `db/`. No persistence definitions in `srv/handlers/`.
- One CDS service per domain. Projections only; no new entities in the service layer.

## 2. Naming Conventions

| Element                | Convention                | Example                |
|------------------------|---------------------------|------------------------|
| Entity                 | PascalCase singular       | `PurchaseRequest`      |
| Service                | PascalCase + `Service`    | `ProcurementService`   |
| Action / Function     | camelCase                 | `submitPurchaseRequest`|
| Service projection     | Plural                    | `PurchaseRequests`     |
| Field                  | camelCase                 | `requestDate`          |
| Enum symbol            | PascalCase element        | `#Draft`, `#Submitted` |
| JS module              | kebab-case                | `number-range.js`      |
| JS function            | camelCase                 | `computeLineTotal`     |
| JS constant            | UPPER_SNAKE_CASE          | `HTTP_STATUS`          |
| Namespace              | `smartprocurex.<domain>`  | `smartprocurex.procurement` |

## 3. Folder Conventions

```
db/<domain>.cds
db/common/<shared>.cds
 srv/<domain>-service.cds
 srv/<domain>-service.js          (one-liner re-export of the handler)
 srv/common/<shared-lib>.js
 srv/common/<domain>-service-helpers.js   (per-domain reusable logic)
 srv/handlers/<domain>-handler.js
```

## 4. Import Order (top to bottom of every `.js`)

1. External packages (`@sap/cds`, etc.).
2. `srv/common/*` shared libraries.
3. `srv/common/<domain>-service-helpers.js` (when present).
4. Local handler imports.
5. Then the `cds.ql` destructure on its own line.

Example:

```js
import cds from '@sap/cds';
import { generateBusinessNumber } from '../common/number-range.js';
import)));
import { rollUpItems } from '../common/calculator.js';
import { recalculatePurchaseRequestTotal }
    from '../common/procurement-service-helpers.js';
import { DOCUMENT_PREFIX, PURCHASE_REQUEST_STATUS } from '../common/constants.js';

const { SELECT, UPDATE } = cds.ql;
```

## 5. Comment Standards

- Every file starts with a JSDoc block describing Responsibility + Design.
- Every exported function has a JSDoc block with `@param` and `@returns`.
- Section headers use a 60-char banner:
  ```js
  // ============================================================
  // Section Title
  // ============================================================
  ```
- No TODO / FIXME / XXX comments. No dead code.

## 6. Validation Standards

- Pure checks in `srv/common/validation.js` (no CAP import).
- Side-effect-ful `require*` rejecters in the same module.
- In handlers, prefer the `require*` early-return idiom:
  ```js
  if (!requirePositive(req, qty, 'quantity')) return;
  ```
- Never rely on exceptions for control flow.

## 7. Error Handling

- Handlers reject exclusively via `req.reject(code, msg, target)`.
- Codes come from `HTTP_STATUS` in `srv/common/errors.js`.
- Use `rejectValidation` / `rejectNotFound` / `rejectConflict` /
  `rejectForbidden` / `rejectUnprocessable` / `rejectInternal` / `rejectInvalidState`.
- No `throw new Error(...)` inside handlers.

## 8. Function Order (inside a handler file)

1. Imports.
2. `cds.ql` destructure.
3. `cds.service.impl(function () { ... })`.
4. Local entity destructure (`const { PurchaseRequests, ... } = this.entities;`).
5. `before` hooks in lifecycle order (CREATE -> UPDATE -> DELETE).
6. `on` action handlers in business-flow order.
7. (No module-level mutable state; handlers are stateless.)

## 9. File Organization

- One handler file per domain service.
- Cross-handler reusable logic goes to `srv/common/`.
- Per-domain reused helpers go to `srv/common/<domain>-service-helpers.js`.
- Never duplicate logic; always call the shared helper.

## 10. Formatting Rules

- 4-space indentation.
- Single quotes for strings.
- Semicolons required.
- `async`/`await` for all asynchronous operations. No `.then()/.catch()` chains.
- Trailing commas in multi-line literals.
- Max line length: 110 characters.

## 11. Reusable Code Rules

- Before writing new logic, check `srv/common/` for an existing helper.
- If a snippet is used in two handlers, move it to `srv/common/`.
- Database lookups used by multiple actions live in the domain's
  `*-service-helpers.js`, taking `tx` + identifiers as parameters.

## 12. Entire File Response Policy

- Whenever a file is modified, the COMPLETE file content is returned in the response.
- Snippets ("replace this block", "add below") are forbidden.
- Imports may never be omitted in the returned content.

## 13. No Duplicated Code

- Number generation: only via `generateBusinessNumber`.
- Decimal math: only via `calculator.js`.
- Validation: only via `validation.js` / `errors.js`.
- Date handling: only via `utils.js` date helpers.
- Header total recalculation: only via the per-domain service helpers.
