# Paraformer Small 离线语音实验轨道工程报告

日期：2026-08-21
轨道：Android Internal / arm64-v8a / `streamingAsrEngine=onnx-paraformer-small`
准确率状态：`WAITING_FOR_AUTHORIZED_WAV`

## 结论

`onnx-paraformer-small` 已完成模型锁定、主机解码、Android 接入、单元测试、离线构建、静态审计和真机 Runtime 预热。候选 APK 已安装到设备 `67110b7a`，并在进入智能记账页后输出：

```text
QingJiEmbeddedSpeech: Streaming speech runtime verification succeeded.
```

本报告不把官方样例结果当成真实准确率 Go。用户已确认原 25 MiB CTC 轨道的真实语音准确率不达标，但本次没有留存该段授权 WAV，因此新旧模型还不能在相同真实语料上计算 CER、数字准确率或业务成功率。应用保持开机供用户直接测试。

## 锁定供应链

- 模型：`sherpa-onnx-paraformer-zh-small-2024-03-09`
- 模型类型：离线整句 Paraformer，INT8，中文/英文，不提供时间戳
- 归档：77,920,048 bytes
- 归档 SHA-256：`da92b3db5218c5be53aad53e57d1b6e63e7fc98a0e054fbdd6dbe18e9c6b1450`
- `model.int8.onnx`：81,828,675 bytes，SHA-256 `3ef6c19369b912f7caf3cef8e545c5ccd1a33d9d7ec792a46668dc41c4b229ec`
- `tokens.txt`：75,352 bytes，SHA-256 `4b2d964e18b9cf139b473003b6698fb2ed9a2a5ec55b93daa677b28f578897aa`
- Runtime：sherpa-onnx v1.13.2、CPU、2 线程、`greedy_search`
- 精简 arm64 AAR：13,494,651 bytes，SHA-256 `731ff07eef479586cc2abb96e8fbad60f39fddda26be1a9510daffdcbbf29dda`

模型归档的 README 指向 ModelScope 量化导出页；该导出页未填写许可证字段，其明确指向的原始 DAMO/IIC Paraformer 模型标注为 Apache License 2.0。NOTICE 与 SBOM 保留了这个歧义，并设置 `distributionReviewRequired=true`；当前仅允许 Internal 评估，不视为已批准对外分发。

## 主机快速门禁

命令：

```powershell
D:\miniconda\python.exe scripts\asr-benchmark\verify-paraformer-small-official-samples.py `
  --python-runtime D:\CodexData\Caches\QingJiAI\sherpa-onnx-ctc-small\python-runtime `
  --model-root D:\CodexData\Caches\QingJiAI\sherpa-onnx-paraformer-small\sherpa-onnx-paraformer-zh-small-2024-03-09 `
  --sample-root D:\CodexData\Caches\QingJiAI\sherpa-onnx-paraformer-small\sherpa-onnx-paraformer-zh-small-2024-03-09\test_wavs
```

结果：7/7 音频成功解码，最大观测 RTF `0.012`。与 CTC 共享的三条样例中，CTC 为 3/3 精确匹配；Paraformer 为 2/3，另一条仅增加“啊/嗯”语气词。因此官方样例 A/B 结论是 `INCONCLUSIVE_OFFICIAL_SAMPLES_TOO_EASY`，不是 Paraformer 准确率胜出。

## Android 实现

- 新增独立 `streamingOnnxParaformerSmall` 源集，不覆盖 ncnn、旧 ONNX 或 CTC 轨道。
- 复用现有 AudioRecord、16 kHz 单声道 PCM16、generation、resultToken、手动停止、取消、超时和唯一 final 生命周期。
- OfflineStream 在录音期间只接收内存音频；用户停止后整句 decode 一次，不写磁盘、不上传、不生成虚假 partial。
- 30 秒墙钟上限仍由共享捕获层执行；超限直接失败，不解码、不产生 final。
- 模型、hash、ABI、JNI、许可证或 SBOM 异常均 fail closed，不回退系统语音。
- Internal 构建现在固定先执行 `:app:clean`，防止不同 ASR engine 共用 Gradle variant 时残留模型或 Runtime。

## 构建与包体

候选构建：

```powershell
pnpm android:verify:paraformer-small-asr:windows
```

结果：`BUILD SUCCESSFUL`，Android JVM 测试通过，模型/Runtime/ABI/权限/包体门禁通过。

- 候选 APK：131,185,713 bytes（125.11 MiB）
- 普通 Internal APK：34,854,663 bytes
- ASR APK 增量：96,331,050 bytes（91.87 MiB）
- 候选 SHA-256：`fb768d59591a4a58eff3819f05295e943ad8db15830d8a564a772168b94c47b6`
- 硬上限：ASR 增量 110 MiB、候选 APK 150 MiB
- ABI：仅 `arm64-v8a`
- Runtime：一份 sherpa-onnx Runtime
- 权限：无 `INTERNET`、无 `ACCESS_NETWORK_STATE`
- 签名：APK Signature Scheme v2，Internal debug key
- 对齐：`zipalign -c -P 16 -v 4` 通过
- NOTICE/SBOM：已打包并通过静态检查

普通版随后单独执行 `pnpm android:verify:internal:windows` 并通过，证明新增大模型轨道未进入普通 APK。

## 自动化结果

- Jest：86 suites / 631 tests 全部通过
- TypeScript：`tsc --noEmit` 通过
- ASR scorer 自测：13/13 通过
- Android Internal Paraformer JVM + assemble：通过
- Android ordinary Internal JVM + assemble：通过
- 仓库卫生：通过
- 真机安装：通过
- 真机 JNI/模型预热：通过

## 待完成准确率门禁

下一步必须在手机上用与失败 CTC 测试完全相同的句子，至少覆盖：金额数字、商户名、多笔交易、停顿、环境噪声。若允许留存测试录音，则导出 WAV 并同时跑 CTC/Paraformer，报告 CER、数字序列准确率和账单解析成功率；若不允许留存，只能记录用户侧逐句人工 A/B 结果。

在该门禁完成前：

- 不宣称准确率 Go；
- 不替换默认轨道；
- 不进行 Runtime operator 裁剪；
- 不执行自动关机。
