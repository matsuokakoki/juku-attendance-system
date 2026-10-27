import DOMPurify from "dompurify";
import { useEffect, useState } from "react";
import { api } from "./api";
import { path, teacherMenu, pageTitle } from "./config";
import { useAction, useSchedule, MonthSelect, ErrorBox, Status } from "./ui";
import {
  labels,
  monthDates,
  monthOffset,
  slotInfo,
  todayJst,
  weekday,
  weekdays,
  type Announcement,
  type CalendarDay,
  type Pattern,
  type Student,
  type Subject,
  type Template,
  type Schedule,
} from "../shared/domain";
function TeacherTop() {
  const [group, setGroup] = useState<null | "create" | "maintenance" | "past">(
    null,
  );
  const groups = {
    create: { title: "新規予定作成", indices: [1, 2, 3, 4, 5] },
    maintenance: { title: "メンテナンス", indices: [8, 9, 10, 14, 15] },
    past: { title: "過去一覧、閲覧者確認", indices: [11, 12, 13] },
  };
  return (
    <>
      <h1>先生用メニュー</h1>
      <div className="menu">
        <a className="big-button" href="/teacher_today.html">
          📅 出席を確認・編集
        </a>
        <button className="menu-button" onClick={() => setGroup("create")}>
          新規予定作成（月に一回のみ！）↓
        </button>
        <a className="menu-button" href="/teacher_announcements.html">
          お知らせ追加
        </a>
        <button className="menu-button" onClick={() => setGroup("maintenance")}>
          名前、メンテ↓
        </button>
        <button className="menu-button" onClick={() => setGroup("past")}>
          過去一覧、閲覧者確認↓
        </button>
        <a className="menu-button" href="/teacher_template_edit.html">
          （二回目以降）テンプレ個別編集
        </a>
      </div>
      {group && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={groups[group].title}
          >
            <h2>{groups[group].title}</h2>
            <div className="menu">
              {groups[group].indices.map((i) => (
                <a
                  className="menu-button"
                  key={i}
                  href={"/" + teacherMenu[i][0]}
                >
                  {teacherMenu[i][1]}
                </a>
              ))}
              <button className="secondary" onClick={() => setGroup(null)}>
                閉じる
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function TeacherAttendance({ past = false }: { past?: boolean }) {
  const s = useSchedule(
    past ? monthOffset(todayJst().slice(0, 7), -1) : todayJst().slice(0, 7),
  );
  const a = useAction();
  const [visible, setVisible] = useState(10);
  const [modal, setModal] = useState<{ date: string; period: number } | null>(
    null,
  );
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setChanges({});
    setVisible(10);
  }, [s.data]);
  const d = s.data;
  const active = d?.students.filter((x) => x.active === 1) ?? [];
  const present = (studentId: string, date: string, period: number) =>
    changes[`${studentId}:${date}:${period}`] ??
    d?.reservations.some(
      (r) =>
        r.student_id === studentId && r.date === date && r.period === period,
    ) ??
    false;
  const dates = monthDates(s.month)
    .filter(
      (date) =>
        past || s.month !== todayJst().slice(0, 7) || date >= todayJst(),
    )
    .slice(0, visible);
  return (
    <>
      <h1>{past ? "過去一覧" : "出席を確認・編集"}</h1>
      <MonthSelect
        past
        month={s.month}
        onChange={(m) => {
          if (
            !Object.keys(changes).length ||
            confirm("未保存の変更を破棄しますか？")
          )
            s.setMonth(m);
        }}
      />
      <ErrorBox error={s.error} />
      {s.loading && <p>読み込み中…</p>}
      {d && !s.loading && (
        <>
          <div className="table-wrap">
            <table className="attendance-table">
              <thead>
                <tr>
                  <th>日付</th>
                  {[1, 2, 3, 4, 5, 6].map((p) => (
                    <th key={p}>{p}限</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dates.map((date) => (
                  <tr key={date}>
                    <th>
                      {Number(date.slice(5, 7))}/{Number(date.slice(8))}
                      <br />（{weekdays[weekday(date)]}）
                    </th>
                    {[1, 2, 3, 4, 5, 6].map((period) => {
                      const info = slotInfo(
                        date,
                        period,
                        d.calendar,
                        d.subjects,
                      );
                      const names = active.filter((st) =>
                        present(st.id, date, period),
                      );
                      return (
                        <td
                          key={period}
                          className={
                            info.closed ? "rest" : info.study ? "study" : ""
                          }
                        >
                          <button
                            className="attendance-cell"
                            onClick={() => setModal({ date, period })}
                          >
                            <small>
                              {info.closed
                                ? "休み"
                                : info.study
                                  ? "自習のみ"
                                  : info.subject}
                            </small>
                            <strong>{names.length}人</strong>
                            <span>
                              {names.map((n) => n.name).join("、") || "—"}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="secondary more"
            onClick={() => setVisible((v) => v + 10)}
          >
            さらに表示
          </button>
          <div className="fixed-bar">
            <button
              disabled={a.busy || !Object.keys(changes).length}
              onClick={() =>
                void a.run(async () => {
                  await api("/api/teacher/reservations", {
                    month: s.month,
                    revision: d.revision,
                    changes: Object.entries(changes).map(([key, present]) => {
                      const [studentId, date, period] = key.split(":");
                      return {
                        studentId,
                        date,
                        period: Number(period),
                        present,
                      };
                    }),
                  });
                  a.setNotice("✓ 保存しました");
                  s.refresh();
                })
              }
            >
              ✓ 変更を保存する
            </button>
            <Status a={a} />
          </div>
          {modal && (
            <div className="overlay" role="presentation">
              <section
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label="登録者を編集"
              >
                <h2>
                  {modal.date} {modal.period}限 登録者
                </h2>
                <div className="student-grid">
                  {active.map((st) => (
                    <button
                      key={st.id}
                      className={
                        present(st.id, modal.date, modal.period)
                          ? "selected"
                          : "secondary"
                      }
                      aria-pressed={present(st.id, modal.date, modal.period)}
                      onClick={() =>
                        setChanges((v) => ({
                          ...v,
                          [`${st.id}:${modal.date}:${modal.period}`]: !present(
                            st.id,
                            modal.date,
                            modal.period,
                          ),
                        }))
                      }
                    >
                      {st.name}
                    </button>
                  ))}
                </div>
                <button className="secondary" onClick={() => setModal(null)}>
                  閉じる
                </button>
              </section>
            </div>
          )}
        </>
      )}
    </>
  );
}
function CalendarEditor({ patterns = false }: { patterns?: boolean }) {
  const s = useSchedule();
  const [days, setDays] = useState<CalendarDay[]>([]);
  const a = useAction();
  useEffect(() => {
    if (s.data)
      setDays(
        monthDates(s.month).map(
          (date) =>
            s.data!.calendar.find((d) => d.date === date) ?? {
              date,
              closed: 0,
              pattern: "default",
              reason: "",
            },
        ),
      );
  }, [s.data]);
  function update(date: string, patch: Partial<CalendarDay>) {
    setDays((v) => v.map((d) => (d.date === date ? { ...d, ...patch } : d)));
  }
  return (
    <>
      <h1>{patterns ? "講習用テンプレB/Cを使う日を設定" : "休講日設定"}</h1>
      <MonthSelect past month={s.month} onChange={s.setMonth} />
      <ErrorBox error={s.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th>{patterns ? "適用する科目" : "休講"}</th>
              {!patterns && <th>公式サイトに載せる理由</th>}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <th>
                  {d.date}（{weekdays[weekday(d.date)]}）
                </th>
                <td>
                  {patterns ? (
                    <select
                      aria-label={d.date + "の科目"}
                      value={d.pattern}
                      onChange={(e) =>
                        update(d.date, { pattern: e.target.value as Pattern })
                      }
                    >
                      {Object.entries(labels).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={d.date + "を休講にする"}
                      type="checkbox"
                      checked={d.closed === 1}
                      onChange={(e) =>
                        update(d.date, { closed: e.target.checked ? 1 : 0 })
                      }
                    />
                  )}
                </td>
                {!patterns && (
                  <td>
                    <input
                      aria-label={d.date + "の休講理由"}
                      value={d.reason}
                      maxLength={200}
                      onChange={(e) =>
                        update(d.date, { reason: e.target.value })
                      }
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        disabled={a.busy || !s.data || s.loading}
        onClick={() =>
          void a.run(async () => {
            await api("/api/teacher/calendar", {
              month: s.month,
              revision: s.data!.revision,
              days,
            });
            a.setNotice("✓ 保存しました");
            s.refresh();
          })
        }
      >
        ✓ 保存する
      </button>
      <Status a={a} />
    </>
  );
}
function Subjects() {
  const s = useSchedule();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [pattern, setPattern] = useState<Pattern>("default");
  const a = useAction();
  useEffect(() => {
    if (s.data) setSubjects(s.data.subjects);
  }, [s.data]);
  return (
    <>
      <h1>曜日×コマごとの科目名設定</h1>
      <label>
        編集対象{" "}
        <select
          value={pattern}
          onChange={(e) => setPattern(e.target.value as Pattern)}
        >
          {Object.entries(labels).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <ErrorBox error={s.error} />
      <datalist id="subject-options">
        {["個", "数学", "英語", "国語", "理科", "社会", "自習", "休講"].map(
          (x) => (
            <option key={x}>{x}</option>
          ),
        )}
      </datalist>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>曜日</th>
              {[1, 2, 3, 4, 5, 6].map((p) => (
                <th key={p}>{p}限</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6].map((day) => (
              <tr key={day}>
                <th>{weekdays[day]}</th>
                {[1, 2, 3, 4, 5, 6].map((period) => (
                  <td key={period}>
                    <input
                      aria-label={`${labels[pattern]} ${weekdays[day]} ${period}限`}
                      list="subject-options"
                      maxLength={40}
                      value={
                        subjects.find(
                          (s) =>
                            s.pattern === pattern &&
                            s.weekday === day &&
                            s.period === period,
                        )?.subject ?? "個"
                      }
                      onChange={(e) =>
                        setSubjects((v) =>
                          v.map((s) =>
                            s.pattern === pattern &&
                            s.weekday === day &&
                            s.period === period
                              ? { ...s, subject: e.target.value }
                              : s,
                          ),
                        )
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        disabled={a.busy || !subjects.length}
        onClick={() =>
          void a.run(async () => {
            await api("/api/teacher/subjects", { subjects });
            a.setNotice("✓ 保存しました");
            s.refresh();
          })
        }
      >
        ✓ 保存する
      </button>
      <Status a={a} />
    </>
  );
}
function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [newName, setNewName] = useState("");
  const a = useAction();
  const load = () => api<Student[]>("/api/teacher/students").then(setStudents);
  useEffect(() => {
    void a.run(load);
  }, []);
  function update(id: string, patch: Partial<Student>) {
    setStudents((v) => v.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  return (
    <>
      <h1>{pageTitle}</h1>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            await api("/api/teacher/students", {
              name: newName,
              yomi: "",
              active: 1,
            });
            setNewName("");
            await load();
            a.setNotice("✓ 生徒を追加しました");
          });
        }}
      >
        <label>
          追加する生徒名
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            maxLength={50}
          />
        </label>
        <button disabled={a.busy}>追加</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>名前</th>
              <th>ひらがな読み</th>
              <th>在籍</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td>
                  <input
                    aria-label={s.name + "の名前"}
                    value={s.name}
                    maxLength={50}
                    onChange={(e) => update(s.id, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={s.name + "の読み"}
                    value={s.yomi}
                    maxLength={100}
                    onChange={(e) => update(s.id, { yomi: e.target.value })}
                  />
                </td>
                <td>{s.active ? "在籍" : "削除済み"}</td>
                <td>
                  <button
                    disabled={a.busy}
                    onClick={() =>
                      void a.run(async () => {
                        await api("/api/teacher/students", s);
                        a.setNotice("✓ 保存しました");
                        await load();
                      })
                    }
                  >
                    保存
                  </button>{" "}
                  <button
                    className="danger"
                    disabled={a.busy}
                    onClick={() => {
                      if (
                        confirm(
                          s.active
                            ? `${s.name}さんを生徒一覧から削除しますか？`
                            : `${s.name}さんを在籍に戻しますか？`,
                        )
                      )
                        void a.run(async () => {
                          await api("/api/teacher/students", {
                            ...s,
                            active: s.active ? 0 : 1,
                          });
                          await load();
                          a.setNotice("✓ 更新しました");
                        });
                    }}
                  >
                    {s.active ? "削除" : "戻す"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Status a={a} />
    </>
  );
}
function Templates({ individual = false }: { individual?: boolean }) {
  const s = useSchedule(
    individual
      ? todayJst().slice(0, 7)
      : monthOffset(todayJst().slice(0, 7), 1),
  );
  const [templates, setTemplates] = useState<Template[]>([]);
  const [studentId, setStudentId] = useState("");
  const a = useAction();
  useEffect(() => {
    if (s.data) {
      setTemplates(s.data.templates);
      setStudentId(
        (v) => v || s.data!.students.find((st) => st.active)?.id || "",
      );
    }
  }, [s.data]);
  const students =
    s.data?.students.filter(
      (st) => st.active && (!individual || st.id === studentId),
    ) ?? [];
  function toggle(st: string, weekday: number, period: number) {
    setTemplates((v) =>
      v.some(
        (t) =>
          t.student_id === st && t.weekday === weekday && t.period === period,
      )
        ? v.filter(
            (t) =>
              !(
                t.student_id === st &&
                t.weekday === weekday &&
                t.period === period
              ),
          )
        : [...v, { student_id: st, weekday, period }],
    );
  }
  async function save(generate: boolean) {
    if (
      generate &&
      !confirm(
        "この月の出席予定をテンプレートから作成します。対象の登録内容は置き換わります。よろしいですか？",
      )
    )
      return;
    await a.run(async () => {
      await api("/api/teacher/templates", {
        month: s.month,
        revision: s.data!.revision,
        ...(individual ? { studentId } : {}),
        generate,
        templates: individual
          ? templates.filter((t) => t.student_id === studentId)
          : templates,
      });
      a.setNotice("✓ テンプレートと出席予定を保存しました");
      s.refresh();
    });
  }
  return (
    <>
      <h1>{individual ? "テンプレ個別編集" : "新規出席作成（月に一度）"}</h1>
      <MonthSelect past month={s.month} onChange={s.setMonth} />
      {individual && (
        <label>
          生徒{" "}
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
            {s.data?.students
              .filter((s) => s.active)
              .map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <button
        className="secondary"
        disabled={a.busy || s.loading}
        onClick={() =>
          void a.run(async () => {
            const prev = await api<Schedule>(
              "/api/teacher/schedule?month=" + monthOffset(s.month, -1),
            );
            setTemplates(prev.templates);
            a.setNotice(
              "前月のテンプレートを読み込みました。保存すると反映されます",
            );
          })
        }
      >
        前月を読み込む
      </button>
      <ErrorBox error={s.error} />
      <div className="table-wrap">
        <table className="template-table">
          <thead>
            <tr>
              <th rowSpan={2}>生徒</th>
              {[1, 2, 3, 4, 5, 6].map((day) => (
                <th key={day} colSpan={6}>
                  {weekdays[day]}
                </th>
              ))}
            </tr>
            <tr>
              {Array.from({ length: 36 }, (_, i) => (
                <th key={i}>{(i % 6) + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((st) => (
              <tr key={st.id}>
                <th>{st.name}</th>
                {Array.from({ length: 36 }, (_, i) => {
                  const day = Math.floor(i / 6) + 1,
                    period = (i % 6) + 1;
                  return (
                    <td key={i}>
                      <input
                        type="checkbox"
                        aria-label={`${st.name} ${weekdays[day]} ${period}限`}
                        checked={templates.some(
                          (t) =>
                            t.student_id === st.id &&
                            t.weekday === day &&
                            t.period === period,
                        )}
                        onChange={() => toggle(st.id, day, period)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button
          disabled={
            a.busy || !s.data || s.loading || (individual && !studentId)
          }
          onClick={() => void save(true)}
        >
          ✓ {individual ? "変更を出席予定に反映" : "次月テンプレと出席を保存"}
        </button>
        <button
          className="secondary"
          disabled={a.busy || !s.data || s.loading}
          onClick={() => void save(false)}
        >
          テンプレートのみ保存
        </button>
      </div>
      <Status a={a} />
    </>
  );
}
function Publication() {
  const s = useSchedule();
  const a = useAction();
  return (
    <>
      <h1>月ごとの公開設定</h1>
      <MonthSelect past month={s.month} onChange={s.setMonth} />
      <ErrorBox error={s.error} />
      {s.data && !s.loading && (
        <section>
          <p className="summary">
            現在の状態：{s.data.published ? "公開中" : "非公開"}
          </p>
          <button
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                await api("/api/teacher/publication", {
                  month: s.month,
                  revision: s.data!.revision,
                  published: !s.data!.published,
                });
                s.refresh();
                a.setNotice("✓ 公開設定を保存しました");
              })
            }
          >
            {s.data.published ? "非公開にする" : "公開する"}
          </button>
        </section>
      )}
      <Status a={a} />
    </>
  );
}
function Announcements() {
  const [rows, setRows] = useState<Announcement[]>([]);
  const [text, setText] = useState("");
  const a = useAction();
  const load = () =>
    api<Announcement[]>("/api/teacher/announcements").then(setRows);
  useEffect(() => {
    void a.run(load);
  }, []);
  return (
    <>
      <h1>お知らせ管理</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            await api("/api/teacher/announcements", { text });
            setText("");
            await load();
            a.setNotice("✓ お知らせを追加しました");
          });
        }}
      >
        <label>
          お知らせ本文
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            required
          />
        </label>
        <button disabled={a.busy}>追加する</button>
      </form>
      <Status a={a} />
      {rows.map((r) => (
        <article key={r.id}>
          <time>{r.created_at.slice(0, 10)}</time>
          <p className="prewrap">{r.text}</p>
          <button
            className="danger"
            disabled={a.busy}
            onClick={() => {
              if (confirm("このお知らせを削除しますか？"))
                void a.run(async () => {
                  await api("/api/teacher/announcements/delete", { id: r.id });
                  await load();
                });
            }}
          >
            削除
          </button>
        </article>
      ))}
    </>
  );
}
function Logs() {
  const [month, setMonth] = useState(todayJst().slice(0, 7));
  const [rows, setRows] = useState<{
    logins: { id: number; name: string; created_at: string }[];
    audits: { id: number; action: string; created_at: string }[];
  }>({ logins: [], audits: [] });
  const a = useAction();
  useEffect(() => {
    void a.run(async () =>
      setRows(await api("/api/teacher/logs?month=" + month)),
    );
  }, [month]);
  return (
    <>
      <h1>閲覧者確認</h1>
      <MonthSelect past month={month} onChange={setMonth} />
      <Status a={a} />
      <table>
        <thead>
          <tr>
            <th>生徒</th>
            <th>ログイン日時</th>
          </tr>
        </thead>
        <tbody>
          {rows.logins.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>
                {new Date(r.created_at).toLocaleString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
function Export() {
  const [month, setMonth] = useState(todayJst().slice(0, 7));
  return (
    <>
      <h1>Excel出力</h1>
      <MonthSelect past month={month} onChange={setMonth} />
      <p>日付と6コマの科目・登録者を、従来の出席表形式でCSVに出力します。</p>
      <a className="big-button" href={"/api/teacher/export?month=" + month}>
        CSVをダウンロード
      </a>
    </>
  );
}
const homeFields = [
  ["hero_html", "上部の大見出し"],
  ["features_html", "一輝塾の主な特徴"],
  ["message_html", "代表メッセージ"],
  ["schedule_html", "授業開始時間と料金"],
  ["results_html", "合格実績"],
  ["guide_html", "塾案内"],
  ["news_html", "新着情報"],
];
function HomeEditor() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const a = useAction();
  useEffect(() => {
    void a.run(async () => setFields(await api("/api/teacher/home")));
  }, []);
  return (
    <>
      <h1>ホームページ編集</h1>
      {homeFields.map(([key, label]) => (
        <label key={key}>
          {label}
          <textarea
            value={fields[key] ?? ""}
            maxLength={10000}
            onChange={(e) =>
              setFields((v) => ({ ...v, [key]: e.target.value }))
            }
          />
        </label>
      ))}
      <button
        disabled={a.busy}
        onClick={() =>
          void a.run(async () => {
            await api("/api/teacher/home", fields);
            a.setNotice("✓ 保存しました");
          })
        }
      >
        ✓ 保存する
      </button>
      <Status a={a} />
    </>
  );
}
export function PublicHome() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    api<Record<string, string>>("/public/v1/home")
      .then(setFields)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main>
      <h1>一輝塾</h1>
      <ErrorBox error={error} />
      {homeFields.map(([key, label]) => (
        <section key={key}>
          <h2>{label}</h2>
          <div
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(fields[key] ?? ""),
            }}
          />
        </section>
      ))}
    </main>
  );
}
export default function TeacherPage() {
  switch (path) {
    case "/teacher_today.html":
      return <TeacherAttendance />;
    case "/teacher_past.html":
      return <TeacherAttendance past />;
    case "/kyuukoubi.html":
      return <CalendarEditor />;
    case "/temporary_days.html":
      return <CalendarEditor patterns />;
    case "/subject_editor.html":
      return <Subjects />;
    case "/student_admin.html":
    case "/rename.html":
    case "/yomi_editor.html":
      return <Students />;
    case "/teacher_nextmonth_template.html":
      return <Templates />;
    case "/teacher_template_edit.html":
      return <Templates individual />;
    case "/teacher_visibility_editor.html":
      return <Publication />;
    case "/teacher_announcements.html":
      return <Announcements />;
    case "/accesslog_view.html":
      return <Logs />;
    case "/attendance_csv_export.html":
      return <Export />;
    case "/fix_attendanceCount.html":
      return (
        <>
          <p className="notice">
            人数は現在の登録内容から自動集計されています。
          </p>
          <TeacherAttendance />
        </>
      );
    case "/home_admin.html":
      return <HomeEditor />;
    default:
      return <TeacherTop />;
  }
}
