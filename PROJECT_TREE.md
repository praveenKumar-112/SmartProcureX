# SmartProcureX - Project Tree

> Live snapshot of the project file structure.
> Updated whenever a file is created, renamed, moved, or removed.
> Excludes `node_modules/`, `gen/`, `package-lock.json`.

```
SmartProcureX/
├── .gitignore
├── package.json
├── mta.yaml
├── readme.md
├── DESIGN_SUMMARY.md
├── IMPLEMENTATION_REPORT.md
├── PROJECT_ANALYSIS.md
├── PROJECT_SETUP_REPORT.md
├── PROJECT_PROGRESS.md
├── PROJECT_DECISIONS.md
├── PROJECT_TREE.md
├── CODING_STANDARDS.md
│
├── db/
│   ├── schema.cds
│   ├── identity.cds
│   ├── supplier.cds
│   ├── procurement.cds
│   ├── warehouse.cds
│   ├── asset.cds
│   ├── platform-support.cds
│   ├── common/
│   │   └── number-range.cds
│   └── data/
│       └── smartprocurex.common-NumberRanges.csv
│
├── srv/
│   ├── identity-service.cds
│   ├── identity-service.js      (future)
│   ├── supplier-service.cds
│   ├── supplier-service.js      (future)
│   ├── warehouse-service.cds
│   ├── warehouse-service.js
│   ├── asset-service.cds
│   ├── asset-service.js
│   ├── procurement-service.cds
│   ├── procurement-service.js
│   ├── platform-service.cds
│   ├── platform-service.js
│   ├── reporting-service.cds
│   ├── reporting-service.js
│   ├── common/
│   │   ├── asset-service-helpers.js
│   │   ├── calculator.js
│   │   ├── constants.js
│   │   ├── db-run.js
│   │   ├── errors.js
│   │   ├── notification-service-helpers.js
│   │   ├── number-range.js
│   │   ├── procurement-service-helpers.js
│   │   ├── reporting-service-helpers.js
│   │   ├── utils.js
│   │   ├── validation.js
│   │   └── warehouse-service-helpers.js
│   └── handlers/
│       ├── asset-handler.js
│       ├── notification-handler.js
│       ├── procurement-handler.js
│       ├── reporting-handler.js
│       └── warehouse-handler.js
│
├── test/
│   ├── notification-e2e.test.js
│   ├── reporting-e2e.test.js
│   ├── probe-cross.err
│   ├── probe-cross.mjs
│   ├── probe-cross.out
│   ├── probe-prtp.out
│   ├── probe.mjs
│   ├── probe2.mjs
│   ├── probe2.out
│   ├── probe3.mjs
│   ├── probe3.out
│   ├── probe4.mjs
│   ├── probe4.out
│   ├── probe5.mjs
│   ├── probe5.out
│   ├── probe5b.mjs
│   ├── probe5c.mjs
│   ├── probe5d.mjs
│   ├── probe5e.mjs
│   ├── probe5f.mjs
│   ├── probe5g.mjs
│   ├── probe5h.mjs
│   └── probe5i.mjs
│
└── docs/
    ├── API_STRATEGY.md
    ├── BUSINESS_REQUIREMENTS.md
    ├── BUSINESS_WORKFLOW.md
    ├── CODING_STANDARDS.md
    ├── DOMAIN_MODEL.md
    ├── MODULE_BREAKDOWN.md
    ├── PROJECT_ROADMAP.md
    └── SYSTEM_ARCHITECTURE.md
```

### Legend
- `(future)` - file does not yet exist but is planned per the phase order.
- All other entries exist on disk as of the latest update.
