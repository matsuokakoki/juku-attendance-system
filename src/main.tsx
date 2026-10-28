import {
  StrictMode,
  lazy,
  Suspense,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError, setIdentity } from "./api";
import {
  addDays,
  labels,
  monthDates,
  monthOffset,
  slotInfo,
  todayJst,
  weekday,
  weekdays,
  type Announcement,
  type CalendarDay,
  type Identity,
  type Pattern,
  type Schedule,
  type Student,
  type Subject,
  type Template,
} from "../shared/domain";
import "./style.css";
import { path, teacher, role, rootPage } from "./config";
import { useAction, useSchedule, MonthSelect, ErrorBox, Status } from "./ui";
const TeacherPage = lazy(() => import("./teacher"));
const PublicHome = lazy(() =>
  import("./teacher").then((m) => ({ default: m.PublicHome })),
);
function Shell({
  identity,
  children,
}: {
  identity: Identity;
  children: ReactNode;
}) {
  const a = useAction();
  return (
    <>
      <header>
        <a className="brand" href={rootPage}>
          一輝塾
        </a>
        <span>
          {identity.role === "teacher"
            ? "先生用メニュー"
            : identity.name + "さん"}
        </span>
        <button
          className="quiet"
          disabled={a.busy}
          onClick={() =>
            void a.run(async () => {
              await api(`/api/${role}/logout`, {});
              window.location.href = teacher
                ? "/teacher_login.html"
                : "/login.html";
            })
          }
        >
          ログアウト
        </button>
      </header>
      <main>
        {path !== rootPage && (
          <a className="back" href={rootPage}>
            ← メニューに戻る
          </a>
        )}
        {children}
        <Status a={a} />
      </main>
      <footer>一輝塾 出席管理</footer>
    </>
  );
}
function Login({ onLogin }: { onLogin: (i: Identity) => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const a = useAction();
  function submit(e: FormEvent) {
    e.preventDefault();
    void a.run(async () => {
      const i = await api<Identity>("/api/login", { role, name, password });
      setIdentity(i);
      onLogin(i);
      window.location.href = rootPage;
    });
  }
  return (
    <main className="login">
      <h1>
        <span>一輝塾</span>
        <br />
        {teacher ? "先生用ログイン" : "出席管理システム"}
      </h1>
      <form onSubmit={submit}>
        {!teacher && (
          <label>
            名前
            <input
              name="username"
              autoComplete="username"
              placeholder="苗字を入力"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={50}
            />
          </label>
        )}
        <label>
          パスワード
          <input
            name="password"
            autoComplete="current-password"
            type="password"
            placeholder="パスワード"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <button disabled={a.busy} type="submit">
          {a.busy ? "確認中…" : "ログイン"}
        </button>
      </form>
      <Status a={a} />
    </main>
  );
}
function StudentTop() {
  const [ann, setAnn] = useState<Announcement[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Announcement[]>("/api/student/announcements")
      .then(setAnn)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="menu">
        <a className="big-button" href="/student_day.html">
          本日の出席を確認
        </a>
        <a className="big-button" href="/student_monthly.html">
          月別の出席確認・変更
        </a>
      </div>
      <section>
        <h2>お知らせ</h2>
        <ErrorBox error={error} />
        {ann.length ? (
          ann.map((n) => (
            <article key={n.id}>
              <time>
                {new Intl.DateTimeFormat("ja-JP", {
                  timeZone: "Asia/Tokyo",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(n.created_at))}
              </time>
              <p className="prewrap">{n.text}</p>
            </article>
          ))
        ) : (
          <p className="muted">現在お知らせはありません。</p>
        )}
      </section>
    </>
  );
}
function StudentSchedule({
  identity,
  todayOnly = false,
}: {
  identity: Identity;
  todayOnly?: boolean;
}) {
  const s = useSchedule();
  const [visible, setVisible] = useState(10);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const a = useAction();
  useEffect(() => {
    setPending(new Set());
    setVisible(10);
  }, [s.month, s.data]);
  useEffect(() => {
    if (!pending.size) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [pending]);
  const d = s.data;
  const today = d?.today ?? todayJst();
  const dates = todayOnly
    ? [today]
    : monthDates(s.month)
        .filter((date) => date > today)
        .slice(0, visible);
  const weekStart = addDays(today, -((weekday(today) + 6) % 7));
  const count =
    d?.reservations.filter(
      (r) =>
        r.date >= weekStart &&
        r.date <= addDays(weekStart, 5) &&
        !pending.has(r.date + ":" + r.period),
    ).length ?? 0;
  function toggle(key: string) {
    setPending((v) => {
      const next = new Set(v);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  return (
    <>
      <h1>
        {identity.name}さんの{todayOnly ? "本日の出席" : "出席確認"}
      </h1>
      {!todayOnly && (
        <MonthSelect
          month={s.month}
          onChange={(m) => {
            if (!pending.size || confirm("保存していない変更を破棄しますか？"))
              s.setMonth(m);
          }}
        />
      )}
      <ErrorBox error={s.error} />
      {s.loading && <p role="status">読み込み中…</p>}
      {d &&
        !s.loading &&
        (!d.published ? (
          <p className="empty">この月の予定はまだ公開されていません。</p>
        ) : (
          <>
            <p className="summary">あなたの今週のコマ：{count}コマ</p>
            {dates.map((date) => (
              <section
                className={`day-card${todayOnly ? " day-card-today" : ""}`}
                key={date}
              >
                <h2>
                  {Number(date.slice(5, 7))}/{Number(date.slice(8))}（
                  {weekdays[weekday(date)]}）
                </h2>
                <div className="slots">
                  {Array.from({ length: 6 }, (_, i) => i + 1).map((period) => {
                    const info = slotInfo(date, period, d.calendar, d.subjects);
                    const mine = d.reservations.some(
                      (r) => r.date === date && r.period === period,
                    );
                    const key = date + ":" + period;
                    const cancelled = pending.has(key);
                    const count =
                      d.counts.find(
                        (r) => r.date === date && r.period === period,
                      )?.count ?? 0;
                    const text = info.closed
                      ? "休み"
                      : info.study
                        ? "自習のみ"
                        : info.subject;
                    return (
                      <button
                        type="button"
                        key={period}
                        className={`slot ${info.closed ? "rest" : info.study ? "study" : mine && !cancelled ? "active" : ""}`}
                        disabled={
                          todayOnly ||
                          !mine ||
                          info.closed ||
                          info.study ||
                          a.busy
                        }
                        aria-pressed={mine && !cancelled}
                        aria-label={`${date} ${period}限 ${text}${mine ? " 登録済み" : ""}${cancelled ? " 取消予定" : ""}`}
                        onClick={() => toggle(key)}
                      >
                        <span>{period}限</span>
                        <strong>{text}</strong>
                        {!info.closed && !info.study && (
                          <small>
                            残
                            {Math.max(
                              0,
                              info.capacity - count + (cancelled ? 1 : 0),
                            )}
                            席
                          </small>
                        )}
                        <b>{mine ? (cancelled ? "✕" : "〇") : ""}</b>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {!todayOnly && (
              <>
                {visible <
                  monthDates(s.month).filter((x) => x > today).length && (
                  <button
                    className="secondary more"
                    onClick={() => setVisible((v) => v + 10)}
                  >
                    もっと見る
                  </button>
                )}
                <div className="fixed-bar">
                  <button
                    disabled={a.busy}
                    onClick={() => {
                      if (confirm("この内容で確定しますか？"))
                        void a.run(async () => {
                          if (pending.size)
                            await api("/api/student/cancellations", {
                              month: s.month,
                              revision: d.revision,
                              changes: [...pending].map((key) => {
                                const [date, period] = key.split(":");
                                return { date, period: Number(period) };
                              }),
                            });
                          setPending(new Set());
                          a.setNotice("✓ 出席内容を保存しました");
                          s.refresh();
                        });
                    }}
                  >
                    ✓ この変更を保存する
                  </button>
                  <Status a={a} />
                </div>
              </>
            )}
          </>
        ))}
    </>
  );
}
function App() {
  const [identity, setUser] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (path === "/home_public.html") {
      setLoading(false);
      return;
    }
    api<Identity>(`/api/${role}/me`)
      .then((i) => {
        setIdentity(i);
        setUser(i);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 503) setUnavailable(true);
        if (!(e instanceof ApiError) || e.status !== 401) setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);
  if (path === "/home_public.html")
    return (
      <Suspense fallback={<p>読み込み中…</p>}>
        <PublicHome />
      </Suspense>
    );
  if (loading)
    return (
      <main className="empty" role="status">
        読み込み中…
      </main>
    );
  if (unavailable)
    return (
      <main className="empty">
        <h1>メンテナンス中</h1>
        <p>{error}</p>
      </main>
    );
  if (!identity)
    return (
      <>
        <Login onLogin={setUser} />
        <ErrorBox error={error} />
      </>
    );
  return (
    <Shell identity={identity}>
      {teacher ? (
        <Suspense fallback={<p>読み込み中…</p>}>
          <TeacherPage />
        </Suspense>
      ) : path === "/student_day.html" ? (
        <StudentSchedule identity={identity} todayOnly />
      ) : path === "/student_monthly.html" ? (
        <StudentSchedule identity={identity} />
      ) : (
        <StudentTop />
      )}
    </Shell>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
