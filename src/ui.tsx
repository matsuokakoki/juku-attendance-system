import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { role } from "./config";
import {
  todayJst,
  monthOffset,
  addDays,
  type AttendancePage,
  type Schedule,
} from "../shared/domain";
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, setNotice, run };
}
export function useSchedule(initial = todayJst().slice(0, 7), enabled = true) {
  const [month, setMonth] = useState(initial);
  const [data, setData] = useState<Schedule | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setLoading(true);
    setError("");
    api<Schedule>(`/api/${role}/schedule?month=${month}`)
      .then((d) => {
        if (current) setData(d);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [month, revision, enabled]);
  return {
    month,
    setMonth,
    data,
    error,
    loading,
    refresh: () => refresh((v) => v + 1),
  };
}
export function MonthSelect({
  month,
  onChange,
  past = false,
}: {
  month: string;
  onChange: (m: string) => void;
  past?: boolean;
}) {
  const base = todayJst().slice(0, 7);
  const options = Array.from({ length: past ? 18 : 3 }, (_, i) =>
    monthOffset(base, past ? i - 14 : i),
  );
  if (!options.includes(month)) options.unshift(month);
  return (
    <label className="month-label">
      表示する月{" "}
      <select value={month} onChange={(e) => onChange(e.target.value)}>
        {options.sort().map((m) => (
          <option key={m} value={m}>
            {Number(m.slice(0, 4))}年{Number(m.slice(5))}月
          </option>
        ))}
      </select>
    </label>
  );
}
export function Status({ a }: { a: ReturnType<typeof useAction> }) {
  return (
    <>
      <ErrorBox error={a.error} />
      {a.notice && (
        <p className="notice" role="status">
          {a.notice}
        </p>
      )}
    </>
  );
}

// Keep loaded date ranges; only the next visible page is transferred.
export function useAttendanceTimeline(enabled: boolean, includeToday: boolean) {
  const initial = role === "teacher" ? 3 : 14;
  const [limit, setLimit] = useState(initial);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<AttendancePage | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const cache = useRef<{ revision: number; page: AttendancePage } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setLoading(true);
    setError("");
    async function load() {
      const previous =
        cache.current?.revision === revision ? cache.current.page : null;
      const today = todayJst();
      let combined: AttendancePage = previous ?? {
        dates: [],
        next: includeToday ? today : addDays(today, 1),
        hasMore: true,
        schedules: {},
        today,
        weeklyCount: 0,
        students: [],
        subjects: [],
      };
      let first = !previous;
      while (
        combined.hasMore &&
        combined.next &&
        combined.dates.length < limit
      ) {
        const size = Math.min(14, limit - combined.dates.length);
        const page = await api<AttendancePage>(
          `/api/${role}/attendance?from=${combined.next}&limit=${size}&masters=${first ? 1 : 0}`,
        );
        if (!current) return;
        const schedules = { ...combined.schedules };
        const students = first ? page.students : combined.students;
        const subjects = first ? page.subjects : combined.subjects;
        for (const [month, data] of Object.entries(page.schedules)) {
          const old = schedules[month];
          // Retain the original revision: older edited rows must still detect conflicts.
          schedules[month] = {
            ...data,
            revision: old?.revision ?? data.revision,
            students,
            subjects,
            calendar: [...(old?.calendar ?? []), ...data.calendar],
            reservations: [...(old?.reservations ?? []), ...data.reservations],
            counts: [...(old?.counts ?? []), ...data.counts],
          };
        }
        combined = {
          ...page,
          dates: [...combined.dates, ...page.dates],
          schedules,
          students,
          subjects,
        };
        first = false;
      }
      if (!current) return;
      cache.current = { revision, page: combined };
      setState(combined);
    }
    void load()
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [enabled, includeToday, limit, revision]);
  const base: Schedule | null = state
    ? {
        month: state.today.slice(0, 7),
        published: true,
        revision: 0,
        today: state.today,
        calendar: [],
        reservations: [],
        counts: [],
        templates: [],
        students: state.students,
        subjects: state.subjects,
      }
    : null;
  return {
    schedules: state?.schedules ?? {},
    dates: state?.dates ?? [],
    base,
    weeklyCount: state?.weeklyCount ?? 0,
    hasMore: state?.hasMore ?? false,
    loading,
    error,
    loadMore: () => setLimit((v) => v + 14),
    refresh: () => setRevision((v) => v + 1),
  };
}
