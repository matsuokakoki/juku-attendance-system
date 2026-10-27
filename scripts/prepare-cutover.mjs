import { writeFileSync, mkdirSync } from "node:fs";
const target = process.argv[2];
const url = new URL(target ?? "");
if (url.protocol !== "https:" || !url.hostname.endsWith(".workers.dev"))
  throw new Error("HTTPS workers.dev URL is required");
const pages = [
  "login",
  "student_top",
  "student_day",
  "student_monthly",
  "teachertop_final",
  "teacher_today",
  "teacher_past",
  "teacher_nextmonth_template",
  "teacher_template_edit",
  "teacher_visibility_editor",
  "kyuukoubi",
  "temporary_days",
  "subject_editor",
  "student_admin",
  "rename",
  "yomi_editor",
  "teacher_announcements",
  "accesslog_view",
  "attendance_csv_export",
  "fix_attendanceCount",
  "home_admin",
  "home_public",
  "temp",
];
mkdirSync("private/cutover/public", { recursive: true });
const redirects = pages.map((page) => ({
  source: `/${page}.html`,
  destination: new URL(`/${page}.html`, url).href,
  type: 302,
}));
redirects.push({
  source: "/",
  destination: new URL("/login.html", url).href,
  type: 302,
});
writeFileSync(
  "private/cutover/firebase.json",
  JSON.stringify(
    {
      hosting: {
        site: "juku-attendance",
        public: "public",
        redirects,
        headers: [
          {
            source: "**",
            headers: [{ key: "Cache-Control", value: "no-store" }],
          },
        ],
      },
    },
    null,
    2,
  ),
);
writeFileSync(
  "private/cutover/firestore.frozen.rules",
  "rules_version = '2';\nservice cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }\n",
);
console.log(
  "切替設定を private/cutover に作成しました。デプロイは行っていません。",
);
