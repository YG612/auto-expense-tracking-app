# Android 语音兼容性与验收矩阵

本文定义轻记 AI 在 Android API 24–36 上的语音能力模型、自动化契约和真机验收方法。它是发布门禁，不是按手机品牌堆叠补丁的清单。

## 1. 目标与边界

- 语音模块只输出最终转写文字，不创建或保存录音文件。
- 本地识别是默认路径；任何可能联网的系统识别都必须由用户对本次操作明确授权。
- “权限已授予”“识别服务存在”“中文模型已就绪”“麦克风可采集”“当前有前台 Activity”是相互独立的事实。
- OEM 名称不得进入路由和错误分支。三星、小米、OPPO、一加、vivo、荣耀、华为和 Pixel 只是真机样本。
- 任意语音失败都必须安全降级到文字记账，不得阻断账本使用。
- 系统识别服务及其返回文字均视为不可信边界：必须限制长度、规范化、隔离旧会话并保证最终结果至多消费一次。

当前 Android 工程的范围是 `minSdk 24`、`targetSdk 36`、`compileSdk 36`。

## 2. 能力模型

不得再用单个 `available` 或单个运行时权限推导“语音可用”。开始一次会话前应得到以下正交事实：

| 维度           | 必须区分的状态                                                        | 说明                                                 |
| -------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| Provider 服务  | `PRESENT`、`ABSENT`、`UNKNOWN`、`TEMPORARILY_UNAVAILABLE`             | 分别记录本地服务、系统 Activity、系统 direct service |
| Locale 就绪度  | `READY`、`DOWNLOADABLE`、`DOWNLOADING`、`UNSUPPORTED`、`UNKNOWN`      | `UNKNOWN` 只表示无法可靠查询，不等于服务不存在       |
| App 麦克风权限 | `NOT_DETERMINED`、`GRANTED`、`DENIED`、`BLOCKED`、`RESTRICTED`        | 只适用于由 App 直接采音的路径                        |
| 麦克风采集通道 | `AVAILABLE`、`NO_HARDWARE`、`PRIVACY_DISABLED`、`IN_USE`、`UNKNOWN`   | Android 12+ 全局麦克风开关独立于运行时权限           |
| 前台宿主       | `READY`、`NO_ACTIVITY`、`PAUSED`、`DESTROYED`                         | 系统 Activity 和权限弹窗需要可用前台宿主             |
| 联网授权       | `NOT_GRANTED`、`GRANTED_FOR_SESSION`                                  | 授权不能跨会话静默复用为默认行为                     |
| 网络条件       | `ONLINE`、`OFFLINE`、`METERED`、`CAPTIVE`、`UNKNOWN`                  | 网络条件不是联网授权；二者不可合并                   |
| 会话阶段       | `CHECKING`、`PERMISSION`、`STARTING`、`LISTENING`、`PROCESSING`、终态 | 只允许前进，不允许迟到回调造成倒退                   |

Provider 能力至少包含：

```text
providerId
route = on-device | system-activity | direct-system
serviceState
localeReadiness
requiresAppMicrophonePermission
mayUseNetwork
hostRequirement
diagnosticCode
```

`startable` 是上述事实和用户本次授权的派生结果，不是持久化事实。

## 3. 不可破坏的系统不变量

1. `allowNetworkFallback=false` 时不得启动 `mayUseNetwork=true` 的 Provider。
2. 系统 Activity 不以本 App 的 `RECORD_AUDIO` 权限作为前置条件；direct 路径必须检查该权限。
3. `UNKNOWN` 不得伪装为 `READY`，也不得被等同为 `ABSENT`。
4. 同一时刻最多存在一个活跃会话、一个权限请求、一个能力探针和一个模型准备操作。
5. 会话 ID 与 native generation 必须共同隔离迟到回调。
6. `SUCCEEDED`、`ERROR`、`CANCELLED` 是不可逆终态；最终结果至多交付一次。
7. `PROCESSING` 不得因迟到的 `ready`、`beginning` 或 partial 回调退回 `LISTENING`。
8. `cancel`、页面卸载、Host pause/destroy 和 React Native invalidate 后，不得再更新 UI 或记账。
9. capability、permission、start、listening、final result 和外部 Activity 返回都必须有有界退出或生命周期对账。
10. 任何 Provider 返回的空白、超长、重复、乱序或旧会话结果都不能进入记账用例。
11. 不记录原始音频，不在日志、错误消息和诊断事件中记录完整转写文字。
12. 模型下载和联网识别必须由可见的用户动作触发，不得在 App 启动或普通重试中自动发生。

## 4. Android API 24–36 矩阵

自动化层级：`S` 静态检查，`J` JVM/TypeScript 单测，`R` Robolectric/原生契约测试，`E` Emulator instrumentation，`D` 真机。

| API | 平台能力与主要差异                                                         | 必测期望                                                                                   | 自动化  | 真机 |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------- | ---- |
| 24  | 无 `createOnDeviceSpeechRecognizer`；可有 direct service 或系统 Activity   | 默认本地路径明确降级；只有用户明确操作后才启动系统路径                                     | S/J/R/E | D    |
| 25  | 同 API 24                                                                  | 无 Provider、仅 direct、仅 Activity、二者都有四种组合均有稳定结果                          | J/R/E   | D    |
| 26  | 同 API 24                                                                  | 权限首次询问、拒绝、永久拒绝和无前台 Activity 均不悬挂                                     | J/R/E   | D    |
| 27  | 同 API 24                                                                  | stop、cancel、返回空结果和 Provider busy 均进入唯一终态                                    | J/R/E   | D    |
| 28  | 后台麦克风访问限制更严格                                                   | Host pause 立即释放 direct recognizer；不得后台继续采音                                    | J/R/E   | D    |
| 29  | 同 API 28                                                                  | 冷启动、旋转、返回键和进程回收后可重新开始新会话                                           | J/R/E   | D    |
| 30  | package visibility 生效                                                    | Manifest 必须声明 `android.speech.RecognitionService` 和识别 Activity 查询；缺失时测试失败 | S/R/E   | D    |
| 31  | 增加 on-device recognizer 和全局麦克风开关；不能使用 API 33 的模型支持查询 | 服务存在但模型状态不可查询时不得当成服务缺失；采用受控启动探测或可解释降级                 | J/R/E   | D    |
| 32  | 同 API 31                                                                  | 覆盖本地模型已装、未装、全局麦克风关闭和 direct service 异常                               | J/R/E   | D    |
| 33  | 增加 `checkRecognitionSupport`、模型下载和 biasing strings                 | `READY/DOWNLOADABLE/DOWNLOADING/UNSUPPORTED/UNKNOWN` 映射准确；API 返回超时可恢复          | J/R/E   | D    |
| 34  | 增加可观察模型下载回调及错误 14/15 相关能力                                | success、scheduled、progress、error、监听不受支持和 10 秒超时均只完成 Promise 一次         | J/R/E   | D    |
| 35  | 延续 API 34；target 行为回归                                               | 所有已知 Android error code 都映射到稳定业务错误和正确恢复动作                             | J/R/E   | D    |
| 36  | 当前 compile/target 基线                                                   | 最新系统镜像完成权限、隐私开关、Provider 缺失、生命周期和包可见性回归                      | S/J/R/E | D    |

### 当前 API 实现状态

- API 31–32 已拆分“本地服务存在”与“locale 模型就绪度”：`PRESENT + UNKNOWN` 会执行一次受控的 on-device 启动探测，且 `allowNetworkFallback=false`。
- `UNKNOWN` 始终保留为 `UNKNOWN`，不会伪装成 `READY`，也不会被误判为服务缺失；该行为已有 TypeScript 与 JVM 回归测试。

## 5. Provider 与 Locale 矩阵

| ID    | 条件                                        | 预期路由与结果                                         | 自动化  | 当前覆盖           |
| ----- | ------------------------------------------- | ------------------------------------------------------ | ------- | ------------------ |
| PR-01 | 三种 Provider 均不存在                      | `service-unavailable`，文字入口始终可用                | J/R/E   | 部分               |
| PR-02 | 本地服务存在，locale `READY`                | 默认选择 on-device；不请求联网授权                     | J/R/E/D | 已覆盖选择策略     |
| PR-03 | 本地服务存在，locale `DOWNLOADABLE`         | 不自动下载；展示下载与系统输入两个独立动作             | J/R/E/D | 已覆盖 TS 主路径   |
| PR-04 | 本地服务存在，locale `DOWNLOADING`          | 不重复下载、不忙等；提示稍后重试                       | J/R/E/D | 部分               |
| PR-05 | 本地服务存在，locale `UNSUPPORTED`          | 不尝试本地；仅在显式授权后使用系统路径                 | J/R/E/D | 部分               |
| PR-06 | 本地服务存在，locale `UNKNOWN`，API 31–32   | 不等同服务缺失；执行受控探测且不静默联网               | J/R/E/D | J 已覆盖，待 E/D   |
| PR-07 | 系统 Activity 可用，direct 也可用           | 显式系统输入优先 Activity，降低 binder 兼容风险        | J/R/E/D | 已覆盖策略         |
| PR-08 | 仅 direct system 可用                       | 显式授权后才开始，并请求 App 麦克风权限                | J/R/E/D | 已覆盖策略，缺真机 |
| PR-09 | 仅系统 Activity 可用                        | 不请求 App 麦克风权限；取消或空结果进入终态            | J/R/E/D | 部分               |
| PR-10 | capability 后 Provider 被禁用或默认服务改变 | start 失败为稳定、可重试错误；资源完全释放             | R/E/D   | 缺失               |
| PR-11 | 系统 Activity 返回恶意或异常结果            | 只接收当前会话首个合法结果；500 code point 限制        | J/R/E   | 部分               |
| PR-12 | Activity handler 支持识别但不支持 `zh-CN`   | 报 `language-not-supported` 或 `no-speech`，不误报权限 | R/E/D   | 缺失               |
| LO-01 | `zh-CN`、`zh_Hans_CN`、`cmn-Hans-CN`        | 可匹配大陆普通话模型                                   | J       | 已覆盖部分         |
| LO-02 | `zh-Hant-TW/HK` 与 `zh-Hans-CN`             | 显式脚本或地区冲突时不得误判为已安装                   | J       | 已覆盖部分         |
| LO-03 | 通用 `zh`/`cmn` 模型                        | 可服务匹配的地区请求，但诊断保留实际 locale            | J       | 部分               |
| LO-04 | 空、空白、畸形或超长 locale                 | 规范化为受控默认或拒绝，不传递到 Provider              | J/R     | 缺失               |
| LO-05 | Provider 返回大小写、下划线和重复 locale    | 确定性去重并正确归类                                   | J       | 缺失               |

## 6. 权限、硬件、隐私开关与网络矩阵

| ID    | 条件                                           | 预期                                                                         | 自动化 | 真机    |
| ----- | ---------------------------------------------- | ---------------------------------------------------------------------------- | ------ | ------- |
| PM-01 | direct 路径，首次询问后允许                    | 只询问一次，进入 STARTING                                                    | J/R/E  | D       |
| PM-02 | direct 路径，拒绝但可再问                      | `permission-denied`，允许明确重试                                            | J/R/E  | D       |
| PM-03 | direct 路径，永久拒绝/策略限制                 | `permission-blocked`，只提供设置或文字入口                                   | J/R/E  | D       |
| PM-04 | 系统 Activity 路径，App 权限拒绝               | 不请求 App 权限，仍可打开系统输入                                            | J/R/E  | D       |
| PM-05 | 请求权限时没有前台 Activity                    | 有界返回暂时拒绝，不标记永久 blocked                                         | J/R/E  | D       |
| PM-06 | 权限弹窗期间旋转、Activity 重建或 Host destroy | Promise 有界结束；下次可重新请求                                             | R/E    | D       |
| PM-07 | Android 12+ App 权限 granted、全局麦克风关闭   | 识别为 `PRIVACY_DISABLED`，不误报服务不兼容                                  | R/E    | D，必测 |
| PM-08 | 没有麦克风硬件                                 | direct Provider 不可开始；系统 Activity 可独立评估                           | S/R/E  | D       |
| PM-09 | 通话、录音 App 或音频路由占用麦克风            | `audio`/`busy`，释放资源并允许稍后重试                                       | R/E    | D       |
| PM-10 | 一次性权限或权限自动重置                       | 每次开始前重新读取事实，不使用缓存权限                                       | R/E    | D       |
| NW-01 | 未给予本次联网授权                             | 所有 `mayUseNetwork` Provider 都不可启动                                     | J/R    | D       |
| NW-02 | 用户点击系统语音输入                           | 授权仅作用于新会话；UI 清楚说明可能联网                                      | J/R/E  | D       |
| NW-03 | 已授权但设备离线                               | `network`，保留可用 partial，文字入口可用                                    | J/R/E  | D       |
| NW-04 | 计费网络、门户网络、VPN/私有 DNS 异常          | 不循环重试、不偷偷切换 Provider                                              | J/E    | D       |
| NW-05 | `EXTRA_PREFER_OFFLINE=true`                    | 不把该 hint 当作离线证明；只有 on-device Provider 可标 `mayUseNetwork=false` | S/J    | D       |

## 7. 生命周期、并发与超时矩阵

| ID    | 场景                                     | 预期                                               | 自动化 | 当前覆盖           |
| ----- | ---------------------------------------- | -------------------------------------------------- | ------ | ------------------ |
| LC-01 | 双击开始或两个 Controller 并发开始       | native 单飞；第二个请求稳定返回 busy               | J/R    | TS 部分            |
| LC-02 | capability 探针并发                      | 共用或拒绝第二个探针；临时 recognizer 恰好销毁一次 | R      | 缺失               |
| LC-03 | 模型下载并发                             | 同 locale 单飞；每个 Promise 至多完成一次          | R      | 缺失               |
| LC-04 | 权限请求并发                             | 第二个请求 busy；原请求有超时和生命周期清理        | R/E    | owner/超时已覆盖   |
| LC-05 | direct 会话 Host pause                   | 发出 cancelled，销毁 recognizer，旧回调失效        | J/R/E  | 部分               |
| LC-06 | 系统 Activity 打开导致 Host pause        | 保持该会话；返回结果后清 gate                      | R/E    | 部分               |
| LC-07 | 系统 Activity 不返回或回调丢失           | Host resume 时对账或超时清 gate，不能永久 busy     | R/E/D  | JVM 已覆盖，待 E/D |
| LC-08 | React Native invalidate/Host destroy     | 取消会话、权限请求、探针、下载和所有 timeout       | R/E    | 部分               |
| LC-09 | 进程被系统杀死后冷启动                   | 不恢复旧会话；新会话可立即开始                     | E      | D                  |
| LC-10 | stop 后 Provider 不返回 final            | 8 秒 result watchdog 终止并释放                    | J/R/E  | watchdog 已有      |
| LC-11 | Provider 从不 ready                      | 12 秒 starting watchdog 终止并释放                 | J/R/E  | watchdog 已有      |
| LC-12 | 长时间无有效语音                         | 35 秒 listening watchdog 终止并释放                | J/R/E  | watchdog 已有      |
| LC-13 | 权限回调永不返回                         | 产品上限内终止，不永久停在 PERMISSION              | J/R/E  | 20 秒超时已实现    |
| LC-14 | capability/model bridge Promise 永不返回 | 5/10 秒内终止；迟到回调无效                        | J/R    | native 部分        |

系统 Activity 的可见交互时间可以由用户决定；App 回到前台且结果仍 pending 时启动 5 秒对账宽限，随后必须释放 gate，不得无限占用。

## 8. 回调乱序与状态机矩阵

允许的主路径：

```text
IDLE
  -> CHECKING
  -> PERMISSION?
  -> STARTING
  -> LISTENING
  -> PROCESSING
  -> SUCCEEDED | ERROR | CANCELLED
```

允许从活动阶段直接进入任一终态；不允许从后续阶段回到先前阶段。

| ID    | Provider 回调序列                            | 预期                                    | 自动化 | 当前覆盖      |
| ----- | -------------------------------------------- | --------------------------------------- | ------ | ------------- |
| EV-01 | ready → beginning → partial → end → final    | 正常成功，final 消费一次                | J/R    | 部分          |
| EV-02 | final 重复两次                               | 第二次忽略                              | J/R    | TS 已覆盖     |
| EV-03 | cancel 后旧 session final                    | 忽略，不记账                            | J/R    | TS 已覆盖     |
| EV-04 | end/PROCESSING 后迟到 ready 或 beginning     | 保持 PROCESSING，不回退 LISTENING       | J/R    | TS/JVM 已覆盖 |
| EV-05 | PROCESSING 后迟到 partial                    | 不更新可提交文字，不重置 final watchdog | J/R    | TS 部分       |
| EV-06 | error 后 final、final 后 error               | 第一个终态获胜，另一个忽略              | J/R    | 缺失          |
| EV-07 | partial/final 只有空白                       | `no-speech`，不进入解析                 | J/R    | 部分          |
| EV-08 | 500/501 Unicode code point、代理对、组合字符 | 500 接收，501 拒绝；TS/Kotlin 语义一致  | J/R    | 部分          |
| EV-09 | Provider 不发送 ready，直接 partial/final    | 可前进成功；不依赖可选回调              | J/R    | 缺失          |
| EV-10 | Provider 只发 onError，无 onEnd              | 唯一 ERROR 终态并释放                   | J/R    | 部分          |
| EV-11 | 旧 generation 回调命中相同 sessionId         | native generation 拦截                  | J/R    | gate 部分     |
| EV-12 | event metadata 缺失、未知枚举、错误数字      | 保守归一化，不崩溃、不启用联网          | J      | 部分          |

当前实现使用单调阶段转换：`PROCESSING` 后迟到的 `ready`、`beginning` 或 `partial` 不得令 native 或 TypeScript 状态倒退，旧会话事件也不得更新新会话。

## 9. Android 错误码契约

必须对当前 SDK 的全部 `SpeechRecognizer` 错误做表驱动测试，而不是只覆盖用户曾经遇到的错误。

| Android 错误                                                                          | 本地业务错误                                          | 默认恢复                                  |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| `ERROR_NETWORK_TIMEOUT`、`ERROR_NETWORK`、`ERROR_SERVER`、`ERROR_SERVER_DISCONNECTED` | `network`                                             | 同路径手动重试；不得自动扩大联网范围      |
| `ERROR_AUDIO`                                                                         | `audio`                                               | 释放资源，提示检查通话/占用/隐私开关      |
| `ERROR_CLIENT`                                                                        | `cancelled` 或 `service-incompatible`，取决于当前阶段 | 不应一律映射可重试 unknown                |
| `ERROR_SPEECH_TIMEOUT`、`ERROR_NO_MATCH`                                              | `no-speech`                                           | 同路径重试                                |
| `ERROR_RECOGNIZER_BUSY`、`ERROR_TOO_MANY_REQUESTS`                                    | `busy`                                                | 退避后由用户重试                          |
| `ERROR_INSUFFICIENT_PERMISSIONS` 且 App 权限未授予                                    | `permission-denied/blocked`                           | 重新授权或设置                            |
| `ERROR_INSUFFICIENT_PERMISSIONS` 且 App 权限已授予                                    | `privacy-disabled` 或 `service-incompatible`          | 先识别全局麦克风事实，再考虑系统 Activity |
| `ERROR_LANGUAGE_NOT_SUPPORTED`                                                        | `language-not-supported`                              | 改用明确授权的系统路径或文字              |
| `ERROR_LANGUAGE_UNAVAILABLE` + on-device                                              | `model-missing`                                       | 明确下载或系统路径                        |
| `ERROR_LANGUAGE_UNAVAILABLE` + system                                                 | `language-not-supported`                              | 文字入口                                  |
| `ERROR_CANNOT_CHECK_SUPPORT`                                                          | `model-status-unknown`                                | 不伪装 READY；允许受控探测                |
| `ERROR_CANNOT_LISTEN_TO_DOWNLOAD_EVENTS`                                              | `DOWNLOADING` 或明确下载失败                          | 使用无监听下载路径，Promise 只完成一次    |
| 未知未来错误                                                                          | `unknown`                                             | 保守、可诊断、不得自动联网                |

错误事件必须保留 `stage/provider/route/modelState/nativeCode/retryable`，但用户文案不得直接显示 native 异常文本。

## 10. 自动化契约清单

### 10.1 TypeScript 纯状态机

- `TS-ST-01`：用允许转移表拒绝所有倒退和终态后的事件。
- `TS-ST-02`：对所有事件类型生成排列，验证 final 至多交付一次。
- `TS-ST-03`：cancel/dispose/新会话后，旧 session 的 state/partial/final/error 全部无效。
- `TS-ST-04`：Provider 选择表覆盖三条 route、五种模型状态和联网授权真假值。
- `TS-ST-05`：`mayUseNetwork=true` 与未授权的组合永远不能调用 native start。
- `TS-ST-06`：permission 的五种状态映射到稳定错误与正确按钮。
- `TS-ST-07`：capability、permission 和 start Promise reject/永不完成时有界退出。
- `TS-ST-08`：500/501 code point、emoji、组合字符、NFKC 和空白输入一致。
- `TS-ST-09`：malformed native payload、未知枚举和缺失 metadata 保守归一化。
- `TS-ST-10`：显式系统输入授权只应用于新会话，不改变默认本地优先策略。

### 10.2 Kotlin/JVM 纯策略

- `KT-POL-01`：API 24–36 能力输入表，拆分 service presence 与 locale readiness。
- `KT-POL-02`：三 Provider 全组合的引擎选择和隐私不变量。
- `KT-POL-03`：所有 Android error code × engine × permission × consent 的表驱动映射。
- `KT-POL-04`：BCP-47 locale 匹配、脚本/地区冲突、空值和畸形值。
- `KT-POL-05`：会话 phase/generation 的单调转换与迟到回调拒绝。
- `KT-POL-06`：watchdog token 在重置、重入、旧 generation 和竞态下不可误消费。
- `KT-POL-07`：系统 Activity gate 超时、cancel、错误 requestCode、重复结果和新会话。
- `KT-POL-08`：权限、capability 和模型下载 single-flight gate。
- `KT-POL-09`：所有 Promise 的 success/reject/timeout 至多完成一次。
- `KT-POL-10`：录音正文不进入日志和诊断 payload。

### 10.3 Robolectric/Instrumentation

- `AN-CT-01`：PackageManager 注入无服务、仅 Activity、仅 direct、两者都有。
- `AN-CT-02`：API 31/32 on-device service 存在且 readiness 不可查询。
- `AN-CT-03`：API 33 support callback 的 installed/supported/pending/empty/error/timeout。
- `AN-CT-04`：API 34 download callback 的 success/scheduled/error/timeout/迟到回调。
- `AN-CT-05`：permission grant/deny/block、无 Activity、Activity 重建和 invalidate。
- `AN-CT-06`：Android 12+ 全局麦克风开关和无麦克风硬件。
- `AN-CT-07`：Activity result 成功、取消、空、超长、重复、错误 requestCode 和不返回。
- `AN-CT-08`：RecognitionListener 的正常、缺失、重复和乱序回调序列。
- `AN-CT-09`：每条终止路径都验证 recognizer `cancel/destroy` 次数和 active gate 清理。
- `AN-CT-10`：Manifest 合并后仍含两条 speech `<queries>`，且 internal 不含 App 自用 INTERNET 权限。

### 10.4 CI 门禁

每次 speech 相关 PR 必须通过：

```text
TypeScript speech controller + UI tests
Kotlin policy/watchdog/activity-gate tests
API 24、30、31、32、33、34、36 emulator contract tests
Manifest queries / permission / INTERNET static assertions
Internal arm64 assemble + Android JVM tests
```

API 31、32、33、34 不能只选一个代表版本，它们对应三套不同的本地模型能力。

## 11. 真机样本矩阵

品牌只用于获得不同系统组件组合，断言始终基于能力事实。每次记录：设备、Android API、系统构建、App build、默认识别 Provider、Activity/direct/local 是否存在、locale readiness、权限、全局麦克风、网络条件、最终 route、错误码和耗时。不得记录完整语音正文。

| 真机样本   | 最低覆盖目的                         | 必测能力场景                                             |
| ---------- | ------------------------------------ | -------------------------------------------------------- |
| Pixel      | AOSP/Google 基线与最新 API           | local ready/missing、模型下载、全局麦克风、系统 Activity |
| 三星       | 不同系统识别组件与权限 UI            | direct/Activity 解析、权限永久拒绝、生命周期             |
| 小米/Redmi | 不同后台和权限管理实现               | Host pause/resume、全局麦克风、Provider busy             |
| OPPO       | 系统 Activity 与 direct service 组合 | granted 但 direct 拒绝、Activity 降级、取消返回          |
| 一加       | 与 OPPO 代码基线下的独立设备样本     | 同一能力断言，不共享品牌特判                             |
| vivo       | 不同默认识别 Provider                | 无本地模型、仅系统输入、离线网络                         |
| 荣耀       | 非 Google 默认组件组合               | Provider 缺失/切换、中文 locale                          |
| 华为       | 可无 GMS 的系统组件组合              | 无 Google 服务时安全降级、系统 Activity 可用性           |

每个发布候选至少满足：

- API 31/32 真机至少 1 台；
- API 33/34 真机至少 1 台；
- API 35/36 真机至少 1 台；
- “本地模型 ready”“本地模型 missing/unknown”“只有系统 Activity”“没有可用识别服务”四种能力组合均有证据；
- 至少 2 个不同系统组件家族完成权限拒绝、全局麦克风关闭、取消、离线和重复开始测试。

## 12. 真机验收步骤与证据

1. 全新安装 internal 包，记录 build、API 和系统构建。
2. 在未授予麦克风权限时进入语音页；确认 App 不自动弹权限、不自动联网。
3. 点击本地语音，依次验证允许、拒绝、永久拒绝。
4. Android 12+ 关闭全局麦克风，保持 App 权限 granted，验证错误分类和恢复动作。
5. 验证本地模型 ready、missing/downloadable/unknown；下载只能由按钮触发。
6. 在飞行模式和正常网络分别验证本地路径；本地路径不得依赖网络成功。
7. 点击系统语音输入，验证明确授权、取消、空结果和正常结果。
8. 监听中切后台、锁屏、旋转、返回、杀进程，再回到 App 开始新会话。
9. 连续快速点击开始/停止/取消，确认无永久 busy、无重复卡片和无崩溃。
10. 验证结果只进入确认卡片，不保存录音；诊断记录不包含完整正文。

证据包应包含勾选矩阵、屏幕录制或截图、脱敏日志和失败时的稳定诊断字段。只写“某品牌可用”不构成验收证据。

## 13. 当前风险与优先级

已关闭并加入回归测试的结构性问题：API 31–32 `UNKNOWN` 本地路径不可达、状态从 `PROCESSING` 倒退、系统 Activity 永久 busy、权限请求永久悬挂、旧 controller 销毁新会话，以及把全局麦克风关闭误报为 App 权限问题。

| 优先级 | 剩余风险                                                            | 发布影响                                  |
| ------ | ------------------------------------------------------------------- | ----------------------------------------- |
| P1     | capability/model 临时 recognizer 尚未统一为完整 single-flight owner | 极端并发下仍需 instrumentation 验证       |
| P1     | 部分未来 Android error code 只能保守归为 `unknown`                  | 新 Provider 错误需要按稳定诊断码继续扩充  |
| P1     | 缺 API 31/32/33/34 instrumentation 与足够的真机证据                 | 不能仅凭单元测试宣称所有 Android 设备通过 |
| P2     | 当前 Internal APK 只含 `arm64-v8a`                                  | 仅影响旧 32 位测试机，不影响架构本身      |

因此当前可以进入跨设备真机回归，但只有完成第 11–12 节证据矩阵的设备组合，才可被标记为“已验证兼容”；不能用一个品牌或一台手机代表全部 Android 设备。

## 14. 权威依据

- [SpeechRecognizer API](https://developer.android.com/reference/android/speech/SpeechRecognizer)：main-thread、`destroy()`、错误码、API 31 on-device 入口与 Android 11 package visibility 要求。
- [RecognitionSupport API](https://developer.android.com/reference/android/speech/RecognitionSupport)：API 33 起 installed/supported/pending/online locale 语义。
- [RecognizerIntent API](https://developer.android.com/reference/android/speech/RecognizerIntent)：`EXTRA_PREFER_OFFLINE` 和 partial 等 extra 可能被实现忽略。
- [Package visibility：连接 speech recognition service](https://developer.android.com/training/package-visibility/use-cases#speech-recognition-service)。
- [Android 12 microphone toggle](https://developer.android.com/about/versions/12/behavior-changes-all#mic-camera-toggles)：全局麦克风开关独立于 App 权限。
- [解释敏感权限访问](https://developer.android.com/training/permissions/explaining-access)：检查麦克风开关支持与用户恢复路径。
