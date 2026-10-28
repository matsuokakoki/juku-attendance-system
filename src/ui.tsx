import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { role } from "./config";
import {
  todayJst,
  monthOffset,
  monthDates,
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

// Month payloads are cached; expanding the list only fetches newly needed months.
export function useAttendanceTimeline(enabled: boolean, includeToday: boolean) {
  const [limit, setLimit] = useState(14);
  const [revision, setRevision] = useState(0);
  const [schedules, setSchedules] = useState<Record<string, Schedule>>({});
  const [dates, setDates] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const cache = useRef<{
    revision: number;
    months: string[];
    schedules: Record<string, Schedule>;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setLoading(true);
    setError("");
    async function load() {
      const previous =
        cache.current?.revision === revision ? cache.current : null;
      const months =
        previous?.months ??
        (await api<{ months: string[] }>(`/api/${role}/schedule-months`))
          .months;
      if (!current) return;
      const today = todayJst();
      const allDates = months
        .flatMap(monthDates)
        .filter((date) => (includeToday ? date >= today : date > today));
      const nextDates = allDates.slice(0, limit);
      const next = { ...(previous?.schedules ?? {}) };
      const needed = [
        ...new Set([
          today.slice(0, 7),
          ...nextDates.map((date) => date.slice(0, 7)),
        ]),
      ].filter((month) => !next[month]);
      const loaded = await Promise.all(
        needed.map((month) =>
          api<Schedule>(`/api/${role}/schedule?month=${month}`),
        ),
      );
      for (const schedule of loaded) next[schedule.month] = schedule;
      if (!current) return;
      cache.current = { revision, months, schedules: next };
      setSchedules(next);
      setDates(nextDates.filter((date) => next[date.slice(0, 7)]?.published));
      setHasMore(allDates.length > limit);
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
  return {
    schedules,
    dates,
    hasMore,
    loading,
    error,
    loadMore: () => setLimit((v) => v + 14),
    refresh: () => setRevision((v) => v + 1),
  };
}
