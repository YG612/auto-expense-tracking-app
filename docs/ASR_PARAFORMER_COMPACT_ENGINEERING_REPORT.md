# Paraformer Compact 工程验证报告

更新时间：2026-08-21（Asia/Shanghai）

## 当前状态

`ASYM_FULL_ALL_OFFLINE_OPTIMIZED_READY_FOR_USER_TEST`

## 全离线单模型优化构建（2026-08-21）

按当前真机主观测试结果，构建了只内置 `asym-full` Paraformer、但保留其余全部离线能力的
Internal 测试版。该版本没有删除离线中文 OCR、账单分类、文本纠正、本地词典或隐私保护功能；
仅从最终 APK 移除了五个不再需要同时分发的语音 A/B 模型，并对 Java/Kotlin、资源和 JS bundle
执行发布级 R8/资源收缩。六模型实验室 APK 仍单独归档，可随时恢复安装。

| 项目 | 结果 |
| --- | --- |
| 语音模型 | `asym-full`，45,137,197 字节（43.05 MiB，无损 Gzip 分发流） |
| 最终 APK | 71,702,000 字节（68.38 MiB） |
| APK SHA-256 | `e5d022a51334bac0983757ccb949f7585e0db67f46c05592892f55a0f77eb6ff` |
| 包名 / 版本 | `com.qingjiai.internal` / `1.0.7-internal`（versionCode 8） |
| ABI | 仅 `arm64-v8a` |
| 归档路径 | `E:\CodexData\Models\QingJiAI\paraformer-compact-work\android-artifacts\app-internal-asym-full-all-offline-optimized.apk` |
| R8 mapping | `E:\CodexData\Models\QingJiAI\paraformer-compact-work\android-artifacts\app-internal-asym-full-all-offline-optimized-mapping.txt` |

APK 静态门禁确认只含一份语音模型和一份 ONNX Runtime，同时仍含 OCR 原生库、25 项中文 OCR
资源以及 20 项账单分类资源；无 `INTERNET`/`ACCESS_NETWORK_STATE` 权限，通过签名、单 ABI、
Runtime 唯一性和 16 KiB zip 对齐检查。相对原始 Paraformer APK 的 125.11 MiB，减少约
56.73 MiB（45.34%）；相对 377.44 MiB 六模型实验室包减少 309.06 MiB。

构建命令为 `pnpm android:verify:paraformer-asym-full-optimized:windows`，Android JVM 测试、
R8、资源收缩和 APK 完整性门禁全部成功；TypeScript 类型检查、ESLint 以及 86 个 Jest suite、
635 项测试也全部通过。最终 APK 已覆盖安装到 OnePlus 9R，保留应用数据，进程和主 Activity
启动正常。真实语音与 OCR 内容测试仍由用户在真机完成，本报告不据静态检查伪造识别结论。

首次 68.36 MiB 产物的静态资源检查虽然通过，但真机显示没有离线模型。根因是 R8 删除了只由
`Class.forName` 发现的 `StreamingOnnxSpeechEngineFactory`，使带模型的构建被误判成普通无模型
构建；随后用户明确选择系统语音时，Android 直接在后台调用 `SpeechRecognizer`，因此不会弹出
Google Activity。现已显式保留两个可选离线工厂及其构造器，并新增 mapping 构建门禁。修复版
覆盖安装后，真机日志确认 `Streaming speech runtime verification succeeded`，智能记账页不再出现
模型缺失提示且“开始语音”可用。旧的缺陷归档已被修复版覆盖。

真机短句“坐车花了四十五块钱支付宝”进一步暴露出文本事件分句缺陷，而非 ASR 退化：完整
转写被 `付了?` 事件锚点从“支付宝”内部切成“坐车花了四十五块钱支”和“付宝”，从而错误
生成两张候选卡。现已在分句阶段保护完整的“支付宝”和“微信支付”上下文，同时允许渠道词
之后真正独立的“支付”继续作为动作证据。新增无标点普通话回归覆盖当前短句、微信支付以及
“支付宝支付十八元”，均只生成一笔且金额、账户正确。卡片中的“识别原文”也已更名为
“本笔解析片段”，避免把分句结果误报成完整 ASR 原文。最终 639 项 Jest 测试、类型检查、
ESLint、Android JVM 测试和完整 APK 门禁通过，修复版已覆盖安装；真机再次确认离线 Runtime
预热成功且“开始语音”可用。

已新增一个把六个可加载 ONNX 候选同时内置的 Internal 模型实验室 APK。智能记账语音区会
显示模型名称、压缩体积和当前选中项；仅在未录音、未解码时允许切换，但模型检查或预热期间
仍可选择其他模型作为恢复入口。选择持久化在本机，
后台线程负责解压、逐字节/SHA-256 校验和预热，已经解压过的模型直接复用。每次能力响应和
识别事件均携带 `speechModelId`，便于记录 A/B 结果。普通构建、原 Paraformer 构建和原先的
98.87 MiB 单 RTN 候选 APK 均继续保留。

模型实验室 APK：

| 项目 | 结果 |
| --- | --- |
| 内置模型 | baseline INT8、RTN safe、HQQ safe、三档非对称 INT4，共 6 个 |
| 模型压缩流合计 | 355,596,944 字节（339.12 MiB） |
| APK | 395,774,844 字节（377.44 MiB） |
| APK SHA-256 | `bf22405149823b68963a5786cdc744e5be2314e709df12140612d4093e8bb3b0` |
| 归档路径 | `E:\CodexData\Models\QingJiAI\paraformer-compact-work\android-artifacts\app-internal-paraformer-model-lab.apk` |

最终 Runtime AAR 为 4,928,955 字节，SHA-256
`6a179b0f4f6c40347e35afc6312067218b865c953f75a3fcf597a8385878d4a7`。其 required-operator
配置由六个源图联合生成，并补充 ORT 优化器实际生成的 opset 14/17/21 与
`DynamicQuantizeMatMul`、`MatMulIntegerToFloat`、`FusedConv`、`FusedMatMul`、
`SkipLayerNormalization` 闭包。

该最终 APK 已覆盖安装到 OnePlus 9R，保留原应用数据；安装后仍保持用户原先选择的
`rtn-safe`，真机预热日志为 `Streaming speech runtime verification succeeded`。UI 自动化层级检查
确认当前 RTN 选中，而“原始 Paraformer INT8”按钮为 `enabled=true`，未自动替用户切换模型。
其余模型的选择和主观准确率测试按用户要求交由用户逐项判断。

该大包只用于一次安装后对六个模型做真机横向测试，不是最终发布包。最终确认模型后仍使用
单模型轨道恢复约 100 MiB 或更小的发布体积。ORT 格式候选因 sherpa 当前不兼容，没有放入
可切换目录，但原文件继续保留在 E 盘。

当前主候选为“敏感层保留 INT8/FP32、80 个安全 MatMul 使用对称 RTN INT4”的
Paraformer。它保持原 8359 词表、7×80 LFR、CMVN、CIF 和 greedy decode，并已在
FLEURS validation/test、固定数字子集和官方 WAV 上达到无可测准确率退化。

模型以无损 Gzip 流随 APK 分发，Android 首次使用时解压到 no-backup 私有目录，并验证
解压字节数和 SHA-256 后原子替换。这样不改变 ONNX 数值，最终 Internal APK 为
103,677,646 字节（98.87 MiB），低于 100 MiB。

真机第一次加载暴露出 reduced-operator 配置只扫描源图、未覆盖 ORT 初始化期间的 ONNX
函数体和优化器辅助算子：先缺少 `Size(21)`，补齐后继续暴露 `Flatten(21)`。构建脚本现已
显式加入完整基础函数体及优化器辅助算子闭包并重建 Runtime；最终 Runtime 已在真机完成
baseline 和 RTN 预热验证。候选不标记为 promoted，仍等待用户完成主观语音 A/B。

## 现场问题修复（2026-08-21）

用户反馈无法切回原始模型，且其他模型频繁显示“没有听清有效内容”。定位到两个独立工程问题：

- UI 把 `PREPARING_MODEL` 和 `CHECKING_AVAILABILITY` 也当成禁止切换状态，当前候选预热慢或
  失败时会把所有恢复入口锁住；同时 native 返回的 `busy` 错误被 Promise `catch` 静默丢弃。
- 自适应能量 VAD 的设计本应仅用于波形、音质和停顿提示，但手动停止时错误地用
  `hasDetectedSpeech()` 作为解码硬门禁。安静人声、OEM 降噪或麦克风差异造成 VAD 漏检时，
  Paraformer 尚未获得音频结束解码机会就直接返回 `no-speech`。

修复后，检查/预热期间仍允许明确选择其他模型；选中项在 native 持久化后立即更新，模型预热
在后台继续；真实切换失败会显示可操作的中文原因。手动停止则始终执行 `inputFinished()` 并
排空 Paraformer 解码器，VAD 不再阻断识别；只有模型实际返回空文本才报告 `no-speech`。
日志仅记录模型 ID 和脱敏音质统计，不包含 PCM 或转写内容。

## 主候选与 APK

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| RTN INT4 ONNX | 72,355,603 | `39cd81e97e74705900569ecd1d0d27d58e9855b6cb451bce2e8c1b2d30dc3782` |
| 无损 Gzip 分发模型 | 63,510,652 | `9ae585e851047a5d896591a2f0c9e7f51d0d16f42f6495ee812409be3fab3583` |
| arm64 compact Runtime AAR | 4,885,468 | `36ef81dec15141dd31dce29669349987c443a069f6a1d036b134f2a8363e49b4` |
| required-operator 配置 | — | `7207a383dc6f10b0dc051593ed1a13c26ed40307d62b2afaf48029a8ac15b8eb` |
| Internal 测试 APK | 103,677,646 | `55f59e1b89f39f1ea9e7de1ec844934f735099799446027b9d86120a7bb3b78f` |

APK 已归档到：
`E:\CodexData\Models\QingJiAI\paraformer-compact-work\android-artifacts\app-internal-paraformer-compact-rtn-safe.apk`。

最新 Runtime 包含单一 `arm64-v8a` ABI、CPU EP、`libonnxruntime.so` 和
`libsherpa-onnx-jni.so`，通过 9 MiB、单 Runtime 和 16 KiB ELF 对齐门禁。APK 通过签名、
无联网权限、模型/Runtime 唯一性、许可证和 SBOM 检查。

## 主候选准确率

| 指标 | 原 Paraformer INT8 | RTN compact | 结果 |
| --- | ---: | ---: | --- |
| validation CER（409 条） | 11.7116% | 11.0327% | 改善 |
| validation 数字 CER | 13.0126% | 11.8820% | 改善 |
| validation 数字完全匹配 | 174/254 | 175/254 | 改善 |
| FLEURS test CER（945 条） | 11.7355% | 11.3934% | 改善 |
| test 数字 CER | 12.9902% | 12.4935% | 改善 |
| test 数字完全匹配 | 402/630 | 403/630 | 改善 |
| 固定 618 条数字子集 CER | 12.9485% | 12.4464% | 改善 |
| 固定 618 条数字完全匹配 | 396/618 | 396/618 | 持平 |
| 官方 0/1/8k WAV | — | 逐条相同 | 通过 |

主机 945 条解码时间从 131.448 秒变为 154.011 秒（+17.16%）。该数值不能代替 ARM
真机延迟，最终体验由用户在真机 A/B 中判定。

## 全部保留的替代路线

以下产物均保留在 E 盘，不覆盖主候选，也不因自动评测结论而删除。

| 路线 | 原始字节数 | Gzip 字节数 | 自动评测结论 |
| --- | ---: | ---: | --- |
| HQQ 安全 80 节点 | 73,180,485 | 64,611,962 | validation 改善，但主机解码约慢 48%，保留供真机测试 |
| 非对称 RTN：FFN | 63,584,888 | 55,101,450 | validation 改善；test CER/数字均轻微退化，保留 |
| 非对称 RTN：FFN+decoder | 61,718,939 | 52,891,738 | validation 改善；test CER/数字均轻微退化，保留 |
| 非对称 RTN：再加 attention | 55,360,963 | 45,137,197 | 最小；test CER、数字和延迟退化，保留 |
| ORT 格式 RTN | 72,420,536 | 63,884,249 | 比 ONNX 略大，当前 sherpa 加载不兼容，保留 |
| 主机优化 ONNX 实验 | 71,442,390 | 未作为分发物 | 含平台相关优化，不替换 ARM 主候选，保留 |

主要文件：

- RTN 主候选：`E:\CodexData\Models\QingJiAI\paraformer-compact-work\combined-safe\smallest-sensitivity-safe\model.int4.onnx`
- HQQ：`E:\CodexData\Models\QingJiAI\paraformer-compact-work\hqq-safe\model.hqq-int4.onnx`
- 三档非对称候选：`E:\CodexData\Models\QingJiAI\paraformer-compact-work\asym-candidates`
- ORT 格式：`E:\CodexData\Models\QingJiAI\paraformer-compact-work\ort-format\model.int4.ort`
- 优化图实验：`E:\CodexData\Models\QingJiAI\paraformer-compact-work\runtime\model.int4.optimized.onnx`
- 完整选择记录：`E:\CodexData\Models\QingJiAI\paraformer-compact-work\evaluation\compact-selection.json`

## 已实现的端侧工程

- `streamingAsrEngine=onnx-paraformer-compact` 仅允许 Internal + arm64-v8a。
- sherpa `OfflineRecognizer_newFromFile` 使用固定 JNI 补丁捕获原生异常并转换为 Java
  `RuntimeException`，使模型或 Runtime 不兼容时进入 fail-closed UI，而不是终止进程。
- 进程内常驻一个 `OfflineRecognizer`，每轮只创建/释放 `OfflineStream`，串行解码。
- 页面后台预热；后台内存压力时释放，返回后重新预热。
- 保留 generation、resultToken、取消、超时、迟到回调隔离和唯一 final。
- `VOICE_RECOGNITION` 优先、`MIC` 回退；NoiseSuppressor 可用即启用，失败安全回退。
- 自适应 VAD 只给“似乎说完了”提示，不自动提交，也不再作为解码硬门禁；约 13 Hz 发送
  脱敏音量状态。
- UI 不伪造 partial；分别提示准备、录音、长停顿、识别、无语音、削波和高噪声。
- 本地纠正层保持原文、最长匹配、冲突不改、数字逐字保护和完整审计。

## 工程门禁

- TypeScript、ESLint：通过。
- Jest：86 suites、644 tests 通过（含预热期恢复切换、切换失败可见性、支付渠道分段和
  目的地/商户消歧回归测试）。
- Node ASR 评分器：13/13 通过。
- Android Internal compact JVM 测试：通过。
- 单 RTN compact APK：构建和静态门禁通过，98.87 MiB，继续保留。
- 六模型实验室 APK：Android JVM 测试、离线构建、六模型 hash/唯一性、单 arm64
  Runtime、签名、无联网权限、许可证/SBOM 和 16 KiB 对齐门禁通过，377.44 MiB。
- 真机旧 Runtime：确认模型成功解压且 SHA 完全一致；先后定位 `Size(21)`、
  `Flatten(21)` 缺失，不是模型损坏或压缩误差。
- 真机最终 Runtime：baseline 与当前 RTN 均加载通过；原始模型按钮确认可用。六模型主观
  语音 A/B、60 条同 PCM A/B、热启动、p95 和 RSS 交由用户最终测试。

任务完成后保持开机。

## 语音交易商户消歧修复（2026-08-21）

真机语句“去北京花了三十五块钱支付宝”的识别、金额和账户均正确，但商户被错误填为
“北京”。根因不在 Paraformer，而是交易对手规则把 `去/到/在 + 任意名称 + 花了` 一律当作
消费场所；同时兜底商户规则重复了同一推断。

现已在结构化交易对手入口和兜底入口同时增加保守消歧：`去/到/在 + 纯目的地 + 花了` 不再
产生商户；带“店、馆、餐厅、面馆、商场”等明确场所后缀的名称仍保留；内置品牌、本机商户
别名和用户规则仍按更高优先级保留。固定回归覆盖阿拉伯数字和 ASR 常见中文数字文本，并验证
“老王面馆”及用户词典中的“麦当劳”不会被误删。

本次门禁结果：TypeScript、ESLint、86 个 Jest suites / 644 tests、Android Internal JVM
测试、R8 和最终离线 APK 审计全部通过。新 `asym-full` 单模型 APK 为 71,704,124 字节
（68.38 MiB），SHA-256
`a3fa42303404fed5e4bf38e58014e3015d870b0d6746414afdbcc1dcf8ccb58b`，归档路径：
`E:\CodexData\Models\QingJiAI\paraformer-compact-work\android-artifacts\app-internal-asym-full-all-offline-optimized.apk`。
该 APK 已覆盖安装到 OnePlus 9R 且保留应用数据，智能记账页打开正常，真机日志确认
`Streaming speech runtime verification succeeded`。实际麦克风重说结果仍由用户确认。
