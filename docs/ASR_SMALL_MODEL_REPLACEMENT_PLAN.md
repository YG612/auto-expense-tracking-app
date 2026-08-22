# 小体积中文 ASR 替换实施方案

状态：`READY_FOR_IMPLEMENTATION`

目标版本：Android Internal 实验轨道，尚不进入 Production

更新时间：2026-08-21

## 1. 决策摘要

当前 `ncnn` 与 `onnx` 实验轨道都使用
`sherpa-*-streaming-zipformer-zh-14M-2023-02-23`。两条轨道只更换推理运行时，
没有更换模型，因此无法用运行时切换解决基础中文频繁识别错误。

下一轮采用以下决策：

1. 保留 App 自持 `AudioRecord`、手动“说完了”、会话代际、单次结果消费和
   无网络安全边界。
2. 新增独立的 `onnx-ctc-small` 候选轨道，首选模型为
   `sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01`。
3. 候选模型约 25 MiB，只支持中文；它必须与当前 14M 模型在同一批真实失败录音上
   A/B，不能因发布时间较新或官方样例正常而直接替换。
4. `Paraformer-zh-small INT8`（约 79 MiB）只作为第二阶段可选离线语音包候选，
   不进入基础 APK，也不与第一阶段同时集成。
5. 当前模型在候选通过全部门禁前不得删除；候选失败时普通 Internal、Production、
   Debug 和 iOS 行为保持不变。

## 2. 成功标准与非目标

### 2.1 第一阶段成功标准

- 模型资产不超过 30 MiB。
- 最终 Internal 候选 APK 不超过 80 MiB，且相对普通 arm64 Internal 的增量不超过
  55 MiB。
- 不声明 `INTERNET` 或 `ACCESS_NETWORK_STATE`。
- 只包含 `arm64-v8a`，所有原生库继续满足 16 KiB ELF 对齐要求。
- 清晰语音 CER `<= 8%`，噪声语音 CER `<= 15%`。
- 金额序列 exact match `>= 98%`。
- 22 条财务 smoke 的全部数字序列 exact match 为 `100%`。
- 需要完整音频的样本不得提前结束。
- 用户停止到 final 的 P95 `<= 1.5 s`，遥测覆盖率为 `100%`。
- 最低目标设备峰值 PSS `<= 250 MiB`。
- 连续 100 次识别无崩溃、无卡死、无重复 final，结束后 PSS 不持续增长超过
  10 MiB。

任何一项失败，候选都不能替换当前默认路径。完整生产准入仍要求至少 300 条授权录音，
第一阶段的 22 条 smoke 和真实失败集只用于快速淘汰候选。

### 2.2 非目标

- 本阶段不实现云端 ASR。
- 本阶段不新增联网权限或模型在线下载。
- 本阶段不实现 iOS 自有离线模型。
- 本阶段不训练或微调模型。
- 本阶段不引入两遍式识别，也不集成 79 MiB/200 MiB 级模型。
- 本阶段不允许 ASR 结果跳过候选卡片、确认策略或 repository 校验。

## 3. 目标架构

```text
用户点“开始语音”
  -> PreferredSpeechRecognitionPort 选择完整 Provider
  -> EmbeddedSpeechRecognitionModule 获取会话所有权
  -> AudioRecord: 16 kHz / mono / PCM16
  -> StreamingZipformerSpeechEngine 管理采集、30 秒上限和手动停止
  -> SherpaOnnxCtcSmallRecognizerAdapter 执行流式 CTC 解码
  -> partial 只在屏幕显示
  -> 用户点“说完了”
  -> inputFinished + 排空 decoder
  -> 唯一 final
  -> SpeechRecognitionController 校验 session/generation/resultToken
  -> parseTextTransactions
  -> 候选卡片 / 待确认箱
  -> 用户确认后写入 SQLite
```

以下边界不得改变：

- `enableEndpoint = false`，模型静音端点不能结束记账会话。
- 30 秒安全超时、取消、切后台和销毁不能产生 final。
- PCM 只在原生内存中存在，不跨 React Native、不写文件、不上传。
- 候选模型损坏、缺失或加载失败时 fail closed，不得静默切换 OEM/system Provider。
- 普通无模型构建仍可由用户显式选择系统兼容路径。

### 3.1 借鉴输入法，但不复制输入法离线包

输入法的小包体通常不是“一个同等能力的超小模型”，而是以下因素叠加：模型量化与裁剪、
只带必要算子的原生运行时、领域词典和用户词典、按设备/语种拆包，以及在允许时用云端结果
掩盖本地模型的能力边界。本项目可以借鉴前四项，但第一阶段继续坚持完全离线，不能用联网
回退改善测试结果。

讯飞输入法或其他商业输入法的离线资源不能直接抽取、重新打包或依赖其私有进程：资源格式、
模型许可证、SDK 授权、应用签名和版本兼容都不可控。若后续评估商业离线 SDK，必须建立独立
候选轨道，取得明确的嵌入与分发授权，并使用同一套录音和门禁与自有方案比较。

### 3.2 输入法式分层瘦身架构

第一阶段将 ASR 载荷拆成四层，各层单独计量、锁定和回归：

| 层         | 内容                                     | 第一阶段策略                                           |
| ---------- | ---------------------------------------- | ------------------------------------------------------ |
| 声学模型   | 25 MiB INT8 中文 CTC                     | 先原样建立准确率基线，不立即做 INT4 或二次量化         |
| 推理运行时 | sherpa-onnx + ONNX Runtime 原生库        | 按确切模型算子生成裁剪版，仅保留 CPU、arm64 和必需 API |
| 领域资源   | 财务热词、类别、商户、支付渠道与易混淆词 | 本地、可版本化，目标不超过 2 MiB，硬上限 5 MiB         |
| 用户个性化 | 用户确认过的商户/类别词及权重            | 只存本机数据库，不进 APK、不上传、不训练共享模型       |

基础 APK、模型、原生运行时和领域资源必须分别报告大小。不得只用“模型 25 MiB”代表最终
包体，也不得把下载后的语音包排除在用户实际占用之外。优化目标是 ASR 在 APK 中的压缩后
增量不超过 45 MiB；产品硬门槛仍以第 2.1 节的 APK 总大小和 55 MiB 增量为准。

### 3.3 准确率保护原则

按以下顺序优化，每一步只改变一个变量：

1. 使用官方 INT8 模型和未裁剪的锁定 runtime 建立桌面及 Android 基线。
2. 只裁剪 runtime 的无关算子、执行提供程序、ABI、工具和测试代码；固定音频集的 transcript
   应与未裁剪 runtime 完全一致。
3. 加入项目自有的财务领域词表和上下文偏置，单独重跑普通文本、金额和真实失败切片。
4. 根据用户确认记录调整本地商户/类别候选排序；不得因此自动改写金额、日期、数量或账户。
5. 只有前四步仍不达标，才另立模型 ID 试验更激进量化、蒸馏或领域微调，并重新走完整门禁。

领域层首先验证锁定的 sherpa-onnx 版本和 CTC 模型是否支持上下文偏置。若不支持，第一阶段
只在交易解析的非数字字段提供保守候选，不把模糊匹配结果伪装成 ASR 原文，也不靠规则修补
数字准确率指标。

## 4. 构建轨道设计

保留现有参数，并新增一个明确名称，避免覆盖历史 A/B 基线：

| `streamingAsrEngine` | 作用                    | 状态 |
| -------------------- | ----------------------- | ---- |
| `ncnn`               | 当前 14M ncnn 基线      | 保留 |
| `onnx`               | 当前 14M ONNX 基线      | 保留 |
| `onnx-ctc-small`     | 新 25 MiB 中文 CTC 候选 | 新增 |

建议命令：

```powershell
pnpm android:streaming-ctc-small-asr:prepare:windows
pnpm android:streaming-ctc-small-asr:verify:windows
pnpm android:assemble:streaming-ctc-small-asr:windows
pnpm android:verify:streaming-ctc-small-asr:windows
```

候选只允许 `Internal + arm64-v8a`。对 Debug、Release、普通 Internal 使用该参数必须
立即失败。

## 5. 文件级改动清单

### 5.1 模型锁与准备脚本

新增：

- `android/app/src/internal/streaming-ctc-small-asr-lock.json`
- `scripts/prepare-android-streaming-ctc-small-asr.ps1`
- `scripts/build-android-streaming-ctc-small-runtime.ps1`
- `scripts/report-android-asr-artifact-budget.cjs`

锁文件至少固定：

- sherpa-onnx runtime 名称、版本、来源 URL、大小、SHA-256 和许可证；
- 模型归档 URL、归档大小、SHA-256 和许可证证据；
- `model.int8.onnx`、`tokens.txt`、`bbpe.model` 的大小与 SHA-256；
- runtime 支持的 ABI、必需 AAR 条目和禁止的额外 ABI；
- 模型目录 `speech/zipformer-small-ctc-zh-int8-2025-04-01`；
- 兼容的 runtime 版本与引擎类型 `zipformer2-ctc`。

准备脚本必须：

1. 只读取锁定缓存，不在构建期间联网。
2. 在复制前校验归档和 runtime 的大小与 SHA-256。
3. 解压到唯一临时目录，校验每个必需文件后再复制。
4. 生成包含 lock hash、runtime hash、model hash 和 engine type 的
   `prepared-assets.json`。
5. 失败时不留下半准备资产。
6. `-VerifyOnly` 不修改仓库或缓存。

优先验证当前锁定的 sherpa-onnx `1.13.2` 是否已包含 `Zipformer2 CTC` Kotlin API。
若不包含，再单独升级 runtime；不得顺带升级未验证的依赖。

runtime 构建脚本必须：

1. 从锁定的候选 ONNX/ORT 模型生成 required-operator 配置。
2. 使用固定源码 commit、NDK、CMake、编译参数和 `--include_ops_by_config` 构建。
3. 仅构建 `arm64-v8a` CPU 路径，不包含训练、测试、命令行工具和未使用的执行提供程序。
4. 对产物 AAR、每个 `.so`、导出 JNI 表和许可证生成 hash 清单。
5. 同时保留未裁剪 runtime 作为准确率基线，不能覆盖历史锁文件。

包体报告脚本至少输出：模型、tokens/BBPE、领域资源、压缩后原生库、未压缩原生库、APK、
安装后资产及原生库的字节数，并记录 APK 与普通 arm64 Internal 的差值。AAR 文件大小不能
直接当作 APK 增量。

### 5.2 Android source set 与适配器

新增：

- `android/app/src/streamingOnnxCtcSmall/java/com/qingjiai/speech/embedded/streaming/SherpaOnnxCtcSmallRecognizerAdapter.kt`
- `android/app/src/streamingOnnxCtcSmall/java/com/qingjiai/speech/embedded/streaming/StreamingOnnxSpeechEngineFactory.kt`
- `android/app/src/streamingOnnxCtcSmall/assets/`（由准备脚本生成，不提交模型）

适配器继续实现现有 `StreamingRecognizerAdapter`：

- `acceptSamples()` -> `OnlineStream.acceptWaveform()`；
- `isReady()` -> online recognizer ready gate；
- `decode()` -> CTC online decode；
- `inputFinished()` -> 只允许由手动停止路径调用；
- `text()` -> 读取当前 CTC 结果；
- `close()` -> stream 和 recognizer 必须幂等释放。

工厂名称沿用反射加载器已知的 `StreamingOnnxSpeechEngineFactory`，但每个构建只能编译
一个 ONNX 工厂 source set，防止类冲突。

### 5.3 Gradle 与 Windows 构建包装器

修改：

- `android/app/build.gradle`
- `scripts/android-build-windows.ps1`
- `package.json`

Gradle 工作包括：

- 把 `onnx-ctc-small` 加入显式允许列表；
- 只为该引擎加入 `streamingAsr/java` 公共采集层、
  `streamingOnnxCtcSmall/java`、候选 assets 和锁定 runtime；
- 新增准备资产校验和最终 APK 审计任务；
- 验证最终 APK 只包含候选目录，不能同时包含旧 14M、SenseVoice、Paraformer 或
  两份 ONNX runtime；
- 继续审计权限、ABI、模型 hash、许可证/SBOM、签名和 16 KiB 对齐；
- 普通 Internal 的“无嵌入语音载荷”门禁必须识别并禁止新候选目录。

Windows 构建包装器把 `StreamingAsrEngine` 的 `ValidateSet` 扩展为
`ncnn`, `onnx`, `onnx-ctc-small`，并保持 Internal/arm64 限制。

### 5.4 原生与 TypeScript 测试

新增或扩展：

- 候选 adapter 的 JVM/API 契约测试；
- `EmbeddedSpeechEngineLoader` 候选工厂加载测试；
- CTC partial、手动停止、取消、30 秒超时和迟到回调测试；
- runtime/model 缺失、hash 错误、错误 ABI 和重复 runtime 的构建失败测试；
- `SpeechRecognitionController` 保持只消费当前 generation 的 final；
- `VOICE` resultToken 和 durable receipt 回归测试。
- 未裁剪与裁剪 runtime 的固定 WAV transcript 等价测试；任一差异都必须作为新候选重新评分；
- runtime required-operator 配置覆盖测试和 JNI 导出面审计；
- 领域词表版本、大小、确定性生成及“绝不改写数字字段”测试；
- APK 分项大小报告的 schema、预算边界和基线差值测试。

测试不能把官方示例音频识别成功当作准确率门禁。模型准确率只能由独立录音结果和
`scripts/asr-benchmark/score-asr-ab.cjs` 判定。

## 6. 数据与 A/B 流程

### 6.1 快速失败集

先建立 20 到 50 条真实失败集：

- 使用者明确授权；
- 不提交录音到 Git；
- 不含真实姓名、账号、完整账本或其他敏感内容；
- 覆盖当前已观察到的基础中文错误；
- 至少一半包含金额、数量、日期或多笔边界；
- 每条保留准确参考文本和明确数字序列。

结果至少包含：

- `android-system`
- `sherpa-ncnn-14m`
- `sherpa-onnx-ctc-small-25m`

同一 WAV、同一设备、同一线程数、同一预热规则至少运行三轮，模型顺序随机。

### 6.2 评分顺序

1. 先执行评分器自测。
2. 跑 22 条 smoke；任一数字错、静音幻觉或提前结束即淘汰。
3. 跑真实失败集；确认候选确实修复主要错误切片，而不是只改善官方样例。
4. 扩展到现有 238 条清单。
5. 只有准备进入生产决策时才扩充到至少 300 条独立录音。

示例：

```powershell
pnpm run asr:benchmark:test
pnpm run asr:benchmark:score -- `
  --manifest scripts/asr-benchmark/financial-smoke-manifest.jsonl `
  --results D:\asr-runs\sherpa-ncnn-14m.jsonl `
  --results D:\asr-runs\sherpa-onnx-ctc-small-25m.jsonl `
  --json
```

## 7. 实施批次

### 批次 A：不改 App 的候选淘汰

- 获取并锁定官方模型归档和许可证证据。
- 使用桌面 sherpa-onnx 对相同 WAV 解码。
- 完成 22 条 smoke 和真实失败集评分。

退出条件：基础文字错误没有显著下降，或任一财务数字 smoke 失败，则停止集成。

### 批次 B：隔离 Android 引擎集成

- B1 增加锁文件、准备脚本、source set、adapter 和构建命令，先使用未裁剪 runtime。
- 复用现有采集、手动停止和会话安全层。
- B2 从同一模型生成 required-operator 配置并构建 arm64 裁剪 runtime。
- B3 加入小型财务领域词表；用户个性化只进入本机数据层。
- 完成 transcript 等价、JVM、TypeScript 和静态 APK 门禁，并生成分项包体报告。

退出条件：裁剪 runtime 改变 transcript、APK 超过体积预算、引入网络权限、出现多
ABI/runtime、无法满足 16 KiB 对齐或 native 资源无法确定性释放，则不进入真机测试。
若仅裁剪 runtime 失败，回退到未裁剪 runtime 继续判断模型准确率，不能混淆两项结论。

### 批次 C：真机性能与稳定性

- Redmi/HyperOS 作为首轮最低目标设备；再覆盖 ColorOS、MagicOS 和 Pixel/AOSP。
- 测量冷/热加载、首个 partial、stop-to-final、峰值 PSS、五分钟温升和功耗。
- 连续执行 100 次开始/停止/取消混合循环。

退出条件：任一目标设备 OOM、崩溃、持续内存增长、P95 超时或产生重复 final。

### 批次 D：产品决策

- 全部门禁通过：候选可替换实验 `streamingAsr` 默认模型，但仍不自动进入 Production。
- 准确率通过、包体失败：转为独立“离线语音版”或应用商店按需资源包研究。
- 体积通过、准确率失败：保留系统语音兼容路径，评估显式联网 ASR，不继续堆叠小模型。
- 两者都失败：停止该候选，保留文字输入和当前安全降级，不制造“离线可用”假象。

## 8. 回滚设计

- 新候选使用独立 Gradle engine 名称、source set、锁文件和准备目录。
- 不修改旧模型 hash、旧准备脚本或旧 A/B 结果格式。
- 回滚只需停止构建 `onnx-ctc-small`；普通构建和现有实验轨道不受影响。
- 在候选正式胜出前，不删除 `ncnn` 与旧 `onnx` 轨道。
- 任何候选运行时错误均 fail closed；不得用静默系统回退掩盖模型损坏。

## 9. 第二阶段预留：79 MiB Paraformer 小模型

只有25 MiB候选无法达到准确率门槛，且产品仍坚持完全离线时，才开启第二阶段：

- 采用 `Paraformer-zh-small INT8` 作为录音结束后的整句 final 模型；
- 以独立语音包交付，不进入基础 APK；
- 最多30秒PCM可保留在内存中，理论原始数据约960 KiB，无需写音频文件；
- 流式 partial 仍不拥有提交权；只有 Paraformer final 可进入交易解析；
- 若整句 final 失败，保留屏幕文字供用户明确采用，但不能自动入账。

该阶段必须重新评估峰值 PSS、模型加载时间、应用商店分发限制和许可证，不能把第一阶段
门禁结果直接继承给第二阶段。

## 10. Definition of Done

第一阶段只有同时满足以下条件才算完成：

- [ ] 官方来源、许可证、大小和 SHA-256 已锁定。
- [ ] 22 条 smoke 和真实失败集已有三轮可复现 A/B 结果。
- [ ] 新引擎可通过单独命令准备、验证、构建和测试。
- [ ] 未裁剪 runtime 的准确率基线已锁定，裁剪 runtime 的 transcript 等价门禁通过。
- [ ] required-operator 配置、runtime 构建参数、JNI 表、许可证和产物 hash 可复现。
- [ ] 模型、runtime、领域资源、APK 增量和安装后占用已有分项字节报告。
- [ ] 财务领域层与用户词典不自动改写金额、日期、数量或账户。
- [ ] 普通构建不包含候选模型或 runtime。
- [ ] 候选 APK 权限、ABI、签名、模型、SBOM 和 16 KiB 对齐审计通过。
- [ ] 手动停止、取消、超时、切后台和迟到回调安全契约通过。
- [ ] 准确率、数字、延迟、PSS、体积和100次稳定性全部通过。
- [ ] 回滚演练证明禁用候选后普通构建不受影响。
- [ ] 文档明确记录 Go/No-Go，不用“能构建”替代“可发布”。
