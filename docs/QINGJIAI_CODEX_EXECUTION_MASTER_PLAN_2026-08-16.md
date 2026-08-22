# 青记 AI 账单识别执行总方案

版本：2026-08-17（承接 2026-08-16 方案）

状态：功能、合成数据、候选模型及 Android/Host 证据完成；等待人工审计、iOS 真机、A3 与影子观察
适用范围：青记 App、`qingji` CLI、MCP 适配器、Codex/Claude Code 等外部代理

## 1. 最终产品边界

用户可以把一条或多条自然语言账单交给 App、CLI 或 MCP。系统生成可审阅的记账候选，不允许模型直接写账。

每条候选只输出：

- 方向：`INCOME` 或 `EXPENSE`；
- 金额：整数分 `amountMinor`，必须由确定性解析器从原文证据得到；
- 支出一级分类：餐饮、交通、购物、居住、娱乐、医疗、教育、其他支出；
- 可选的时间、账户、商户、备注等原文中明确存在的信息；
- 置信度、缺失字段、歧义原因和模型审计信息。

明确不做：

- 不让新模型生成金额或修正金额；
- 不向用户暴露历史交易细类型；
- 不为新记录生成二级分类；
- 不把转账、退款、报销、借还款、充值等扩展为用户分类；它们只是内部风险信号；
- 不静默提交、不自动保存、不允许外部代理绕过预览和确认。

历史数据库中的详细交易类型和二级分类继续可读，迁移采用兼容读取，不做破坏性改写。

## 2. 决策优先级

历史聊天记录曾提出“合成数据不能用于最终模型”。用户后续明确要求“数据只能靠大模型合成”，因此本方案以纯大模型合成数据为当前有效约束。为降低同源偏差，必须同时执行独立生成、独立评审、冻结提示词隔离、分组防泄漏、OOD 风险集和人工抽审。

如果以后取得真实且合规的脱敏数据，只能作为新版本数据源加入；不得在本版本中假装存在真实样本，也不得降低现有溯源要求。

## 3. 统一九标签契约

模型标签固定为：

1. `income`
2. `expense.food`
3. `expense.transport`
4. `expense.shopping`
5. `expense.housing`
6. `expense.entertainment`
7. `expense.healthcare`
8. `expense.education`
9. `expense.other_expense`

`expense.other_expense` 永久禁止模型自动接受，只能由用户明确选择。模型允许返回 NONE（拒识/待编辑）。收入不再细分。

## 4. 分层架构

```text
自然语言 / 账单文本
        │
        ▼
确定性预处理与金额解析 ── 金额缺失或歧义 ──► PENDING / EDIT
        │
        ▼
规则、商户词典、语义风险检测
        │
        ├── 特殊资金 / OOD ───────────────► PENDING / EDIT
        │
        ▼
九标签端侧模型
        │
        ▼
温度校准 + 逐类别置信度/间隔阈值
        │
        ├── 禁用类别或未达阈值 ───────────► PENDING / EDIT
        │
        ▼
统一 ParsedTransactionCandidate
        │
        ├── App 预览
        ├── qingji CLI JSON 预览
        └── MCP 工具预览
                 │
                 ▼
             用户明确确认
                 │
                 ▼
               本地保存
```

App、CLI 和 MCP 共享同一候选生成服务。桌面端通过 stdin 调用同一 C++/fastText 核心，不复制另一套分类逻辑。模型异常、超时或资产不可用时必须降级到现有规则候选，不能阻断记账。

## 5. 金额与方向处理

金额解析顺序：

1. 对原文做 Unicode 规范化，但保留金额证据；
2. 用确定性解析器识别阿拉伯数字、中文数字、口语单位和小数；
3. 只有唯一、正数且可安全转成整数分时写入 `amountMinor`；
4. 多金额、范围金额、缺单位且含义不确定时标记歧义；
5. 模型输出永远不能覆盖解析器结果。

方向由明确收入/支出语言、规则和九标签结果共同校验。模型标签与已确定方向冲突时返回 `TYPE_MISMATCH` 并拒识。

## 6. 纯大模型合成数据方案

目标矩阵位于 `data/synthetic/generation-matrix.json`，生产最低规模：

| 数据集       |   数量 | 用途                         |
| ------------ | -----: | ---------------------------- |
| 分类训练     | 27,000 | 训练九标签候选模型           |
| 分类验证     |  4,500 | 校准、阈值和最多三轮定向改进 |
| 分类冻结测试 |  9,000 | 每个模型版本只评估一次       |
| 风险/OOD     |  8,000 | 特殊资金、非账单、边界拒识   |
| 金额解析     |  3,000 | 确定性金额解析回归           |
| 端到端       |  4,500 | 候选、待编辑和确认流程回归   |

数据生成规则：

- 训练/验证与冻结测试使用不同 `promptVersion` 和不同提示词家族；
- generator 与 judge 使用不同会话，优先使用不同模型；
- 工具关闭、会话不持久化、每批结构化 JSON Schema 输出；
- 每条数据带 `generatorModel`、`promptVersion`、`scenario`、`splitGroup`；
- 同一商户族、表达模板和语义改写共享 `splitGroup`；
- 规范化精确去重和字符三元组近似去重；
- 冻结集与训练/验证不能共享 promptVersion 或 splitGroup；
- 生成、评审和准备阶段采用原子写入，可按已验证行数恢复；
- 发布门禁校验数量、哈希、溯源、评审覆盖和人工抽审记录，缺一即 `DATA_NOT_READY`。

分类验证难例至少包含：场所与物品冲突、宽泛平台、ASR 同音、分类边界、信息不足、新商户；风险集单独包含特殊资金和 OOD，正确结果是拒识。错误分析只能使用验证集与风险集；冻结集禁止用于定位和迭代。

人工抽审最低 450 条。这里的“人工”是发布责任人对合成样本质量的抽查和签名，不得用另一个自动模型冒充人工签名。

## 7. 模型训练与选择

当前候选是单个量化 fastText 九分类头，训练脚本会比较三组受控超参数；最多三轮定向迭代，每个模型家族最多 24 个候选。未来可以添加更简单或更复杂的模型家族，但必须走同一选择报告，不能直接替换生产资产。

训练过程：

1. 从准备清单读取并校验训练、验证和冻结哈希；
2. 只用训练集拟合；
3. 在验证集选温度和总体宽松底线；
4. 对每个预测类别单独选择达到 99% 接受精度的置信度/间隔阈值；
5. 证据不足或无法达到精度门槛的类别自动禁用；
6. `expense.other_expense` 无条件禁用；
7. 生成候选 manifest，状态为 `FROZEN_EVALUATION_REQUIRED`；
8. 冻结测试、风险测试和三端运行时测试完成后进入模型选择。

选择规则：

- 所有硬门禁失败时，winner 必须为 `NONE`；
- 首要目标是最大化 99% 精度下的高置信覆盖率；
- 简单模型与最高覆盖模型差距不超过 3 个百分点时选择简单模型；
- 差距 3–5 个百分点时必须人工复核；
- 复杂模型通常需至少增加 5 个百分点覆盖率才有充分升级理由；
- 平局依次选择更小、延迟更低、内存更低、跨平台更简单、供应链风险更低的模型。

## 8. 发布硬门禁

候选必须同时满足：

- 模型权重不超过 5 MiB（当前仓库资产校验仍采用更严格的 3 MiB）；
- APK 增量不超过 5 MiB；
- 端侧 p95 推理不超过 100 ms；
- 额外峰值 PSS 不超过 20 MiB；
- 高置信接受精度至少 0.99；
- OOD 错误接受率不超过 0.01；
- 自动提交错误数为 0；
- 冻结集总体准确率至少 0.88；
- 启用类别 macro-F1 至少 0.86；
- 启用类别最低召回至少 0.75；
- 高置信覆盖率至少 0.50；
- ECE 不超过 0.05；
- Android、iOS、桌面主机黄金向量一致；
- 冻结测试对该模型版本只运行一次；
- 所有必需错误切片存在且已明确归因。

模型选择输出 `selection_report.json` 和 `MODEL_SELECTION_REPORT.md`。报告只是推荐；进入影子模式前必须由责任人创建并签署 `A3_SELECTION_APPROVED.json`，且其中绑定选择报告哈希和模型 manifest 哈希。影子模式仍然 `allowAutoCommit=false`。

## 9. 错误切片与最多三轮迭代

`error_slices.json` 的每个切片必须归入以下一种处理方式：

- `RULE`
- `ONTOLOGY`
- `TRAINING_DATA`
- `NORMALIZATION`
- `THRESHOLD`
- `OOD_REJECTION`
- `LABEL_GUIDE`

建议迭代顺序：

1. 第一轮修正标签指南、生成矩阵和明显规则；
2. 第二轮只补第一轮确认的高价值难例，并保持 splitGroup 隔离；
3. 第三轮只处理仍影响硬门禁的切片；
4. 三轮后仍不能过门禁则选择 NONE，不继续追逐冻结集指标。

任何一轮都不得查看冻结样本内容后定向补数据。

## 10. App、CLI 与 MCP 安全契约

- `parse`/预览可以调用模型增强，但只返回候选；
- 新分类只保留收入/支出和八个支出一级类；
- 子分类始终为空；
- 模型置信度只作为审计信息，不替代候选完整性和风险判断；
- 外部代理缺少确认令牌时不能提交；
- 含缺失金额、金额歧义、特殊资金、类别拒识或禁用类别的候选必须 `PENDING`；
- CLI 使用稳定 JSON 输出和非零退出码表达不可执行状态；
- MCP 使用相同服务边界，不给模型数据库写权限；
- 原始文本和财务数据默认留在本机；合成数据生成阶段只能发送专用生成提示，不发送用户账本。

CLI 的价值是提供可脚本化、可审计、可测试的窄接口。Codex、Claude Code 等代理可以调用它，但 CLI 不是新的分类器，也不是绕过用户确认的通道。

## 11. 仓库命令

数据阶段：

```powershell
npm run synthetic-data:generate -- --kind category ...
npm run synthetic-data:review -- ...
npm run synthetic-data:prepare -- ...
npm run synthetic-data:release-gate -- ...
```

模型阶段：

```powershell
npm run bill-classifier:train -- ...
npm run bill-classifier:run-candidate -- --split validation ...
npm run bill-classifier:run-candidate -- --split risk ...
npm run bill-classifier:run-candidate -- --split frozen ...
npm run bill-classifier:evaluate -- ...
npm run bill-classifier:error-slices -- --split validation ...
npm run bill-classifier:select -- ...
npm run bill-classifier:approval-request -- --selection-report ... --completion-receipt ... --output A3_SELECTION_APPROVAL_REQUEST.json
npm run bill-classifier:approve-shadow -- --selection-report ... --completion-receipt ... --approval A3_SELECTION_APPROVED.json --output shadow-activation.json
npm run bill-classifier:stage-shadow -- --selection-report ... --completion-receipt ... --activation ... --output-root build/shadow-models/v3
npm run bill-classifier:shadow-observation -- --observations ... --selection-report ... --activation ... --shadow-manifest ... --output shadow-observation-report.json
npm run bill-classifier:release-readiness -- --selection-report ... --completion-receipt ... --runtime-report ... --human-audit ... --prepared-manifest ... --approval ... --activation ... --shadow-manifest ... --shadow-stage-receipt ... --shadow-report ... --observations ... --output MODEL_RELEASE_READY.json
./scripts/android-build-windows.ps1 -Variant Internal -Offline -BillClassifierAssetsRoot build/shadow-models/v3 -BuildReceipt build/shadow-models/v3/android-build-receipt.json
npm run bill-classifier:runtime-report -- --manifest ... --baseline-apk ... --candidate-apk ... --android-build-receipt ... --benchmark ... --ios-benchmark ... --ios-device-evidence ... --android-golden ... --ios-golden ... --host-golden ... --frozen-lock ... --output ...
```

模型选择前的设备测试必须使用独立的 `BENCHMARK_ONLY` 资产目录，不能伪造
A3 或复用影子模式：

```powershell
npm run bill-classifier:stage-benchmark -- --candidate-dir build/model-candidates/codex-v4 --output-root build/benchmark-assets/codex-v4
./scripts/android-build-windows.ps1 -Variant Internal -Offline -BillClassifierAssetsRoot build/benchmark-assets/codex-v4 -BuildReceipt build/benchmark-runs/codex-v4/android-build-receipt.json
```

基准证据和 APK 必须写到资产根目录之外，避免被递归打包。基准模式固定
`allowAutoCommit=false`，并绑定候选 manifest、冻结评估、错误切片和冻结锁哈希；
它不构成模型选择或影子批准。

iOS 真机证据通过独立基准入口采集。该入口只在物理设备、
`BENCHMARK_ONLY` 资产和显式启动参数同时满足时运行；普通启动无副作用：

```bash
npm run ios:bill-classifier:benchmark -- \
  --device <IOS_DEVICE_UDID> \
  --development-team <APPLE_DEVELOPMENT_TEAM> \
  --candidate-dir build/model-candidates/codex-v4 \
  --output-dir build/ios-benchmark/codex-v4 \
  --acknowledge-replaces-installed-app
```

此命令需要 macOS、完整 Xcode、已完成 `pod install` 的 workspace 和 iOS 17+
开发设备。它构建并安装带基准资产的应用，因此要求显式确认会替换设备上的同
bundle ID 开发应用。输出包含真机黄金向量、物理内存样本及哈希绑定证据。

人工审计和 iOS 证据到位后，一条命令执行数据门禁、运行时报告和模型选择：

```powershell
npm run bill-classifier:complete-selection -- --execute
```

不带 `--execute` 时只进行只读就绪检查。当前检查精确报告四项缺失：
`human-audit.json`、`ios-benchmark.json`、`ios-device-evidence.json` 和
`ios-golden.jsonl`。

执行成功后还会生成不可变的 `MODEL_SELECTION_COMPLETE.json`，把人工审计、
准备数据 manifest、运行时报告、选择报告和获胜候选逐项做 SHA-256 绑定。A3
请求模板只保持 `PENDING_HUMAN_APPROVAL`；责任人必须另行签署，代码不会自动
填写批准人。影子模式中，每次用户确认账单后仅记录模型版本、预测/最终分类、
置信度和耗时，不记录账单原文、金额或账户；设置页可显式导出 JSONL。观察门禁
要求至少 500 条、覆盖 7 个自然日、每个启用标签至少 20 条、匹配率至少 99%、
Wilson 95% 下界至少 98%、p95 不超过 100 ms，且自动提交恒为 false。

代码与运行时验证：

```powershell
npm run lint
npm run typecheck
npm run test:ci
npm run synthetic-data:test
npm run bill-classifier:metrics:test
npm run bill-classifier:verify-native
npm run bill-classifier:build-host
npm run qingji:test
npm run qingji:mcp:test
npm run android:assemble:windows
```

## 12. 当前实施状态

| 工作项                                         | 状态                           |
| ---------------------------------------------- | ------------------------------ |
| 新增记录简化为收入/支出与八个支出一级分类      | 完成                           |
| 金额确定性解析、歧义与待确认                   | 完成                           |
| App/CLI/MCP 共享异步候选流程                   | 完成                           |
| C++/Android/iOS/桌面主机统一模型协议           | 完成                           |
| 逐类别策略、OTHER 禁用、NONE 回退              | 完成                           |
| LLM 合成、确定性评审、去重、分组、防泄漏、恢复 | 完成                           |
| 模型训练、校准、评估、错误切片、选择、审批脚本 | 完成代码                       |
| 56,000 条 Codex 合成分类数据及辅助语料         | 完成；明确不冒充独立 LLM 评审  |
| 候选 `category-v3.ftz` 与冻结评估              | 完成；候选 2 通过算法门禁      |
| Android/Host 黄金向量、延迟、PSS、APK 增量     | 完成                           |
| Android USB 代理幂等性 E2E                     | 完成                           |
| 450 条人工审计材料                             | 完成；等待真实审计人签署       |
| iOS 真机黄金向量与运行时报告                   | 等待 Mac 和 iOS 真机           |
| A3 请求、证据哈希链、影子采集/导出/评估工具    | 完成代码                       |
| A3 选择审批与真实影子观察期                    | 等待人工审计、iOS 证据和责任人 |

## 13. 完成定义

“功能代码完成”与“模型可发布”分开判断。

功能代码完成要求：代码、单元测试、原生核心、CLI/MCP 和 Android 构建全部通过。

模型可发布要求：生产规模数据真实生成并通过发布门禁；候选完成一次冻结评估；运行时报告齐全；错误切片全部归因；模型选择非 NONE；责任人签署 A3；影子运行无自动提交且达到观察期标准。

不得用玩具数据、空文件、复制样本或降低数量阈值伪造完成。当前正确终态是：
功能代码与 Android/Host 候选验证就绪；发布仍由真实人工审计、iOS 真机证据、
责任人 A3 签署和影子观察期阻塞。
