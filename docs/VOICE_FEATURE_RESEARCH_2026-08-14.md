# 同类软件语音功能调研与“轻记 AI”方案建议

更新时间：2026-08-14

## 1. 结论摘要

同类产品的“语音功能”实际上分为三类，并非一种技术路线：

1. **系统入口型**：通过 Siri、Shortcuts、Spotlight、Action Button 等唤起“新增交易”动作。代表是 YNAB。它降低打开 App 的摩擦，但语音理解、对话和唤起可靠性主要由操作系统承担。
2. **App 内语音转写型**：用户点麦克风，说一句或多句自然语言；产品先做 ASR，再提取金额、日期、分类等字段。MonAi、Cannie、Money Voice、BudgetVoice 等新兴轻量产品采用这种交互。
3. **对话/多模态助手型**：文字、语音转写、收据、邮件等统一进入自然语言助手，由助手创建和修改费用。Expensify Concierge 是主流费用管理软件中更典型的方向；其官方材料能确认自然语言和收据工作流，但没有公开证明 App 内语音使用哪种 ASR。

主流综合型财务产品通常不会把语音设为唯一录入方式。收据 OCR、银行/支付导入、通知捕获、自然语言文字和手工表单仍然并存。语音最适合“刚发生、手不方便、信息简单”的即时记录，不适合在嘈杂环境、多人同场或需要凭证/税务字段时取代其他入口。

对当前项目最合适的路线不是重写，而是：

- 近期保留现有“系统本地优先 + 明示联网回退 + 统一本地解析 + 确认后入账”；
- 用真机 A/B 数据决定 Android 内置离线模型是否进入生产包；
- 增加 iOS App Intents/Shortcuts，把语音能力扩展到 App 外；
- 中期把云端 ASR 或大模型理解做成用户明确开启的可选 Provider，而不是默认依赖；
- 不做无确认自动落账，至少在数字、交易类型、账户或多笔拆分存在风险时保持确认。

## 2. 当前项目画像

“轻记 AI”是 React Native 0.86、Android/iOS 双端、本地 SQLite 持久化的本地优先个人记账 App。它已有文字智能记账、多笔拆分、金额/日期/类型/分类解析、置信度、待确认箱及本地个性化学习。

现有语音链路是：

```text
用户主动开始
  -> 选择一个完整 Provider
  -> 权限与能力检测
  -> App 内显示 partial/final 转写
  -> 用户点“说完了”或“使用这段文字”
  -> parseTextTransactions（与文字入口共用）
  -> 候选卡片 / 待确认箱
  -> 用户确认后写入 SQLite
```

当前 Provider 已抽象为：

- Android 12+ 系统端侧识别；
- Android OEM 系统语音界面；
- Android 直接系统识别服务（可能联网，需用户明确同意）；
- iOS `SFSpeechRecognizer` 端侧或系统联网识别；
- Android 实验构建中的 App 自持 `AudioRecord` + sherpa-ncnn + 约 25 MB Zipformer 普通话模型。

架构上的强项：

- ASR 与交易理解解耦，替换 Provider 不需要重写记账语义层；
- 端侧/联网、录音所有权、断句所有权被显式建模；
- `sessionId`、generation、单次消费 `resultToken` 防止迟到回调和重复入账；
- 音频只在内存中消费，默认不保存录音；
- 不把系统静音端点等同于用户确认，避免一句话被截断后错误落账；
- 已有财务短句 benchmark，包含 CER、数字 exact match 和 P95 最终延迟门槛。

当前缺口：

- Android 内置模型仅通过构建和静态审计，尚无真机准确率、功耗、内存和兼容性结论；
- iOS 尚未完成 macOS/Xcode 真机构建验证，也没有 App 自有离线 Provider；
- 语音只能在 App 内启动，尚无 Siri/Shortcuts/锁屏/Action Button 入口；
- 本地规则对开放域商户、复杂修正和长对话的能力有限；
- 现有 22 条 smoke 清单规模不足以支撑生产准入，应扩入口音、噪声、同音金额、多笔、退款/报销/转账等集合。

## 3. 竞品与相邻产品观察

| 产品/类型 | 已公开的语音或自然语言形态 | 可确认的实现边界 | 对本项目的启示 |
|---|---|---|---|
| YNAB（成熟预算产品） | Siri/Spotlight/Shortcuts 增加交易、查询分类余额；也支持锁屏和组件入口 | 官方明确是 iOS 系统集成；未宣称 App 自建 ASR | App 外入口能显著降低摩擦；可先打开预填/确认界面，不必追求完全无界面对话 |
| Expensify（成熟费用管理） | Concierge 里用自然语言创建、修改费用；收据 OCR 自动提取商户、日期、金额、币种和分类 | 官方确认聊天、邮件、短信、收据输入；“say”属于自然语言示例，不能据此断言其 App 内 ASR 技术 | 把语音当作统一自然语言入口的一种来源；修改和追问能力比单次转写更有长期价值 |
| 钱迹（成熟国内极简记账） | 官方重点是快速录入、导入和 Android 自动记账 | 官方文档确认自动记账使用 Accessibility Service 识别支付页面，未发现其官方资料把 App 内语音作为核心功能 | 中国场景里支付捕获/导入常比语音覆盖更多真实交易；语音应与自动记账互补 |
| MonAi（语音优先轻量产品） | 像发语音消息一样输入，自动拆分和分类；数据存个人 iCloud | 商店页能确认交互和存储宣称，未公开 ASR/NLU 供应商 | “语音消息式”低学习成本；多笔拆分是有感知的差异化能力 |
| Cannie（语音/文字自然语言） | 一次录音识别多笔、相对日期、多语言和简单计算 | 商店页确认产品能力，未公开底层模型 | 与本项目现有多笔文字解析高度同路；benchmark 应加入多笔和相对日期结构化准确率 |
| Money Voice / BudgetVoice（语音优先轻量产品） | “金额 + 用途”一句话，自动分类；本地存储或打开预填表单 | 商店页确认产品形态；不能从文案确认是否完全端侧推理 | “直接保存”最快，但预填表单更安全；本项目应按置信度渐进确认，而非一刀切 |
| 国内新兴 AI 语音记账 App | 中文语音提取金额/分类，常同时提供 OCR、云同步 | App Store 文案能确认功能，但隐私/“AI”描述不足以判断 ASR 是否端侧 | 本项目应把可验证隐私边界作为差异化卖点，并避免模糊的“AI 自动记账”表述 |

公开资料局限：竞品通常只公开产品交互，不公开 ASR SDK、模型、音频保留策略、端点检测或结构化解析架构。除非官方技术文档明确说明，否则本文不把“支持语音”推断成“端侧 ASR”或“云端大模型”。

## 4. 可选实现方案

### 方案 A：仅使用系统语音能力

Android 使用 `createOnDeviceSpeechRecognizer`，不可用时在用户明确同意后使用系统默认识别/OEM Activity；iOS 使用 `SFSpeechRecognizer`，端侧可用时设置 `requiresOnDeviceRecognition`。

- 优点：安装包小、研发和维护成本最低、系统负责语言模型更新；与现有代码基本一致。
- 缺点：不同 ROM/地区/设备差异大；系统可能自动断句；中国 Android 设备经常缺少可用中文服务；联网边界由系统 Provider 决定。
- 适用：默认轻量包、MVP、低频语音用户。
- 建议：作为所有构建的基线兼容路线保留，但不能宣称“所有设备离线可用”。

### 方案 B：App 内置端侧 ASR

App 自持麦克风和端点策略，使用 sherpa-ncnn/Zipformer 等端侧模型；ASR 输出继续进入本地规则解析。

- 优点：离线、隐私边界清晰、交互和“说完了”语义可控、跨 OEM 行为更一致。
- 缺点：增加约 25 MB 或更多包体；低端机的首帧延迟、内存、温升和准确率需要持续验证；模型升级与供应链由团队负责；当前只有 Android PoC。
- 适用：隐私定位强、中文高频使用、系统服务碎片化严重的市场。
- 建议：先以可选语音包或独立 flavor 灰度；满足财务数字 100% exact-match 等门槛后再考虑默认内置。iOS 可后续复用同一模型体系，但需要单独完成原生集成和设备测试。

### 方案 C：云端流式 ASR + 本地规则解析

客户端只在用户选择联网模式后上传实时音频到自有后端；后端代理云 ASR，密钥绝不进入 App；得到转写后仍由现有 `parseTextTransactions` 本地结构化。

- 优点：通常有更好的口音、噪声和热词适应能力；模型无需随 App 发布；可以快速扩展方言和多语言。
- 缺点：持续按时长付费；依赖网络和服务可用性；音频属于高敏数据，需要传输、留存、删除、地域和供应商合规设计；服务端成为新攻击面。
- 适用：端侧模型未达标、愿意显式开启“增强识别”的用户。
- 建议：只做可选增强 Provider；后端默认不落音频，短期日志去标识化；转写结果仍必须经过本地确认闭环。

### 方案 D：ASR + 云端大模型结构化

先 ASR，再把转写文本和允许的本地上下文发送给结构化输出模型，直接返回交易候选；高风险字段仍走本地校验和确认。

- 优点：开放域商户、复杂语序、多轮修正、多笔交易和新类别泛化最好；能做“把刚才第二笔改成报销”一类对话。
- 缺点：成本、延迟、不可预测性、提示注入/越权字段、隐私和供应商锁定；模型输出不能直接绕过 repository 校验。
- 适用：高级/订阅功能，或本地规则失败后的用户主动重试。
- 建议：采用“本地规则先行，低置信度再询问是否使用联网增强”；使用严格 schema、字段白名单、金额整数校验、交易类型语义校验和幂等 operation ID。

### 方案 E：端侧 ASR + 端侧语义模型

端侧 ASR 后，使用量化小模型或专门的序列标注/分类模型提取金额、商户、日期、账户、交易类型；确定性规则负责金额和日期安全兜底。

- 优点：完全离线、开放表达能力强于纯规则、隐私一致。
- 缺点：双模型带来包体和内存压力；训练数据、量化、评测与升级成本高；小模型仍可能在数字上犯不可接受的错误。
- 适用：有足够匿名/合成训练语料和设备性能预算后的中长期版本。
- 建议：现在不优先。先积累用户明确同意的脱敏纠错统计和合成基准，证明规则瓶颈确实是主要流失原因再投入。

### 方案 F：系统级快捷指令 / App Intents

iOS 暴露“开始语音记账”“用文本创建候选”“查询本月支出”等 App Intents；由 Siri、Spotlight、Shortcuts、锁屏组件或 Action Button 触发。Android 可用快捷方式、Widget/Tile 或 Assistant 可发现动作做相邻能力。

- 优点：用户无需先找 App；开发成本远低于自建语音助手；与现有候选/确认逻辑可复用。
- 缺点：平台差异大；系统语音理解和可用性不可完全控制；后台写账会增加数据库并发、解锁和隐私复杂度。
- 适用：高频用户、驾驶/购物等即时场景。
- 建议：iOS 优先实现“打开到预填/确认页”，不要第一版就在后台静默写账。App Intent 只传结构化参数或文本，最终调用共享领域服务并保留幂等和确认策略。

## 5. 方案对比

评分：5 为最有利；成本项 5 表示成本最低。

| 方案 | 离线/隐私 | 跨设备一致性 | 中文潜力 | 包体成本 | 服务成本 | 研发复杂度 | 推荐阶段 |
|---|---:|---:|---:|---:|---:|---:|---|
| A 系统 ASR | 3 | 2 | 3 | 5 | 5 | 4 | 立即保留 |
| B App 内置 ASR | 5 | 4 | 4 | 2 | 5 | 2 | Android 灰度验证 |
| C 云端 ASR | 2 | 4 | 5 | 5 | 2 | 3 | 可选增强 |
| D 云 ASR + LLM | 1-2 | 4 | 5 | 5 | 1 | 2 | 后期高级功能 |
| E 全端侧双模型 | 5 | 4 | 4 | 1 | 5 | 1 | 中长期研究 |
| F 系统快捷入口 | 取决于 A-D | 2 | 取决于 Provider | 5 | 5 | 3 | iOS 近期优先 |

## 6. 推荐组合与路线图

### 第一阶段：把现有路线做成可发布结论

1. 完成 Android 系统路线和 streaming ASR 的同机 A/B 真机测试。
2. benchmark 扩展到至少 200 条，按普通话/口音、安静/噪声、男女声、快慢语速分层。
3. 除 CER 外，以字段准确率为主：金额 exact match、日期、交易类型、账户、分类、多笔边界；金额错误权重大于分类错误。
4. 记录端到端时间：点按到收音、首个 partial、用户停止到 final、final 到候选卡片；同时记录峰值内存、包体和 5 分钟连续使用温升。
5. 完成 iOS Xcode Release 和真机权限/端侧能力验证。

发布选择：普通包默认方案 A；若方案 B 在目标设备矩阵上通过全部门槛，则提供“离线语音包”下载或单独包型，不要因为平均 CER 良好就默认内置。

### 第二阶段：补齐低摩擦入口

1. 新增 iOS App Intents/Shortcuts，先支持“开始记一笔”和“把这段文字转为候选”。
2. 支持锁屏组件/Action Button 跳入语音页。
3. 保持候选确认；只有金额、类型、账户、日期全部明确且用户在设置中主动开启时，才研究“一步确认”。
4. Android 增加应用快捷方式或 Tile，复用同一 Smart Entry deep link。

### 第三阶段：可选联网增强

1. 当本地/系统路线失败或解析低置信度时，提示用户一次性选择云 ASR 或大模型增强。
2. 云端密钥只存在后端；默认不保存音频；请求带短期 ID，不上传完整账本。
3. 先上线云 ASR + 本地解析，只有其结构化召回仍不足时再加入云端大模型。
4. 用真实失败集评估增益；若金额 exact match 或确认耗时没有显著改善，不扩大联网范围。

## 7. 产品与安全原则

- 文案区分“设备本地”“系统语音（可能联网）”“联网增强”，不要统称为“AI 语音”。
- 麦克风必须由用户主动触发，不做后台常驻监听。
- 不保存原始音频应继续作为默认策略；如未来允许上传诊断样本，必须单独、明确、可撤回授权。
- ASR 置信度不能直接当交易正确率；金额/日期/类型需要独立字段置信度和确定性校验。
- 分类错通常可编辑，金额错会破坏账本可信度，因此确认 UI 应优先突出金额和交易方向。
- Provider 失败不得静默切到联网或不同录音所有者；保持当前 fail-closed 设计。
- 外部系统快捷入口也必须使用共享 repository 验证、revision/operation ID 和幂等边界。

## 8. 公开资料

- YNAB：Using Siri and Spotlight with YNAB — https://support.ynab.com/en_us/using-siri-and-spotlight-with-ynab-B1Me9dj5ge
- YNAB：How to Add Transactions in YNAB — https://support.ynab.com/en_us/how-to-add-transactions-in-ynab-HyDwA_byi
- Expensify：Expense Assistant — https://help.expensify.com/articles/new-expensify/concierge-ai/Expense-Assistant
- Expensify：Mobile App / SmartScan — https://use.expensify.com/download
- 钱迹：产品主页 — https://qianjiapp.com/
- 钱迹：Android 自动记账说明 — https://docs.qianjiapp.com/auto/qianji_auto_android.html
- MonAi（Google Play）— https://play.google.com/store/apps/details?id=app.getmonai.android
- Cannie（Google Play）— https://play.google.com/store/apps/details?id=app.cannie
- Money Voice（Google Play）— https://play.google.com/store/apps/details?id=com.swoyef.moneyvoice
- BudgetVoice（Google Play）— https://play.google.com/store/apps/details?id=com.ubrains.budgetvoice
- Apple App Intents — https://developer.apple.com/documentation/appintents
- Apple on-device Speech — https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition
- Android SpeechRecognizer — https://developer.android.com/reference/android/speech/SpeechRecognizer

## 9. 第二轮技术选型调研

### 9.1 端侧 ASR 引擎候选

#### sherpa-ncnn（当前 PoC）

当前项目使用的 14M 中文流式 Zipformer 路线体积小、真正流式、Android/iOS 均有官方构建说明，适合短句低延迟录入。它最大的优势不是“理论准确率最高”，而是 App 能完整拥有麦克风、decoder 和停止时机，正好满足本项目“只有用户点说完才提交”的安全语义。

继续使用它的前提是：在财务短句上通过数字 exact match，而不是只参考通用中文 CER。官方也明确标注小模型速度快但准确率不高，所以它应当被视作待实测候选，而不是默认胜者。

#### sherpa-onnx（优先新增的对照组）

sherpa-onnx 同样支持 Android/iOS、流式与非流式模型，中文模型选择比 sherpa-ncnn 更丰富，并有 INT8、Android 示例和部分 Snapdragon QNN 路线。它的现实价值是：

- 可以比较不同大小 Zipformer，而不是被固定在 14M 模型上；
- ONNX 生态更适合后续模型替换、量化和硬件执行 Provider；
- 可研究中英混合、粤语/方言和设备 NPU 加速；
- 同一 runtime 未来还能承载小型语义分类模型。

代价是 native 包体、算子兼容、ABI、16 KB page alignment、QNN 设备碎片化和模型许可证审计工作都会增加。建议新增实验 flavor，而不是直接替换已工作的 sherpa-ncnn。

#### Vosk

Vosk 有成熟 Android 离线示例和 42 MB 中文小模型，支持修改语言模型/grammar，Apache 2.0 许可清晰。它适合做受限词表或低端设备 baseline。但其官方模型页给出的中文小模型公开错误率明显高于大模型，不能仅凭“离线且体积可接受”进入生产。

建议用途：作为 benchmark 对照，或研究金额数字、分类和账户名的受限 grammar；不建议在未证明财务字段准确率前替换 Zipformer。

#### whisper.cpp

whisper.cpp 支持 Android/iOS 完全端侧运行，语言覆盖广、长文本和非流式转写生态成熟。问题是 Whisper 本质上更偏窗口式转写，移动端持续实时 partial、低功耗和超短首字延迟通常不如原生流式 Transducer/CTC 自然；模型和内存预算也更高。

建议用途：用户录完一小段后离线批处理的“高质量模式”、多语言可选包或 benchmark 对照。它不适合直接替换当前强调实时 partial 和明确 stop 的默认路线，除非真机测试证明延迟、峰值内存与温升可接受。

#### Apple SpeechAnalyzer / SpeechTranscriber

Apple 新的 SpeechAnalyzer 把输入、分析模块和异步结果解耦，SpeechTranscriber 面向通用会话转写，并由 AssetInventory 管理所需资产。对 iOS 26+，它比继续只围绕旧 `SFSpeechRecognizer` 增加补丁更值得验证。

建议采用版本分层：

```text
iOS 26+ 且中文资产可用 -> SpeechAnalyzer + SpeechTranscriber
iOS 15.1-25            -> 现有 SFSpeechRecognizer
以上端侧能力不可用     -> 用户明确同意后才允许系统联网路线
```

它仍是系统 Provider，不能据此承诺所有机型、所有 locale 完全离线；必须实测中文资产状态、首次准备时间、partial 修订行为和停止后的 final 延迟。

### 9.2 端侧语义理解候选

语音记账实际包含两个独立准确率问题：

```text
音频 --ASR--> 转写文本 --NLU--> 结构化交易
```

优化 ASR 不能解决“给小王转了二百，昨天打车三十五”如何拆分、分类和判断交易类型；优化 NLU 也不能修复 ASR 把“三十五”听成“三十五十”。因此 benchmark 必须分别保存人工转写、ASR 输出和结构化结果。

#### 确定性规则（当前方案）

继续作为权威安全层：金额、日期、交易方向、账户约束和 repository 校验不交给生成模型。它可解释、可回归、成本为零，且当前已经支持多笔和本地个性化。

#### 小型序列标注/分类模型

可用 ONNX Runtime Mobile 在 Android/iOS 运行金额之外的实体识别，例如商户、类别、项目和意图分类。模型只提出候选，金额仍由规则提取。相比端侧 LLM，它更小、更稳定、更容易做字段级指标。

适合作为最先研究的端侧 NLU 增强：训练/合成中文口语数据，输出 token 标签和句级交易类型，再与现有规则进行 ensemble。没有足够数据前，不值得急于实现。

#### Apple 端侧 Foundation Models

支持 Apple Intelligence 的设备可以使用 Foundation Models 做实体提取，并通过 `@Generable` guided generation 直接生成受约束 Swift 结构。其优点是不需要随 App 打包大模型，也不需要把文本上传第三方服务器。

限制非常明确：只有支持且开启 Apple Intelligence 的设备可用；Android 无等价统一系统能力；小模型仍可能产生语义错误。推荐把它作为 iOS 可选解析 Provider：生成候选后交给共享确定性验证，不直接执行写账。

### 9.3 云端 ASR 候选与接入方式

国内可选供应商至少包括腾讯云、讯飞和火山引擎；它们均有实时或流式识别能力。腾讯云公开 WebSocket 实时接口和离在线 SDK；讯飞支持短语音、实时转写、方言和热词；火山引擎提供大模型流式识别、智能分句、数字规整和多方言能力。

不应根据宣传准确率直接选型，应使用同一批项目语料做盲测：

| 维度 | 必测内容 |
|---|---|
| 财务正确性 | 数字序列、金额、日期、退款/报销/转账、多笔边界 |
| 中文适配 | 普通话、地方口音、中英商户名、支付宝/微信/银行卡别名 |
| 实时体验 | 首 partial、partial 抖动、stop-to-final P50/P95 |
| 可控性 | 热词、数字规整开关、端点参数、标点、敏感词策略 |
| 工程 | WebSocket 稳定性、并发限制、SDK 体积、错误码、SLA |
| 合规 | 数据地域、音频/转写留存、训练使用、删除机制、审计材料 |
| 商业 | 免费额度、按时长/次数/并发/设备授权、最低购买量、价格变更 |

腾讯的“离在线 SDK”是另一种方案：弱网时本地识别、在线时云端增强，但公开计费包含按设备或按应用授权，并提示重装、刷机、签名和包名变化可能消耗额外设备授权。它能减少自维护模型成本，却带来商业授权和供应商绑定，应单独于纯云 API 评估。

推荐的云端拓扑：

```text
App（短期会话令牌）
  -> 自有语音网关
      -> 供应商 A/B 适配器
      -> 不落原始音频
      -> 仅返回转写、时间戳和供应商置信信息
  -> App 本地解析 / 可选云 NLU
  -> 本地确认与 repository 校验
```

客户端不能内置长期云密钥。语音网关还应负责限流、预算上限、供应商熔断、地域路由和删除审计。早期用户量很小时，也不建议客户端直连长期密钥来节省一个后端。

### 9.4 模型交付方式

内置端侧模型并非只有“放进所有 APK”一种选择：

1. **随安装包内置**：首次即用、离线确定，但所有用户承担包体；适合小模型且语音为核心卖点。
2. **独立语音 flavor**：工程简单、隔离风险，当前项目已采用；缺点是发布、测试和用户选择成本高。
3. **安装后可选下载**：主包轻，用户明确知道体积；需要模型签名、断点续传、原子安装、版本回滚和存储清理。
4. **应用商店按需资产**：利用 Play Asset Delivery / Apple 托管资源减少自建 CDN，但仍要处理平台差异和资源可用性。
5. **系统资产**：Android/iOS 系统 ASR 或 iOS SpeechAnalyzer 资产；包体最小，但可用性和更新时间由系统控制。

若采用下载模型，必须把模型当作可执行供应链资产：锁定 URL、长度、SHA-256、许可证和兼容 runtime 版本；下载到临时位置，校验后原子切换；初始化失败时回滚旧版本，不能静默转联网。

### 9.5 系统级入口深化

iOS App Intents 能让 Siri、Spotlight、Shortcuts、Widget 和 Action Button 发现 App 动作。Android 静态/动态/固定快捷方式可以直达“开始语音记账”，能力声明还能让支持的 Assistant 通过语音命令履约。

推荐暴露的动作按风险分级：

| 动作 | 是否允许后台完成 | 建议 |
|---|---|---|
| 打开语音记账 | 是 | 只导航，不触碰账本 |
| 用一段文本生成候选 | 可 | 生成待确认项，不自动计入统计 |
| 新建确定金额/类别交易 | 暂不允许 | 首版必须展示确认 snippet/页面 |
| 查询本月支出/预算 | 可 | 设备解锁、隐藏敏感金额设置需生效 |
| 修改或删除交易 | 否 | 必须进入 App 且二次确认 |

Android 文档提醒快捷方式元数据可被 Launcher 访问，因此 shortcut label、ID 和 Intent extras 中不能放金额、商户或账户等敏感信息。

## 10. 新增候选组合

### 组合 R1：最小风险发布版

- Android/iOS 继续系统端侧优先；
- 系统能力缺失时保持文字/手工入口；
- 用户逐次同意才使用可能联网的系统语音；
- 新增 iOS/Android 快捷入口；
- 不内置模型、不新增后端。

这是成本最低、最快发布的选择，但必须接受中国 Android 设备覆盖率不稳定。

### 组合 R2：隐私差异化版（推荐主线）

- Android 提供可选下载的 sherpa-ncnn 或胜出的 sherpa-onnx 模型；
- iOS 26+ 优先 SpeechAnalyzer，旧系统保留现有实现；
- NLU 继续确定性本地规则；
- 所有语音默认不出设备；
- 快捷入口只创建候选，不静默落账。

这与当前产品定位最一致。关键决策只剩“哪个端侧模型通过财务 benchmark”和“模型内置还是按需下载”。

### 组合 R3：覆盖率优先版

- 默认系统端侧；
- 失败时提供 App 内置离线和云 ASR 两个显式选项；
- 根据设备性能、模型状态和网络选择推荐项，但不自动切换；
- 云端只转写，本地继续结构化和确认。

适合希望覆盖方言/噪声/低端机的产品，但需要自有语音网关和更复杂的隐私说明。

### 组合 R4：智能助手版

- ASR Provider 任意；
- 本地规则先解析；
- 低置信度时可选端侧 Foundation Model、小型 NLU 或云 LLM；
- 支持“第二笔改成报销”“都记到旅行项目”等多轮修正；
- 生成模型只修改候选草稿，永远不能直接调用写账 repository。

这是长期体验上限最高的方案，但不应在基础 ASR 真机数据和候选确认体验尚未稳定时优先投入。

## 11. 建议新增的实验矩阵

在现有 system vs sherpa-ncnn A/B 基础上，建议按阶段加入：

```text
第一批：Android system / sherpa-ncnn 14M / sherpa-onnx 小中型中文
第二批：iOS SFSpeechRecognizer / iOS 26 SpeechAnalyzer
第三批：最佳端侧模型 / 2 家云 ASR
研究批：Vosk grammar / whisper.cpp / Apple Foundation Models NLU
```

淘汰规则：

- 财务 smoke 任一金额数字错误：不得作为“自动确认”路线；
- P95 stop-to-final 超过 1.5 秒：不得作为默认实时路线；
- 目标低端机出现 OOM、明显持续掉帧或温升异常：不得默认内置；
- 需要未告知联网或无法说明音频留存：不得接入；
- 许可证、模型来源或构建产物无法复现：不得发布。

胜出不必意味着只有一个 Provider。最终可保留“系统轻量路线 + App 离线路线 + 明示云增强”三层，但 UI 只展示用户能理解的选择，不暴露引擎名。

## 12. 第二轮新增资料

- sherpa-ncnn — https://k2-fsa.github.io/sherpa/ncnn/index.html
- sherpa-onnx — https://k2-fsa.github.io/sherpa/onnx/index.html
- Vosk Android — https://alphacephei.com/vosk/android
- Vosk models — https://github.com/alphacep/vosk-space/blob/master/models.md
- whisper.cpp — https://github.com/ggml-org/whisper.cpp
- Apple SpeechAnalyzer — https://developer.apple.com/documentation/speech/speechanalyzer
- Apple Foundation Models — https://developer.apple.com/documentation/foundationmodels
- ONNX Runtime Mobile — https://onnxruntime.ai/docs/get-started/with-mobile.html
- Android App Shortcuts — https://developer.android.com/develop/ui/compose/system/shortcuts
- 腾讯云实时语音识别 API — https://cloud.tencent.com/document/product/1093/101674
- 腾讯云离在线 SDK 计费 — https://cloud.tencent.com/document/product/1093/87739
- 讯飞语音转写 — https://www.xfyun.cn/doc/asr/ifasr_new/lfasr-description.html
- 火山引擎大模型语音识别 — https://www.volcengine.com/docs/6561/1354871
