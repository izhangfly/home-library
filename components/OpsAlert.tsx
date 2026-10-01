// 运维告警 —— 只在真出事的时候出现
//
// 每晚的备份会验证自己能不能恢复，还会体检派生字段。但结果一直只写进
// /var/log/home-library-backup.log —— 没有人会去看那个文件。
// 于是万一哪天 pg_dump 挂了（盘满、密码换了、Postgres 升级），
// 日志忠实地记下来，而**你要恢复的那天才发现**。那是最糟糕的时机。
//
// 所以 backup.sh 现在把结果写进 Setting，这里读出来。三种情况才出声：
//   1. 上一次备份失败了
//   2. 太久没备份（超过两天）—— 说明 cron 根本没跑，比失败更隐蔽
//   3. 派生字段漂了 —— 排序键和分类号对不上，上架建议会给错答案
// 一切正常时**什么都不显示**：常驻的"一切正常"横幅，看两天就没人看了。

import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { IconWarn } from "./icons";

interface BackupStatus {
  at?: string;
  ok?: boolean;
  restoreVerified?: boolean;
  derivedDrift?: boolean;
  counts?: string;
  note?: string;
}

/** 超过这么久没成功备份就报警 —— cron 一天一次，两天没动静一定是坏了 */
const STALE_HOURS = 48;

export async function OpsAlert() {
  const t = await getTranslations();
  const [row, lockout, pull] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "ops.lastBackup" } }),
    prisma.setting.findUnique({ where: { key: "ops.authLockout" } }),
    prisma.setting.findUnique({ where: { key: "ops.lastPull" } }),
  ]);

  const problems: { key: string; detail?: string }[] = [];

  // 有人把管理员密码试到被锁 —— 站点挂在公网上，这件事必须让人看见。
  // 只报最近 7 天的：三个月前那次已经过去了，一直挂着只会让人习惯性忽略。
  const lockAt = (lockout?.value as { at?: string } | undefined)?.at;
  if (lockAt && Date.now() - new Date(lockAt).getTime() < 7 * 24 * 3600_000) {
    problems.push({ key: "authLockout", detail: new Date(lockAt).toLocaleString("zh-CN") });
  }

  // 异地副本旧了。
  //
  // 服务器上的备份和数据库在**同一块盘**上 —— 盘坏了两个一起没，那不叫备份。
  // 真正的异地副本是 Mac 上那份，靠 launchd 每晚拉。可半夜跑的任务没人看输出：
  // SSH 密钥换了、盘满了、笔记本连着几天没开机，它就默默不干活，
  // 副本一天天变旧，等你需要的那天才发现。
  //
  // 四天才报：笔记本过个周末不开机是常事，两天就喊会变成"狼来了"。
  const pullAt = (pull?.value as { at?: string } | undefined)?.at;
  const pullDays = pullAt ? (Date.now() - new Date(pullAt).getTime()) / 86_400_000 : Infinity;
  if (pullDays > 4) {
    problems.push({ key: "pullStale", detail: Number.isFinite(pullDays) ? `${Math.floor(pullDays)}` : "" });
  }

  // 从没备份过（新装的）不算故障，别一上来就吓人
  if (!row) return problems.length ? renderAlert(t, problems) : null;

  const st = (row.value ?? {}) as BackupStatus;
  const at = st.at ? new Date(st.at) : row.updatedAt;
  const hours = (Date.now() - at.getTime()) / 3600_000;

  if (st.ok === false) problems.push({ key: "backupFailed", detail: st.note });
  else if (hours > STALE_HOURS) problems.push({ key: "backupStale", detail: `${Math.floor(hours / 24)}` });
  if (st.derivedDrift) problems.push({ key: "derivedDrift" });

  if (!problems.length) return null;
  return renderAlert(t, problems);
}

function renderAlert(
  t: Awaited<ReturnType<typeof getTranslations>>,
  problems: { key: string; detail?: string }[],
) {
  return (
    <section role="alert" className="card mb-4 border-danger p-4">
      <h2 className="mb-1 flex items-center gap-2 text-md">
        <IconWarn className="h-5 w-5 text-danger" />
        {t("ops.title")}
      </h2>
      <ul className="flex flex-col gap-1">
        {problems.map((p) => (
          <li key={p.key}>
            <span className="font-black">{t(`ops.${p.key}.what`, { n: p.detail ?? "" })}</span>{" "}
            <span className="hint">{t(`ops.${p.key}.why`)}</span>
          </li>
        ))}
      </ul>
      {/* 这行指的是备份日志。猜密码那条和备份日志无关，
          原样跟在后面等于让人去翻一个根本不会有线索的文件。 */}
      {problems.some((p) => p.key !== "authLockout") && (
        <p className="hint mt-2">{t("ops.where")}</p>
      )}
    </section>
  );
}
