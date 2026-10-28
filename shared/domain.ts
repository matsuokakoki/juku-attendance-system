import type { z } from "zod";
import type { patternSchema } from "./validation";
export type Pattern = z.infer<typeof patternSchema>;
export type Student = {
  id: string;
  name: string;
  yomi: string;
  active: number;
};
export type Reservation = { student_id: string; date: string; period: number };
export type CalendarDay = {
  date: string;
  closed: number;
  pattern: Pattern;
  reason: string;
};
export type Subject = {
  pattern: Pattern;
  weekday: number;
  period: number;
  subject: string;
};
export type Template = { student_id: string; weekday: number; period: number };
export type Announcement = { id: string; text: string; created_at: string };
export type Identity = {
  role: "student" | "teacher";
  studentId: string | null;
  name: string;
  csrf: string;
};
export type Schedule = {
  month: string;
  published: boolean;
  revision: number;
  today: string;
  calendar: CalendarDay[];
  subjects: Subject[];
  reservations: Reservation[];
  counts: { date: string; period: number; count: number }[];
  students: Student[];
  templates: Template[];
};
export type AttendancePage = {
  dates: string[];
  next: string | null;
  hasMore: boolean;
  schedules: Record<string, Schedule>;
  today: string;
  weeklyCount: number;
  students: Student[];
  subjects: Subject[];
};
export function todayJst(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function weekday(date: string): number {
  return new Date(date + "T12:00:00Z").getUTCDay();
}
export function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function monthOffset(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1, 12)).toISOString().slice(0, 7);
}
export function monthDates(month: string): string[] {
  const end = monthOffset(month, 1) + "-01";
  const dates: string[] = [];
  for (let d = month + "-01"; d < end; d = addDays(d, 1)) dates.push(d);
  return dates;
}
export function slotInfo(
  date: string,
  period: number,
  calendar: CalendarDay[],
  subjects: Subject[],
) {
  const day = calendar.find((d) => d.date === date);
  const pattern = day?.pattern ?? "default";
  const subject =
    subjects.find(
      (s) =>
        s.pattern === pattern &&
        s.weekday === weekday(date) &&
        s.period === period,
    )?.subject ?? "個";
  const closed = weekday(date) === 0 || day?.closed === 1 || subject === "休講";
  return {
    pattern,
    subject,
    closed,
    study: subject === "自習",
    capacity: subject === "個" ? 9 : 30,
  };
}
export function canCancel(
  date: string,
  today: string,
  published: boolean,
): boolean {
  return published && date > today;
}
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export const labels: Record<Pattern, string> = {
  default: "通常",
  temporary: "臨時B",
  temporary2: "臨時C",
};
export const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

export function teacherSessionExpires(now = new Date()): number {
  return Math.floor(
    new Date(addDays(todayJst(now), 1) + "T00:00:00+09:00").getTime() / 1000,
  );
}
