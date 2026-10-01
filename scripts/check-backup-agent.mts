// 装出去的定时任务和仓库里的脚本有没有分叉
//
// pull-backup.sh 必须**复制**到 ~/Library/Application Support 才能被 launchd 跑
// （TCC 不让定时任务读 ~/Documents）。复制就会漂：改了仓库里那份、忘了重装，
// 每晚跑的还是旧的，而且一切看起来都正常 —— 这正是这个项目栽过三次的那种坑。
//
// 没装就跳过：不是每台机器都要当异地副本的落点。
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const support = join(homedir(), "Library/Application Support/home-library");
const installed = join(support, "pull-backup.sh");
const plist = join(homedir(), "Library/LaunchAgents/com.ianzhang.homelibrary-backup.plist");
const repo = join(process.cwd(), "deploy/pull-backup.sh");

console.log("\n=== 备份定时任务 ===");

if (!existsSync(plist) && !existsSync(installed)) {
  console.log("  · 这台机器没装拉取任务，跳过（要装：./deploy/install-backup-agent.sh）");
  process.exit(0);
}

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  // 提示只在失败时给 —— 成功还挂一句"要重跑安装脚本"会让人以为出事了
  console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail ? "  —— " + detail : ""}`);
  if (!ok) fail++;
};

check("plist 还在", existsSync(plist));
check("装出去的脚本还在", existsSync(installed));

if (existsSync(installed)) {
  check(
    "装出去的脚本和仓库里的一致",
    readFileSync(installed, "utf8") === readFileSync(repo, "utf8"),
    "改完 pull-backup.sh 要重跑 ./deploy/install-backup-agent.sh",
  );
}

// 任务指向的必须是 Application Support 那份，不能是 Documents 里的仓库
if (existsSync(plist)) {
  const xml = readFileSync(plist, "utf8");
  check(
    "任务指向的不是 ~/Documents（TCC 会挡）",
    !/<string>[^<]*\/Documents\//.test(xml),
    "指向 Documents 的话 launchd 每晚只会得到 Operation not permitted",
  );
}

console.log(fail ? `\n=== ${fail} 项不合格 ===\n` : "\n=== 定时任务正常 ===\n");
process.exit(fail ? 1 : 0);
