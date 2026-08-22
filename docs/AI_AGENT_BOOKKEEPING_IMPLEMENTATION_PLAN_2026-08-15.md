# AI 代理记账接入实施计划

更新时间：2026-08-17

适用目标：允许 Codex、Claude Code 及其他受控 AI 代理把账单交给轻记 AI 分类，并安全地形成待确认或已确认交易。

## 1. 目标与完成定义

最终用户流程：

```text
用户把账单文字或截图交给 AI
        ↓
AI 调用轻记 AI 的结构化工具
        ↓
轻记 AI 自己解析、校验、去重并给出结果
        ↓
不确定项进入待确认；符合策略的项目由用户明确确认
        ↓
AI 能读取本次操作结果，但不能访问任意 SQL 或绕过账本规则
```

完成必须同时满足：

1. Codex 与 Claude Code 至少可以通过同一套 MCP 工具完成预览和创建待确认记录。
2. AI 输出不直接作为数据库事实；所有写入复用现有领域校验、review disposition 和 repository 事务。
3. 每次写入有调用方、来源、幂等键和稳定结果，重复请求不会生成重复交易。
4. 默认不向模型发送整个账本；只暴露完成本次操作所需的最少字段。
5. 转账、借贷、还款、退款、报销和余额调整不能由无人值守代理直接确认。
6. Android 与 iOS 都有可用入口；无法后台写入的平台必须清楚降级为打开待确认界面。
7. 有攻击性测试覆盖伪造参数、重复调用、过期 revision、恶意深链、超长输入和权限拒绝。

## 2. 当前基线

### 2026-08-17 收支精简与模型管线增量

- 新建/识别 UI 只展示“收入、支出”，支出只选择八个一级分类；历史特殊类型和二级分类仍可读取，但不再作为新建选项。
- 金额继续由确定性解析器提取为整数分；模型只承担 `income + 8 expense` 九类建议，避免把金额抽取、方向、分类和风险判断塞进一个不可审计输出。
- App、CLI、MCP 共用异步候选管线。桌面 CLI/MCP 通过 stdin 调用与移动端相同的 C++/fastText 核心；模型不可用时回退规则。代理写入仍固定为 `PENDING`。
- LLM-only 数据流水线已实现结构化生成、总预算分批、断点检查点、独立 judge、去重、按 `splitGroup` 切分、冻结清单和 SHA-256 发布门禁。
- v3 单模型训练已实现三组配置竞争、温度校准、阈值选择和冻结门禁；现有 15-head bootstrap 仅作为兼容资产继续加载，不会被未达标候选覆盖。
- 真实 Claude CLI 冒烟已到达服务端，但账户返回 429“余额不足或无可用资源包”，费用为 0。因此当前生产数据、v3 权重和冻结指标仍是明确的 `DATA_NOT_READY`，不得对外宣称模型已训练完成。

### 当前实现状态（2026-08-15）

- 阶段 A 已实现：`bill preview`、`bill open-android` 和 `bill queue-pending-android` CLI。
- 阶段 B 已实现：共享 `AgentCommandService`、v8 operation receipt migration、payload hash 冲突拒绝和原子幂等写入。
- 阶段 C 已实现并通过 Internal Bundle、Kotlin 编译、安全门禁和 JVM 测试：ADB 授权设备通过 Internal-only `run-as` 向 no-backup 私有 inbox 投递，App 前台最多创建 `PENDING`。
- 阶段 D 的 STDIO MCP 已实现并完成协议级联调：`preview_bill`、Android/iOS Simulator 核对入口、`queue_pending_bill_android` 与 `get_operation_status_android` 可由 Codex 和 Claude Code 共用。MCP schema 与共享解析层统一为 500 个 Unicode 字符，501 字在协议边界直接拒绝。
- 已增加最小化结果回执和 `get_operation_status_android`，App 先原子写结果再删除命令；回执不含账单原文或任意 SQLite 查询能力。
- Android API 36 x86_64 模拟器已完成真实 APK 端到端验证：首次返回 `COMMITTED`，同 key/同 payload 返回 `ALREADY_COMMITTED` 且 transaction ID 不变，同 key/不同 payload 返回 `AGENT-IDEMPOTENCY-PAYLOAD-MISMATCH`。绕过 CLI 直投的 501 字恶意命令返回终态 `REJECTED / AGENT-COMMAND-INVALID`，且私有 inbox 被清空。
- 当前 Internal APK SHA-256 为 `2774A899E811C0952DBC396DC09E2AC315B155117C6C06E98990AFCF2C11D356`；对该产物的 `aapt2 dump permissions` 只显示录音、唤醒锁、悬浮窗和动态 receiver 隔离权限，不含 `INTERNET`。
- 项目级 `.mcp.json` 已由 Claude Code 实际连接；`.codex/config.toml` 已由当前 Codex 宿主实际加载。Codex 内已成功调用 `preview_bill`，并以 dry-run 调用 `queue_pending_bill_android` 和 `get_operation_status_android`，返回结构化结果且未连接设备或写账本。`pnpm qingji -- doctor` 五项全部通过并返回 `READY_FOR_HOST_RESTART`。
- iOS 已提供 Simulator 打开待核对页的降级入口；尚缺 macOS/Xcode 编译、物理 USB Android 设备证据和 iOS/生产同步通道。
- iOS 16+ App Intents 已加入预览、准备待确认和打开待确认列表入口；请求只进入受保护的临时核对 inbox，拉起 App 后由公开路由填充页面，不在 Intent 或深链中写入账本。Windows 仅完成静态契约验证，仍需 macOS/Xcode 生命周期验收。
- macOS CI 已增加不依赖 CocoaPods 的 Apple SDK `swiftc -typecheck` 门禁，覆盖 `AgentAppIntents.swift`；完整 React Native Simulator 构建仍在经评审的 `Gemfile.lock` 与 `ios/Podfile.lock` 齐备后才执行，不把条件跳过冒充构建通过。
- 实体 Android USB 验收已固化为 `android:agent:e2e:windows` 脚本；它必须显式确认会创建 1 条虚构 `PENDING` 记录，并自动验证首次、重复和冲突三种结果。脚本已通过 Windows PowerShell 5/7 解析、未确认失败关闭和无设备失败关闭测试；当前无 USB 设备可执行真实验收。
- 生产同步已完成不绑定后端的核心层：`AgentSyncProtocol` 构建稳定请求与 payload SHA-256，并严格解析不含账单、令牌或余额的最小回执；`AgentSyncOperationStateMachine` 实现创建、领取、完成、取消、过期、幂等冲突与 revision 竞态拒绝；`AI_AGENT_SYNC_API_V1.openapi.json` 定义 OAuth/DPoP、代理/设备独立作用域、强 ETag/If-Match、查询和领取前取消。契约检查、6 个协议攻击性测试和 8 个状态机测试通过；示例域名为 `.invalid` 且标记未生产就绪。后端、身份提供方、钥匙存储、持久化事务和保留政策尚未选定，因此尚无可部署的线上同步。

本项目已经具有：

- 统一的 `parseTextTransactions` 本地解析管线；
- OCR、TEXT、VOICE、支付通知和账单导入来源模型；
- `source_reference_id` 唯一索引和通知导入幂等批次；
- `PENDING` / `CONFIRMED` 状态与持久化层二次 review 校验；
- repository 事务、金额整数分、分类方向、账户、revision 和字段长度校验；
- Android `ACTION_SEND` 与 `qingjiai://entry/smart` 输入入口；
- iOS Share Extension 本地 OCR 后打开智能记账页。

初始缺口中仍未关闭的项目：

- 电脑代理仍不能也不应直接访问手机沙箱内的 OP-SQLite；
- Internal 桥接已有调用身份、幂等键、receipt 和按 request key 的最小状态回读，但生产级请求签名与细粒度作用域尚未实现；
- 没有生产同步 API；
- 自定义 `qingjiai://` scheme 是公开输入面，不能承载免确认写入；
- 交易来源枚举暂时没有独立的 `AI_AGENT` 来源；当前通过独立 receipt 和 `agent:` source reference 保留来源，避免改写历史 migration。

## 3. 目标架构

```text
Codex / Claude Code / 其他 MCP Host
                    │
          QingJi MCP Server（Node）
                    │
       身份、作用域、幂等、审计、限流
                    │
          QingJi Agent Command Service
              │                 │
       纯解析/只读命令       设备或同步传输
                                │
                      App-owned Command Inbox
                                │
           现有 parser → review policy → repository
                                │
                         本地 OP-SQLite
```

CLI 与 MCP 只应是适配器，二者共享 `AgentCommandService`。不得让 MCP 通过拼接 shell 命令访问数据库，也不得让 CLI 直接打开移动端 SQLite 文件。

## 4. 工具契约

### 第一组：默认可授权

- `preview_bill`
  - 输入：`text`、可选 `referenceDate`、可选时区。
  - 只读；返回候选、置信度、缺失字段、歧义、分类和账户建议。
- `list_categories`
  - 只读；只返回 ID、名称、方向、父子关系和系统键。
- `list_accounts`
  - 只读；默认只返回 ID、名称、类型和隐藏状态，不返回余额或流水。
- `get_operation_status`
  - 只读；按调用方和幂等键查询本次操作结果。

### 第二组：可自动创建，但只能进入待确认

- `create_pending_bill`
  - 必填：原始输入、调用方生成的幂等键。
  - 服务端重新解析；只能写入 `PENDING`。
  - 返回 transaction ID、revision、review reasons 和是否为重复请求。

### 第三组：必须逐次授权

- `confirm_pending_bill`
  - 必填：transaction ID、`expectedRevision`、明确的用户确认凭据。
  - 只接受现有 `PENDING` 记录。
  - 受现有 review policy 限制；高风险类型继续拒绝代理确认。

第一版不提供删除、通用修改、任意查询、导出整个账本或 SQL 工具。

## 5. 分阶段实施

### 阶段 A：本机 CLI 原型

交付：

- `qingji bill preview`：直接复用项目解析管线并输出稳定 JSON；
- `qingji bill open-android`：通过无 shell 拼接的 ADB 参数把文字分享给已安装 App；
- 支持从 stdin 读取账单，减少写入终端历史的机会；
- 不直接写手机账本，不自动点击确认。

验收：固定时间输入得到确定 JSON；特殊交易显示 review 风险；dry-run 不调用 ADB；参数不会形成 shell 注入。

### 阶段 B：共享 Agent Command Service

交付：

- 从 React UI 中抽取平台无关的 preview/build-pending 应用服务；
- 定义版本化 JSON Schema；
- 增加 `AI_AGENT` 来源或以兼容迁移方式记录 agent provenance；
- 新增 agent operation receipt 表，唯一键至少包含 caller ID 与 idempotency key；
- 结果绑定 payload hash，复用相同 key 但不同内容时必须拒绝。

验收：CLI、React UI 和后续 MCP 对同一输入产生同一候选；并发重复提交只写一笔；崩溃重试可恢复。

### 阶段 C：Android 设备桥接

仅用于 Internal 构建的第一版桥接：

- App 使用 no-backup 私有 command inbox；
- 第一版不监听端口：用户已授权的 ADB 主机通过仅 Internal 可用的 `run-as` 写入 inbox，Production Release 保持不可调试；
- JSON 从 stdin 传输，账单文本不插入 shell 程序、命令日志或返回值；ADB 授权和 Internal `run-as` 边界构成本地开发配对凭据；
- 外部请求只能创建 `PENDING`，不能确认或删除；
- App 原子写入数据库 receipt 和最小化结果文件，而不是让电脑端读取 SQLite；桌面端用投递返回的 `requestKey` 查询结果。

生产版本不得依赖开启 USB 调试。正式产品需要认证后的同步 API 或系统级 App Intent/Shortcut。

### 阶段 D：MCP Server

交付：

- STDIO MCP：本机 Codex/Claude Code；
- Streamable HTTP MCP：仅在生产身份、TLS、OAuth/短期 token 和审计完成后启用；
- 精确工具授权，不使用全局 bypass；
- 正确设置 read-only、additive、idempotent 等注解，但安全保证仍由服务端执行；
- 为 Codex 和 Claude Code 提供薄配置与使用说明，不复制业务逻辑。

验收：两个客户端用同一测试夹具完成 preview 与 create-pending；未授权 confirm 被拒绝；断线重试不重复入账。

### 阶段 E：iOS 与正式同步

- 增加 App Intent：预览账单、创建待确认账单、打开待确认页；
- App Intent 参数只传最少必要内容；
- 后台能力不足时明确打开 App，不伪装为已写入；
- 若引入云同步，使用账户级认证、端到端最小化、冲突 revision 和撤销路径；
- 完成隐私政策、数据删除、密钥轮换、速率限制和事故响应。

已实现的协议与后端契约见 `src/agent/AgentSyncProtocol.ts` 和 `docs/AI_AGENT_SYNC_API_V1.openapi.json`。该契约依据 OAuth 2.0 Security BCP（RFC 9700）、DPoP（RFC 9449）和 HTTP Problem Details（RFC 9457）建立最小边界；它不是已部署服务，也不包含用户账号或密钥实现。

## 6. 安全不变量

1. 外部文本、OCR 和 AI 结构化字段全部是不可信输入。
2. 代理不能选择跳过 parser、review policy 或 transaction write integrity。
3. `create_pending_bill` 是可重试的加法操作；同一幂等键不同 payload 必须失败。
4. confirm 必须携带 expected revision，旧结果不能覆盖用户的新编辑。
5. 账单内容不写命令日志；错误日志只记录 request ID、状态码和脱敏摘要。
6. 深链只用于填充或打开页面；公开 scheme 永远不授予确认能力。
7. MCP 注解是 UI 提示，不是权限边界。
8. 模型或代理不可获得数据库文件、任意 shell、通用 SQL 或无范围网络凭据。

## 7. 测试矩阵

- 正常消费、收入、多笔、相对日期、中文金额；
- 多金额、优惠金额、总价/单价混合、个人收款、宽泛商户；
- 转账、退款、报销、借贷、还款和余额调整；
- 共享解析上限 500 字边界（500 接受、501/2,000 拒绝）、控制字符、Unicode、恶意 URL 和 shell 元字符；
- 相同 key/相同 payload、相同 key/不同 payload、并发重复请求；
- App 被杀、数据库事务失败、桥接超时、MCP 断线；
- 旧 revision 确认、已删除记录、隐藏账户、分类方向不一致；
- Android Debug/Internal/Production 身份隔离及 iOS Extension/App Intent 生命周期。

## 8. 发布门禁

阶段 A 只作为开发者功能发布。满足以下条件前不得宣传“AI 自动记账”：

- 真机链路验证并产生可查询 receipt；
- 至少 100 条授权、脱敏账单夹具通过回归；
- 金额解析准确率、重复率、误确认率有明确指标；
- 所有非普通收支保持人工确认；
- 权限撤销、数据删除和失败补偿验证完成；
- Codex 与 Claude Code 的最小权限配置均完成独立验收。

## 9. 建议执行顺序

1. 完成阶段 A CLI，并把它作为解析契约的可执行样例。
2. 抽取 `AgentCommandService` 与 operation receipt，而不是直接写 MCP。
3. 先完成 Internal Android 配对桥接和真机证据。
4. 在稳定命令层之上增加 MCP。
5. 最后实施生产同步和 iOS App Intent。

这样可以尽早获得可演示成果，同时避免把临时 ADB 或公开深链误当成生产授权机制。
