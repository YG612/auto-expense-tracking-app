# 离线中文 ASR A/B 基线

本基线用于在**同一批授权录音、同一设备、同一会话参数**下比较 Android 系统本地识别、sherpa-ncnn 和 sherpa-onnx。它只评价“音频转文字”这一层，不替代交易解析、金额计算、分类或入账测试，也不授权下载或发布任何模型。

## 1. 文件与运行方式

- `scripts/asr-benchmark/financial-smoke-manifest.jsonl`：238 条财务短句清单；目前只定义录音槽位，不包含音频。
- `scripts/asr-benchmark/generate-financial-manifest.cjs`：由 22 条人工基线确定性生成扩展槽位，便于审计和复现。
- `scripts/asr-benchmark/score-asr-ab.cjs`：纯 Node 评分器，无新增依赖。
- `scripts/asr-benchmark/score-asr-ab.test.cjs`：评分器自测。

先执行评分器单元测试：

```powershell
pnpm run asr:benchmark:test
```

三个引擎分别跑完相同录音后，将结果写成 JSONL，再执行：

```powershell
pnpm run asr:benchmark:score -- `
  --manifest scripts/asr-benchmark/financial-smoke-manifest.jsonl `
  --results D:\asr-runs\android-system-local.jsonl `
  --results D:\asr-runs\sherpa-ncnn.jsonl `
  --results D:\asr-runs\sherpa-onnx.jsonl
```

机器可读结果增加 `--json`。评分命令默认不因指标失败而返回非零退出码；CI 应读取 JSON 中的 `smokePassed` / `productionEligible`，以免把“成功生成失败报告”误判为模型通过。

## 2. 录音清单契约

每行是一个 JSON 对象：

```json
{
  "id": "fin-001",
  "audioFile": "recordings/fin-001.wav",
  "referenceText": "今天下午去商场买两瓶牛奶花了25元",
  "expectedOutcome": "TRANSCRIBE",
  "expectedAmountSequenceFen": [2500],
  "expectedNumberSequence": [2, 25],
  "expectedLedgerAmountFen": 2500,
  "sceneTags": ["expense", "shopping", "quantity"],
  "environment": "clean",
  "accentProfile": "standard_mandarin",
  "requiresFullAudio": true
}
```

关键边界：

- `expectedAmountSequenceFen` 是话语中**明确说出的货币序列**，统一换算为分。例如“5 瓶、每瓶 10 块”是 `[1000]`，不能把数量 5 冒充金额。
- `expectedNumberSequence` 保留全部数字顺序，用于发现“5 瓶”识别成“1 瓶”、日期混入金额等问题。
- `expectedLedgerAmountFen` 只给下游交易解析回归使用；ASR 评分器不自行做乘法或入账判断。
- `expectedOutcome=REJECT` 只用于静音和纯非语音负样本。正常人声即使不包含交易，也应转写，不能用“拒识”掩盖识别失败。
- `requiresFullAudio=true` 的样本必须上报完整音频处理情况，专门捕获用户话没说完就结束的问题。

正式录音要求：16 kHz、mono、PCM WAV；同一原始 WAV 不为不同模型单独降噪；文件名和 `id` 一致。至少覆盖清晰普通话、常见口音、道路/餐厅/音乐噪声、远场、句中停顿、多笔交易、否定/计划语义、静音与纯噪声。语料须取得明确授权，不提交真实姓名、账号、账本内容或未经许可的录音。

## 3. 模型结果契约

每个模型、每条清单恰好一行：

```json
{
  "model": "sensevoice-int8",
  "id": "fin-001",
  "status": "TRANSCRIBED",
  "transcript": "今天下午去商场买两瓶牛奶花了25元",
  "finalLatencyMs": 620,
  "audioDurationMs": 3100,
  "processedAudioMs": 3100,
  "prematureEnd": false,
  "deviceId": "redmi-arm64-01",
  "runId": "2026-08-12-a"
}
```

- `status` 只能是 `TRANSCRIBED`、`REJECTED` 或 `FAILED`。
- `finalLatencyMs` 从用户明确点击“说完了”或输入音频结束，到最终结果/明确失败的单调时钟耗时，必须是有限且不小于 0 的数。
- `requiresFullAudio=true` 时必须同时提供有限正数 `audioDurationMs` 和 `processedAudioMs`；后者不得超过前者 200 ms 以上。`prematureEnd` 只能作为交叉校验，不能覆盖时长证据；两者矛盾即门禁失败。
- 不得把缺失延迟填成 `0`，也不得把缺失收音进度填成“完整”。评分器会把缺失遥测显示为覆盖率不足并判定相应门槛失败。
- A/B/C 必须使用相同 `deviceId`、录音、预热规则和运行轮次；ncnn/onnx 固定相同 CPU 线程数，系统引擎记录实际 Provider 与本地/联网状态。建议按轮次随机引擎顺序，至少做 3 轮并保留每轮原始 JSONL。

## 4. 指标与判定

评分器输出整体指标及 `environment:*`、`accent:*`、`scene:*` 分片：

- CER：NFKC、去空白和标点后的 Unicode 字符编辑距离；清晰语音 `<= 8%`，噪声语音 `<= 15%`。
- 金额 exact match：所有正常人声的货币序列必须逐项、逐顺序相同，目标 `>= 98%`；预期无金额的句子若幻觉出“10 元”同样失败。
- 数字序列 exact match：数量、单价、日期和金额全部保真；财务 smoke 强制 `100%`，不能被 CER 或金额均值掩盖。
- 拒识准确率：静音/纯非语音必须拒识，目标 `>= 98%`；正常人声误拒同样按失败处理。
- 提前结束：要求完整音频的用例 `prematureEnd` 必须为零，遥测覆盖率必须 100%。
- 最终延迟：覆盖率必须 100%，P95 `<= 1.5 s`。

238 条清单足以做扩展实验，但仍低于 300 条生产门槛，因此 `productionEligible` 始终为 `false`；`--production-minimum` 也不得低于 300。`asrMetricGatePassed` 仅表示至少 300 条时 ASR 数值门禁通过，不表示可发布。正式 Go/No-Go 还必须完成 RTF、峰值 PSS、连续 100 次稳定性、包体、隐私、许可、回滚和设备矩阵验证。任何金额吞字、数量错误、收支/退款/转账反转、提前结束、正常人声误拒或录音外传都是阻断缺陷，不能用总体均值抵消。

## 5. 建议 A/B/C 顺序

1. 先录制原始 22 个槽位做 smoke；通过后再录满 238 个授权槽位，不要调参后反复覆盖原录音。
2. 冻结模型哈希、运行时版本、解码参数、VAD/会话参数与设备信息。
3. Android 系统本地识别、sherpa-ncnn 和 sherpa-onnx 均跑同一批 WAV，先检查缺失结果和遥测覆盖率；系统引擎无法接受文件输入时，须用同一扬声器/声卡回放链路，不能混用现场口述。
4. 只有 22 条 smoke 无金额吞字、无提前结束、无静音幻觉，才跑 238 条扩展集；生产结论仍需另补到至少 300 条盲测集。
5. 模型大小是运行时/包体目标，不是准确率豁免；未同时达到安全门槛就继续保留文字输入和显式系统语音回退。
