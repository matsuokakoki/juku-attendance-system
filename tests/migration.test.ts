import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// Migration tooling is plain Node so the same source runs without a TS build.
// @ts-expect-error the migration module intentionally has no build dependency
import { normalize, toSql } from "../scripts/normalize.mjs";
const snapshot = (
  extra: { path: string; data: Record<string, unknown> }[] = [],
) => ({
  project: "juku-attendance",
  exportedAt: "2026-10-28T00:00:00Z",
  documents: [
    {
      path: "students/list",
      data: { names: ["架空生徒"], yomiMap: { 架空生徒: "かくうせいと" } },
    },
    { path: "attendance/架空生徒/202611/2026-10-31", data: { "1限": true } },
    { path: "holidays/202611", data: { "2026-11-02": true } },
    { path: "temporaryDays/202611", data: { "2026-11-01": true } },
    { path: "temporaryDays2/202611", data: { "2026-11-01": true } },
    ...extra,
  ],
});
describe("旧日付の正規化", () => {
  it("前月末キーを本来の翌月初へ変換", () => {
    const data = normalize(snapshot(), "2026-07-28");
    expect(data.tables.reservations[0].date).toBe("2026-11-01");
    expect(
      data.tables.calendar.find(
        (d: { date: string }) => d.date === "2026-11-02",
      ).pattern,
    ).toBe("temporary2");
  });
  it("共通テンプレートは抽出時点の翌月を優先し月別原本も残す", () => {
    const result = normalize(
      snapshot([
        {
          path: "templates/base/default/202610/students/架空生徒",
          data: { 月: ["1限"] },
        },
        {
          path: "templates/base/default/202611/students/架空生徒",
          data: { 火: ["2限"] },
        },
        {
          path: "templates/base/default/202612/students/架空生徒",
          data: { 水: ["3限"] },
        },
      ]),
      "2026-07-28",
    );
    expect(result.tables.attendance_templates).toHaveLength(1);
    expect(result.tables.attendance_templates[0]).toMatchObject({
      weekday: 2,
      period: 2,
    });
    expect(result.tables.templates).toHaveLength(3);
  });
  it("移行差分を共通テンプレートとログイン履歴まで比較できる", () => {
    const directory = mkdtempSync(join(tmpdir(), "juku-diff-test-"));
    try {
      mkdirSync(join(directory, "private"));
      const before = snapshot();
      const after = snapshot([
        {
          path: "templates/base/default/202611/students/架空生徒",
          data: { 火: ["2限"] },
        },
      ]);
      writeFileSync(join(directory, "before.json"), JSON.stringify(before));
      writeFileSync(join(directory, "after.json"), JSON.stringify(after));
      execFileSync(
        process.execPath,
        [
          resolve("scripts/compare-snapshots.mjs"),
          join(directory, "before.json"),
          join(directory, "after.json"),
          "2026-07-28",
        ],
        { cwd: directory },
      );
      const report = JSON.parse(
        readFileSync(join(directory, "private/diff-report.json"), "utf8"),
      );
      expect(report.attendance_templates.added).toBe(1);
      expect(report.template_state.added).toBe(0);
      expect(report.login_events).toEqual({ added: 0, changed: 0, deleted: 0 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("親の月と一致しないレコードは推測せず停止", () => {
    expect(() =>
      normalize(
        snapshot([
          {
            path: "attendance/架空生徒/202611/2026-11-30",
            data: { "1限": true },
          },
        ]),
        "2026-07-28",
      ),
    ).toThrow("month/date conflict");
  });
  it("全量置換は削除済み予約も消し、実SQLで再実行可能", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
    db.exec(readFileSync("migrations/0002_shared_template.sql", "utf8"));
    const initial = normalize(snapshot(), "2026-07-28");
    db.exec(toSql(initial));
    db.exec(toSql(initial));
    expect(db.prepare("SELECT count(*) n FROM reservations").get()?.n).toBe(1);
    const next = snapshot();
    next.documents = next.documents.filter(
      (d: { path: string }) => !d.path.startsWith("attendance/"),
    );
    db.exec(toSql(normalize(next, "2026-07-28")));
    expect(db.prepare("SELECT count(*) n FROM reservations").get()?.n).toBe(0);
    db.close();
  });
  it("予約重複と失敗途中のバッチをDBが防止", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
    db.exec(readFileSync("migrations/0002_shared_template.sql", "utf8"));
    db.exec(toSql(normalize(snapshot(), "2026-07-28")));
    const row = db.prepare("SELECT * FROM reservations").get()!;
    expect(() =>
      db
        .prepare("INSERT INTO reservations VALUES(?,?,?)")
        .run(row.student_id!, row.date!, row.period!),
    ).toThrow();
    db.exec("BEGIN");
    try {
      db.exec("DELETE FROM reservations");
      db.exec("INSERT INTO write_guards VALUES('conflict',0)");
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
    }
    expect(db.prepare("SELECT count(*) n FROM reservations").get()?.n).toBe(1);
    db.close();
  });
});
