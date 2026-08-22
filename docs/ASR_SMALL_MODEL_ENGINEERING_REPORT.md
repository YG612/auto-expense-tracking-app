# 小体积离线语音工程验证报告

## 结论

- 新 `onnx-ctc-small` 轨道工程状态：`PASS`
- 整体执行/自动关机资格：`BLOCKED_BY_LEGACY_NCNN_LOCKED_AAR`
- 真实记账语音准确率：`WAITING_FOR_AUTHORIZED_WAV`
- 实验轨道：`Internal + arm64-v8a + streamingAsrEngine=onnx-ctc-small`
- 候选 APK：`android/app/build/outputs/asr-comparison/app-internal-ctc-small.apk`
- 候选 APK 大小：75,809,969 字节（72.30 MiB），小于 80 MiB 硬上限
- 相对普通 Internal 的增量：40,955,894 字节（39.06 MiB），同时小于 50 MiB 目标和 55 MiB 硬上限
- 本报告只给出工程 Go 结论。仓库没有获得授权的真实记账 WAV，因此不对准确率、数字准确率或生产可用性给出 Go 结论。
- 旧 onnx 轨道已完成兼容构建；旧 ncnn 轨道因锁定 AAR 无公开分发源且当前锁未记录生成 `classes.jar` 的完整 JDK 信息，仍保持 fail-closed。根据执行计划，这个遗留供应链阻塞会阻止自动关机。

## 锁定输入

| 项目        | 锁定值                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------- |
| 模型        | `sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01`                              |
| 模型归档    | 21,264,113 字节；SHA-256 `b3b309f7ce4a737195fcc6963ea19b0653a7d3401580af5ae0d3e284cbb71f0b` |
| INT8 ONNX   | 26,342,340 字节；SHA-256 `68c9c943840f7d9cf3e8a4970ba50f404feb5277f611fa82b7e72267786fa84a` |
| tokens      | 13,366 字节；SHA-256 `6fed8c6c248516f38e7faa19404b57413e8ce259f1cbc1fa4aebc86eac32fdfd`     |
| bbpe        | 255,180 字节；SHA-256 `503204e0690eff065e30d0e01898c9ab06d0e6dc376a741eb6846198f95b2f82`    |
| sherpa-onnx | v1.13.2，Apache-2.0                                                                         |
| 官方 AAR    | 56,655,608 字节；SHA-256 `aa5505c0ec4f8bdaee5f214a64ba3012be64f2aecc022e82a64f33392b8dd245` |
| arm64 AAR   | 13,494,651 字节；SHA-256 `731ff07eef479586cc2abb96e8fbad60f39fddda26be1a9510daffdcbbf29dda` |
| 锁文件      | SHA-256 `9312750d9d13a55f4171ba599871b5785f242a2d70ba5c7c685742a6cf7db043`                  |

锁文件位于 `android/app/src/internal/streaming-ctc-small-asr-lock.json`。准备流程逐文件验证大小和 SHA-256，异常时直接失败，不会回退系统语音。

## 实现结果

- Android 适配器使用 `OnlineZipformer2CtcModelConfig`、CPU、2 线程、`greedy_search`、`enableEndpoint=false`、16 kHz/80 维特征。
- 复用既有 `AudioRecord`、手动停止、generation、resultToken、看门狗、取消和唯一 final 状态机；普通构建、旧 ncnn 和旧 onnx 轨道保留。
- Runtime 只保留 arm64 的 ONNX Runtime、sherpa C/C++ API 与 JNI，APK 静态门禁拒绝其他 ABI、缺失库、重复 Runtime 和联网权限。
- Internal 直装 APK 对原生库采用传输时压缩、安装时解压。所有 arm64 ELF 的 LOAD 对齐仍为至少 16 KiB。
- CTC 不使用只支持 Transducer 的 sherpa 热词接口。
- `correctVoiceTranscript()` 只接受版本化显式规则与本机 `Merchant.aliases`，最长匹配优先，冲突不改，禁止模糊拼音/编辑距离猜测；阿拉伯数字、带单位的中文数字及其金额/日期/时间/计量单位均受保护，纠正前后数字词元必须逐字一致。
- `BookkeepingSession.start()` 可保存 `rawText`、`effectiveText`、规则版本和逐项 corrections。尚未保存候选时可在确认界面恢复原文重新解析；已有保存、在途保存、旧 session/generation 或已恢复状态均拒绝。
- 没有数据库迁移，没有上传词典、语音或识别结果。

## Runtime 裁剪决策

本次没有重新编译或做 required-operator 级 ONNX Runtime 裁剪，而是从锁定官方 v1.13.2 AAR 确定性移除三个无关 ABI。原因是原生库压缩后，最终 ASR APK 增量已经为 39.06 MiB，低于 50 MiB 目标；继续做算子级裁剪只会增加算子遗漏和转录漂移风险。

该派生 AAR 连续构建哈希一致。验证脚本证明派生 AAR 中四个 arm64 `.so` 与官方完整 AAR 对应条目逐字节相同，因此完整与精简 Runtime 的 arm64 执行代码等价。

## 官方样例等价检查

使用 sherpa-onnx 1.13.2、相同模型和解码参数验证归档内三条官方样例：

| WAV      | 采样率 | 转录                                                   |
| -------- | -----: | ------------------------------------------------------ |
| `0.wav`  | 16 kHz | 对我做了介绍那么我想说的是呢大家如果对我的研究感兴趣呢 |
| `1.wav`  | 16 kHz | 重点呢想谈三个问题首先呢就是这一轮全球金融动荡的表现   |
| `8k.wav` |  8 kHz | 深入的分析这一次全球金融动荡背后的根源                 |

样例 WAV 的大小与 SHA-256 均来自锁文件。此检查只证明模型可运行、8 kHz 重采样可运行及 Runtime 派生等价，不替代真实记账语音准确率验收。

## 包体审计

| 项目                             |        字节 |    MiB |
| -------------------------------- | ----------: | -----: |
| 普通 Internal APK                |  34,854,075 |  33.24 |
| CTC 候选 APK                     |  75,809,969 |  72.30 |
| ASR APK 增量                     |  40,955,894 |  39.06 |
| ASR 模型与 Runtime（APK 压缩后） |  40,844,008 |  38.95 |
| ASR 模型与 Runtime（未压缩）     |  61,813,502 |  58.95 |
| 候选全部原生库（APK 压缩后）     |  30,901,830 |  29.47 |
| 候选全部原生库（未压缩）         |  87,456,736 |  83.41 |
| 静态安装占用估算                 | 163,266,705 | 155.70 |

静态安装占用估算为“APK + 解压后的全部原生库”，不包含 ART 编译产物和用户数据；没有连接授权 Android 设备，因此不伪造设备实测值。

- 普通 APK SHA-256：`c292132140dc78ff3b133fdd59539803b7996369141ea9f98b19f39079f4b400`
- 候选 APK SHA-256：`69d6310106a88c12816be8ea85cafda40074b45504a8fd5d3099d97f8f26d2dc`
- 机器可读报告：`android/app/build/reports/streaming-ctc-small-artifact-budget.json`
- 样例等价报告：`android/app/build/reports/streaming-ctc-small-sample-equivalence.json`

## 门禁结果

完整入口：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-android-streaming-ctc-small-asr.ps1
```

最终一次完整执行结果：

- Runtime 确定性、供应链、许可证、SBOM、模型哈希、官方样例等价：PASS
- TypeScript `tsc --noEmit`：PASS
- ESLint：PASS
- Jest：86 个套件、631 项测试全部 PASS
- Node ASR 评分器：13 项自测全部 PASS
- Android 普通 Internal：JVM 测试、构建、无语音模型静态检查 PASS
- Android CTC Internal：JVM 测试（包括 CTC 路径/解码配置）、构建、签名、权限、ABI、Runtime 唯一性和 APK 静态检查 PASS
- Android 旧 onnx Internal：准备、构建和原有静态检查 PASS
- Android 旧 ncnn Internal：`BLOCKED`，详见 `docs/ASR_SMALL_MODEL_EXECUTION_FAILURE.md`
- 仓库卫生：PASS；主 App 与 Share Extension 必须共享同一 App Group entitlement，已作为唯一显式的合法重复项记录
- 迁移完整性：12 个不可变迁移 PASS
- Agent 同步契约：PASS
- Release identity：`1.0.7 (8)` PASS
- `git diff --check`：PASS
- 工作区未出现 APK/AAR/模型等意外可提交产物；这些准备/构建产物位于已忽略路径。

## 工具链与源码状态

- 分支：`codex/pr11-integration-20260820`
- 起始提交：`7868f53d848541eb3b8da0ee37ea7b48fe3748d2`
- Windows 11 amd64
- Node.js v24.14.0
- pnpm 11.9.0
- OpenJDK 21.0.1
- Gradle 9.3.1；Kotlin 2.2.21

执行中修复了两个可复现的包装脚本问题：Windows 判定不再依赖可能缺失的 `OS` 环境变量；完整验证会拒绝 JDK 11 并自动选择可用的 JDK 17+。

## 后续准确率验收

状态必须保持为：

```text
WAITING_FOR_AUTHORIZED_WAV
```

获得授权 WAV 后，按版本化清单分别跑系统语音、旧 ncnn、旧 onnx 与 `onnx-ctc-small`，执行 CER、金额/数字序列 100% 门禁、静音幻觉、提前结束和分场景统计。真实数据通过前，不把本轨道升级为默认语音方案。
