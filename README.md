# 日序 · 个人计划表

一个中文个人计划网页：每日清单、长期任务四象限、完成记录、云端同步与文件备份。无需账号，每台设备首次输入访问密钥。

## 日常使用

1. 在电脑和手机打开同一个网站，输入同一个访问密钥。密钥由浏览器记住；不要把密钥交给其他人。
2. 在“每日计划”切换日期、添加任务。点击任务标题编辑，勾选左侧方框完成，上下箭头调整顺序。
3. 在“长期任务”创建目标并手动选择象限。展开目标，添加子任务；为子任务设置计划日期即可进入每日清单。
4. “计划日期”与“截止日期”独立。往日未完成任务不会自动移动，可展开列表逐条或批量顺延。
5. “完成记录”按实际完成时间（北京时间）归档，可取消完成。长期任务进度随子任务更新，长期任务本身需要手动完成。
6. 在“设置与备份”定期导出 JSON。导入前会校验并显示任务数量；确认后先下载当前数据，再整份替换云端数据。

页面可见时每 15 秒检查更新，重新聚焦也会刷新。保存失败会显示“尚未保存”并保留当前编辑。发生冲突时，先“加载最新，保留草稿”，核对内容后重新保存。不要在未保存时关闭或刷新浏览器。

## 项目与运行

- Node.js >= 22.13，Vinext / React，Cloudflare D1，Sites 托管。
- `.openai/hosting.json` 保存当前 Site ID 和数据库绑定；复用此身份，勿重复创建 Site。
- `app/page.tsx`、`app/globals.css` 是交互界面与响应式样式。
- `lib/planner.ts` 定义任务和备份校验、操作语义；`lib/api.ts` 实现密钥验证和乐观并发控制。
- `app/api/planner/route.ts` 将操作保存到 D1。所有 API 访问都验证 `X-Planner-Key`，拒绝缓存。
- 单用户任务快照和递增版本号保存在一个 D1 记录内，批量操作采用带版本条件的原子 UPSERT。记录上限 1.5 MB，最多 10000 条任务。

```powershell
npm run install:ci
node scripts/create-access-key.mjs
npm run db:generate # 仅在变更 schema 后生成新迁移；已有迁移不能重写
npm run build
$env:CLOUDFLARE_CF_FETCH_ENABLED = 'false'
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_complete_vanisher.sql
npm run dev -- --port 5173
```

已有本地数据库不要重复执行已应用的迁移。本地模拟数据和生产数据彼此独立。

首次生成的密钥在忽略版本控制的 `outputs/access-key.txt`；本地校验值在 `.dev.vars`。已有密钥时脚本会拒绝覆盖。密钥和 `.dev.vars` 均不得提交或打包。Windows 上若 npm 命令转发失败，可使用 `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"` 代替 `npm`。

## 验证

```powershell
npm run typecheck
npm test
npm run test:browser
```

浏览器测试使用独立的无头 Edge 会话，需要本机安装 Edge 和已启动的 5173 端口预览。仅允许 localhost / 127.0.0.1 地址；测试会替换本地模拟数据库数据，不应对正式数据运行。截图和结果保存在忽略的 `tests/output/`。可通过 `PLANNER_TEST_URL` 指定另一本地地址。

## 部署与密钥重置

发布使用 Sites 技能的源码同步、打包、保存版本和部署流程。网站入口需要 public 访问模式，任务 API 仍由应用密钥保护。生产环境设置 secret 类型的 `PLANNER_KEY_HASH`（访问密钥的 SHA-256 十六进制值），不可设置明文密钥或把它写入代码。首次部署自动应用 Drizzle SQL 迁移。

重置密钥步骤：

1. 在项目目录执行 `node scripts/create-access-key.mjs --rotate`，生成新密钥及本地校验值。
2. 通过 Sites 部署管理将 secret `PLANNER_KEY_HASH` 更新为 `.dev.vars` 中的新校验值。
3. 重新部署已保存的版本，让环境配置生效。无需清空或迁移任务数据。
4. 在各设备忘记旧密钥并输入新密钥。旧密钥将无法读取或修改数据。

## 第一版边界

仅个人使用，支持一层子任务；无离线写入队列、重复任务、推送提醒、番茄钟和团队协作。密钥相当于任务数据的访问权限。备份是普通 JSON 文件，也应妥善保管。
