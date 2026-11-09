# 插件侧 CLI 授权回执适配

2026-11-07｜Codex 子代理｜当前分离任务的局部材料；未提交、未接入业务。

依据桌面 `infra/feishu_auth.rs` 的 `read_status`、`status_snapshot`、`cli_with_timeout`、`complete` 及 `tests/feishu_auth_contract.rs` 核对输出：status 可为顶层对象或 data 对象；普通 login 完成可为 success:true；设备授权可能以 authorization_complete / missing_scope 和 exit 3 结束，此时必须重新读取实际身份及 scope。二维码生成成功不等于登录成功。消息执行另有 ok:true/data 信封，不将其强套在授权回执上。

新增 `src/cli-auth.ts`、`src/cli-auth.test.ts`。纯函数接受原生执行结果，返回经过核验的账号 ID 和 scope，不返回令牌或原始诊断；状态要求 ou_ 身份、ready、valid，按调用方明确提供的所需 scope 逐项精确核验。login 完成后还必须提供新读取的 status，校验权限及回执账号一致性。所有错误为固定安全文本，不记录日志、不持久化凭据。

TDD：先新增测试，初次执行因模块缺失失败（不算行为 Red）；随后加入无实现函数，21 项中 17 项因尚未实现失败、4 项拒绝非法输入测试通过。实现后同一命令 `npx vitest run src/cli-auth.test.ts` 为 21/21 通过；`npm run typecheck` 通过。未做独立重构。

边界：这是回执解析与核验，不是授权工作流。没有调用 CLI、没有登录/刷新/二维码流程、没有 UI 接线、没有真实账号验收；调用方负责在 login 之后重新读取 status，保存并复用请求 operation ID，依据具体操作配置 requiredScopes。needs_refresh 当前按无效状态拒绝，不自动刷新。未改现有 client、native-cli 或 task-intent；现有业务仍走原链路。

## 2026-11-07 17:45 续接更新

前文为早期模块阶段记录，保留原文。现CLI授权适配已接入插件client，任务/日程编排、消息草稿与撤回、联系人、卡片、账号隔离存储均使用声明式通用原生接口；CLI归插件管理。旧宿主feishu.request仅允许配置迁移读取，新增业务不得回落旧解析。

真实运行发现并修复冒号存储键不兼容；存储mock加入宿主实际规则，47项相关回归通过。完整插件400项Vitest和1项Node测试通过，typecheck通过。实际页面恢复并读到15项任务；并发轮询占满仍阻断创建，正在修复，尚未验收或发布。此处自动化不代替正式安装包和原生语音验收。

## 2026-11-07 18:02 交付检查更新

作者：Codex。修复创建联系人查询无关群聊、远端创建成功仍等待通知结束才显示回执的问题。任务/日程只读取个人候选；创建确认即展示回执并落历史，邀请与卡片分享后续更新，同一 operationId 更新记录，失败不自动重发。

验证：npm test 完整通过（44 文件、417 项 Vitest，另 1 项原生包缓存校验）；npm run typecheck、git diff --check 通过。输出保存在 D:/Project/Vi/_logs/feishu-delivery-full-latest.log。上述为自动化证据，不能代替真实飞书操作验收。

真实候选程序测试：任务请求在模型调用阶段失败，通用 ai.generate 探测返回“当前文字模型尚未配置或登录”。候选程序 managed/account 地址为 api-hk.orulink.ai，选中模型服务为内网 192.168.1.129:9876；仍遵守凭据同源边界，没有向内网转发公网登录令牌。待确认测试端点后继续真实创建、通知、编辑/完成/删除、消息确认及撤回。未发布、未将自动化通过声明为实际验收。

已通过 gh 核对迁移后插件仓库 orulink-ai/vitalk-plugin-feishu；PR #8 为 main 目标的草稿。新增 generic host 能力尚未随公开桌面版交付，上架须填写正确 minHostVersion，并先交付相应 OTA 桌面版；不可向旧桌面用户直接推送不兼容插件。插件版本目前仍 0.1.5，发布前统一提升为未发布的新版本。

18:02 原生只读核验补充：完整读取 3 页当前任务，1107-1745 测试标记无匹配；未发现这次模型失败留下的任务。根部门全员读取经插件 native.execute 实际返回 exitCode=1、错误码 40004、no dept authority error，不能宣称全公司名册已验收，也不能以缓存联系人替代。诊断只输出错误码和汇总，不记录联系人名单或凭据。

## 2026-11-07 18:20 交付复核与原生接口验收

作者：Codex（含 generic_dependency_review 独立复核）。本轮未提交、未合并、未发布。

- 补齐当前已发送草稿的撤回入口，区分 recalling/recalled/recall_unknown；旧 sent 快照不能恢复撤回按钮。覆盖当前保留草稿，不宣称已有全部历史消息管理。
- 完成任务前读取远端状态版本，按账号、任务及版本生成操作编号；相同版本去重，远端重新打开后的新版本允许再次完成。相关回归先红后绿，71 项通过。
- 最终完整 npm test：44 文件、427 项 Vitest 通过，另 1 项 Node 原生资源损坏校验通过；npm run typecheck 通过。日志：D:/Project/Vi/_logs/feishu-delivery-recall-final.log。构建 SHA256：8bcc12e3c8c2938026975d91c93855d35e16f70cf259de28453da79cfa4018f6。
- 新候选桌面中的插件 native.execute 真实调用：本人测试任务创建、读回、编辑、完成、删除及删除读回全部通过，GUID 63b2b89d-bafe-43ef-b379-4042a3563fc9；测试个人日程创建、读回、编辑、删除及删除读回通过，event ID 167c3874-76ff-f519-c67b-49efc02ba5d8_0。两项对象均已清理，没有邀请公司成员。此证据只覆盖原生接口，不覆盖 LLM、麦克风或界面点击。
- 仓库本机 gh 再确认：插件 orulink-ai/vitalk-plugin-feishu；桌面 vilab-orulink/ViTalk；发行 vilab-orulink/ViTalk-public，旧 Ro-In-AI 地址重定向到该发行仓库。公开最新版本仍插件 0.1.5、桌面 0.6.19。
- 发布门槛：模型端点配置待选择；全员名册返回 40004 部门访问权限不足；新通用宿主版本尚未发布。因此当前开发包不能直接替换 0.1.5，后续需独立新版本及正确最低宿主版本，先验收并交付宿主 OTA，再上架兼容插件。

### 2026-11-09 09:17:01 +08:00 · Codex · 发布续接与最新 dev 集成

- 用户要求发布；核对迁移后的插件仓库仍为 orulink-ai/vitalk-plugin-feishu，桌面仓库为 vilab-orulink/ViTalk。
- 本次同步 origin/dev 11fdbc83ac9ac16b178b840907c59a1b47990a64；合并提交 2092291f67b8a37ac3401e05bd7a89993fe7480d 有两个 parent。保留发布集成前 stash 备份，不重复应用。
- App.tsx 冲突保留上游 language 参数与常驻插件语音页面；补齐新增通用权限英文文案。重新生成上游 TypeScript SDK 以消除陈旧 dist 引发的类型及测试失败。
- 本次验证：插件 typecheck、427 项 Vitest 和 1 项缓存损坏检查通过；桌面 typecheck、lint、44 项 CI 合约检查通过；240 个测试文件通过，1976 项通过、1 项跳过。原生 cargo check 尚在运行。
- 真实验收仍未完成：候选账号使用公网 api-hk，模型地址仍为内网 192.168.1.129；已请求统一验收配置，不跨地址转发账号令牌。全公司名册权限与完整语音验收仍不能声明通过。
- 未推送、未合入业务 PR、未发布。新版插件依赖新增通用宿主接口，发布必须检查最低宿主版本，不能覆盖旧插件版本造成旧客户端不兼容。

### 2026-11-09 · Codex · 账号同源模型验收

- 用户明确：公网账号用公网服务，内网账号用内网服务。当前候选账号为公网，已通过应用正常偏好保存接口设置到其 managed URL；保留所选豆包流式模型和 deepseek-flash，未跨地址转发凭据。
- 公网模型列表确认 ASR 和 deepseek-flash available；真实 plugin_ai_generate 返回 OK。
- 使用插件当前 prepareTask/prepareCalendar/createIntentModel 实现和真实 DeepSeek 验证两条口语任务、个人日程、全公司在职员工日程，四条均返回有效计划。联系人为合成测试对象，无外部写入；此结果是实际 LLM 解析检查，不等于麦克风/通知端到端验收。
- 实际插件 native.execute 读取飞书组织根目录仍返回 40004 / no dept authority error。不能用部分缓存代替全公司名单。完整员工邀请验收未通过，不声明已完成发布。

### 2026-11-09 09:49 +08:00 · Codex · 发布前令牌刷新回归

- 真实候选验收发现 auth status 返回 needs_refresh 时被误判为登录失效；同一 CLI 的 user_info 只读请求可刷新到 ready/valid，未重新授权。
- 插件新增一次有界只读刷新探测，刷新后重新读取状态并校验账号一致；撤销、失效或失败不重试，不放宽业务权限校验。运行时与授权状态页共用该逻辑，桌面不加入飞书业务。
- TDD：新增用例首先因实现缺失失败；实现后相关 17 项通过。最终完整 46 文件 437 项 Vitest、1 项原生资源损坏检查和 typecheck 通过，日志 D:/Project/Vi/_logs/feishu-release-refresh-full-tests.log。
- release_review_plugin 独立复核未发现确定 P1/P2。正在执行当前业务代码的本人任务创建、编辑、完成、删除验收；尚未将本次改动发布。

### 2026-11-09 09:56 +08:00 · Codex · 当前业务服务真实验收

- 最终插件本地完整测试：46 个文件、438 项 Vitest 和 1 项 Node 原生依赖检查通过；typecheck、git diff --check 通过。日志 D:/Project/Vi/_logs/feishu-release-final-refresh-tests.log。
- 使用候选桌面当前插件业务代码、SDK native.execute 及公网 DeepSeek：口语本人任务创建、卡片分享、编辑、完成、删除均返回明确回执；测试任务已删除。
- 个人日程自然语言创建、编辑、删除均返回明确回执；没有邀请其他员工，测试日程已删除。
- 日程首轮验收脚本误用了带前缀的 operationId，被 UUID 校验拒绝；改正脚本后通过。产品页面本来使用 UUID，无需修改产品校验。
- 以上覆盖真实业务服务和远端读写，不冒充麦克风、界面点击或正式安装包验收。消息确认及撤回仍在验收，全公司组织权限不足尚未通过。未提交、未合并、未发布。


### 2026-11-09 10:05 +08:00 · Codex · 本人消息收件人回归

真实搜索返回已认证本人但缺少完整在职字段，消息候选被排除；修复仅在消息收件人读取中认可当前新鲜认证本人（且非外部），不修改全公司员工名册。client-contacts 新用例先红后绿，其他未核验同事仍不可发送。439 项 Vitest、1 项 Node 检查和 typecheck 通过，独立复核相关 39 项通过，无 P1/P2。真实发送/撤回仍在验收中，未发送给其他用户，未发布。

### 2026-11-09 10:25 +08:00 · Codex · 发布候选最终回归

- 飞书插件 0.1.6：46 文件、440 项 Vitest、1 项缓存完整性检查、typecheck 通过；六个平台 CLI 发布文件已校验并打包，尚未上传。最终独立源码复核未发现 P1/P2。
- 真实公网账号及公网 DeepSeek：本人消息经明确确认后发送，取得回执并成功撤回（sent / recalled）；本人任务创建、卡片通知、编辑、完成、删除，以及个人日程创建、编辑、删除通过。以上是候选程序业务服务真实接口验收，不等于新正式安装包或麦克风界面验收。
- 当前飞书应用读取根部门返回 40004 / no dept authority，全公司员工邀请尚未实测通过；不将部分联系人冒充全公司。
- 桌面仅承载通用插件能力，版本准备为 0.6.20；飞书 CLI、提示词、联系人、授权及卡片仍位于插件。SDK 0.5.0 的 34 项测试通过。
- 宿主复核发现暂停执行期间可能吞掉语音取消：新增两个失败测试，修复后相关 68 项通过，typecheck/lint 通过，独立复核无剩余 P1/P2。
- Windows 正式编译进行中。已处理本机资源目录 rename 锁冲突和 CMake PATH 缺失；复用刚生成的服务端资源和离线文档，构建覆盖配置存放在工作区外日志目录。未宣称安装验收或 OTA 签名完成；未公开发布。
