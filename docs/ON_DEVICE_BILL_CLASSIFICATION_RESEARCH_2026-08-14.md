# 内置 AI 小模型账单分类调研与最终方案

日期：2026-08-14
状态：方案已收敛并完成 `0.1.0-bootstrap` 双平台实现；真实盲测与 iOS/macOS 构建仍是生产门禁

## 1. 结论

首版采用 **量化 fastText 监督分类器（字符 n-gram）作为现有规则管线中的受控候选器**，而不是生成式小语言模型或端侧 Transformer。

- 模型只预测已确认是普通 `EXPENSE` / `INCOME` 的账单分类，不判断金额、账户、日期、转账、退款、报销、借贷等高风险交易语义。
- 优先级为：明确文本语义 > 用户主动规则 > 已学习商户规则 > 商户字典 > 端侧模型 > 现有通用关键词 > 无分类。
- 模型只有在校准后的置信度和 Top-1/Top-2 间隔同时达标时才给出建议；否则弃权。模型结果不能覆盖明确规则、交易类型保护或人工选择。
- Android 和 iOS 共用锁定版本的 fastText C++ 推理核心和同一份 `.ftz` 模型，通过原生桥输出最小 DTO；TypeScript 继续负责决策融合、风险和复核。
- 首版目标模型 1–3 MB，运行时增量目标小于 1.5 MB/ABI，单条热推理 P95 小于 15 ms，峰值额外内存小于 15 MB（均须在最低档目标真机实测）。
- 若真实盲测不能达到本文闸门，再进入第二阶段：用 `bge-small-zh-v1.5` 蒸馏/微调的 INT8 4 层编码器配 ONNX Runtime Mobile；不能在没有证据时直接承担约 20–30 MB 模型和额外运行时成本。

这不是“规则或 AI”二选一。规则负责精确、安全和个性化，小模型负责规则未覆盖的泛化表达。

## 2. 当前项目约束

项目是 React Native 0.86、React 19、TypeScript，Android 最低 API 24、目标 API 36，iOS deployment target 15.1。账本和学习反馈均保存在本地 SQLite。

现有分类不是简单关键词表，而是分层确定性系统：

1. 文本标准化、分句和金额/时间解析；
2. 特殊交易类型优先识别；
3. 语义本体处理商品、服务、活动、场所、否定和多事件歧义；
4. 用户规则、连续三次纠正产生的商户规则、商户字典和通用关键词参与决策；
5. 独立置信度与 `reviewDisposition` 决定直接确认、复核、待处理或仅编辑；
6. 分类器从不自行落账，数据库写入还有领域不变量校验。

当前种子数据包含 13 个支出一级类、108 个支出二级类和 13 个收入类（合计 134 个分类节点）。直接做 121 个叶子标签的平面模型会导致长尾类别样本稀疏，所以模型必须分层输出。

项目已有内置流式 ASR 的资产锁定、SHA-256、SBOM、许可证、ABI、普通构建无载荷验证和无网络权限验证。账单模型应复用同样的供应链边界，而不是新增一套较弱流程。

## 3. 方案比较

| 路线                         | 优点                                                                     | 主要问题                                                                             | 结论                       |
| ---------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------- |
| 生成式 0.5B–1.5B 小模型      | 可零样本解释、输出灵活                                                   | 数百 MB；慢、耗内存；输出不可控；标签闭集任务收益低                                  | 排除                       |
| 4 层中文 BERT/BGE-small INT8 | 语义泛化强；可蒸馏                                                       | 模型约 20–30 MB，另有 tokenizer/运行时；训练与算子兼容更复杂                         | 第二阶段挑战者             |
| LiteRT 文本模型              | Android 生态成熟，可硬件加速                                             | iOS 仍需单独集成；ML Kit 的自定义高层 API主要面向图像，文本需自己管理 tokenizer/张量 | 不作为首选                 |
| ONNX Runtime Mobile          | Android/iOS 一套模型格式；可裁剪算子，INT8 成熟                          | 预编译包较大，自定义构建与 Transformer tokenizer 增加供应链成本                      | Transformer 阶段首选运行时 |
| ExecuTorch                   | PyTorch 导出自然，支持 Android/iOS 和多后端                              | 仍在快速演进；为线性文本分类器引入过重                                               | 当前不选                   |
| fastText 量化监督分类        | 原生 C++、MIT；短文本分类成熟；字符 n-gram 适合商户/OOV；可压至约 1–3 MB | 不擅长复杂组合语义；概率需校准；需自建训练集                                         | **首版采用**               |

fastText 官方给出的公开分类示例中，量化模型可从数百 MB 压到约 1.4–1.7 MB，且精度下降很小；自动调参还可直接指定模型大小上限。这个数字不是本项目的性能承诺，只证明该路线具备所需量级，最终必须由本项目数据和设备给出结果。

## 4. 最终决策架构

### 4.1 模型职责

模型输入仅使用当前已拆分的单笔 `sourceText`，附加可靠的商户规范名；不输入金额原值、账户余额、用户姓名或历史账本。金额统一替换为 `<AMOUNT>`，日期替换为 `<DATE>`，支付渠道替换为 `<ACCOUNT>`，降低过拟合和隐私暴露。

模型输出：

```ts
type OnDeviceCategoryPrediction = {
  modelId: string;
  modelVersion: string;
  taxonomyVersion: number;
  parentCategoryKey?: string;
  subcategoryKey?: string;
  top1Probability: number;
  top2Probability: number;
  calibratedConfidence: number;
  abstained: boolean;
  reason?:
    | 'LOW_CONFIDENCE'
    | 'LOW_MARGIN'
    | 'OOV'
    | 'TYPE_UNSUPPORTED'
    | 'MODEL_UNAVAILABLE';
  latencyMs: number;
};
```

原生层不读取数据库、不决定是否确认、不写账。桥接层建议命名为 `OnDeviceBillClassifier`，接口保持 `load/status/classify/close`，并保证加载失败时现有规则链路无损工作。

### 4.2 分层分类

训练两个很小的分类头（可放在同一资产包）：

1. 一级头：支出 13 类或收入 13 类；
2. 二级头：只在选定支出一级类内部预测其子类。

一级预测不可靠则完全弃权；一级可靠但二级不可靠时只建议一级类。这样与项目允许一级分类直接选择的展示策略一致，也避免把“知道是交通但不知道公交/地铁”的样本强行塞入错误叶子。

### 4.3 决策融合

仅在以下条件全部满足时调用模型：

- 事件已经拆成单笔；
- 类型为普通 `EXPENSE` 或 `INCOME`；
- 没有退款、储值充值、转账、借贷、报销等语义风险；
- 没有明确分类、有效用户规则或可靠商户字典结果；
- 不是个人收款对象、多事件歧义或当前已有强冲突证据。

上线初值（必须由验证集调优，不是硬编码真理）：一级 `calibratedConfidence >= 0.82` 且 margin `top1-top2 >= 0.18`；二级分别为 `0.78` 和 `0.15`。模型建议一律不能单独把候选抬成 `DIRECT_CONFIRM`：首版最高只到 `REVIEW_CONFIRM`。累积足够线上本地确认统计并证明风险可控后，才评估放宽。

`ClassificationSuggestionSource` 新增 `ON_DEVICE_MODEL`；候选中保留 `modelId/modelVersion`，但 UI 默认只显示“AI 建议”，调试页才显示概率和版本。

## 5. 数据与训练

### 5.1 数据来源

按可信度分层构建：

- 金标准：人工复核并确认的真实短句；按用户/商户分组去重后再切分，防止同一模板泄漏到训练集和测试集。
- 银标准：现有明确规则和语义本体生成/标注的样本，只用于预训练和覆盖扩充，不能主导最终测试。
- 纠错样本：`classification_feedback` 中用户改过的文本；默认只在设备内用于规则个性化。若未来用于集中训练，必须单独明示同意、去标识化、可撤回，不能因已有“保留原始文字”设置就推定获得上传授权。
- 反例/弃权集：转账、退款、充值、押金、借贷、多金额、多事件、否定、个人收款和未知文本。弃权质量与分类准确率同等重要。

训练前建立不可变 `taxonomy.json`，用稳定 `system_key` 而非数据库 ID 作为标签。隐藏/自定义分类不进入全局模型；用户自定义分类继续由用户规则处理。

### 5.2 中文预处理

- NFKC、小写、空白归一化，与现有 normalizer 对齐；
- 汉字按字符切分，并保留 2–5 字符 n-gram；Latin 商户词保持 token；
- 数字、日期、订单号和支付渠道替换为占位符；
- 不删除“没、不是、退款、押金”等否定/风险词；风险层会先拦截，训练集仍需包含这些反例；
- 同一预处理代码生成测试向量，TypeScript、训练脚本和 C++ 端逐字节对齐。

### 5.3 训练与校准

- 使用按类别加权采样；一级宏平均指标优先，二级按父类单独报告；
- 以设备/用户/商户分组的 train/validation/test 切分，保留时间外推测试集；
- 在 validation 上做温度缩放或等距回归校准，校准参数随模型锁定；
- 使用 fastText quantize 的 `-qnorm -retrain`，通过 `-autotune-modelsize 3M` 搜索大小约束；
- 固定随机种子、源码 commit、编译器、训练数据 manifest、标签表和所有参数；输出模型、许可证、SBOM、SHA-256 和模型卡。

## 6. 上线闸门

在真实、冻结、未参与开发的盲测集上同时满足：

- 一级 Top-1 accuracy >= 92%，macro-F1 >= 88%；
- 在“模型选择不弃权”的样本上 selective accuracy >= 95%，覆盖率 >= 60%；
- 二级 selective accuracy >= 90%，覆盖率 >= 45%；
- 高风险集错误自动建议率 <= 0.5%，这些样本原则上应由前置规则拦截或模型弃权；
- Expected Calibration Error <= 0.05；
- 相比当前规则基线，人工修改分类率相对下降 >= 20%，且危险类型错误不增加；
- Android API 24 arm64 最低档真机与 iPhone（iOS 15.1 可运行设备）完成冷启动、热推理、并发、内存和 500 次循环稳定性测试；
- 普通/Release 构建是否含模型须由产品策略明确，并有 APK/IPA 资产清单测试证明；运行时不增加 `INTERNET` 权限。

若一级指标未达标，不通过降低阈值换覆盖率；先补充混淆类别和弃权样本。若达到准确率但覆盖率持续低于 60%，才启动 Transformer 挑战者 PoC。

## 7. 实施顺序

1. **离线基线（无 App 改动）**：导出 taxonomy，建立 1,000–3,000 条去重种子集与风险集；对“现有规则、fastText、BGE-small-zh INT8”用相同盲测协议比较。
2. **Android Internal PoC**：仿照 `streamingAsr` 增加显式 Gradle property 和独立 source set；只打 arm64；完成资产锁和原生桥，默认 shadow mode，不改变 UI 建议。
3. **融合 A/B**：本地记录匿名聚合计数（模型建议、弃权、用户接受/修改、耗时），不记录或上传原文；验证阈值后在 Internal 中显示建议。
4. **iOS 对齐**：同一 C++ commit、同一 `.ftz`、相同黄金向量；加入 Xcode build phase 的哈希和目标成员验证。
5. **生产灰度**：首版模型建议最高为 `REVIEW_CONFIRM`；版本回滚通过随 App 发布的上一版资产完成，不引入远程模型下载。

建议新增：

```text
src/classification/model/                 # TS 端口、融合策略、DTO
android/app/src/billClassifier/           # Kotlin/JNI 与锁定 runtime
ios/QingJiAI/BillClassification/          # Swift/C++ bridge
models/bill-classifier/manifest.json      # 模型元数据（实际大资产按发布策略管理）
scripts/bill-classifier/                  # 训练、量化、评估、锁定
docs/BILL_CLASSIFIER_MODEL_CARD.md
```

## 8. 不做的事情

- 不让模型生成 JSON 并直接入账；
- 不把分类概率混入当前通用 confidence 后掩盖结构风险；
- 不使用测试集调阈值；
- 不用用户确认样本在手机上直接增量训练首版模型，避免灾难性遗忘、投毒和不可复现；个性化继续走现有规则；
- 不将支付通知、OCR、语音原文上传给第三方模型服务；
- 不因模型给出高概率就覆盖退款、转账、充值或人工规则。

## 9. 主要资料

- fastText 官方监督分类与量化教程：https://fasttext.cc/docs/en/supervised-tutorial.html
- fastText 官方量化模型结果：https://fasttext.cc/docs/en/supervised-models.html
- fastText 官方模型大小约束：https://fasttext.cc/docs/en/autotune.html
- fastText 源码与 MIT 许可：https://github.com/facebookresearch/fastText
- ONNX Runtime Mobile 部署与量化：https://onnxruntime.ai/docs/tutorials/mobile/
- ONNX Runtime 裁剪算子配置：https://onnxruntime.ai/docs/reference/operators/reduced-operator-config-file.html
- ONNX Runtime 自定义移动端构建：https://onnxruntime.ai/docs/build/custom.html
- ExecuTorch Android/iOS 入门：https://docs.pytorch.org/executorch/stable/getting-started.html
- Apple Core ML 端侧推理与隐私：https://developer.apple.com/documentation/coreml/
- Apple Core ML 模型压缩：https://developer.apple.com/documentation/coreml/reducing-the-size-of-your-core-ml-app
- Google ML Kit 自定义模型范围（主要为图像）：https://developers.google.com/ml-kit/custom-models
- BGE-small-zh-v1.5 模型配置与 MIT 许可：https://huggingface.co/BAAI/bge-small-zh-v1.5/blob/main/config.json

## 10. 最终决策记录

选择 fastText 不是因为它理论上最强，而是因为它在当前产品问题上有最佳的 **准确率可验证性 / 包体 / 延迟 / 跨平台 / 可弃权 / 供应链复杂度** 比值。项目已有复杂语义规则来处理它的弱项；小模型最有价值的工作是补足商户别名、口语和规则长尾，而不是重新实现整个账单解析器。

最终 go/no-go 仍以第 6 节的同一盲测集决定。若 fastText 未达闸门，则保留全部接口和融合策略，只将原生推理实现替换为 ONNX Runtime Mobile + INT8 4 层中文编码器；不会推翻领域层和安全边界。
