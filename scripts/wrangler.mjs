import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
const env = {
  ...process.env,
  WRANGLER_LOG_PATH:
    process.env.WRANGLER_LOG_PATH ?? resolve(tmpdir(), "juku-wrangler.log"),
  XDG_CONFIG_HOME:
    process.env.XDG_CONFIG_HOME ?? resolve(".wrangler", "config"),
  WRANGLER_SEND_METRICS: "false",
};
const command = resolve("node_modules/wrangler/bin/wrangler.js");
const result = spawnSync(
  process.execPath,
  [command, ...process.argv.slice(2)],
  { stdio: "inherit", env },
);
process.exitCode = result.status ?? 1;
