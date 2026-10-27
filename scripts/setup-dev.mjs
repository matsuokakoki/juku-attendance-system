import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".dev.vars")) {
  writeFileSync(
    ".dev.vars",
    `STUDENT_PASSWORD=${randomBytes(16).toString("hex")}\nTEACHER_PASSWORD=${randomBytes(16).toString("hex")}\nSESSION_SECRET=${randomBytes(32).toString("hex")}\n`,
    { mode: 0o600 },
  );
  console.log(
    "開発用の秘密情報を .dev.vars に生成しました。公開しないでください。",
  );
} else console.log(".dev.vars は既にあります。変更しませんでした。");
