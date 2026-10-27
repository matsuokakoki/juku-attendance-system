import { attendanceCsv } from "../shared/report";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { timingSafeEqual } from "node:crypto";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  dateSchema,
  monthSchema,
  periodSchema,
  patternSchema,
} from "../shared/validation";
import {
  monthDates,
  teacherSessionExpires,
  todayJst,
  monthOffset,
  slotInfo,
  csvCell,
  type Identity,
  type Student,
  type CalendarDay,
  type Subject,
  type Reservation,
} from "../shared/domain";

type Bindings = Env & { MAINTENANCE?: string };
type AppEnv = { Bindings: Bindings; Variables: { identity: Identity } };
const app = new Hono<AppEnv>();
function fail(
  status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
  message: string,
): never {
  throw new HTTPException(status, { message });
}
async function digest(s: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
  );
}
async function hash(s: string) {
  return Array.from(await digest(s), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function equal(a: string, b: string) {
  return timingSafeEqual(await digest(a), await digest(b));
}
function cookieName(c: Context<AppEnv>, role: string) {
  return (
    (new URL(c.req.url).protocol === "https:" ? "__Host-" : "") + "juku_" + role
  );
}
const studentCookie = (c: Context<AppEnv>) => cookieName(c, "student");
const teacherCookie = (c: Context<AppEnv>) => cookieName(c, "teacher");
async function body<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  try {
    return schema.parse(await c.req.json());
  } catch {
    fail(400, "入力内容を確認してください");
  }
}
async function audit(c: Context<AppEnv>, action: string, details: unknown) {
  const id = c.get("identity");
  return c.env.DB.prepare(
    "INSERT INTO audit(actor,action,details) VALUES(?,?,?)",
  ).bind(id?.studentId ?? "teacher", action, JSON.stringify(details));
}
async function guard(c: Context<AppEnv>, month: string, revision: number) {
  const id = crypto.randomUUID();
  return {
    first: c.env.DB.prepare(
      "INSERT INTO write_guards(id,ok) VALUES(?,EXISTS(SELECT 1 FROM months WHERE month=? AND revision=?))",
    ).bind(id, month, revision),
    last: c.env.DB.prepare("DELETE FROM write_guards WHERE id=?").bind(id),
  };
}
async function commit(
  c: Context<AppEnv>,
  month: string,
  revision: number,
  queries: D1PreparedStatement[],
) {
  const g = await guard(c, month, revision);
  try {
    await c.env.DB.batch([
      g.first,
      ...queries,
      c.env.DB.prepare(
        "UPDATE months SET revision=revision+1 WHERE month=?",
      ).bind(month),
      g.last,
    ]);
  } catch (e) {
    if (String(e).includes("CHECK constraint"))
      fail(
        409,
        "別の画面で更新されました。再読み込みして変更を確認してください",
      );
    throw e;
  }
}
app.onError((error, c) => {
  if (error instanceof z.ZodError)
    return c.json({ error: "入力内容を確認してください" }, 400);
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  console.error(
    JSON.stringify({
      event: "request_error",
      path: c.req.path,
      type: error.name,
    }),
  );
  return c.json(
    { error: "処理に失敗しました。時間をおいて再度お試しください" },
    500,
  );
});
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Frame-Options", "DENY");
  if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 200_000,
    onError: (c) => c.json({ error: "送信サイズが大きすぎます" }, 413),
  }),
);
app.use("/api/*", async (c, next) => {
  if (c.env.MAINTENANCE === "true" && c.req.path !== "/api/health")
    fail(503, "メンテナンス中です。しばらくお待ちください");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin !== new URL(c.req.url).origin)
      fail(403, "この操作は許可されていません");
    if (!c.req.header("content-type")?.startsWith("application/json"))
      fail(400, "JSON形式が必要です");
    const size = Number(c.req.header("content-length") ?? 0);
    if (size > 200_000) fail(400, "一度に送信できるサイズを超えています");
  }
  await next();
});
async function authenticate(c: Context<AppEnv>, role: "student" | "teacher") {
  const token = getCookie(
    c,
    role === "teacher" ? teacherCookie(c) : studentCookie(c),
  );
  if (!token) fail(401, "ログインしてください");
  const s = await c.env.DB.prepare(
    "SELECT s.*,t.name,t.active FROM sessions s LEFT JOIN students t ON t.id=s.student_id WHERE s.hash=? AND s.role=? AND s.expires>?",
  )
    .bind(await hash(token), role, Math.floor(Date.now() / 1000))
    .first<{
      role: "student" | "teacher";
      student_id: string | null;
      csrf: string;
      name: string;
      active: number;
    }>();
  if (!s || (role === "student" && s.active !== 1))
    fail(401, "ログインしてください");
  const identity: Identity = {
    role,
    studentId: s.student_id,
    name: role === "teacher" ? "先生" : s.name,
    csrf: s.csrf,
  };
  c.set("identity", identity);
  if (
    !["GET", "HEAD"].includes(c.req.method) &&
    c.req.header("x-csrf-token") !== s.csrf
  )
    fail(403, "画面を再読み込みしてください");
  return identity;
}
app.use("/api/student/*", async (c, next) => {
  await authenticate(c, "student");
  await next();
});
app.use("/api/teacher/*", async (c, next) => {
  await authenticate(c, "teacher");
  await next();
});
app.get("/api/health", (c) =>
  c.json({ status: "ok", environment: c.env.ENVIRONMENT }),
);
app.post("/api/login", async (c) => {
  const data = await body(
    c,
    z.object({
      role: z.enum(["student", "teacher"]),
      name: z.string().trim().max(50).default(""),
      password: z.string().trim().max(200),
    }),
  );
  if (
    !c.env.STUDENT_PASSWORD ||
    !c.env.TEACHER_PASSWORD ||
    !c.env.SESSION_SECRET
  )
    fail(503, "認証の設定が完了していません");
  const now = Math.floor(Date.now() / 1000);
  const ip = await hash(
    c.env.SESSION_SECRET + ":" + (c.req.header("cf-connecting-ip") ?? "local"),
  );
  const window = Math.floor(now / 600);
  const key = ip + ":" + window;
  const rate = await c.env.DB.prepare(
    "INSERT INTO rate_limits(key,attempts,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
  )
    .bind(key, now + 1200)
    .first<{ attempts: number }>();
  if ((rate?.attempts ?? 0) > 60)
    fail(429, "試行回数が多いため、10分ほど待って再度お試しください");
  const password =
    data.role === "teacher" ? c.env.TEACHER_PASSWORD : c.env.STUDENT_PASSWORD;
  if (!(await equal(data.password, password)))
    fail(401, "パスワードが間違っています");
  let student: Student | null = null;
  if (data.role === "student") {
    student = await c.env.DB.prepare(
      "SELECT * FROM students WHERE name=? AND active=1",
    )
      .bind(data.name)
      .first<Student>();
    if (!student) fail(401, "その名前は登録されていません");
  }
  const token = crypto.randomUUID() + crypto.randomUUID();
  const csrf = crypto.randomUUID();
  const age =
    data.role === "teacher" ? teacherSessionExpires() - now : 12 * 3600;
  const previous = getCookie(c, cookieName(c, data.role));
  const queries = [
    c.env.DB.prepare(
      "INSERT INTO sessions(hash,role,student_id,csrf,expires,created_at) VALUES(?,?,?,?,?,?)",
    ).bind(
      await hash(token),
      data.role,
      student?.id ?? null,
      csrf,
      now + age,
      now,
    ),
    c.env.DB.prepare("DELETE FROM sessions WHERE expires<?").bind(now),
    c.env.DB.prepare("DELETE FROM rate_limits WHERE expires<?").bind(now),
  ];
  if (previous)
    queries.push(
      c.env.DB.prepare("DELETE FROM sessions WHERE hash=?").bind(
        await hash(previous),
      ),
    );
  if (student)
    queries.push(
      c.env.DB.prepare(
        "INSERT INTO login_events(student_id,created_at) VALUES(?,?)",
      ).bind(student.id, new Date().toISOString()),
    );
  await c.env.DB.batch(queries);
  setCookie(c, cookieName(c, data.role), token, {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    ...(data.role === "teacher" ? { maxAge: age } : {}),
  });
  return c.json({
    role: data.role,
    studentId: student?.id ?? null,
    name: student?.name ?? "先生",
    csrf,
  });
});
for (const role of ["student", "teacher"] as const) {
  app.get(`/api/${role}/me`, (c) => c.json(c.get("identity")));
  app.post(`/api/${role}/logout`, async (c) => {
    const token = getCookie(c, cookieName(c, role));
    if (token)
      await c.env.DB.prepare("DELETE FROM sessions WHERE hash=?")
        .bind(await hash(token))
        .run();
    deleteCookie(c, cookieName(c, role), { path: "/" });
    return c.json({ ok: true });
  });
}
app.get("/api/student/announcements", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5",
      ).all()
    ).results,
  ),
);
async function readSchedule(c: Context<AppEnv>, teacher: boolean) {
  const month = monthSchema.parse(
    c.req.query("month") ?? todayJst().slice(0, 7),
  );
  const today = todayJst();
  if (
    !teacher &&
    (month < today.slice(0, 7) || month > monthOffset(today.slice(0, 7), 2))
  )
    fail(403, "この月は表示できません");
  const meta = await c.env.DB.prepare("SELECT * FROM months WHERE month=?")
    .bind(month)
    .first<{ published: number; revision: number }>();
  if (!teacher && !meta?.published)
    return c.json({
      month,
      published: false,
      revision: meta?.revision ?? 0,
      today,
      calendar: [],
      subjects: [],
      reservations: [],
      counts: [],
      students: [],
      templates: [],
    });
  const user = c.get("identity");
  const [calendar, subjects, reservations, counts, students, templates] =
    await c.env.DB.batch([
      c.env.DB.prepare(
        "SELECT * FROM calendar WHERE date>=? AND date<? ORDER BY date",
      ).bind(month + "-01", monthOffset(month, 1) + "-01"),
      c.env.DB.prepare("SELECT * FROM subjects"),
      teacher
        ? c.env.DB.prepare(
            "SELECT r.* FROM reservations r JOIN students s ON s.id=r.student_id WHERE r.date>=? AND r.date<? AND s.active=1",
          ).bind(month + "-01", monthOffset(month, 1) + "-01")
        : c.env.DB.prepare(
            "SELECT * FROM reservations WHERE student_id=? AND date>=? AND date<?",
          ).bind(user.studentId, month + "-01", monthOffset(month, 1) + "-01"),
      c.env.DB.prepare(
        "SELECT date,period,count(*) AS count FROM reservations r JOIN students s ON s.id=r.student_id WHERE date>=? AND date<? AND s.active=1 GROUP BY date,period",
      ).bind(month + "-01", monthOffset(month, 1) + "-01"),
      teacher
        ? c.env.DB.prepare("SELECT * FROM students ORDER BY yomi,name")
        : c.env.DB.prepare(
            "SELECT id,name,yomi,active FROM students WHERE id=?",
          ).bind(user.studentId),
      teacher
        ? c.env.DB.prepare("SELECT * FROM templates WHERE month=?").bind(month)
        : c.env.DB.prepare("SELECT * FROM templates WHERE 0"),
    ]);
  return c.json({
    month,
    published: !!meta?.published,
    revision: meta?.revision ?? 0,
    today,
    calendar: calendar.results,
    subjects: subjects.results,
    reservations: reservations.results,
    counts: counts.results,
    students: students.results,
    templates: templates.results,
  });
}
app.get("/api/student/schedule", (c) => readSchedule(c, false));
app.get("/api/teacher/schedule", async (c) => {
  const month = monthSchema.parse(
    c.req.query("month") ?? todayJst().slice(0, 7),
  );
  await c.env.DB.prepare("INSERT OR IGNORE INTO months(month) VALUES(?)")
    .bind(month)
    .run();
  return readSchedule(c, true);
});
const changesSchema = z.object({
  month: monthSchema,
  revision: z.number().int().nonnegative(),
  changes: z
    .array(z.object({ date: dateSchema, period: periodSchema }))
    .min(1)
    .max(186),
});
app.post("/api/student/cancellations", async (c) => {
  const d = await body(c, changesSchema);
  const id = c.get("identity").studentId!;
  const meta = await c.env.DB.prepare(
    "SELECT published FROM months WHERE month=?",
  )
    .bind(d.month)
    .first<{ published: number }>();
  if (!meta?.published) fail(403, "この月は公開されていません");
  const today = todayJst();
  if (
    d.month < today.slice(0, 7) ||
    d.month > monthOffset(today.slice(0, 7), 2) ||
    d.changes.some((s) => s.date <= today || s.date.slice(0, 7) !== d.month)
  )
    fail(403, "変更できる日付ではありません");
  const [cal, sub] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM calendar WHERE date>=? AND date<?").bind(
      d.month + "-01",
      monthOffset(d.month, 1) + "-01",
    ),
    c.env.DB.prepare("SELECT * FROM subjects"),
  ]);
  if (
    d.changes.some((s) => {
      const info = slotInfo(
        s.date,
        s.period,
        cal.results as CalendarDay[],
        sub.results as Subject[],
      );
      return info.closed || info.study;
    })
  )
    fail(403, "変更できるコマではありません");
  const queries = d.changes.map((s) =>
    c.env.DB.prepare(
      "DELETE FROM reservations WHERE student_id=? AND date=? AND period=?",
    ).bind(id, s.date, s.period),
  );
  queries.push(
    await audit(c, "cancel", { month: d.month, changes: d.changes }),
  );
  await commit(c, d.month, d.revision, queries);
  return c.json({ ok: true });
});
app.post("/api/teacher/reservations", async (c) => {
  const d = await body(
    c,
    z.object({
      month: monthSchema,
      revision: z.number().int().nonnegative(),
      changes: z
        .array(
          z.object({
            studentId: z.string().min(1).max(100),
            date: dateSchema,
            period: periodSchema,
            present: z.boolean(),
          }),
        )
        .max(300),
    }),
  );
  if (d.changes.some((s) => s.date.slice(0, 7) !== d.month))
    fail(400, "日付と月が一致しません");
  const students = (
    await c.env.DB.prepare("SELECT id FROM students WHERE active=1").all<{
      id: string;
    }>()
  ).results;
  if (d.changes.some((s) => !students.some((t) => t.id === s.studentId)))
    fail(400, "生徒が登録されていません");
  const queries = d.changes.map((s) =>
    s.present
      ? c.env.DB.prepare(
          "INSERT OR IGNORE INTO reservations(student_id,date,period) VALUES(?,?,?)",
        ).bind(s.studentId, s.date, s.period)
      : c.env.DB.prepare(
          "DELETE FROM reservations WHERE student_id=? AND date=? AND period=?",
        ).bind(s.studentId, s.date, s.period),
  );
  queries.push(await audit(c, "teacher_reservations", d));
  await commit(c, d.month, d.revision, queries);
  return c.json({ ok: true });
});
app.post("/api/teacher/calendar", async (c) => {
  const d = await body(
    c,
    z.object({
      month: monthSchema,
      revision: z.number().int().nonnegative(),
      days: z
        .array(
          z.object({
            date: dateSchema,
            closed: z.number().int().min(0).max(1),
            pattern: patternSchema,
            reason: z.string().max(200),
          }),
        )
        .max(31),
    }),
  );
  if (d.days.some((s) => s.date.slice(0, 7) !== d.month))
    fail(400, "日付と月が一致しません");
  await commit(c, d.month, d.revision, [
    ...d.days.map((s) =>
      c.env.DB.prepare(
        "INSERT INTO calendar(date,closed,pattern,reason) VALUES(?,?,?,?) ON CONFLICT(date) DO UPDATE SET closed=excluded.closed,pattern=excluded.pattern,reason=excluded.reason",
      ).bind(s.date, s.closed, s.pattern, s.reason),
    ),
    await audit(c, "calendar", d),
  ]);
  return c.json({ ok: true });
});
app.post("/api/teacher/subjects", async (c) => {
  const d = await body(
    c,
    z.object({
      subjects: z
        .array(
          z.object({
            pattern: patternSchema,
            weekday: z.number().int().min(0).max(6),
            period: periodSchema,
            subject: z.string().min(1).max(40),
          }),
        )
        .max(126),
    }),
  );
  await c.env.DB.batch([
    ...d.subjects.map((s) =>
      c.env.DB.prepare(
        "UPDATE subjects SET subject=? WHERE pattern=? AND weekday=? AND period=?",
      ).bind(s.subject, s.pattern, s.weekday, s.period),
    ),
    c.env.DB.prepare("UPDATE months SET revision=revision+1"),
    await audit(c, "subjects", d),
  ]);
  return c.json({ ok: true });
});
app.post("/api/teacher/publication", async (c) => {
  const d = await body(
    c,
    z.object({
      month: monthSchema,
      revision: z.number().int().nonnegative(),
      published: z.boolean(),
    }),
  );
  await commit(c, d.month, d.revision, [
    c.env.DB.prepare("UPDATE months SET published=? WHERE month=?").bind(
      d.published ? 1 : 0,
      d.month,
    ),
    await audit(c, "publication", d),
  ]);
  return c.json({ ok: true });
});
app.get("/api/teacher/students", async (c) =>
  c.json(
    (await c.env.DB.prepare("SELECT * FROM students ORDER BY yomi,name").all())
      .results,
  ),
);
app.post("/api/teacher/students", async (c) => {
  const d = await body(
    c,
    z.object({
      id: z.string().max(100).optional(),
      name: z.string().trim().min(1).max(50),
      yomi: z.string().trim().max(100),
      active: z.number().int().min(0).max(1),
    }),
  );
  const id = d.id ?? crypto.randomUUID();
  if (
    d.id &&
    !(await c.env.DB.prepare("SELECT id FROM students WHERE id=?")
      .bind(id)
      .first())
  )
    fail(404, "生徒が見つかりません");
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO students(id,name,yomi,active) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,yomi=excluded.yomi,active=excluded.active",
      ).bind(id, d.name, d.yomi, d.active),
      ...(d.active === 0
        ? [c.env.DB.prepare("DELETE FROM sessions WHERE student_id=?").bind(id)]
        : []),
      c.env.DB.prepare("UPDATE months SET revision=revision+1"),
      await audit(c, "student", { ...d, id }),
    ]);
  } catch (e) {
    if (String(e).includes("UNIQUE"))
      fail(409, "その名前は既に登録されています");
    throw e;
  }
  return c.json({ ok: true, id });
});
const templatesSchema = z.object({
  month: monthSchema,
  revision: z.number().int().nonnegative(),
  studentId: z.string().min(1).max(100).optional(),
  generate: z.boolean().default(false),
  templates: z
    .array(
      z.object({
        student_id: z.string().min(1).max(100),
        weekday: z.number().int().min(0).max(6),
        period: periodSchema,
      }),
    )
    .max(5000),
});
app.post("/api/teacher/templates", async (c) => {
  const d = await body(c, templatesSchema);
  if (d.studentId && d.templates.some((t) => t.student_id !== d.studentId))
    fail(400, "生徒が一致しません");
  const templates = JSON.stringify(d.templates);
  const queries: D1PreparedStatement[] = [
    d.studentId
      ? c.env.DB.prepare(
          "DELETE FROM templates WHERE month=? AND student_id=?",
        ).bind(d.month, d.studentId)
      : c.env.DB.prepare("DELETE FROM templates WHERE month=?").bind(d.month),
    c.env.DB.prepare(
      "INSERT OR IGNORE INTO templates(month,student_id,weekday,period) SELECT ?,json_extract(value,'$.student_id'),json_extract(value,'$.weekday'),json_extract(value,'$.period') FROM json_each(?)",
    ).bind(d.month, templates),
  ];
  if (d.generate) {
    if (d.studentId)
      queries.push(
        c.env.DB.prepare(
          "DELETE FROM reservations WHERE substr(date,1,7)=? AND student_id=?",
        ).bind(d.month, d.studentId),
      );
    else
      queries.push(
        c.env.DB.prepare(
          "DELETE FROM reservations WHERE substr(date,1,7)=?",
        ).bind(d.month),
      );
    queries.push(
      c.env.DB.prepare(
        `WITH RECURSIVE days(date) AS (SELECT ? UNION ALL SELECT date(date,'+1 day') FROM days WHERE date<date(?,'-1 day')) INSERT OR IGNORE INTO reservations(student_id,date,period) SELECT t.student_id,d.date,t.period FROM days d JOIN templates t ON t.month=? AND t.weekday=CAST(strftime('%w',d.date) AS INTEGER) JOIN students s ON s.id=t.student_id AND s.active=1 LEFT JOIN calendar c ON c.date=d.date WHERE strftime('%w',d.date)!='0' AND COALESCE(c.closed,0)=0 AND (? IS NULL OR t.student_id=?)`,
      ).bind(
        d.month + "-01",
        monthOffset(d.month, 1) + "-01",
        d.month,
        d.studentId ?? null,
        d.studentId ?? null,
      ),
    );
  }
  queries.push(
    await audit(c, "templates", {
      month: d.month,
      studentId: d.studentId,
      generate: d.generate,
      count: d.templates.length,
    }),
  );
  await commit(c, d.month, d.revision, queries);
  return c.json({ ok: true });
});
app.get("/api/teacher/announcements", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT * FROM announcements ORDER BY created_at DESC LIMIT 200",
      ).all()
    ).results,
  ),
);
app.post("/api/teacher/announcements", async (c) => {
  const d = await body(
    c,
    z.object({ text: z.string().trim().min(1).max(2000) }),
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO announcements(id,text,created_at) VALUES(?,?,?)",
    ).bind(crypto.randomUUID(), d.text, new Date().toISOString()),
    await audit(c, "announcement_add", d),
  ]);
  return c.json({ ok: true });
});
app.post("/api/teacher/announcements/delete", async (c) => {
  const d = await body(c, z.object({ id: z.string().max(100) }));
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM announcements WHERE id=?").bind(d.id),
    await audit(c, "announcement_delete", d),
  ]);
  return c.json({ ok: true });
});
app.get("/api/teacher/logs", async (c) => {
  const month = monthSchema.parse(c.req.query("month"));
  const [logins, audits] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT l.id,s.name,l.created_at FROM login_events l JOIN students s ON s.id=l.student_id WHERE created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 1000",
    ).bind(
      new Date(month + "-01T00:00:00+09:00").toISOString(),
      new Date(monthOffset(month, 1) + "-01T00:00:00+09:00").toISOString(),
    ),
    c.env.DB.prepare(
      "SELECT * FROM audit WHERE created_at>=? AND created_at<? ORDER BY id DESC LIMIT 200",
    ).bind(
      new Date(month + "-01T00:00:00+09:00").toISOString(),
      new Date(monthOffset(month, 1) + "-01T00:00:00+09:00").toISOString(),
    ),
  ]);
  return c.json({ logins: logins.results, audits: audits.results });
});
app.get("/api/teacher/export", async (c) => {
  const month = monthSchema.parse(c.req.query("month"));
  const rows = (
    await c.env.DB.prepare(
      "SELECT r.date,r.period,s.name FROM reservations r JOIN students s ON s.id=r.student_id WHERE substr(r.date,1,7)=? ORDER BY r.date,r.period,s.yomi,s.name",
    )
      .bind(month)
      .all<{ date: string; period: number; name: string }>()
  ).results;
  const cal = (
    await c.env.DB.prepare("SELECT * FROM calendar WHERE substr(date,1,7)=?")
      .bind(month)
      .all<CalendarDay>()
  ).results;
  const subjects = (
    await c.env.DB.prepare("SELECT * FROM subjects").all<Subject>()
  ).results;
  const csv = attendanceCsv(month, rows, cal, subjects);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
app.get("/api/teacher/home", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT data FROM site_content WHERE id='home'",
  ).first<{ data: string }>();
  return c.json(JSON.parse(row?.data ?? "{}"));
});
app.post("/api/teacher/home", async (c) => {
  const d = await body(c, z.record(z.string().max(100), z.string().max(10000)));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE site_content SET data=? WHERE id='home'").bind(
      JSON.stringify(d),
    ),
    await audit(c, "home", { keys: Object.keys(d) }),
  ]);
  return c.json({ ok: true });
});
app.get("/public/v1/home", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT data FROM site_content WHERE id='home'",
  ).first<{ data: string }>();
  c.header("Cache-Control", "public, max-age=60");
  return c.json(JSON.parse(row?.data ?? "{}"));
});
app.get("/public/v1/closures", async (c) => {
  const from = dateSchema.parse(
    c.req.query("from") ?? todayJst().slice(0, 7) + "-01",
  );
  const to = dateSchema.parse(
    c.req.query("to") ?? monthOffset(from.slice(0, 7), 3) + "-01",
  );
  if (
    to < from ||
    new Date(to).getTime() - new Date(from).getTime() > 366 * 86400000
  )
    fail(400, "取得期間は1年以内にしてください");
  const rows = (
    await c.env.DB.prepare(
      "SELECT date,reason FROM calendar WHERE closed=1 AND date>=? AND date<=? ORDER BY date",
    )
      .bind(from, to)
      .all()
  ).results;
  const etag = '"' + (await hash(JSON.stringify(rows))) + '"';
  c.header("ETag", etag);
  c.header("Cache-Control", "public, max-age=60, stale-if-error=86400");
  c.header("Access-Control-Allow-Origin", "*");
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);
  return c.json({ version: 1, timezone: "Asia/Tokyo", closures: rows });
});
app.all("/api/*", (c) => c.json({ error: "APIが見つかりません" }, 404));
export default app;
