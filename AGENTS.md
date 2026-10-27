# Working on this application

- Read README.md and docs/operations.md before changing infrastructure.
- Keep the established student login inputs and cancellation-only permissions.
- Teachers authenticate once per JST calendar day. Do not change this to a sliding 24-hour or monthly expiry.
- Use YYYY-MM-DD for class dates. Do not convert local midnight through toISOString. Audit timestamps use UTC.
- Normal, temporary B and temporary C are all supported. C takes precedence when importing overlapping legacy flags.
- Keep API authorization independent of UI controls. Session cookies are HttpOnly; all mutations require same-origin and CSRF validation.
- Use local D1 and fake data for development and tests. Never seed fake data into the production database.
- Keep credentials, actual student data, logs and migration snapshots in ignored private/ or secret files.
- Record schema changes as migrations. Keep production maintenance enabled until the scheduled final snapshot, reconciliation and cutover are complete.
- Run npm run check and npm run test:e2e after substantive changes. Build before starting the preview server; restart preview after a build if asset watching is unavailable.
- Update docs/verification.md with what was actually verified. Do not describe a preview deployment as the completed production cutover.
