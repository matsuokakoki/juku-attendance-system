export const path = window.location.pathname;
export const teacher = ![
  "/",
  "/login.html",
  "/student_top.html",
  "/student_monthly.html",
  "/student_day.html",
  "/home_public.html",
].includes(path);
export const role = teacher ? "teacher" : "student";
export const rootPage = teacher
  ? "/teachertop_final.html"
  : "/student_top.html";
export const teacherMenu = [
  ["teacher_today.html", "📅 出席を確認・編集"],
  ["kyuukoubi.html", "休講日"],
  ["subject_editor.html", "科目名"],
  ["temporary_days.html", "臨時科目適用日"],
  ["teacher_nextmonth_template.html", "新規出席作成（月に一度）"],
  ["teacher_visibility_editor.html", "公開設定"],
  ["teacher_announcements.html", "お知らせ追加"],
  ["teacher_template_edit.html", "テンプレ個別編集"],
  ["student_admin.html", "生徒追加・削除"],
  ["rename.html", "名前変更"],
  ["yomi_editor.html", "ひらがな読み登録"],
  ["teacher_past.html", "過去一覧"],
  ["accesslog_view.html", "閲覧者確認"],
  ["attendance_csv_export.html", "Excel出力"],
  ["fix_attendanceCount.html", "人数の確認"],
  ["home_admin.html", "ホームページ編集"],
];
export const pageTitle =
  teacherMenu.find(([p]) => path === "/" + p)?.[1].replace("📅 ", "") ??
  "先生用メニュー";
