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
export function useSchedule(
  initial = todayJst().slice(0, 7),
  enabled = true,
  scope = "all",
) {
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
    api<Schedule>(`/api/${role}/schedule?month=${month}&scope=${scope}`)
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
  }, [month, revision, enabled, scope]);
  return {
    month,
    setMonth,
    data,
    error,
    loading,
    refresh: () => refresh((v) => v + 1),
    patch: (patch: Partial<Schedule>) =>
      setData((current) =>
        current?.month === month ? { ...current, ...patch } : current,
      ),
  };
}
export function MonthSelect({
  month,
  onChange,
  past = false,
  label = "表示する月",
}: {
  month: string;
  onChange: (m: string) => void;
  past?: boolean;
  label?: string;
}) {
  const base = todayJst().slice(0, 7);
  const options = Array.from({ length: past ? 18 : 3 }, (_, i) =>
    monthOffset(base, past ? i - 14 : i),
  );
  if (!options.includes(month)) options.unshift(month);
  return (
    <label className="month-label">
      {label}{" "}
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
  function acknowledge(
    month: string,
    revision: number,
    changes: {
      studentId: string;
      date: string;
      period: number;
      present: boolean;
    }[],
  ) {
    const current = cache.current;
    const old = current?.page.schedules[month];
    if (!current || !old) return;
    let weeklyCount = current.page.weeklyCount;
    const reservations = new Map(
      old.reservations.map((r) => [`${r.student_id}:${r.date}:${r.period}`, r]),
    );
    const counts = new Map(
      old.counts.map((r) => [`${r.date}:${r.period}`, { ...r }]),
    );
    const weekStart = addDays(
      current.page.today,
      -((new Date(current.page.today + "T12:00:00Z").getUTCDay() + 6) % 7),
    );
    for (const change of changes) {
      const key = `${change.studentId}:${change.date}:${change.period}`;
      const was = reservations.has(key);
      const delta = Number(change.present) - Number(was);
      if (change.present)
        reservations.set(key, {
          student_id: change.studentId,
          date: change.date,
          period: change.period,
        });
      else reservations.delete(key);
      const slot = `${change.date}:${change.period}`;
      counts.set(slot, {
        date: change.date,
        period: change.period,
        count: Math.max(0, (counts.get(slot)?.count ?? 0) + delta),
      });
      if (
        role === "student" &&
        change.date >= weekStart &&
        change.date <= addDays(weekStart, 5)
      )
        weeklyCount += delta;
    }
    const page = {
      ...current.page,
      weeklyCount,
      schedules: {
        ...current.page.schedules,
        [month]: {
          ...old,
          revision,
          reservations: [...reservations.values()],
          counts: [...counts.values()],
        },
      },
    };
    cache.current = { ...current, page };
    setState(page);
  }
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
    acknowledge,
    loadMore: () => setLimit((v) => v + 14),
    refresh: () => setRevision((v) => v + 1),
  };
}

export function useTodayAttendance(enabled: boolean) {
  const [data, setData] = useState<(Schedule & { weeklyCount: number }) | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    api<AttendancePage>(`/api/student/attendance?from=${todayJst()}&limit=1`)
      .then((page) => {
        if (!current) return;
        const today = page.today;
        const schedule = page.schedules[today.slice(0, 7)];
        setData({
          month: today.slice(0, 7),
          published: page.dates.includes(today),
          revision: schedule?.revision ?? 0,
          today,
          calendar: schedule?.calendar ?? [],
          reservations: schedule?.reservations ?? [],
          counts: schedule?.counts ?? [],
          students: page.students,
          subjects: page.subjects,
          templates: [],
          weeklyCount: page.weeklyCount,
        });
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
  }, [enabled]);
  return { data, error, loading };
}
