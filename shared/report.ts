import {
  csvCell,
  monthDates,
  slotInfo,
  weekday,
  weekdays,
  type CalendarDay,
  type Subject,
} from "./domain";
export function attendanceCsv(
  month: string,
  rows: { date: string; period: number; name: string }[],
  calendar: CalendarDay[],
  subjects: Subject[],
): string {
  const header = ["日付"];
  for (let p = 1; p <= 6; p++) {
    header.push(`${p}限-科目`);
    for (let j = 2; j <= 9; j++) header.push(`${p}限-${j}`);
  }
  const output: string[][] = [header];
  for (const date of monthDates(month)) {
    const row = [
      `${Number(date.slice(5, 7))}/${Number(date.slice(8))}（${weekdays[weekday(date)]}）`,
    ];
    for (let p = 1; p <= 6; p++) {
      const info = slotInfo(date, p, calendar, subjects);
      const names = rows
        .filter((r) => r.date === date && r.period === p)
        .map((r) => r.name);
      const cells = info.closed
        ? ["休み"]
        : names.length <= 8
          ? [info.subject, ...names]
          : [info.subject, String(names.length)];
      while (cells.length < 9) cells.push("");
      row.push(...cells);
    }
    output.push(row, Array<string>(row.length).fill(""));
  }
  return (
    "\uFEFF" + output.map((row) => row.map(csvCell).join(",")).join("\r\n")
  );
}
