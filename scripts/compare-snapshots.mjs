import { readFileSync, writeFileSync } from "node:fs";
import { normalize } from "./normalize.mjs";
const [before, after, since] = process.argv.slice(2);
if (!before || !after || !since)
  throw new Error(
    "Usage: node scripts/compare-snapshots.mjs before.json after.json YYYY-MM-DD",
  );
const a = normalize(JSON.parse(readFileSync(before, "utf8")), since).tables;
const b = normalize(JSON.parse(readFileSync(after, "utf8")), since).tables;
const key = {
  students: (r) => r.id,
  months: (r) => r.month,
  calendar: (r) => r.date,
  subjects: (r) => [r.pattern, r.weekday, r.period].join("/"),
  templates: (r) => [r.month, r.student_id, r.weekday, r.period].join("/"),
  attendance_templates: (r) => [r.student_id, r.weekday, r.period].join("/"),
  template_state: (r) => String(r.id),
  reservations: (r) => [r.student_id, r.date, r.period].join("/"),
  announcements: (r) => r.id,
  login_events: (r) => [r.student_id, r.created_at].join("/"),
  site_content: (r) => r.id,
  migration_mapping: (r) => r.source_path,
};
const report = {};
for (const table of Object.keys(a)) {
  const old = new Map(
    a[table].map((row) => [key[table](row), JSON.stringify(row)]),
  );
  const next = new Map(
    b[table].map((row) => [key[table](row), JSON.stringify(row)]),
  );
  report[table] = {
    added: [...next].filter(([k]) => !old.has(k)).length,
    changed: [...next].filter(([k, v]) => old.has(k) && old.get(k) !== v)
      .length,
    deleted: [...old].filter(([k]) => !next.has(k)).length,
  };
}
writeFileSync("private/diff-report.json", JSON.stringify(report, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
