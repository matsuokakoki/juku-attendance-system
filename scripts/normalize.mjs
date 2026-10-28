import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const digest = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const addDay = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Invalid date");
  const d = new Date(s + "T12:00:00Z");
  if (d.toISOString().slice(0, 10) !== s) throw new Error("Invalid date");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
export function normalize(snapshot, since) {
  if (snapshot.project !== "juku-attendance")
    throw new Error("Unexpected source project");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since))
    throw new Error("--since is required");
  const tables = {
    students: [],
    months: [],
    calendar: [],
    subjects: [],
    templates: [],
    attendance_templates: [],
    template_state: [{ id: 1, revision: 0 }],
    reservations: [],
    announcements: [],
    login_events: [],
    site_content: [],
    migration_mapping: [],
  };
  const warnings = [];
  const docs = snapshot.documents;
  const list = docs.find((d) => d.path === "students/list")?.data;
  if (!list?.names?.length) throw new Error("Empty roster");
  const ids = new Map(
    list.names.map((name) => [name, "s-" + digest(name).slice(0, 24)]),
  );
  tables.students = list.names.map((name) => ({
    id: ids.get(name),
    name,
    yomi: list.yomiMap?.[name] ?? "",
    active: 1,
  }));
  const calendar = new Map();
  const months = new Map();
  const reservations = new Set();
  const counts = new Map();
  function ensureMonth(month) {
    if (!months.has(month))
      months.set(month, { month, published: 0, revision: 0 });
  }
  function mapped(doc, date, rule) {
    tables.migration_mapping.push({
      source_path: doc.path + (date ? "#" + date : ""),
      actual_date: date ?? null,
      hash: digest(doc.data),
      rule,
    });
  }
  for (const doc of docs) {
    const p = doc.path.split("/");
    const data = doc.data;
    if (p[0] === "subjects") {
      for (const [day, periods] of Object.entries(data)) {
        if (!weekdays.includes(day)) continue;
        for (const [period, subject] of Object.entries(periods)) {
          if (/^[1-6]限$/.test(period) && typeof subject === "string")
            tables.subjects.push({
              pattern: p[1],
              weekday: weekdays.indexOf(day),
              period: Number(period[0]),
              subject,
            });
        }
      }
    }
    if (["holidays", "temporaryDays", "temporaryDays2"].includes(p[0])) {
      for (const [key, value] of Object.entries(data)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
        const date = addDay(key);
        if (date < since) continue;
        if (date.slice(0, 7).replace("-", "") !== p[1])
          throw new Error("Calendar month/date conflict in " + p[0]);
        const row = calendar.get(date) ?? {
          date,
          closed: 0,
          pattern: "default",
          reason: "",
        };
        if (p[0] === "holidays") row.closed = value === true ? 1 : 0;
        else if (
          value === true &&
          (p[0] === "temporaryDays2" || row.pattern === "default")
        )
          row.pattern = p[0] === "temporaryDays2" ? "temporary2" : "temporary";
        calendar.set(date, row);
        mapped(doc, date, "legacy-local-midnight-plus-one");
      }
    }
    if (p[0] === "attendance" && p.length === 4) {
      const date = addDay(p[3]);
      if (date.slice(0, 7).replace("-", "") !== p[2])
        throw new Error("Attendance month/date conflict");
      if (date < since) continue;
      ensureMonth(date.slice(0, 7));
      for (const [period, present] of Object.entries(data)) {
        if (present !== true || !/^[1-6]限$/.test(period)) continue;
        const key = ids.get(p[1]) + ":" + date + ":" + period[0];
        if (!ids.has(p[1])) throw new Error("Unknown student");
        if (reservations.has(key)) throw new Error("Duplicate reservation");
        reservations.add(key);
        tables.reservations.push({
          student_id: ids.get(p[1]),
          date,
          period: Number(period[0]),
        });
        const countKey = date + ":" + period[0];
        counts.set(countKey, (counts.get(countKey) ?? 0) + 1);
      }
      mapped(doc, date, "legacy-attendance-plus-one-validated-against-parent");
    }
    if (p[0] === "templates" && p[2] === "default" && p.length === 6) {
      const month = p[3].slice(0, 4) + "-" + p[3].slice(4);
      if (month < since.slice(0, 7)) continue;
      ensureMonth(month);
      if (!ids.has(p[5])) {
        warnings.push("Inactive template student omitted");
        continue;
      }
      for (const [day, periods] of Object.entries(data)) {
        if (!weekdays.includes(day) || !Array.isArray(periods)) continue;
        for (const period of periods) {
          if (/^[1-6]限$/.test(period))
            tables.templates.push({
              month,
              student_id: ids.get(p[5]),
              weekday: weekdays.indexOf(day),
              period: Number(period[0]),
            });
        }
      }
      mapped(doc, null, "weekly-template-no-date-shift");
    }
    if (p[0] === "templates" && p[2] === "visibility") {
      const month = p[3].slice(0, 4) + "-" + p[3].slice(4);
      if (month < since.slice(0, 7)) continue;
      ensureMonth(month);
      months.get(month).published = data.visible === true ? 1 : 0;
    }
    if (p[0] === "announcements") {
      let created = data.createdAt;
      const seconds = created?._seconds ?? created?.seconds;
      const at = seconds
        ? new Date(seconds * 1000).toISOString()
        : (doc.updateTime ?? snapshot.exportedAt);
      tables.announcements.push({
        id: p[1],
        text: String(data.text ?? ""),
        created_at: at,
      });
    }
    if (p[0] === "pages" && p[1] === "home")
      tables.site_content.push({
        id: "home",
        data: JSON.stringify(
          Object.fromEntries(
            Object.entries(data).filter(
              ([key, v]) => key.endsWith("_html") && typeof v === "string",
            ),
          ),
        ),
      });
    if (p[0] === "accessLog" && p.length === 4 && p[3] >= since) {
      for (const [name, present] of Object.entries(data)) {
        if (present === true && ids.has(name))
          tables.login_events.push({
            student_id: ids.get(name),
            created_at: p[3] + "T03:00:00.000Z",
          });
      }
      mapped(doc, p[3], "legacy-log-date-preserved-time-unavailable");
    }
  }
  tables.months = [...months.values()];
  tables.calendar = [...calendar.values()];
  let countMismatches = 0;
  for (const doc of docs) {
    const p = doc.path.split("/");
    if (p[0] !== "attendanceCount" || p.length !== 4) continue;
    const date = addDay(p[3]);
    if (date < since) continue;
    for (const [period, count] of Object.entries(doc.data)) {
      if (
        /^[1-6]$/.test(period) &&
        Number(count) !== (counts.get(date + ":" + period) ?? 0)
      )
        countMismatches++;
    }
  }
  if (tables.login_events.length)
    warnings.push(
      "Legacy access logs contain dates only; preserved source dates and assigned noon JST. Exact login times cannot be recovered.",
    );
  const exportMonth = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date(snapshot.exportedAt));
  const nextMonth = new Date(exportMonth + "-01T12:00:00Z");
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const preferred = nextMonth.toISOString().slice(0, 7);
  const templateMonth = tables.templates.some((row) => row.month === preferred)
    ? preferred
    : tables.templates
        .map((row) => row.month)
        .sort()
        .at(-1);
  tables.attendance_templates = tables.templates
    .filter((row) => row.month === templateMonth)
    .map(({ student_id, weekday, period }) => ({
      student_id,
      weekday,
      period,
    }));
  warnings.push(
    `Shared template initialized from ${templateMonth ?? "empty"}; monthly source retained for reconciliation.`,
  );
  return {
    version: 2,
    since,
    sourceExportedAt: snapshot.exportedAt,
    tables,
    report: {
      rows: Object.fromEntries(
        Object.entries(tables).map(([k, v]) => [k, v.length]),
      ),
      countMismatches,
      warnings: [...new Set(warnings)],
    },
  };
}
export function toSql(normalized) {
  const quote = (v) =>
    v === null
      ? "NULL"
      : typeof v === "number"
        ? String(v)
        : "'" + String(v).replaceAll("'", "''") + "'";
  const lines = ["UPDATE students SET active=0;"];
  for (const table of [
    "reservations",
    "templates",
    "attendance_templates",
    "template_state",
    "calendar",
    "months",
    "subjects",
    "announcements",
    "login_events",
    "migration_mapping",
  ])
    lines.push(`DELETE FROM ${table};`);
  for (const [table, rows] of Object.entries(normalized.tables)) {
    if (table === "site_content" && rows.every((row) => row.data === "{}"))
      continue;
    for (const row of rows) {
      const keys = Object.keys(row);
      lines.push(
        `INSERT OR REPLACE INTO ${table}(${keys.join(",")}) VALUES(${keys.map((k) => quote(row[k])).join(",")});`,
      );
    }
  }
  return lines.join("\n") + "\n";
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  const since = process.argv[3];
  if (!input || !since)
    throw new Error(
      "Usage: node scripts/normalize.mjs snapshot.json YYYY-MM-DD",
    );
  const result = normalize(JSON.parse(readFileSync(input, "utf8")), since);
  mkdirSync("private", { recursive: true, mode: 0o700 });
  writeFileSync("private/normalized.json", JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
  writeFileSync("private/import.sql", toSql(result), { mode: 0o600 });
  writeFileSync(
    "private/migration-report.json",
    JSON.stringify(result.report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result.report, null, 2));
}
