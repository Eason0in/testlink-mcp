# Contributing

Use Node 24.19.0 (`nvm use`) and keep examples synthetic. Never add real TestLink URLs, keys, account names, exported cases, attachments, or private package dependencies.

Before proposing a change:

```bash
npm ci
npm run check
npm test
npm run eval
npm run build
npm audit --omit=dev --audit-level=high
npm pack --dry-run
```

Write tools must retain preview-before-apply behavior, an explicit confirmation flag, snapshot conflict detection, no automatic retry, and ledger recording. Do not add delete tools.
