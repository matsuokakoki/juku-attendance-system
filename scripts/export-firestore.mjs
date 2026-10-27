import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { mkdirSync, writeFileSync } from "node:fs";
const project = process.env.FIREBASE_PROJECT_ID ?? "juku-attendance";
initializeApp({ projectId: project, credential: applicationDefault() });
const db = getFirestore();
const documents = [];
const now = new Date();
const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12));
const months = [];
for (let i = -4; i <= 4; i++) {
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + i);
  months.push(d.toISOString().slice(0, 7).replace("-", ""));
}
async function read(ref) {
  const snap = await ref.get();
  for (const doc of snap.docs)
    documents.push({
      path: doc.ref.path,
      data: doc.data(),
      updateTime: doc.updateTime.toDate().toISOString(),
    });
}
for (const collection of [
  "students",
  "subjects",
  "holidays",
  "temporaryDays",
  "temporaryDays2",
  "announcements",
  "pages",
])
  await read(db.collection(collection));
const roster = (await db.doc("students/list").get()).data()?.names;
if (!Array.isArray(roster) || !roster.length)
  throw new Error("生徒一覧が取得できませんでした");
for (const month of months) {
  await read(
    db
      .collection("templates")
      .doc("weekly")
      .collection("default")
      .doc(month)
      .collection("students"),
  );
  const visibility = await db.doc("templates/weekly/visibility/" + month).get();
  if (visibility.exists)
    documents.push({ path: visibility.ref.path, data: visibility.data() });
  await read(db.collection("attendanceCount").doc(month).collection("days"));
  await read(db.collection("accessLog").doc(month).collection("days"));
  for (const name of roster)
    await read(db.collection("attendance").doc(name).collection(month));
}
mkdirSync("private", { recursive: true, mode: 0o700 });
const output =
  "private/firestore-snapshot-" +
  new Date().toISOString().replaceAll(":", "-") +
  ".json";
writeFileSync(
  output,
  JSON.stringify(
    { project, exportedAt: new Date().toISOString(), months, documents },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    output,
    students: roster.length,
    documents: documents.length,
  }),
);
