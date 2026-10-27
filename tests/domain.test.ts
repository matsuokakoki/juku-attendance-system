import { describe, it, expect } from "vitest";
import {
  todayJst,
  teacherSessionExpires,
  addDays,
  monthDates,
  monthOffset,
  slotInfo,
  canCancel,
  csvCell,
} from "../shared/domain";
import { dateSchema } from "../shared/validation";
import { attendanceCsv } from "../shared/report";
describe("日本の授業日は時刻ではない", () => {
  it("UTC日付とJST日付の境界", () => {
    expect(todayJst(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
    expect(todayJst(new Date("2026-10-31T14:59:59Z"))).toBe("2026-10-31");
  });
  it("月初・年末・閏日を扱う", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(monthDates("2024-02")).toHaveLength(29);
    expect(monthOffset("2026-01", -1)).toBe("2025-12");
  });
  it("存在しない日を拒否", () => {
    expect(dateSchema.safeParse("2026-02-29").success).toBe(false);
    expect(dateSchema.safeParse("2024-02-29").success).toBe(true);
    expect(dateSchema.safeParse("2026-13-01").success).toBe(false);
  });
});
describe("操作・科目ルール", () => {
  it("通常・B・Cを切り替える", () => {
    const subjects = [
      { pattern: "default" as const, weekday: 1, period: 1, subject: "個" },
      { pattern: "temporary" as const, weekday: 1, period: 1, subject: "数学" },
      {
        pattern: "temporary2" as const,
        weekday: 1,
        period: 1,
        subject: "自習",
      },
    ];
    expect(slotInfo("2026-11-02", 1, [], subjects).capacity).toBe(9);
    expect(
      slotInfo(
        "2026-11-02",
        1,
        [{ date: "2026-11-02", closed: 0, pattern: "temporary", reason: "" }],
        subjects,
      ).subject,
    ).toBe("数学");
    expect(
      slotInfo(
        "2026-11-02",
        1,
        [{ date: "2026-11-02", closed: 0, pattern: "temporary2", reason: "" }],
        subjects,
      ).study,
    ).toBe(true);
  });
  it("日曜・休講日・科目の休講を判定", () => {
    expect(slotInfo("2026-11-01", 1, [], []).closed).toBe(true);
    expect(
      slotInfo(
        "2026-11-02",
        1,
        [{ date: "2026-11-02", closed: 1, pattern: "default", reason: "" }],
        [],
      ).closed,
    ).toBe(true);
  });
  it("当日・過去・非公開は取消不可", () => {
    expect(canCancel("2026-11-02", "2026-11-02", true)).toBe(false);
    expect(canCancel("2026-11-03", "2026-11-02", false)).toBe(false);
    expect(canCancel("2026-11-03", "2026-11-02", true)).toBe(true);
  });
});
describe("CSV互換と安全性", () => {
  it("式と区切り文字をエスケープ", () => {
    expect(csvCell("=1+1")).toBe('"\'=1+1"');
    expect(csvCell('a"b')).toBe('"a""b"');
  });
  it("従来と同じ55列と日別空行", () => {
    const csv = attendanceCsv("2026-11", [], [], []);
    const rows = csv.slice(1).split("\r\n");
    expect(rows).toHaveLength(61);
    expect(rows[0].split(",")).toHaveLength(55);
    expect(rows[1]).toContain("休み");
  });
});

it("先生の認証は日本時間の翌日0時まで", () => {
  expect(
    new Date(
      teacherSessionExpires(new Date("2026-10-27T15:01:00Z")) * 1000,
    ).toISOString(),
  ).toBe("2026-10-28T15:00:00.000Z");
  expect(
    new Date(
      teacherSessionExpires(new Date("2026-10-28T14:59:00Z")) * 1000,
    ).toISOString(),
  ).toBe("2026-10-28T15:00:00.000Z");
});
