import { useEffect, useState } from "react";
import { api } from "./api";
import { role } from "./config";
import { todayJst, monthOffset, type Schedule } from "../shared/domain";
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
export function useSchedule(initial = todayJst().slice(0, 7)) {
  const [month, setMonth] = useState(initial);
  const [data, setData] = useState<Schedule | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => {
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
  }, [month, revision]);
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
