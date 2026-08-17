# 轻记 AI

“轻记 AI”是一款面向 Android 与 iOS 的本地优先个人智能记账 App。本仓库当前完成了 `CODEX_MASTER_PROMPT.md` 的阶段 1（项目初始化）至阶段 8（Android 支付通知自动记账）的候选实现。阶段实现完成不等于第一版已达到生产发布条件；隐私、数据生命周期、生产签名、iOS 构建和第一版缺失项以 `docs/` 中的门禁为准。

当前发布身份目标为 `1.0.7` / build `8`。生产密钥不存放在仓库内，内部 Android 包必须使用与 `com.qingjiai` 不同的 application ID。

本轮新增隔离的 Android `streamingAsr` 实验轨道：App 自持 AudioRecord 和轻量 Zipformer 普通话模型，系统静音端点不能提交结果，只有用户点按“说完了”才产生 final。普通 Internal、Production、Debug、iOS 均不内置该模型；系统兼容包仍可显式使用设备系统语音。实验 APK 已完成构建与静态产物审计，但尚未完成 USB 真机、性能和准确率验证，不是生产就绪结论。

## 技术基线

- React Native 0.86.0 / React 19.2.3 / TypeScript 5.9
- React Navigation 7（Native Stack + Bottom Tabs）
- OP-SQLite 17.1.2
- React Native Community DateTimePicker 9.1.0
- Android：Kotlin 2.1.20、minSdk 24、compileSdk/targetSdk 36、Hermes、新架构
- iOS：Swift 基础工程、iOS 15.1+
- Jest 29 + React Native Testing Library 14
- ESLint 8（React Native 0.86 官方配置）+ Prettier 3
- pnpm 11.9.0（hoisted `node_modules`，便于 React Native 原生自动链接）

## 目录

```text
src/
  app/                  App 根组件和全局 Provider
  navigation/           Root Stack、Bottom Tabs 和路由类型
  screens/              导航入口页与功能页面重导出
  components/           跨功能通用组件
  database/             SQLite 适配、migration 与 repository
  domain/               共享实体与业务服务
  features/             按业务能力组织的功能模块
  classification/       本地文本标准化、解析、分类与置信度管线
  speech/               跨平台语音端口、会话状态机与 React Hook
  importers/            外部来源到统一候选记录的适配层
  native/               Kotlin/Swift 能力的 TypeScript 适配边界
  utils/                无业务归属的通用工具
  tests/                跨模块与数据库测试
```

## 环境要求

### 通用

- Node.js 22.13+ 或 24.3+；本项目已使用 Node 24.14 验证工具链
- pnpm 11.9.0

安装 JavaScript 依赖：

```bash
pnpm install --frozen-lockfile
```

`pnpm-workspace.yaml` 允许构建仅供 Jest 使用的 `better-sqlite3` 原生依赖。移动端运行时使用 OP-SQLite 的 Android/iOS 实现，不打包 `better-sqlite3`。

`.env.example` 仅定义未来可公开的构建期配置契约，当前不会自动读取 `.env`。移动端产物可以被反编译，因此任何第三方 API 密钥都必须保存在服务端，不能写入 `.env` 或客户端代码。

### Android

- Android Studio 与 Android SDK Platform 36
- Android SDK Build-Tools 36.0.0
- Android NDK 27.1.12297006 与 CMake 3.22.1
- JDK 17
- 已启动的模拟器，或已开启 USB 调试的真机

终端 1 启动 Metro：

```bash
pnpm start
```

终端 2 构建并运行：

```bash
pnpm android
```

也可以用 Android Studio 打开 `android/`。若 SDK 不在默认位置，请在 `android/local.properties` 中配置 `sdk.dir`；该文件不会提交。

仅验证 Android 原生 Debug 编译（无需启动模拟器或 Metro）：

```powershell
pnpm android:assemble:windows
```

APK 输出到 `android/app/build/outputs/apk/debug/app-debug.apk`。Windows 下 React Native 新架构与 CMake 会产生很深的中间路径；上述脚本固定把仓库临时映射为 `Q:`，构建完成后立即解除映射。固定盘符保证 Kotlin 与 CMake 的增量缓存不会因盘符切换失效；该盘符只是当前仓库的短路径别名，不会复制项目或改变实际存储位置。

注意：Debug APK 使用 `com.qingjiai.debug`，不包含可独立运行的 JavaScript Bundle。真机安装 Debug APK 后必须保持 Metro 运行；USB 调试时还需要执行 `adb reverse tcp:8081 tcp:8081`。它只用于开发，不能作为脱离电脑运行的测试包。

验证包含 JavaScript Bundle、Hermes 字节码和四 ABI 原生库的独立 Internal 编译：

```powershell
pnpm android:assemble:internal:windows
```

仅给当前主流 Android 真机生成 arm64 产物、减少编译时间与磁盘占用：

```powershell
$env:ORG_GRADLE_PROJECT_reactNativeArchitectures = 'arm64-v8a'
pnpm android:assemble:internal:windows
```

APK 输出到 `android/app/build/outputs/apk/internal/app-internal.apk`。Internal 使用独立的 `com.qingjiai.internal` application ID 和“轻记 AI 内测”名称，包含可独立启动的 Bundle，但允许使用 Debug 密钥，因此只能分发给受控测试人员，不能上传应用商店，也不能替代生产签名验证。普通 Internal 是默认轻量测试轨道，不内置语音模型或离线推理运行时。

可选的 Android Internal `streamingAsr` 实验包只有显式启用 `streamingAsr=true` 才加入锁定的 sherpa-ncnn 与约 25 MB Zipformer 模型。它使用 App 自持 AudioRecord 进行 16 kHz 单声道 PCM16 流式识别，系统或模型端点不会自动提交；只有用户点按“说完了”才结束采集并产生 final。普通 Internal 与 Production 不包含模型，系统兼容包仍可使用系统语音。源码、供应链、JVM、APK 权限/ABI/签名/16 KB 对齐门禁已经通过；真机内存、延迟、稳定性和准确率仍待 USB 验证：

```powershell
pnpm android:streaming-asr:verify:windows
pnpm android:verify:streaming-asr:windows
```

实验分支还提供同一 14M 中文 Zipformer 的 sherpa-onnx A/B 轨道。它使用独立锁文件、AAR、模型目录和 Gradle 引擎选择，不进入普通 Internal 或 Production。准备好锁定缓存后运行：

```powershell
pnpm android:streaming-onnx-asr:prepare:windows
pnpm android:verify:streaming-onnx-asr:windows
```

两种 App 自有引擎共享相同 AudioRecord、用户手动停止和会话安全实现；不得用不同录音、端点策略或线程参数生成对比结论。详细语料和评分契约见 `docs/ASR_AB_BENCHMARK.md`。

连接并授权一台 USB 调试真机后，使用安全安装器覆盖安装并保留数据：

```powershell
pnpm android:install:internal:windows
```

安装器不会卸载、清数据、强制降级或自动授予权限；签名冲突、空间不足、系统限制、ABI 或 API 不兼容会给出对应提示。安装成功后运行 `pnpm android:regression:device:windows` 收集脱敏设备能力证据，并按 `docs/ANDROID_DEVICE_REGRESSION.md` 完成重点人工回归。

一次完成 Android 原生策略测试、arm64 Internal 编译与独立安装包验证：

```powershell
$env:ORG_GRADLE_PROJECT_reactNativeArchitectures = 'arm64-v8a'
pnpm android:verify:internal:windows
```

生产 Release 的 application ID 为 `com.qingjiai`，只允许从安全发布环境引用以下四个变量提供的外部签名材料：`QINGJI_ANDROID_RELEASE_STORE_FILE`、`QINGJI_ANDROID_RELEASE_STORE_PASSWORD`、`QINGJI_ANDROID_RELEASE_KEY_ALIAS`、`QINGJI_ANDROID_RELEASE_KEY_PASSWORD`。仓库不会生成、保存或回退到 Debug 生产密钥；变量缺失时 Release 必须构建失败。签名材料已按 `docs/RELEASE_RUNBOOK.md` 注入并完成身份门禁后，运行 `pnpm android:package:release-abis:windows` 可生成 `armeabi-v7a`、`arm64-v8a` 和仅包含这两种真机 ABI 的 `universal` 三个签名 APK；制品及哈希清单位于带时间戳的 `artifacts/android/release-*` 目录。该命令不是日常真机测试入口，未经签名证书、版本和升级路径验证的产物不得发布。

构建时 Gradle、Kotlin、CMake、Codegen 与原生依赖统一使用同一个临时 `Q:` 根路径，Metro/Hermes 单独使用 D 盘物理路径。Android SDK、Gradle、pnpm/npm 缓存和 `TEMP/TMP` 只接受 D 盘目录；当前终端没有设置时使用 `D:\CodexData` 下的明确回退目录，防止普通新终端把中间文件写回 C 盘。React Native 自动链接 JSON 只在本次构建会话内存在，并在解除 `Q:` 前删除，因此不会把 `Q:`、`R:` 等临时盘符泄漏给后续任务；脚本不会因此清空依赖或其他正常产物。同一物理项目的构建由 Windows 互斥锁串行化：并发构建会安全退出，上次异常中断留下且确实指向本项目的 `Q:` 映射会在持锁后自动恢复。

语音真机验证时，进入“智能记账”并点按“开始语音记账”后才会申请麦克风权限。App 会先完成权限授权，再判断本地中文能力；Android 12 及以上优先使用系统本地识别。设备没有本地中文模型时，用户必须明确选择“系统语音（可能联网）”；Android 会先尝试 App 内可控的系统识别会话，只有运行失败或超时才兼容降级到 OEM/Google 等外部系统语音界面，未经选择不会切换。

ColorOS 等定制系统可能允许应用使用麦克风，却拒绝 App 直接调用 `SpeechRecognizer` 服务。Android 端已把本地识别、OEM 系统语音界面和直接系统服务建模为三个独立引擎：权限确实关闭时才引导授权；权限已经开启但返回 Android error 9 时，不再误报“没有权限”，而是在用户同意后使用 OEM 系统语音界面。中国版 ROM 若没有安装或启用任何中文语音服务，文字与手动记账仍可正常使用。

### iOS

iOS 只能在 macOS 上构建，需要 Xcode、Xcode Command Line Tools、Ruby/Bundler 和 CocoaPods。首次安装或原生依赖变化后执行：

```bash
bundle install
bundle exec pod install --project-directory=ios
pnpm start
pnpm ios
```

完成 Pods 安装后，也可用 Xcode 打开 `ios/QingJiAI.xcworkspace`。Windows 无法执行 iOS 编译或启动 Simulator。

iOS 语音入口需要同时获得 Speech Recognition 与麦克风权限。本地中文识别不可用时不会静默联网，必须由用户在 App 内明确选择“可能联网”的系统语音。阶段 6 新增原生文件后，应在 macOS 上重新执行 `bundle exec pod install --project-directory=ios`，再完成 Xcode Release 与真机权限验证。

## 数据库

阶段 2 使用 OP-SQLite，并通过项目自有的 `DatabaseConnection` 接口隔离第三方实现。`getAppDatabase()` 首次调用时打开单例连接、配置外键/WAL/超时并执行待应用迁移。

v1 schema 包含 11 张业务或关联表：`transactions`、`categories`、`accounts`、`projects`、`tags`、`transaction_tags`、`merchants`、`user_rules`、`classification_feedback`、`budgets`、`import_records`，另有 `schema_migrations` 元数据表。v2 按需求文档写入完整的系统收支分类和 7 个默认账户；稳定 ID 与 `system_key` 可供后续升级和识别规则引用。v3 增加规则来源、学习反馈状态、删除抑制和本地个性化开关。v4 增加交易 revision 与原始文字留存策略，旧账本按向前迁移升级。

持久化约束：

- 金额使用整数分，不使用浮点数。
- 页面和功能模块只能调用 repository，不得直接执行 SQL。
- 所有交易来源进入同一写入验证边界；金额、时间、分类方向、账户、转账目标、外键和字段长度在落库前统一校验。
- 编辑、确认、删除和恢复使用 revision 条件更新；旧页面不能覆盖新修改或复活已删除记录。
- 写操作使用事务；迁移按递增版本逐个、原子执行，并由 SHA-256 门禁阻止改写历史 migration。
- 交易支持软删除，默认查询不返回已删除数据。
- 设置中关闭原始文字留存会在同一事务清除交易原文与纠错原文；此后所有写入入口均服从该策略。
- 交易保留 `sync_status`、`server_id`、`last_synced_at` 等未来同步字段。
- 外键与 CHECK 约束在数据库层兜底。

详细规则见 `src/database/README.md`。

## 质量检查

```bash
pnpm release:identity:test
pnpm release:identity:check
pnpm migration:integrity:test
pnpm migration:integrity:check
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:ci
```

`release:identity:test` 使用攻击性夹具证明门禁能够拒绝生产 Debug 签名、包身份/版本漂移、注释伪装的 internal 后缀和硬编码签名材料。`release:identity:check` 对齐 `config/release-identity.json`、Android、iOS 与 `package.json`；任一生产身份风险都会以非零状态失败。`migration:integrity:test/check` 通过负向用例和 SHA-256 清单保证数据库升级只能追加，不能重写已经审查的历史。

需要自动格式化时运行 `pnpm format`。Jest 通过 OP-SQLite 官方 Node façade 与内存数据库验证真实 SQL、迁移、约束和 repository，不使用手写 SQLite mock。GitHub Actions 使用 frozen pnpm lock 运行上述检查、Android JVM tests 与隔离的 internal assemble。iOS 在缺少已审查的 `Gemfile.lock`/`ios/Podfile.lock` 时只运行 macOS 静态检查，并明确标记为“未执行编译”。

## AI 代理 CLI（阶段 A）

仓库提供开发者预览版 CLI，供 Codex、Claude Code 或本机脚本复用 App 的同一套账单解析规则。它目前不会直接访问手机 SQLite，也不会自动确认交易。

解析账单并输出稳定 JSON：

```powershell
pnpm qingji -- bill preview "今天午饭 25 元，微信支付"
```

也可以从 stdin 读取，减少完整账单进入终端历史的机会：

```powershell
Get-Content -Raw .\bill.txt | pnpm qingji -- bill preview
```

通过 ADB 把文字分享给已安装的 Android Internal App，并打开智能记账核对页：

```powershell
pnpm qingji -- bill open-android "今天午饭 25 元，微信支付"
```

向 Android Internal App 投递幂等命令，并在 App 内创建待确认记录：

```powershell
pnpm qingji -- bill queue-pending-android "今天午饭 25 元，微信支付" --idempotency-key bill-20260815-001
```

投递后使用返回的 `requestKey` 查询最小化回执：

```powershell
pnpm qingji -- bill status-android --request-key <SHA-256 requestKey>
```

没有设备时可用 `--dry-run` 验证参数。打开核对页可显式传入其他 `--package`；创建待确认记录只支持可调试的 Internal 包。多设备环境可传入 `--serial`。CLI 专项测试运行 `pnpm qingji:test`。

完整的 CLI、设备桥接、MCP 与生产同步路线见 `docs/AI_AGENT_BOOKKEEPING_IMPLEMENTATION_PLAN_2026-08-15.md`。

### Codex / Claude Code MCP

先构建共用的本地 MCP Server：

```powershell
pnpm qingji:mcp:build
```

入口文件是 `build/qingji-mcp/scripts/qingji-mcp.js`。仓库已提供项目级 `.codex/config.toml` 和 `.mcp.json`；构建后重启 Codex，或在 Claude Code 首次提示时批准该项目 MCP。两者都可调用 `preview_bill`、Android/iOS Simulator 核对页工具、Internal-only 的 `queue_pending_bill_android` 和 `get_operation_status_android`。MCP 的 stdout 专用于协议，不能直接在终端手工运行查看日志。

构建后可运行 `pnpm qingji -- doctor` 做只读检查。它只验证 Node、MCP 构建产物和两个宿主配置，不读取账单或账本；若项目目录被移动，会提示更新 `.codex/config.toml` 中的 `cwd`。检查通过后仍需重启 Codex，并在任务输入框中运行 `/mcp` 确认 `qingji` 已连接。

连接已授权的 Android USB 设备后，可运行 `pnpm android:agent:e2e:windows -- -AcknowledgeCreatesPendingRecords` 执行 Internal 通道的幂等端到端回归。脚本只使用固定虚构账单，不采集 logcat 或设备序列号，但会在 Internal App 中创建 1 条 `PENDING` 测试记录，运行后需在待确认列表中手动删除。

当前 MCP 不提供“已确认入账”工具；所有账单文字入口统一限制为 500 个 Unicode 字符。`open_android_review` 只打开 App 核对页。`queue_pending_bill_android` 需要用户已授权的 ADB 设备、可调试的 `com.qingjiai.internal` 包、调用方身份和幂等键；App 只创建 `PENDING` 记录，并使用 operation receipt 防止重试重复记账。投递返回 `requestKey`，随后用 `get_operation_status_android` 查询；只有 `COMMITTED`、`ALREADY_COMMITTED`、`CONSUMED_DELETED` 或 `REJECTED` 才是终态，`QUEUED_OR_UNKNOWN` 不能表述为成功。Production Release 不可使用该通道。

### 生产同步契约（未部署）

不依赖 ADB 的正式同步已抽取为传输无关的 `AgentSyncProtocol` 和 `AgentSyncOperationStateMachine`，并提供 `docs/AI_AGENT_SYNC_API_V1.openapi.json` OpenAPI 3.1 契约。状态机实现 `QUEUED → CLAIMED → COMMITTED/REJECTED`、过期、领取前取消、强 ETag/If-Match revision、同键重试和载荷冲突拒绝。OpenAPI 将普通代理作用域与 App 设备领取/完成作用域分离；只有已认证设备领取后才能获取账单命令。契约不包含确认入账、删除账本、任意查询或 SQL 端点。示例服务器使用保留的 `.invalid` 域名并显式标注 `x-not-production-ready`，它不表示线上服务已存在。

契约使用 OAuth 2.0 Authorization Code + PKCE 作为账号授权边界，要求 DPoP 发送方约束、独立作用域、幂等键和 payload SHA-256。令牌由未来的操作系统凭据存储/传输层注入，不进入可序列化账单请求。运行 `pnpm agent:sync-contract:check` 可检查该安全不变量。真正启用前仍必须选定后端、身份提供方、系统钥匙存储和数据保留政策。

工程流程和发布证据：

- `CHANGELOG.md`：1.0.7 修复、安全变更和未关闭门禁
- `docs/EMBEDDED_ASR_POC.md`：可选离线中文语音包的隔离 PoC 与准入门
- `docs/ENGINEERING_PROCESS.md`：从需求、威胁建模到发布复盘的八道门
- `docs/SECURITY_THREAT_MODEL.md`：当前攻击面、隐私生命周期和 P0
- `docs/REQUIREMENTS_TRACEABILITY.md`：PRD/验收用例与代码证据
- `docs/RELEASE_RUNBOOK.md`：版本、签名、构建、升级与 roll-forward

## 手动记账闭环

底部主导航包含：首页、流水、智能记账、分析和设置；根栈包含“手动记账”和“待确认”页面。

阶段 3 已实现：

- 金额按整数分校验和持久化，支持全部 10 种交易类型。
- 分类、账户按近期使用排序；支持原账户/目标账户、时间、商户、项目、标签与备注。
- 支持新建项目和标签、保存、再次进入编辑。
- 流水按日分组，支持月份切换、文本搜索以及类型/分类/账户/项目/标签筛选。
- 删除进入回收站，回收站可恢复；软删除记录默认不参与正常流水查询。

设置页已接入本地个性化、分类规则，以及默认关闭的 Android 微信/支付宝通知自动记账；云同步等后续功能仍保持阶段边界。

## 首页与统计

阶段 4 已实现共享统计服务和两个统计入口：

- 首页显示本月支出、普通收入、结余、报销回款提示、预算进度、最近 7 天净支出、本月分类排行和最近 5 笔交易。
- 分析页支持月份切换、与上月对比、近 6 个月收支趋势、每日净支出、支出分类及占比、收入来源和预算完成度。
- 分类排行可带月份和分类条件进入流水；最近交易可直接进入编辑。
- 统计只计算已确认、未删除、非疑似重复的人民币记录，金额始终使用整数分。
- `EXPENSE` 计入支出，`INCOME` 计入普通收入，`REFUND` 冲减原支出及原分类；转账、借贷、还款和余额调整不混入普通收支。
- `REIMBURSEMENT` 单独统计并计入结余，不混入普通收入来源。
- 预算只统计净消费支出；没有预算时显示明确空状态，不伪造进度。

## 文字智能记账

阶段 5 使用共享 TypeScript 本地规则实现文字输入，不依赖网络或大模型。当前特性分支还加入约 1.92 MiB 的量化 fastText 端侧分类器；它只在明确语义、个人规则、学习规则和商户字典均未解决分类时提供受控建议：

- 标准化全角/半角、中文标点、支付方式别名和常用金额单位。
- 支持阿拉伯数字、中文数字及“12 块 5”“二十八块五”等口语金额；“两百三”等表达会标记歧义。
- 支持今天、昨天、上周五及早中晚等相对日期和时间场景。
- 优先识别转账、退款、报销、还款和借贷，再判断消费分类，避免混入普通收支。
- 支持一句话拆分多笔交易，并共享整句日期和明确账户上下文。
- 识别餐饮、交通、旅行等系统分类，并把旅行地点作为项目/标签建议，不覆盖真实消费分类。
- 每笔候选显示金额、类型、分类、账户、时间、置信度、缺失字段和歧义原因；确认前不会写入账本。
- Android 与 iOS 使用同一份 15 头分层模型和 fastText C++ 推理核心，模型和运行时完全离线；Android/iOS 加载前均校验 manifest、大小和 SHA-256。
- 模型只处理无歧义的普通支出/收入分类，不判断金额、账户和特殊交易类型；低置信度、低间隔、超时、损坏或不可用时保持原规则结果。
- 当前 `0.1.0-bootstrap` 模型仅由系统分类、通用别名和模板训练，不含用户数据；任何 AI 建议都必须人工核对，不能直接确认入账。真实盲测闸门和限制见 `docs/BILL_CLASSIFIER_MODEL_CARD.md`。
- 中高置信度完整候选可直接确认；低置信度或缺少字段的候选可暂存到待确认箱，并复用完整手动表单修改后确认。
- 待确认箱支持单笔确认、编辑、软删除和对完整候选批量确认；待确认记录不进入普通流水和统计。
- 默认保存已确认文字候选的原始文本与置信度，数据只保存在本地 SQLite。

文字解析不会自动创建项目或标签，也没有实现联网 AI 和重复交易合并。Android 支付通知会复用同一解析管线并自动进入待确认；阶段 7 只会在用户确认并实际纠正后按下述严格条件形成本地商户规则。

## 语音入口

阶段 6 通过项目内自有 Kotlin/Swift 模块调用 Android 本地识别、OEM 系统语音界面和 iOS `SFSpeechRecognizer`。普通构建不引入第三方语音 SDK。显式 Android Internal `streamingAsr` 实验构建才加入锁定的 sherpa-ncnn 与约 25 MB Zipformer 模型：

- 只有用户主动点按后才请求权限并启动单次识别，不支持后台或连续监听。
- 默认优先使用设备本地中文模型；系统可能联网的回退路径必须由用户逐次明确同意。
- 系统/OEM 自动断句只形成可继续拼接的转写片段，不会自动生成候选；只有用户明确点按“说完了”或“使用这段文字”，非空结果才进入阶段 5 的同一 `parseTextTransactions` 管线。
- `streamingAsr` 由 App 自持 AudioRecord；模型端点检测关闭，只有“说完了”会停止采集、排空 decoder 并产生 final，取消、切后台和安全超时都不会产生 final。
- 每次识别使用唯一 `sessionId`；每次 OEM 系统窗口还使用独立的 `requestCode` 与会话代次绑定。生命周期由知道实际引擎的原生层管理：打开 OEM 语音界面造成的暂时后台不会误取消会话，而真正取消、销毁或直接识别中断后，旧窗口和旧会话的迟到回调不会生成候选或写入数据库。
- 支持继续说、说完、取消、错误重试、权限设置引导，以及识别中断后由用户明确采用屏幕上的部分文字。
- 语音候选沿用相同的多笔拆分、置信度、确认卡片和待确认箱，持久化来源为 `VOICE`。
- 普通系统语音路径不创建录音文件或音频字段。`streamingAsr` 只在原生层消费内存 PCM，不写 WAV、M4A、PCM 文件、Blob、Base64 或音频 URI；默认只在用户确认后保存转写文本和结构化交易。

Android 原生桥接、流式 ASR 公共层和显式 `streamingAsr` APK 已通过源码及产物门禁，但尚未完成 USB 真机验证。准确率、口音、噪声、内存、延迟与长时间稳定性必须按 `docs/ASR_AB_BENCHMARK.md` 和 `docs/ANDROID_DEVICE_REGRESSION.md` 实测。iOS 当前只有系统语音源码、权限声明和 Xcode 工程引用；离线 Provider 尚未实现，最终原生编译仍必须在 macOS/Xcode 完成。

## 个性化学习

阶段 7 的纠正与规则系统完全位于本机：

- 只有来源为 `TEXT` 或 `VOICE`、已确认、未删除且非合并重复的交易，其真实分类/类型/账户修改才会留下学习反馈。
- 同一可靠商户最近连续 3 笔不同交易被纠正为相同分类后，才生成商户学习规则；个人收款对象、综合平台和“便利店”等宽泛商户不会自动学习。
- 第 4 次输入相同商户时，学习规则优先于商户词典和通用关键词；本次文本中的明确类型、分类、账户以及用户主动创建的规则仍具有更高层级。
- “设置 → 分类规则”可查看来源、匹配内容、建议结果、优先级、使用次数和最近使用时间，并支持创建、编辑、启停与删除商户/关键词规则。
- 删除学习规则会写入本地抑制记录，旧反馈不会把它自动复活；编辑学习规则后会转为用户主动维护的规则。
- 关闭“自动学习纠正”后不会记录新的反馈或生成规则，但已有且启用的规则仍会参与本地建议。
- 交易、标签、反馈和可能发生的第三次规则晋级使用同一个 SQLite 事务，任一步失败都会整体回滚。

## 架构边界

- 页面不得直接执行 SQL，只能通过 repository 访问 SQLite。
- 金额、交易类型、统计、分类与去重逻辑位于共享 TypeScript 领域层，Android/iOS 使用同一规则。
- Kotlin/Swift 原生模块只采集平台事件并输出最小化 DTO，不直接分类或保存交易。
- Android 通知、iOS 分享/OCR 和账单文件先进入 `importers/` 适配层，再进入共享识别与确认管线。
- 自动来源必须支持置信度、待确认、去重、编辑、撤销和删除。

## 阶段状态

已完成候选实现：

- 阶段 1：项目初始化
- 阶段 2：SQLite、migration、领域实体、repository 与数据库单元测试
- 阶段 3：手动记账、流水、编辑、软删除与回收恢复闭环
- 阶段 4：首页、最近交易、共享统计、趋势、分类排行与预算进度
- 阶段 5：本地中文解析、多笔拆分、确认卡片、置信度与待确认箱
- 阶段 6：双平台语音转文字、共享文本解析、取消、重试与默认不保存原始音频
- 阶段 7：本地纠正记录、商户/关键词规则、优先级、规则管理与三次纠正学习

阶段 8（Android 通知自动记账）已形成候选实现：用户显式开启并授予通知使用权后，只筛选微信/支付宝支付结果；事件先原子写入不参与备份的私有事件箱，再由 Headless JS 自动生成待确认账，后台受限时在 App 回前台补导。详见 `docs/AUTO_BOOKKEEPING_RESEARCH_2026-08-15.md`；发布前仍必须完成其中的真实通知样本与 OEM 真机矩阵。
