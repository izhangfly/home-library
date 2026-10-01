# 部署与运维

线上地址：**https://library.example.com**

必须走这个 HTTPS 地址。手机浏览器只在安全上下文里才允许调摄像头，
用 IP + 端口打开的话扫码是用不了的（服务本身也只监听 127.0.0.1，外网访问不到）。

---

## 这套系统在服务器上占了什么

| 资源 | 值 | 说明 |
|---|---|---|
| systemd 单元 | `home-library.service` | 新建，与现有单元无重名 |
| 端口 | `127.0.0.1:8800` | 只监听回环，外网只能经 Caddy 进来 |
| 目录 | `/opt/home-library` | 代码 + `data/uploads`（封面与封面缓存） |
| 数据库 | PostgreSQL 16 的 `homelibrary` 库，角色 `library` | 本次为它新装了 postgresql |
| Caddy | `/etc/caddy/Caddyfile` 末尾追加一个 site block | 原有 block 未改动，改前已备份 |
| 备份 | `/root/backups/home-library`，cron 每天 04:20 | 追加 crontab 条目，原有条目保留 |

**没有动过的东西**：其它 12 个 systemd 服务、它们的端口（8000/8520/8640/8700/8760/8780/9765）、
Xray、WireGuard、原有 Caddy 站点、原有 crontab 条目。
Caddy 是 `reload`（热加载）不是 `restart`，进程号都没变。

---

## 日常操作

```bash
# 看状态 / 日志
systemctl status home-library
journalctl -u home-library -f

# 起停重启
systemctl start|stop|restart home-library

# 开机自启（已经开了）
systemctl enable home-library
```

## 更新代码

在 Mac 上项目目录里跑：

```bash
./deploy/deploy.sh # 全量：同步 + 装依赖 + 迁移 + 构建 + 重启
./deploy/deploy.sh --quick # 只改了代码没动依赖时用，快很多
```

脚本做完会自己做健康检查（本地 8800 + 外网 HTTPS 都要返回 200）。

`.env` 不在同步范围内 —— 服务器上的密钥不会被本地文件覆盖。
要改线上配置就直接编辑 `/opt/home-library/.env`，然后 `systemctl restart home-library`。

## 数据库迁移

改了 `prisma/schema.prisma` 之后：

```bash
# 本地：生成迁移文件（需要先开 SSH 隧道，见下）
npx prisma migrate dev --name 你的改动说明

# 线上：deploy.sh 会自动执行 prisma migrate deploy
```

## 本地开发连线上数据库

线上是 `homelibrary`，本地开发用 `homelibrary_dev`，两个库互不干扰。

```bash
# 开隧道（注意：ssh -f 在某些 shell 下会被回收，建议前台单开一个终端窗口）
ssh -N -L 15432:127.0.0.1:5432 root@YOUR_SERVER_IP

# 另开一个终端
npm run dev
```

## 上线前检查

`deploy.sh` 会先在本地跑 `npm run verify`（typecheck + i18n + 八套不变量测试，
共 218 条断言，约 8 秒），**没过就中止，rsync 都不会执行**。
所以"部署成功"这四个字是有含义的：至少不变量没被破坏。

```bash
./deploy/deploy.sh # 正常：先检查，再部署
./deploy/deploy.sh --skip-verify # 救火：跳过检查（会打印警告）
```

## 备份与恢复

```bash
# 手动备份
/opt/home-library/deploy/backup.sh

# 自动：每天 04:20，保留 30 天
tail -f /var/log/home-library-backup.log
```

`backup.sh` **每次都会验证自己刚做出来的备份**：把 dump 恢复进一个临时库
（`homelibrary_restorecheck`），对书/柜/层/房间/上架/户型图点行数，对不上就非零退出。
没验证过的备份不是备份，是一个"大概能用"的猜测 —— 而手工量的书架尺寸、
手工命名的房间、一本本扫进来的书，丢了没有任何接口能重建。

日志里长这样：

```
[2026-08-10T02:25:56+00:00] 验证备份能不能恢复…
 生产 书/柜/层/房间/上架/户型图 = 6/2/6/16/5/1
 恢复 书/柜/层/房间/上架/户型图 = 6/2/6/16/5/1
[2026-08-10T02:25:56+00:00] 备份可恢复
```

### 异地副本

备份和数据库在**同一块盘**上，盘坏了两个一起没。在 Mac 上跑：

```bash
./deploy/pull-backup.sh # 拉最新一份
./deploy/pull-backup.sh --all # 服务器上留着的全拉回来
```

默认落在 `~/Documents/home-library-backups`（可用 `HL_BACKUP_DIR` 改）。

恢复：

```bash
# 数据库 —— 必须以 root 跑。备份放在 /root/backups（700），
# postgres 用户进不去，`sudo -u postgres pg_restore` 会报 Permission denied。
pg_restore -d "postgresql://library:密码@127.0.0.1:5432/homelibrary" --clean --if-exists db-YYYYmmdd-HHMMSS.dump

# 封面
tar -xzf uploads-YYYYmmdd-HHMMSS.tar.gz -C /opt/home-library/data
```

网页上的 **设置 → 备份 → 导出 JSON** 是另一条路，但要清楚它是干什么的：

* 它是**把数据带走**用的 —— 一份人类可读的整库快照，另存网盘、或者将来搬去别的系统。
 含书目、书架结构、上架关系、标签、**户型图与房间**、设置；封面图不在里面（由 backup.sh 打包）。
* 它**不是恢复路径**。系统里没有对应的导入端点，想把数据还原回本系统请用上面的
 `pg_restore` —— 那条路每晚都会被 backup.sh 自动验证一次。

`scripts/verify-export.mts` 会拿 prisma schema 和导出的覆盖表对账，防止加了新表却忘了导。

---

## 卸载（如果哪天不想要了）

```bash
systemctl disable --now home-library
rm /etc/systemd/system/home-library.service && systemctl daemon-reload
rm -rf /opt/home-library
crontab -l | grep -v home-library | crontab -
# 删掉 Caddyfile 末尾的 library.example.com 段落，然后
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy
# 数据库（不可逆）
su - postgres -c "dropdb homelibrary; dropdb homelibrary_dev; dropuser library"
```

---

## 排障

**页面 502**
服务没起来。`journalctl -u home-library -n 50` 看栈。多半是 `.env` 里的
`DATABASE_URL` 不对，或者 postgresql 没跑。

**扫码时摄像头不弹权限**
确认地址栏是 `https://`。iOS 上还要确认没在无痕模式里。

**某个数据源一直失败**
设置页会列出各源状态。也可以在服务器上直接跑：
```bash
cd /opt/home-library && npm run smoke:sources
```
它会对几本真书打一遍所有源，把每个源命中/失败/耗时都打出来。

**Google Books 返回 `key_ip_restricted`**
API key 上绑的 IP 白名单和服务器实际出口 IP 对不上。这台机器同时有
IPv4 (`YOUR_SERVER_IP`) 和 IPv6 (`YOUR_SERVER_IPV6`) 出口。
代码里已经把 Google Books 的请求钉死在 IPv4 上绕开这个问题；
如果还是报这个错，去 Google Cloud Console 把上面两个地址都加进白名单。

**封面加载不出来**
封面统一走 `/api/cover` 代理并缓存在本地，源站挂了也不影响已缓存的。
要清缓存重抓：`rm -rf /opt/home-library/data/uploads/cover-cache`。
