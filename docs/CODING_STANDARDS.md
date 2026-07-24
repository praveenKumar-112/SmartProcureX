# Coding Standards

This document defines future implementation standards. No code is introduced by this document.

## Folder Conventions

Current foundation:

```text
app/   - Future SAPUI5 frontend applications.
db/    - Future CAP domain models and database-facing design artifacts.
srv/   - Future CAP service definitions and service implementation.
docs/  - Architecture, design, standards, and project documentation.
```

Future recommended structure:

- Keep each SAPUI5 portal under a clear application folder.
- Keep CAP service definitions grouped by business domain.
- Keep service implementation files close to their service ownership.
- Keep tests separate from production code.
- Keep generated folders such as `gen/` out of source control.
- Keep local-only files such as SQLite databases and private CDS config out of source control.

## Naming Conventions

General:

- Use business-readable names.
- Avoid unclear abbreviations.
- Use consistent terminology across UI, API, documentation, and CAP models.
- Prefer singular names for business concepts and plural names for collections where applicable.

Files and folders:

- Use lowercase or kebab-case for technical folders where framework conventions allow.
- Use clear domain names for module folders.
- Keep generated files out of manual editing.

Configuration:

- Keep project package name lowercase.
- Preserve stable MTA module and resource names after deployment begins.

## CAP Conventions

Future CAP implementation should:

- Use standard CAP project layout.
- Keep domain models in `db/`.
- Keep service definitions and handlers in `srv/`.
- Use CAP annotations consistently.
- Prefer declarative CAP behavior before custom implementation.
- Keep custom logic focused and testable.
- Avoid exposing persistence models directly when a service contract should be stable.
- Use environment-specific configuration for local and production targets.
- Treat SAP HANA Cloud as the production persistence model.

## SAPUI5 Conventions

Future SAPUI5 implementation should:

- Follow SAP Fiori design principles.
- Use role-specific applications rather than one overloaded interface.
- Keep controller logic thin.
- Keep backend business rules in CAP.
- Use i18n files for user-facing text.
- Use reusable components only when they reduce real duplication.
- Use consistent table, filter, object page, and worklist patterns.
- Meet enterprise accessibility and responsiveness expectations.

## Git Strategy

Recommended strategy:

- Keep `main` deployable.
- Use feature branches for implementation work.
- Use pull requests for review.
- Require code review for business logic, security, data model, and deployment changes.
- Keep generated dependencies and build output out of Git.
- Commit documentation changes alongside related design decisions.

## Commit Message Format

Recommended format:

```text
<type>(<scope>): <summary>
```

Types:

- `docs`: Documentation only.
- `feat`: New feature.
- `fix`: Bug fix.
- `refactor`: Internal restructuring without behavior change.
- `test`: Test changes.
- `build`: Build, dependency, or deployment changes.
- `chore`: Maintenance tasks.

Examples:

```text
docs(architecture): add procurement workflow design
feat(requests): add purchase request submission
build(mta): configure hana deployer
```

## Branch Naming

Recommended branch names:

```text
docs/architecture-foundation
feature/purchase-requests
feature/approval-workflow
fix/purchase-order-status
build/mta-deployment
```

## Documentation Standards

Documentation should:

- Be stored under `docs/` unless it is project-level setup material.
- Describe intent, responsibility, and decisions.
- Avoid documenting implementation details before they exist.
- Include assumptions and open questions where decisions are pending.
- Be updated when architecture, workflow, security, or deployment decisions change.
- Use Markdown tables and diagrams where they improve clarity.
