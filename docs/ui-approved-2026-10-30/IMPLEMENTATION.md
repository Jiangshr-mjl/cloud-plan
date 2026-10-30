# UI 实施与验收记录

2026-10-30，按本目录 8 张批准稿实施。实际渲染截图在 [docs/images](../images/)；使用 scripts/readme-screenshots.mjs 的浏览器拦截数据生成，不写生产数据库。

## 修改范围
- 共用蓝白配色、中文无衬线、横向导航、控件与窄屏底部导航。
- 每日顶部七日历、清单/周重点两栏、Flag 标识、细进度条、已完成折叠；任务操作通过可键盘访问的省略号菜单展开，Escape/外部点击关闭。
- 项目层级、进度、日期、周重点标识；四象限共享白色画布、外虚线、上/左箭头实线轴、红黄蓝灰类别圆点；保留椭圆嵌套、漂浮与拖动。
- 时间轴、21格习惯、并排统计图、设置三分区、欢迎口号和静态示意任务。
- 真实任务/API/数据模型、密钥认证、同步队列、备份和日期规则未变。

## 验证
- npm run typecheck、npm test（28/28）、npm run build 通过。
- tests/ui-approved.mjs：1440/1360/820/390/360px 全页无横向溢出、日期与旗子、42个习惯格、打卡/撤销、解锁边界、减少动画、空态、无浏览器异常。
- daily-drag、weekly-drag、withdraw-plan、projects、subtask-deadline、timeline-merge、spatial-board、bubble-hierarchy、mobile-quadrants、history-search、debounce-browser 通过。
- spatial-board 覆盖嵌套碰撞、漂浮、详情展开、resize、单区过滤，1360/820/390/320px；mobile-quadrants 覆盖长标题及 320/360/390/430/640/768/1360px。
- 旧测试按当前菜单入口、详情展开和30秒延迟同步更新操作步骤；保留数据一致性和业务断言，使用手动同步等待持久化。
- Impeccable detector 运行一次；导航/视图的3px选中下划线被识别为边框强调，属于批准视觉要求，保留。

## 限制
npm run lint 未通过。修改前 app/page.tsx 已有85条错误（refs / set-state-in-effect）与2条图片警告；新增已完成列表复用 row 后同类 refs 诊断增至86条。habits.tsx、work-time.tsx 各2条既有 effect 错误未增加；其余全仓库问题还包括旧 outputs 脚本及测试 any 类型。未为通过 lint 关闭规则或重写业务队列。详细对比在本地 outputs/ui-lint-comparison.json。

保持现有 Site 公开访问配置，应用内部密钥边界不变；只本地 Git 提交和 Sites 源码同步/发布，不推送 GitHub。手机、空态及弹窗为按交接适配，非逐像素批准稿。工作时长仍为网页运行时间，未增加任务耗时模型。
