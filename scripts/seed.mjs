import { writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
}).format(new Date());
const month = today.slice(0, 7);
const start = new Date(month + "-01T12:00:00Z");
const statements = [
  "DELETE FROM reservations WHERE student_id LIKE 'demo-%';",
  "DELETE FROM templates WHERE student_id LIKE 'demo-%';",
  "DELETE FROM sessions;",
  "DELETE FROM rate_limits;",
  `INSERT INTO students(id,name,yomi) VALUES('demo-yamada','山田','やまだ'),('demo-sato','佐藤','さとう') ON CONFLICT(id) DO UPDATE SET active=1;`,
];
for (let m = 0; m < 3; m++) {
  const dt = new Date(start);
  dt.setUTCMonth(dt.getUTCMonth() + m);
  const ym = dt.toISOString().slice(0, 7);
  statements.push(
    `INSERT INTO months(month,published) VALUES('${ym}',1) ON CONFLICT(month) DO UPDATE SET published=1,revision=revision+1;`,
  );
  for (let i = 0; i < 31; i++) {
    const day = new Date(dt);
    day.setUTCDate(i + 1);
    if (day.toISOString().slice(0, 7) !== ym) break;
    if (day.getUTCDay() !== 0)
      for (const id of ["demo-yamada", "demo-sato"])
        statements.push(
          `INSERT OR IGNORE INTO reservations VALUES('${id}','${day.toISOString().slice(0, 10)}',1);`,
        );
  }
}
mkdirSync("private", { recursive: true });
writeFileSync("private/seed.sql", statements.join("\n"));
const r = spawnSync(
  process.execPath,
  [
    "scripts/wrangler.mjs",
    "d1",
    "execute",
    "attendance",
    "--local",
    "--file",
    "private/seed.sql",
  ],
  { encoding: "utf8", env: process.env },
);
if (r.status) console.error(r.stderr || r.stdout);
else console.log("架空データをローカルDBに投入しました");
process.exitCode = r.status ?? 1;
