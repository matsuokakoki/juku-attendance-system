import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  todayJst,
  addDays,
  weekday,
  monthOffset,
  monthDates,
  type Identity,
  type Schedule,
  type AttendancePage,
} from "../shared/domain";
const secrets = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split("=")),
);
const origin = "http://127.0.0.1:8787";
const month = todayJst().slice(0, 7);
let future = addDays(todayJst(), 1);
while (weekday(future) === 0) future = addDays(future, 1);
const futureMonth = future.slice(0, 7);
async function login(request: APIRequestContext, role: "teacher" | "student") {
  const r = await request.post("/api/login", {
    headers: { origin },
    data: {
      role,
      name: "山田",
      password:
        role === "teacher"
          ? secrets.TEACHER_PASSWORD
          : secrets.STUDENT_PASSWORD,
    },
  });
  expect(r.status()).toBe(200);
  return (await r.json()) as Identity;
}
async function post(
  request: APIRequestContext,
  path: string,
  id: Identity,
  data: unknown,
) {
  return request.post(path, {
    headers: { origin, "x-csrf-token": id.csrf },
    data,
  });
}
async function schedule(request: APIRequestContext, m = month) {
  return (await (
    await request.get("/api/teacher/schedule?month=" + m)
  ).json()) as Schedule;
}
test("未認証では先生データを取得・更新できない", async ({ request }) => {
  expect((await request.get("/api/teacher/students")).status()).toBe(401);
  expect(
    (
      await request.post("/api/teacher/publication", {
        headers: { origin },
        data: {},
      })
    ).status(),
  ).toBe(401);
});
test("生徒は本人分のみ参照でき、先生権限を取得できない", async ({
  request,
}) => {
  await login(request, "student");
  const d = (await (
    await request.get("/api/student/schedule?month=" + month)
  ).json()) as Schedule;
  expect(d.students.map((s) => s.name)).toEqual(["山田"]);
  expect(d.reservations.every((r) => r.student_id === "demo-yamada")).toBe(
    true,
  );
  expect((await request.get("/api/teacher/students")).status()).toBe(401);
});
test("生徒の新規追加APIとCSRFのない更新を拒否", async ({ request }) => {
  const id = await login(request, "student");
  expect(
    (
      await post(request, "/api/student/reservations", id, { present: true })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/student/cancellations", {
        headers: { origin },
        data: { month, revision: 0, changes: [{ date: future, period: 1 }] },
      })
    ).status(),
  ).toBe(403);
});
test("外部Originと当日の取消を拒否", async ({ request }) => {
  const id = await login(request, "student");
  expect(
    (
      await request.post("/api/student/cancellations", {
        headers: { origin: "https://evil.example", "x-csrf-token": id.csrf },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await post(request, "/api/student/cancellations", id, {
        month,
        revision: 0,
        changes: [{ date: todayJst(), period: 1 }],
      })
    ).status(),
  ).toBe(403);
});
test("取消・競合拒否・再送で人数が壊れない", async ({ request }) => {
  const teacher = await login(request, "teacher");
  let d = await schedule(request, futureMonth);
  expect(
    (
      await post(request, "/api/teacher/reservations", teacher, {
        month: futureMonth,
        revision: d.revision,
        changes: [
          { studentId: "demo-yamada", date: future, period: 1, present: true },
        ],
      })
    ).ok(),
  ).toBe(true);
  const student = await login(request, "student");
  d = await schedule(request, futureMonth);
  const payload = {
    month: futureMonth,
    revision: d.revision,
    changes: [{ date: future, period: 1 }],
  };
  expect(
    (
      await post(request, "/api/student/cancellations", student, payload)
    ).status(),
  ).toBe(200);
  expect(
    (
      await post(request, "/api/student/cancellations", student, payload)
    ).status(),
  ).toBe(409);
  const after = await schedule(request, futureMonth);
  expect(
    after.reservations.some(
      (r) =>
        r.student_id === "demo-yamada" && r.date === future && r.period === 1,
    ),
  ).toBe(false);
  expect(
    after.counts.find((r) => r.date === future && r.period === 1)?.count,
  ).toBe(1);
  await post(request, "/api/teacher/reservations", teacher, {
    month: futureMonth,
    revision: after.revision,
    changes: [
      { studentId: "demo-yamada", date: future, period: 1, present: true },
    ],
  });
});
test("非公開月のデータと取消を拒否して復元", async ({ request }) => {
  const t = await login(request, "teacher");
  let d = await schedule(request);
  expect(
    (
      await post(request, "/api/teacher/publication", t, {
        month,
        revision: d.revision,
        published: false,
      })
    ).ok(),
  ).toBe(true);
  const s = await login(request, "student");
  const hidden = await (
    await request.get("/api/student/schedule?month=" + month)
  ).json();
  expect(hidden.published).toBe(false);
  expect(hidden.reservations).toEqual([]);
  expect(
    (
      await post(request, "/api/student/cancellations", s, {
        month,
        revision: 0,
        changes: [{ date: future, period: 1 }],
      })
    ).status(),
  ).toBe(403);
  d = await schedule(request);
  await post(request, "/api/teacher/publication", t, {
    month,
    revision: d.revision,
    published: true,
  });
});
test("休講日APIは公開情報のみでETagに対応", async ({ request }) => {
  const t = await login(request, "teacher");
  const d = await schedule(request);
  const date = month + "-10";
  expect(
    (
      await post(request, "/api/teacher/calendar", t, {
        month,
        revision: d.revision,
        days: [{ date, closed: 1, pattern: "temporary2", reason: "休講" }],
      })
    ).ok(),
  ).toBe(true);
  const r = await request.get(
    "/public/v1/closures?from=" + month + "-01&to=" + month + "-28",
  );
  const payload = await r.json();
  expect(payload.closures).toContainEqual({ date, reason: "休講" });
  expect(JSON.stringify(payload)).not.toContain("student");
  expect(
    (
      await request.get(
        "/public/v1/closures?from=" + month + "-01&to=" + month + "-28",
        { headers: { "if-none-match": r.headers().etag } },
      )
    ).status(),
  ).toBe(304);
});
test("月生成はテンプレートから原子的に作成し重複しない", async ({
  request,
}) => {
  const id = await login(request, "teacher");
  const m = monthOffset(month, 2);
  let d = await schedule(request, m);
  const templates = [{ student_id: "demo-yamada", weekday: 1, period: 2 }];
  expect(
    (
      await post(request, "/api/teacher/templates", id, {
        month: m,
        revision: d.revision,
        templates,
        generate: true,
      })
    ).status(),
  ).toBe(200);
  d = await schedule(request, m);
  expect(d.reservations.length).toBeGreaterThan(0);
  expect(
    d.reservations.every(
      (r) =>
        r.student_id === "demo-yamada" &&
        weekday(r.date) === 1 &&
        r.period === 2,
    ),
  ).toBe(true);
  const count = d.reservations.length;
  await post(request, "/api/teacher/templates", id, {
    month: m,
    revision: d.revision,
    templates,
    generate: true,
  });
  expect((await schedule(request, m)).reservations).toHaveLength(count);
});
test("改名後も不変IDと予定を維持", async ({ request }) => {
  const id = await login(request, "teacher");
  const before = await schedule(request);
  await post(request, "/api/teacher/students", id, {
    id: "demo-sato",
    name: "佐藤改名",
    yomi: "さとう",
    active: 1,
  });
  const after = await schedule(request);
  expect(
    after.reservations.filter((r) => r.student_id === "demo-sato"),
  ).toEqual(before.reservations.filter((r) => r.student_id === "demo-sato"));
  await post(request, "/api/teacher/students", id, {
    id: "demo-sato",
    name: "佐藤",
    yomi: "さとう",
    active: 1,
  });
});
test("CSVは従来の55列・UTF8 BOMで出力", async ({ request }) => {
  await login(request, "teacher");
  const r = await request.get("/api/teacher/export?month=" + month);
  expect(r.headers()["content-type"]).toContain("text/csv");
  const text = await r.text();
  expect(text.split("\r\n")[0].split(",")).toHaveLength(55);
  expect(text).toContain("1限-科目");
});
test("生徒のログインから月別確認・取消まで", async ({ page }) => {
  await page.goto("/login.html");
  await page.getByLabel("名前", { exact: true }).fill("山田");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill(secrets.STUDENT_PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "月別の出席確認・変更" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "月別の出席確認・変更" }).click();
  await expect(
    page.getByRole("heading", { name: "山田さんの出席確認" }),
  ).toBeVisible();
  const slot = page.getByRole("button", {
    name: new RegExp(future + " 1限 .*登録済み"),
  });
  await expect(slot).toBeEnabled();
  await slot.click();
  await expect(slot).toHaveAttribute("aria-pressed", "false");
  await slot.click();
  await expect(slot).toHaveAttribute("aria-pressed", "true");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "✓ この変更を保存する" }).click();
  await expect(page.getByRole("status")).toContainText("保存しました");
});
test("当日画面は全コマ閲覧専用", async ({ page }) => {
  await page.goto("/login.html");
  await page.getByLabel("名前", { exact: true }).fill("山田");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill(secrets.STUDENT_PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("link", { name: "本日の出席を確認" }).click();
  await expect(page.locator(".slot")).toHaveCount(6);
  for (const slot of await page.locator(".slot").all())
    await expect(slot).toBeDisabled();
});
test("先生メニューと3種類の科目編集を実際に開く", async ({ page }) => {
  await page.goto("/teachertop_final.html");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill(secrets.TEACHER_PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page
    .getByRole("button", { name: "新規予定作成（月に一回のみ！）↓" })
    .click();
  await page.getByRole("link", { name: "科目名", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "曜日×コマごとの科目名設定" }),
  ).toBeVisible();
  const select = page.getByLabel("編集対象");
  await expect(select.locator("option")).toHaveCount(3);
  await select.selectOption("temporary2");
  await expect(page.getByLabel("臨時C 月 1限", { exact: true })).toBeVisible();
});
test("スマホ画面で横にはみ出さず主要操作が見える", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login.html");
  await page.getByLabel("名前", { exact: true }).fill("山田");
  await page
    .getByLabel("パスワード", { exact: true })
    .fill(secrets.STUDENT_PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("link", { name: "月別の出席確認・変更" }).click();
  await expect(
    page.getByRole("button", { name: "✓ この変更を保存する" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const table = page.locator(".student-schedule");
    await expect(table).toBeVisible();
    expect(
      await page
        .locator(".student-schedule-wrap")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    const lastColumn = await table
      .getByRole("columnheader", { name: "6限" })
      .boundingBox();
    expect(lastColumn).not.toBeNull();
    expect(lastColumn!.x + lastColumn!.width).toBeLessThanOrEqual(width);
  }
  await page.screenshot({
    path: "test-results/student-mobile.png",
    fullPage: true,
  });
});

test("公開済みの未来月は3か月先以降も取得・取消できる", async ({ request }) => {
  const farMonth = monthOffset(month, 4);
  let date = farMonth + "-15";
  if (weekday(date) === 0) date = addDays(date, 1);
  const teacher = await login(request, "teacher");
  const getFar = async () =>
    (await (
      await request.get("/api/teacher/schedule?month=" + farMonth)
    ).json()) as Schedule;
  let far = await getFar();
  await post(request, "/api/teacher/publication", teacher, {
    month: farMonth,
    revision: far.revision,
    published: true,
  });
  far = await getFar();
  await post(request, "/api/teacher/reservations", teacher, {
    month: farMonth,
    revision: far.revision,
    changes: [{ studentId: "demo-yamada", date, period: 1, present: true }],
  });
  const student = await login(request, "student");
  try {
    const months = await (
      await request.get("/api/student/schedule-months")
    ).json();
    expect(months.months).toContain(farMonth);
    const schedule = await (
      await request.get("/api/student/schedule?month=" + farMonth)
    ).json();
    expect(schedule.published).toBe(true);
    // Pick a weekday so the existing Sunday cancellation rule remains unchanged.
    if (weekday(date) !== 0) {
      const cancelled = await post(
        request,
        "/api/student/cancellations",
        student,
        {
          month: farMonth,
          revision: schedule.revision,
          changes: [{ date, period: 1 }],
        },
      );
      expect(cancelled.ok()).toBe(true);
    }
  } finally {
    far = await getFar();
    await post(request, "/api/teacher/publication", teacher, {
      month: farMonth,
      revision: far.revision,
      published: false,
    });
  }
  const months = await (
    await request.get("/api/student/schedule-months")
  ).json();
  expect(months.months).not.toContain(farMonth);
  const hidden = await (
    await request.get("/api/student/schedule?month=" + farMonth)
  ).json();
  expect(hidden.reservations).toEqual([]);
});

for (const role of ["student", "teacher"] as const) {
  test(`${role}: 必要な日付だけ取得し月をまたいで追加する`, async ({
    page,
  }) => {
    const base = month;
    const next = monthOffset(base, 1);
    const far = monthOffset(base, 3);
    const requestedDates: string[] = [];
    const requests: { limit: number; masters: string }[] = [];
    await page.route(`**/api/${role}/attendance?*`, (route) => {
      const query = new URL(route.request().url()).searchParams;
      const from = query.get("from")!;
      const limit = Number(query.get("limit"));
      requests.push({ limit, masters: query.get("masters")! });
      const all = [base, next, far]
        .flatMap(monthDates)
        .filter((date) => date >= from);
      const dates = all.slice(0, limit);
      requestedDates.push(...dates);
      const schedules: Record<string, Schedule> = {};
      for (const m of new Set(dates.map((date) => date.slice(0, 7)))) {
        schedules[m] = {
          month: m,
          today: todayJst(),
          published: true,
          revision: 0,
          calendar: [],
          subjects: [],
          counts: [],
          templates: [],
          students: [],
          reservations: dates
            .filter((date) => date.slice(0, 7) === m)
            .map((date) => ({ student_id: "demo-yamada", date, period: 1 })),
        };
      }
      const body: AttendancePage = {
        dates,
        next: dates.length ? addDays(dates.at(-1)!, 1) : null,
        hasMore: all.length > limit,
        schedules,
        today: todayJst(),
        weeklyCount: 5,
        students:
          query.get("masters") === "1"
            ? [{ id: "demo-yamada", name: "山田", yomi: "やまだ", active: 1 }]
            : [],
        subjects: [],
      };
      return route.fulfill({ json: body });
    });
    await page.goto(
      role === "student" ? "/login.html" : "/teachertop_final.html",
    );
    if (role === "student")
      await page.getByLabel("名前", { exact: true }).fill("山田");
    await page
      .getByLabel("パスワード", { exact: true })
      .fill(
        role === "student"
          ? secrets.STUDENT_PASSWORD
          : secrets.TEACHER_PASSWORD,
      );
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await page
      .getByRole("link", {
        name:
          role === "student" ? "月別の出席確認・変更" : "📅 出席を確認・編集",
        exact: true,
      })
      .click();
    const rows = page.locator(
      role === "student"
        ? ".student-schedule tbody tr"
        : ".attendance-table tbody tr",
    );
    const initial = role === "teacher" ? 3 : 14;
    await expect(rows).toHaveCount(initial);
    const saved: { month: string; changes: unknown[] }[] = [];
    await page.route(
      `**/api/${role}/${role === "student" ? "cancellations" : "reservations"}`,
      (route) => {
        saved.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
      },
    );
    let firstLabel = "";
    if (role === "student") {
      const first = page.locator(".slot.active:not(:disabled)").first();
      firstLabel = (await first.getAttribute("aria-label"))!.replace(
        " 取消予定",
        "",
      );
      await first.click();
    } else {
      await page.locator(".attendance-cell").first().click();
      await page.getByRole("button", { name: "山田", exact: true }).click();
      await page.getByRole("button", { name: "閉じる", exact: true }).click();
    }
    await expect(page.getByLabel("表示する月")).toHaveCount(0);
    await page.getByRole("button", { name: "もっと見る（2週間分）" }).click();
    await expect(rows).toHaveCount(initial + 14);
    const total = [base, next, far]
      .flatMap(monthDates)
      .filter((date) =>
        role === "teacher" ? date >= todayJst() : date > todayJst(),
      ).length;
    for (let i = 0; i < 6 && (await rows.count()) < total; i++) {
      const before = await rows.count();
      await page.getByRole("button", { name: "もっと見る（2週間分）" }).click();
      await expect(rows).toHaveCount(Math.min(total, before + 14));
    }
    expect(requests[0]).toEqual({ limit: initial, masters: "1" });
    expect(requests.slice(1).every((r) => r.masters === "0")).toBe(true);
    expect(
      requestedDates.some((date) => date.startsWith(monthOffset(base, 2))),
    ).toBe(false);
    expect(requestedDates.some((date) => date.startsWith(far))).toBe(true);
    expect(new Set(requestedDates).size).toBe(requestedDates.length);
    if (role === "student") {
      await expect(
        page.getByRole("button", {
          name: firstLabel + " 取消予定",
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "false");
      await page.locator(".slot.active:not(:disabled)").last().click();
      page.once("dialog", (dialog) => dialog.accept());
    } else {
      await expect(page.locator(".attendance-cell").first()).toContainText(
        "0人",
      );
      await page.locator(".attendance-cell").last().click();
      await page.getByRole("button", { name: "山田", exact: true }).click();
      await page.getByRole("button", { name: "閉じる", exact: true }).click();
    }
    await page
      .getByRole("button", {
        name: role === "student" ? "✓ この変更を保存する" : "✓ 変更を保存する",
      })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "保存しました" }),
    ).toBeVisible();
    expect(saved).toHaveLength(2);
    expect(saved[0].month).not.toBe(saved[1].month);
    expect(saved.every((batch) => batch.changes.length === 1)).toBe(true);
  });
}

test("日付ページAPIは先生3日・生徒14日だけ返し、非公開月と他人の予約を除外", async ({
  request,
}) => {
  await login(request, "teacher");
  const first = await request.get("/api/teacher/attendance");
  expect(first.ok()).toBe(true);
  const teacher = (await first.json()) as AttendancePage;
  expect(teacher.dates).toHaveLength(3);
  expect(teacher.dates[0]).toBe(todayJst());
  expect(teacher.students.length).toBeGreaterThan(0);
  for (const schedule of Object.values(teacher.schedules)) {
    expect(schedule.templates).toEqual([]);
    expect(
      schedule.reservations.every((r) => teacher.dates.includes(r.date)),
    ).toBe(true);
  }
  const next = (await (
    await request.get(
      `/api/teacher/attendance?from=${teacher.next}&limit=14&masters=0`,
    )
  ).json()) as AttendancePage;
  expect(next.dates).toHaveLength(14);
  expect(next.dates.some((date) => teacher.dates.includes(date))).toBe(false);
  expect(next.students).toEqual([]);
  expect(next.subjects).toEqual([]);
  expect((await request.get("/api/teacher/attendance?limit=15")).status()).toBe(
    400,
  );
  const student = await login(request, "student");
  const own = (await (
    await request.get("/api/student/attendance")
  ).json()) as AttendancePage;
  expect(own.dates).toHaveLength(14);
  expect(own.dates[0]).toBe(addDays(todayJst(), 1));
  expect(
    Object.values(own.schedules)
      .flatMap((s) => s.reservations)
      .every((r) => r.student_id === student.studentId),
  ).toBe(true);
  expect(own.students).toHaveLength(1);
  expect(
    (
      await request.get(
        "/api/student/attendance?from=" + addDays(todayJst(), -1),
      )
    ).status(),
  ).toBe(403);
  const hidden = (await (
    await request.get(
      "/api/student/attendance?from=" + monthOffset(month, 4) + "-01",
    )
  ).json()) as AttendancePage;
  expect(hidden.dates).toEqual([]);
  expect(hidden.schedules).toEqual({});
});
