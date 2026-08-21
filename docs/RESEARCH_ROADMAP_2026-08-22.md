# 轻记 AI 最新研究路线与阅读教程（2026-08-22）

> 本文用于帮助后续研发者快速理解“项目现在做到哪里、哪些结论可信、先读什么、下一步怎么做”。它不替代各专项工程报告，而是给这些报告建立一条有优先级的阅读与执行路线。

## 1. 当前结论

截至 2026-08-22，轻记 AI 的核心记账链路、一级分类确认、可选备注、本地分类模型、数据库 v12、CSV、加密备份、隐私锁、预算、循环账草稿、Android 离线语音和通知/OCR 实验均已有源码实现。

最新变化包括 Android 离线语音和 2026-08-22 的金额/分类链路修复：远端审查分支以提交 `b4ca4e343891c2e2ff57bcd979b1abd30767621f` 为基线，加入小体积 CTC、Paraformer Small、Paraformer Compact、模型量化、多模型 A/B、端侧预热、VAD 提示和语音文本纠正实验；随后修复“块”同时表示数量量词和口语货币造成的错金额，并扩充常见糕点与即食餐点语义。

但当前仍不是生产就绪状态：

- GitHub `main` 仍停在 `7f362e516391e0c9d402fab8e866e321129db2a4`；
- 最新研究位于 `codex/pr11-integration-20260820`，没有对应的新 PR；
- 原 PR #11 仍指向旧 head `56a5084`，且不可直接合并；
- 最新提交没有 GitHub check run，远端 combined status 为 `pending`；
- 真实金融语音准确率仍是 `WAITING_FOR_AUTHORIZED_FINANCIAL_WAV`；
- Paraformer 模型导出物的分发许可证仍需复核；
- 数据库跨版本升级、完整备份恢复和目标 OEM 真机矩阵尚未完成。

当前最重要的产品判断是：

> 先证明“正确记账”，再优化“模型更小”；先完成同一录音、同一设备、同一规则的可复现 A/B，再讨论默认替换或生产发布。

## 2. 当前代码快照

| 项目                | 当前值                                                        |
| ------------------- | ------------------------------------------------------------- |
| 本地/远端研究分支   | `codex/pr11-integration-20260820`                             |
| 当前研究基线        | `b4ca4e343891c2e2ff57bcd979b1abd30767621f` + 本文所述分类修复 |
| GitHub main         | `7f362e516391e0c9d402fab8e866e321129db2a4`                    |
| 应用版本            | `1.0.7`                                                       |
| Android/iOS build   | `8`                                                           |
| 数据库最新版本      | v12                                                           |
| 当前 Jest           | 86 suites / 673 tests，通过                                   |
| TypeScript / ESLint | 通过                                                          |
| 迁移完整性          | 12 个不可变迁移，通过                                         |
| 仓库卫生            | 647 个 tracked files，通过                                    |
| Release identity    | `1.0.7 (8)`，通过                                             |
| ASR scorer 自测     | 13/13，通过                                                   |
| GitHub CI           | 当前研究 HEAD 无 check run                                    |

上表的自动验证由本次阅读任务在当前 HEAD 重新执行。Android 最新 Paraformer APK 构建、OnePlus 9R 安装和 Runtime 预热属于提交内工程报告记录，本次没有重新构建或复测，不能把两类证据混为一谈。

## 3. 先理解产品不变量

无论替换模型、增加 OCR 还是引入 Agent，以下原则不变：

1. 金额、账户、交易类型和写账权限不能交给统计模型。
2. 金额不确定、总价冲突、退款/转账/借还款等特殊资金语义必须 fail closed。
3. 模型只能提出候选；用户确认后才能写入 SQLite。
4. 语音 partial 只用于预览；只有用户主动点“说完了”才能产生 final。
5. 取消、后台、超时、权限撤销和迟到回调不能产生可提交结果。
6. PCM 不跨 React Native、不落盘、不上传。
7. 普通包不应混入实验语音模型或 Runtime。
8. 任何模型损坏、哈希不匹配、ABI 错误或许可证不完整都应阻断实验轨道，不能静默回退后伪装成功。
9. 用户界面只展示必要的一级分类；二级分类留给模型、规则和内部分析。
10. 备注是可选的人类信息，不是要求用户补做模型标注。

建议先阅读：

- [2026-08-20 研发总览](RESEARCH_PROGRESS_2026-08-20.md)
- [“鲜花饼一块两元”金额与分类缺陷根因报告](CLASSIFICATION_AMOUNT_ROOT_CAUSE_2026-08-22.md)
- [安全威胁模型](SECURITY_THREAT_MODEL.md)
- [需求可追踪矩阵](REQUIREMENTS_TRACEABILITY.md)
- [发布与回滚手册](RELEASE_RUNBOOK.md)

## 4. 项目研究路线总图

```text
P0 分支与数据安全
  ├─ 为最新研究分支建立新 PR 和 CI
  ├─ 审查 b4ca4e3 的 83 文件变更
  ├─ v1/v6/v7/v8/v9 -> v12 升级矩阵
  └─ v6-v12 加密备份恢复

P0 真实记账语音验证
  ├─ 获得授权金融 WAV / 明确不留存的人测协议
  ├─ 固定同 PCM、同设备、同顺序规则
  ├─ baseline / CTC / Paraformer / compact A/B
  ├─ CER + 数字 exact + 业务解析成功率
  └─ 100 轮、PSS、延迟、抢占和生命周期

P1 分类与交互
  ├─ 一级分类 UI 和可选备注回归
  ├─ bootstrap 模型冻结盲测
  ├─ 特殊资金与商户/目的地风险切片
  └─ 二级标签仅内部保留，不增加用户负担

P1 通知/OCR/Agent
  ├─ 权限信任、OEM 稳定、重复交易
  ├─ OCR 金额 fail closed
  ├─ Agent 只生成待确认候选
  └─ 评估拆分实验包或动态模块

P2 iOS
  ├─ Xcode 编译、App Group、Share Extension
  ├─ 备份/隐私原生桥真机验证
  └─ 自有离线语音研究
```

## 5. 最新离线语音研究如何演进

### 5.1 第一代：14M Zipformer 基线

原始 `ncnn` 和 `onnx` 轨道使用同一个 14M 中文 Zipformer，仅切换 Runtime，并没有真正更换模型。它建立了以下安全架构：

- App 自持 AudioRecord；
- 16 kHz mono PCM16；
- 手动停止唯一 final；
- generation、resultToken 和迟到回调隔离；
- 30 秒安全上限；
- 无网络权限；
- 模型、Runtime、许可证和 SBOM 锁定。

这条路线仍是会话安全基线，但不能因为 Runtime 不同就期待基础识别准确率大幅变化。

阅读：

- [ASR A/B 基准设计](ASR_AB_BENCHMARK.md)
- [Android 设备回归](ANDROID_DEVICE_REGRESSION.md)
- [Android 语音兼容矩阵](ANDROID_SPEECH_COMPATIBILITY_MATRIX.md)

### 5.2 第二代：25 MiB CTC Small

`onnx-ctc-small` 使用 `sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01`。

工程结果：

- 候选 APK 72.30 MiB；
- 相对当时普通 Internal 增量 39.06 MiB；
- 仅 arm64、无 INTERNET、16 KiB 对齐；
- Runtime 派生保持 arm64 原生库逐字节一致；
- 官方样例可解码；
- 工程门禁通过。

研究结论：

- 官方样例只能证明模型可运行；
- 提交内报告记录用户确认 CTC 真实语音准确率不达标；
- 因当时没有留存授权 WAV，无法计算同 PCM CER 或数字准确率；
- 该轨道不应升级为默认方案。

阅读：

- [小体积 CTC 工程报告](ASR_SMALL_MODEL_ENGINEERING_REPORT.md)
- [CTC/旧 ncnn 供应链阻塞](ASR_SMALL_MODEL_EXECUTION_FAILURE.md)
- [小模型替换实施方案](ASR_SMALL_MODEL_REPLACEMENT_PLAN.md)

### 5.3 第三代：79 MiB Paraformer Small

`onnx-paraformer-small` 使用整句 Paraformer，录音期间只接收内存音频，用户停止后一次解码，不制造 partial。

工程结果：

- 候选 APK 125.11 MiB；
- 相对当时普通包增量 91.87 MiB；
- 主机官方样例 7/7 可解码；
- 已安装到报告记录的 Android 设备并完成 Runtime 预热；
- 无联网权限、单 arm64、签名和静态门禁通过。

限制：

- 官方样例过于简单，无法决定是否优于 CTC；
- 模型导出页许可证字段为空，虽然原模型标注 Apache-2.0，仍需分发用途复核；
- 包体不适合作为普通基础包；
- 没有同一真实失败录音的 A/B。

阅读：

- [Paraformer Small 工程报告](ASR_PARAFORMER_SMALL_ENGINEERING_REPORT.md)

### 5.4 第四代：Paraformer Compact 与模型实验室

Compact 路线保持 Paraformer 词表、LFR、CMVN、CIF 和 greedy decode，对模型 MatMul 层做分层量化，并为模型确切算子构建裁剪 Runtime。

研究过的候选：

| 候选             | Gzip 模型大小 | 当前判断                             |
| ---------------- | ------------: | ------------------------------------ |
| baseline INT8    |     70.90 MiB | 准确率基线                           |
| RTN safe         |     60.57 MiB | 自动评测候选，真机 A/B 必需          |
| HQQ safe         |     61.62 MiB | 自动评测有希望，但主机更慢           |
| asym-ffn         |     52.55 MiB | test 指标轻微退化                    |
| asym-ffn-decoder |     50.44 MiB | test 指标轻微退化                    |
| asym-full        |     43.05 MiB | 最小，自动指标退化，用户主观判断优先 |

为了让用户在一台设备上切换，工程中保留了 377.44 MiB 的六模型实验室 APK。这个大包只用于 A/B，不是发布候选。

当前显式单模型优化构建使用：

```text
streamingAsrEngine=onnx-paraformer-compact
compactModelId=asym-full
optimizeInternalSize=true
```

最新工程报告记录的单模型 APK：

- 大小：71,704,124 bytes，约 68.38 MiB；
- SHA-256：`a3fa42303404fed5e4bf38e58014e3015d870b0d6746414afdbcc1dcf8ccb58b`；
- 仅 arm64；
- 无 INTERNET / ACCESS_NETWORK_STATE；
- 保留 OCR、账单分类、文本纠正、本地词典和隐私能力；
- R8、资源收缩、Runtime 唯一性、签名与 16 KiB 对齐门禁通过；
- 报告记录已覆盖安装到 OnePlus 9R，Runtime 预热成功。

必须注意：

- Compact 锁仍标记 `candidateStatus=MODEL_LAB`；
- 锁的默认模型仍是 `baseline-int8`；
- 自动选择候选仍记录为 `rtn-safe`；
- `asym-full` 通过显式构建参数选择，并没有被提升为生产默认；
- 最新 APK 和真机结果本次未重新构建/复测，只能引用工程报告；
- 实际麦克风重说和同 PCM A/B 仍未完成。

阅读：

- [Paraformer Compact 工程报告](ASR_PARAFORMER_COMPACT_ENGINEERING_REPORT.md)

## 6. 最新语音工程修复值得学习的内容

### 6.1 R8 与反射工厂

离线语音工厂通过 `Class.forName` 加载。首个优化包被 R8 删除工厂类后，静态资源仍在，但应用误判为“没有离线模型”。最新代码显式保留可选工厂及构造器，并增加 mapping 门禁。

经验：

- 资产存在不等于能力可加载；
- 反射入口必须进入 shrinker keep 规则和产物后验；
- 真机 Runtime 验证是静态 APK 检查之外的独立证据。

### 6.2 VAD 只能提示，不能剥夺解码权

自适应 VAD 原本只应提示音质和长停顿，却一度被用于手动停止时的硬门禁，导致安静人声在 Paraformer 解码前直接返回 `no-speech`。

当前原则：

- 手动停止始终调用 `inputFinished()` 并排空解码器；
- VAD 只负责“似乎说完了”、削波、噪声和音量提示；
- 只有模型实际返回空文本才报告无语音；
- VAD 不能自动提交，也不能替用户结束录音。

### 6.3 支付宝分句缺陷

“坐车花了四十五块钱支付宝”曾被动作词“付了”从“支付宝”内部错误切开，生成两张候选卡。

当前修复：

- 保护完整的“支付宝”和“微信支付”渠道词；
- 渠道词之后真正独立的“支付”仍可作为动作证据；
- 卡片文案从“识别原文”改为“本笔解析片段”，避免把分句片段冒充完整 ASR 原文。

### 6.4 目的地与商户消歧

“去北京花了三十五块钱支付宝”曾把“北京”错误填为商户。

当前修复：

- `去/到/在 + 纯目的地 + 花了` 不产生商户；
- 带“店、馆、餐厅、面馆、商场”等场所后缀仍可作为商户；
- 已验证品牌、本机商户别名和用户规则保持更高优先级。

这些修复说明：ASR 正确不等于记账正确，最终必须同时测转写、金额、账户、分类、商户和事件数量。

## 7. 公开数据研究路线

当前已锁定：

- FLEURS 简体中文 train / validation / test，共 4,600 条、14.07 小时；
- AISHELL-1 完整归档；
- THCHS-30 完整归档与测试噪声；
- 数据来源页面、许可证文本、归档大小和 SHA-256 快照。

使用边界：

- FLEURS 可用于普通话声学回归和模型对照；
- FLEURS 不是金融记账验收集；
- AISHELL-1 和 THCHS-30 在产品训练前仍需用途/许可证复核；
- WenetSpeech 需要按规则申请，不得绕过授权；
- 公共语料不能代替金额、商户、多笔和特殊资金语义测试。

阅读：

- [离线语音公开数据获取记录](ASR_PUBLIC_DATA_ACQUISITION.md)

## 8. 当前真正缺少的数据

项目已经有 200+ 条金融提示清单，但没有对应的独立授权录音。下一步最有价值的不是再增加一个模型，而是建立可复现的真实金融语音集。

最低建议：

1. 先录制 20–50 条真实失败快速集；
2. 至少一半包含金额、数量、日期或多笔边界；
3. 覆盖普通话、轻口音、噪声、停顿、空白和安静人声；
4. 每条保留准确参考文本和数字序列；
5. 音频不提交 Git，不包含真实姓名、账号和完整账本；
6. 同一 WAV 同时跑系统语音、14M 基线、CTC、Paraformer baseline、RTN 和 `asym-full`；
7. 每个模型至少三轮，模型顺序随机；
8. 快速集通过后扩展到至少 300 条独立授权录音。

如果用户不允许保存 WAV，只能进行逐句人工盲测，报告中必须写明“不可复现”，不能生成伪 CER。

## 9. 语音候选的统一验收表

| 维度                | 门槛或判断                               |
| ------------------- | ---------------------------------------- |
| 清晰语音 CER        | `<= 8%`                                  |
| 噪声语音 CER        | `<= 15%`                                 |
| 金额/数字序列 exact | `>= 98%`；22 条 smoke 要求 100%          |
| 空白幻觉            | 0                                        |
| 提前结束            | 0                                        |
| 重复 final          | 0                                        |
| stop-to-final P95   | `<= 1.5 s`                               |
| 遥测覆盖            | 100%                                     |
| 峰值 PSS            | 最低目标设备 `<= 250 MiB`                |
| 连续稳定性          | 100 轮无崩溃、卡死、重复 final           |
| 结束后 PSS 增长     | 不持续超过 10 MiB                        |
| 权限                | 无 INTERNET / ACCESS_NETWORK_STATE       |
| ABI                 | 仅 arm64-v8a                             |
| ELF                 | PT_LOAD 最小对齐 16 KiB                  |
| 业务正确性          | 金额、账户、分类、商户、事件数量分别验收 |

体积门槛应按产品轨道区分：

- 普通包：不包含任何实验语音模型；
- 单模型离线实验包：应报告 APK、模型、Runtime、OCR、分类模型和安装后占用；
- 多模型实验室包：只用于一次安装的 A/B，不能作为发布体积结论；
- 如果准确率达标但体积不达标，应研究独立离线语音版或按需资源包，而不是偷偷塞入普通包。

## 10. 分类模型研究路线

当前 bootstrap fastText 模型已经能为普通支出/收入提出分类候选，模型和交易对手资产约 2.25 MiB compressed。用户已观察到“武汉飞云南机票 796 元”正确归为交通，这是正向样例，但不是总体准确率证明。

当前交互原则：

- 用户只选择一级分类；
- 二级分类供模型、规则和内部分析使用；
- 保持同一父分类时可保留模型子类；
- 用户改变父分类时清除旧子类；
- 备注可选，不把用户变成 taxonomy 标注员。

下一阶段：

1. 冻结九标签评估协议：收入 + 八个支出一级分类；
2. 按用户、商户和提示族隔离 train/validation/test；
3. 对交通票务、退款、充值、押金、转账、借还款建立风险切片；
4. 报告 accepted precision、coverage、每类召回和 calibration；
5. 模型只做 shadow 观察，不开启 AUTO；
6. 真正上线前要求独立人工审计和发布收据链。

阅读：

- [本地分类模型研究](ON_DEVICE_BILL_CLASSIFICATION_RESEARCH_2026-08-14.md)
- [分类模型卡](BILL_CLASSIFIER_MODEL_CARD.md)
- [合成模型运行记录](CODEX_SYNTHETIC_MODEL_RUN_2026-08-17.md)
- [商户与机构研究](MERCHANT_INSTITUTION_RESEARCH.md)

## 11. 数据与迁移路线

当前数据库为 v12：

|  版本 | 内容                           |
| ----: | ------------------------------ |
| v1-v6 | 基础账本、分类、账户、识别收据 |
|    v7 | Statement Imports              |
|    v8 | Privacy and Onboarding         |
|    v9 | Budgets and Recurring          |
|   v10 | Notification/OCR Experiments   |
|   v11 | Agent Operation Receipts       |
|   v12 | Model Shadow Observations      |

下一步不是增加 v13，而是验证：

1. v1、v6、v7、v8、v9 分别升级到 v12；
2. 迁移失败保持事务原子性；
3. future schema 必须拒绝，不能清空或降级；
4. v6-v12 加密备份完整恢复；
5. CSV 导入的正负号、退款、转账和去重误杀；
6. 预算/循环草稿在退款、转账、软删、跨月和分类变化后的行为；
7. 通知、Agent receipt 和 shadow 表进入备份并正确恢复。

这条路线优先级高于继续增加实验入口，因为账本损坏和重复入账的代价最高。

## 12. 通知、OCR 与 Agent 路线

这些入口目前适合独立实验，不适合与语音模型一起作为一个超大 PR 合并。

### 通知监听

- 只允许显式开启；
- 验证微信/支付宝格式变化和 OEM 后台存活；
- 通知重复、修改、撤回和延迟都必须幂等；
- 不能因通知读取权限存在而自动入账。

### OCR

- 金额、正负号、退款和转账语义必须 fail closed；
- 比较 ML Kit 对普通包体的独立贡献；
- 评估动态模块或独立实验包；
- iOS Vision 需要 Xcode 与真机证据。

### Agent

- Agent 只能生成待确认候选；
- operation receipt 要防重复；
- 不允许 Agent 绕过分类、金额、账户和 repository 校验；
- 外部指令内容不能替代产品安全策略。

## 13. 推荐阅读顺序

### 第一轮：30 分钟建立全局认识

1. 本文；
2. [2026-08-20 研发总览](RESEARCH_PROGRESS_2026-08-20.md)；
3. [安全威胁模型](SECURITY_THREAT_MODEL.md)；
4. [发布与回滚手册](RELEASE_RUNBOOK.md)。

目标：知道哪些能力已经存在，以及“能构建”为什么不等于“生产就绪”。

### 第二轮：理解语音路线

1. [小模型替换实施方案](ASR_SMALL_MODEL_REPLACEMENT_PLAN.md)；
2. [小体积 CTC 工程报告](ASR_SMALL_MODEL_ENGINEERING_REPORT.md)；
3. [Paraformer Small 工程报告](ASR_PARAFORMER_SMALL_ENGINEERING_REPORT.md)；
4. [Paraformer Compact 工程报告](ASR_PARAFORMER_COMPACT_ENGINEERING_REPORT.md)；
5. [公开数据获取记录](ASR_PUBLIC_DATA_ACQUISITION.md)。

目标：按时间理解为何从 CTC 转向 Paraformer，再从大模型转向 Compact 和 `asym-full`。

### 第三轮：理解记账安全

1. [需求可追踪矩阵](REQUIREMENTS_TRACEABILITY.md)；
2. [商户与机构研究](MERCHANT_INSTITUTION_RESEARCH.md)；
3. [分类模型研究](ON_DEVICE_BILL_CLASSIFICATION_RESEARCH_2026-08-14.md)；
4. [分类模型卡](BILL_CLASSIFIER_MODEL_CARD.md)；
5. 数据库迁移和备份测试源码。

目标：理解模型只是候选层，金额、特殊资金语义、确认和幂等必须由确定性边界负责。

## 14. 开发者执行教程

### 14.1 同步与基础检查

先确认没有用户改动，再使用 fast-forward：

```powershell
git status --short --branch
git fetch --prune origin
git pull --ff-only origin codex/pr11-integration-20260820
```

禁止使用 `reset --hard` 或覆盖未提交文件。

### 14.2 当前基础门禁

```powershell
pnpm typecheck
pnpm lint
pnpm test:ci
pnpm migration:integrity:check
pnpm repository:hygiene
pnpm release:identity:check
pnpm asr:benchmark:test
```

### 14.3 普通 arm64 Internal

```powershell
pnpm android:verify:internal:windows
```

验收：

- 仅 arm64；
- 无 INTERNET、ACCESS_NETWORK_STATE、SYSTEM_ALERT_WINDOW；
- 无任何语音模型和语音 Runtime；
- 分类、OCR、备份、隐私等普通功能不受实验轨道污染。

### 14.4 CTC Small，仅保留工程对照

```powershell
pnpm android:streaming-ctc-small-asr:verify:windows
pnpm android:verify:streaming-ctc-small-asr:windows
```

不要因它包体小而提升为默认；真实准确率已有负面用户反馈且缺少可复现 WAV。

### 14.5 Paraformer Small，仅用于大模型基线

```powershell
pnpm android:paraformer-small-asr:verify:windows
pnpm android:verify:paraformer-small-asr:windows
```

只在许可证用途复核和包体接受范围明确时继续。

### 14.6 当前 Compact 单模型候选

准备好的外部缓存和 Runtime 是前提；模型资产不提交 Git。

```powershell
pnpm android:paraformer-compact-asr:verify:windows
pnpm android:verify:paraformer-asym-full-optimized:windows
```

构建后必须重新记录 APK 大小、SHA-256、权限、ABI、Runtime 唯一性、模型 ID、R8 mapping、16 KiB ZIP 和 ELF 对齐。不能沿用 2026-08-21 的旧哈希作为新提交证据。

### 14.7 真机 A/B

推荐顺序：

1. 覆盖安装，保留应用数据；
2. 打开智能记账页并确认 Runtime 预热成功；
3. 确认当前选中的模型 ID；
4. 同一句话按随机顺序测试各模型；
5. 记录完整转写、数字序列、解析笔数、金额、账户、分类和商户；
6. 记录冷/热延迟、PSS、线程、句柄、温升和失败原因；
7. 执行 100 轮开始/停止/取消混合测试；
8. 退出后确认无重复 final、无迟到候选、无持续内存增长。

## 15. 当前 Go / No-Go 表

| 事项                | 当前状态                     | 下一证据                    |
| ------------------- | ---------------------------- | --------------------------- |
| 核心文本记账        | 自动测试通过                 | 真机全链路回归              |
| 一级分类 + 可选备注 | 已实现                       | 用户操作负担与持久化回归    |
| bootstrap 分类模型  | 有正向样例                   | 冻结真实盲测                |
| CTC Small           | 工程 Go，准确率 No-Go/未复现 | 授权同 PCM A/B              |
| Paraformer Small    | 工程 Go，分发/体积未 Go      | 许可证复核 + 同 PCM A/B     |
| Compact RTN/HQQ     | 自动评测候选                 | ARM 真机准确率/延迟         |
| `asym-full` 优化包  | 工程报告记录可安装/预热      | 实际麦克风与同 PCM A/B      |
| 六模型实验室        | A/B 工具                     | 不进入发布决策              |
| 公开普通话语料      | 已获取                       | 不可替代金融验收集          |
| 授权金融 WAV        | 缺失                         | 20–50 条快速集，再扩到 300+ |
| 数据库 v12          | 迁移哈希通过                 | 多起点升级和恢复矩阵        |
| 通知/OCR/Agent      | 实验源码存在                 | 权限、幂等、OEM、真机       |
| iOS                 | 静态源码证据                 | Xcode/签名/真机             |
| 最新研究分支 CI     | 无                           | 创建新 PR 并跑远端检查      |
| 生产发布            | No-Go                        | 全部 P0 门禁                |

## 16. 下一阶段的推荐顺序

### P0-1：恢复可审查的 GitHub 流程

1. 以 `codex/pr11-integration-20260820` 为 head 创建新 PR；
2. 不继续向原 PR #11 堆叠；
3. 把 ASR 大提交拆成工程基础、模型实验、文本纠正/解析修复三个可审查单元；
4. 运行 JavaScript、Android、iOS source audit 和迁移门禁；
5. 解决所有 P0 review finding 后再谈合并。

### P0-2：真实金融语音快速集

先完成 20–50 条，不等 300 条全部准备好。用它快速淘汰 `asym-full`、RTN 或其他候选，再扩展正式集。

### P0-3：目标 Android 真机矩阵

OnePlus 9R 的工程报告记录只能证明一台设备的安装/预热。下一步至少覆盖红米 K90/HyperOS，并逐步加入 ColorOS、MagicOS 和 Pixel/AOSP。

### P0-4：迁移与备份恢复

在语音研究并行进行，但不得延后到模型确定之后。任何数据损坏风险都高于模型准确率提升。

### P1：体积和模块化

在准确率胜出后再做：

- 单模型 Runtime/operator 裁剪复核；
- OCR 独立贡献测量；
- 离线语音独立 APK 或按需资源包；
- 普通包保持无语音载荷。

### P2：iOS 与更长期模型研究

- iOS 原生离线语音；
- 经授权的领域微调；
- 用户本机词典与个性化排序；
- 不上传私人账本或语音。

## 17. 最终决策规则

```text
准确率不达标
  -> 停止该模型，不用规则修补数字指标

准确率达标、体积不达标
  -> 独立离线语音版 / 按需资源包

体积达标、真机延迟或内存不达标
  -> 回退更保守模型或 Runtime，不进入默认

准确率、体积、性能均达标，但许可证未明确
  -> 仍然 No-Go

全部工程门禁和真实数据门禁通过
  -> 只可提升为新的 Internal 默认候选
  -> 仍需生产签名、迁移、备份、隐私和灰度证据
```

## 18. 证据口径

- **源码存在**：代码已提交，不代表模型资产齐全。
- **自动测试通过**：当前本地测试通过，不代表 GitHub CI 或 Android 真机通过。
- **APK 构建通过**：生成 APK，不代表 Runtime 能被 R8 后的反射路径加载。
- **Runtime 预热通过**：模型可加载，不代表真实语音准确。
- **官方样例通过**：模型可运行，不代表金融记账可用。
- **公开语料指标**：可比较普通话声学能力，不代表金额、商户或多笔成功率。
- **用户主观样例**：有产品价值，但没有同 PCM 时不可计算可复现 CER。
- **生产就绪**：需要准确率、数字、生命周期、性能、迁移、备份、隐私、许可证、签名和灰度全部闭环。

当前最准确的阶段描述是：

> “核心记账与多条 Android 离线 ASR 实验轨道已实现；Compact 单模型包已有工程报告和单机预热证据；真实金融语音、跨 OEM 稳定性、分发许可证、数据库恢复和远端审查仍未闭环。”
