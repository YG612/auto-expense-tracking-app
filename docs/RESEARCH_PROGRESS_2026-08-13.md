# 研发进展：从 GitHub 基线到 1.0.7 内测候选

更新时间：2026-08-13
对比基线：`origin/main` 提交 `d1799d2afa62`（用户此前上传到 GitHub 的版本）
当前目标：`1.0.7` / build `8`，Android Internal 受控内测候选

## 1. 结论先行

这次改动不是对原版本做局部补丁，而是完成了一轮覆盖“识别、解析、确认、落库、恢复、发布”的系统性加固。核心结果如下：

- 语音输入从单纯依赖 OEM/系统 Provider，扩展为可选的 App 自持麦克风、离线流式 Zipformer 方案；系统静音端点不再拥有提交权。
- 修复“确认入账后旧语音文字再次出现并可重复生成账单”的会话代际问题，并增加持久化语音操作回执，跨重试防重复入账。
- 中文金额解析支持数量 × 单价、后置单价、半斤/两斤半等表达；促销、冲突总价、负数等不安全表达统一停止猜测。
- 分类由散落关键词升级为确定性规则、个人规则、商户学习和轻量语义本体的分层决策；“网吧消费”可以归娱乐，“在网吧买水”仍由明确商品语义归餐饮。
- 手动记账首层收敛为“支出、收入、转账”和 8 个常用展示组，底层 10 种交易语义与历史分类 ID 保持不变。
- 数据库从 3 个迁移扩展到 6 个不可变迁移，补齐 revision、隐私保留策略、待确认安全标记和语音操作回执。
- 新增 GitHub Actions、发布身份门禁、迁移哈希门禁、Android 安全构建与设备回归工具。
- 旧的 200 MB 级 SenseVoice PoC 已从可执行代码、模型、运行库、Gradle 开关和脚本中移除，仓库只保留一条轻量离线流式研发主线。

## 2. 与 GitHub 基线的规模对比

| 项目                            |        GitHub 基线 |         当前候选 |
| ------------------------------- | -----------------: | ---------------: |
| package 版本                    |            `0.0.1` |          `1.0.7` |
| Android / iOS build             |         初始工程值 |              `8` |
| Git 管理文件数                  |                179 |              270 |
| 数据库迁移                      |              v1–v3 |            v1–v6 |
| `src/tests` 测试文件            |         基线测试集 |    30 个测试文件 |
| Android 普通 arm64 Internal APK | 未形成当前审计基线 | 26,591,742 bytes |
| Android 流式离线 arm64 APK      |                 无 | 56,450,596 bytes |
| 离线语音 APK 实际增量           |                 无 |        28.48 MiB |

当前工作区相对基线约有 179 个文件发生修改或新增。跟踪文件差异约为 10,754 行新增、1,930 行删除；新增文件另约 15,615 行。数字用于说明改动规模，不代替功能验收。

## 3. 主要研发进展

### 3.1 中文交易解析与分类

- 金额解析不再把“5 瓶牛奶每瓶 10 元”记成 10 元，支持前后置单价与中文数量。
- 总价与计算值冲突、负数量/负单价、折扣/满减但没有明确实付金额时 fail closed，不自动生成高置信账单。
- 商户和场所分类增加语义本体：场所默认只在没有更明确商品、服务或风险语义时生效。
- 明确商品/活动优先于场所，例如“网吧买水”归餐饮、“网吧买鼠标”归购物、“网吧上网”归娱乐。
- 退款、充值、押金、代金券、会员卡、转账、借还款等资金语义不会被普通场所规则覆盖。
- 个人规则提供的账户和分类按结构化来源处理；规则账户有效时不再误报成“最近账户推断”。

### 3.2 分类与交易类型精简

- 首层交易入口固定为支出、收入、转账；退款、报销、借贷、还款、余额调整进入“更多”。
- 支出展示汇总为 8 组：餐饮、出行、购物、生活缴费/居家、休闲娱乐、医疗健康、学习办公、其他。
- 精简仅作用于展示层；底层 10 种交易类型、稳定 `systemKey`、历史 `categoryId` 和统计语义均不迁移、不合并。
- 新账不再擅自默认分类；一级分类可直接选择，完整二级分类和自定义分类仍可搜索。

### 3.3 确认体验与防重复入账

- 信息完整且来自个人规则的候选可以在卡片外直接“一次确认入账”，无需先进入编辑页。
- 最近账户只是非阻断提示，但仍要求一次人工确认；金额歧义、缺字段和特殊资金类型继续阻断直接确认。
- 语音结果引入 draft/turn generation 与一次性 result token；确认、放弃、再记一笔和离开页面都会形成代际屏障。
- 已消费的旧 partial/final/error 回调不能污染下一笔，也不能重新生成已确认候选。
- 数据库新增 `recognized_operation_receipts`：语音来源键、规范化 payload hash 和账本写入在同一 SQLite 事务提交。
- 同一语音操作重放返回已提交；不同 payload 复用来源键、已软删后重放等情况明确拒绝，不生成第二条交易。

### 3.4 App 自持轻量离线流式语音

- Android `streamingAsr` 轨道使用 App 自持 `AudioRecord`，16 kHz 单声道 PCM16，PCM 不跨 React Native、不落盘、不上传。
- 使用 sherpa-ncnn 2.1.7 与中文 Zipformer 14M；运行时、模型、源码提交、依赖、补丁、许可证和 SBOM 均由 SHA-256 锁定。
- 模型 endpoint detection 关闭；partial 只用于预览，只有用户点按“说完了”才可以产生 final。
- 取消、切后台、30 秒安全超时、迟到回调均不产生可提交 final。
- 运行时初始化、采集和增量解码在后台 worker；30 秒 watchdog 独立于 native decode；session + generation 双栅栏阻止旧回调。
- 流式包能力损坏时 fail closed，不会静默降级回 OEM 系统端点；普通无模型包仍可由用户显式选择系统语音兼容路径。

### 3.5 数据、隐私与安全

- 交易增加 revision 乐观锁，旧页面不能覆盖新修改或复活已删除记录。
- 原始识别文字保留策略可关闭，并以事务方式清理历史交易和纠错原文。
- Android Internal/Production 不声明 `INTERNET`；语音模型包只声明录音权限和 AndroidX 自动生成的签名级广播权限。
- Android 云备份和设备迁移排除财务数据库；iOS 增加 SQLite/WAL/SHM 保护和隐私清单。
- 错误提示不向 UI 泄露 SQL、文件路径、原始异常或账目正文。

### 3.6 工程与发布

- 版本身份统一到 package、Android、iOS 与发布配置，并由 fail-closed 脚本校验。
- 6 个数据库迁移由 SHA-256 清单保护，只允许追加，不允许重写历史。
- GitHub Actions 覆盖 frozen install、格式、lint、TypeScript、Jest、迁移、发布身份、仓库卫生和普通 Android Internal 构建。
- Android 构建脚本使用短路径、D 盘缓存和互斥锁，避免 Windows 长路径与并发构建污染。
- USB 安装器只执行覆盖安装，不卸载、不清数据、不自动授权；设备证据工具不采集序列号、账本、录音或全量日志。

## 4. 关键文件变化导航

| 领域               | 主要文件/目录                                                             | 说明                                            |
| ------------------ | ------------------------------------------------------------------------- | ----------------------------------------------- |
| 交易解析           | `src/classification/`                                                     | 金额、分句、规则、语义本体、置信与风险          |
| 分类展示           | `src/domain/policies/bookkeepingPresentationPolicy.ts`                    | 交易类型与 8 组分类的展示层映射                 |
| 智能记账           | `src/features/smart-entry/`                                               | 会话状态机、确认卡、一次性语音结果              |
| 持久化             | `src/database/`                                                           | v4–v6 迁移、revision、隐私、操作回执            |
| 语音控制           | `src/speech/`                                                             | 系统/本地路由、代际隔离、App-owned 端口         |
| Android 公共原生层 | `android/app/src/main/java/com/qingjiai/speech/`                          | 系统识别桥与嵌入式引擎公共状态机                |
| Android 流式实现   | `android/app/src/streamingAsr/`                                           | Zipformer 引擎源码；模型/runtime 由准备脚本生成 |
| 供应链             | `android/app/src/internal/streaming-asr-lock.json`、`scripts/*streaming*` | 固定来源、构建、打包、准备和验证                |
| 测试               | `src/tests/`、`android/app/src/test/`、`scripts/*.test.cjs`               | JS、数据库、Kotlin、脚本和发布门禁              |
| CI/发布            | `.github/`、`config/release-identity.json`、`docs/RELEASE_RUNBOOK.md`     | 自动门禁与发布边界                              |

## 5. 已完成的验证

- JavaScript/TypeScript：37 个 Jest suites、417 个 tests 通过；`tsc --noEmit`、ESLint、Prettier 通过。
- Android 原生：11 个 JVM suites、55 个 tests 通过；普通 Internal 与显式流式 Internal 均构建成功。
- 普通 arm64 APK：无语音模型/runtime、无 `INTERNET`、仅 arm64、zipalign 16 KB 与 APK v2 签名验证通过。
- 流式 arm64 APK：7 个模型文件、2 份许可证、SBOM、prepared manifest 和 4 个 native SO 均与锁一致；4 个 SO 的 ELF `PT_LOAD` 最小对齐为 16 KB；无 legacy ONNX/SenseVoice 载荷。
- 本轮复建哈希：普通 arm64 APK `40E0A85059307E5C10D0500CEE20458B91BE4094D40E8F55D1B6F518CCC7CC1D`；流式 arm64 APK `B1C3416A1ED140F9F820E4C2BE15FE86EBD0F85C64DCF5B5FF3EF703B206CB04`。APK 是本地构建证据，不提交源码仓库。
- 发布身份：`1.0.7 (8)` 跨 package/Android/iOS 一致。
- 迁移完整性：6 个不可变 migration 校验通过。

## 6. 仓库去冗余结果

本轮在提交前执行了三层清理：

1. 删除旧 SenseVoice PoC 的约 239 MB ONNX 模型、10.8 MB AAR、许可证副本、Kotlin 引擎、模型锁、准备/构建/打包脚本和 Gradle 入口。
2. 删除本地 APK 归档与已不再需要的非空目录 `.gitkeep`；APK/AAB 和 `artifacts/` 已加入忽略规则。
3. 新增 `pnpm repository:hygiene` 与 CI 门禁，阻止旧运行时、旧构建入口和生成安装包重新进入仓库。

以下内容不是冗余，必须保留：

- v1–v6 历史 migration 及其哈希，保证已有账本可升级。
- 许可证、notice 和 SBOM，即使部分文本相似，也分别承担运行库与模型分发义务。
- 普通系统语音兼容代码与 `streamingAsr` 原生实现，二者服务于不同构建轨道，并非同一实现副本。

## 7. 尚未完成与下一阶段

当前源码和 APK 已达到“可安装内测候选”，但还不是生产发布版。下一步必须在已授权 USB 真机完成：

- Redmi/HyperOS 首轮：冷/热模型加载、首次 partial、点击“说完了”后的 final 延迟、30 秒超时。
- 100 轮开始/停止/取消压力测试，观察 PSS、句柄、线程和 busy 状态是否单调增长。
- 后台、锁屏、来电、闹钟、权限撤销、其他录音 App 抢占时，确认不产生 final、不误入账。
- 用至少 300 条授权财务语音完成金额、数字序列、CER、噪声、口音和提前结束评分。
- MagicOS、ColorOS/OriginOS/Samsung 或旧 Android arm64 设备矩阵。
- iOS 仍只有系统语音实现；离线流式 Provider、macOS 构建、签名与真机验证未完成。

在这些证据完成前，不应把“可构建、可安装”描述为“识别准确率和稳定性已解决”。
