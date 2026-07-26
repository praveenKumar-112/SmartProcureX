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
│   ├── asset-service.js         (future)
│   ├── procurement-service.cds
│   ├── procurement-service.js
│   ├── platform-service.cds
│   ├── platform-service.js      (future)
│   ├── common/
│   │   ├── constants.js
│   │   ├── errors.js
│   │   ├── validation.js
│   │   ├── utils.js
│   │   ├── calculator.js
│   │   ├── number-range.js
│   │   ├── procurement-service-helpers.js
│   │   └── warehouse-service-helpers.js
│   └── handlers/
│       ├── procurement-handler.js
│       ├── warehouse-handler.js
│       ├── asset-handler.js
│       └── notification-handler.js
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
