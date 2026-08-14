# 轻记 AI 需求追踪矩阵

状态：持续维护。三阶段竞争力方案已映射到代码和测试；仓库外原始需求仍需在发布前归档为受审查副本。

## 1. 权威来源

| 来源                              | 作用                                   |
| --------------------------------- | -------------------------------------- |
| `README.md`（项目需求包）         | 产品定位与开发原则                     |
| `PRD.md`                          | 第一版必需范围、页面、隐私和非功能要求 |
| `CATEGORY_TAXONOMY.md`            | 收支分类和特殊交易边界                 |
| `DATA_MODEL.md`                   | 数据实体、整数金额、迁移与软删除要求   |
| `NLP_AND_CLASSIFICATION_RULES.md` | 文本处理顺序、优先级与置信度           |
| `AUTO_BOOKKEEPING_ROADMAP.md`     | Android/iOS 自动化能力边界             |
| `ACCEPTANCE_TESTS.md`             | 20 个业务验收场景                      |
| `CODEX_MASTER_PROMPT.md`          | 阶段顺序和每阶段质量门禁               |

需求变更必须修改权威文档、说明范围影响并获得用户确认。代码或 PR 不能用 README 的一句“已完成”覆盖 PRD 未完成项。

## 2. 第一版能力矩阵

| ID              | 需求                             | 当前证据                                                  |       状态 | 发布门槛                       |
| --------------- | -------------------------------- | --------------------------------------------------------- | ---------: | ------------------------------ |
| REQ-DATA-001    | SQLite、整数分、版本迁移、软删除 | v14；revision/CAS；migration integrity；repository tests  |     已实现 | N-1 真实数据库升级与低存储验证 |
| REQ-MANUAL-001  | 手动新增、编辑、删除、恢复       | 统一写入校验、CAS；`manualBookkeeping.test.ts`            |     已实现 | 真机并发/冲突闭环              |
| REQ-STATS-001   | 月度收入、支出、结余和分类统计   | analytics service/tests                                   | 已实现基础 | 大数据量和设备性能验证         |
| REQ-TEXT-001    | 中文文字解析、多笔、确认、待确认 | classification/session tests                              | 已实现基础 | 验收 1–13 的显式映射补齐       |
| REQ-VOICE-001   | 语音转文字并进入同一解析         | speech native/controller/tests                            |       候选 | ColorOS/iOS 真机矩阵仍必需     |
| REQ-LEARN-001   | 纠正反馈与可管理规则             | 冲突预览、命中历史、导出/停用/删除学习数据及测试          |     已实现 | 真机可用性验收                 |
| REQ-PRIV-001    | 默认不保存音频                   | 原生模块和共享入口                                        | 已实现基础 | 真机/Release 隐私验证          |
| REQ-PRIV-002    | 可关闭原始文字保存               | 设置开关、统一写入策略、事务性历史清除及测试              | 已实现基础 | 真机升级与隐私验收             |
| REQ-PRIV-003    | 基础指纹/面容/设备凭据锁         | PrivacyGate、平台认证桥、后台宽限期、截图/快照保护        |     已实现 | Android/iOS 真机验收           |
| REQ-DATA-002    | CSV 导出                         | 整数金额、公式注入防护、系统文件面板、UI/数据库测试       |     已实现 | Android/iOS 文件往返           |
| REQ-DATA-003    | 本地备份和恢复                   | v1 快照、PBKDF2/AES-GCM、校验、事务恢复、原生合同测试     |     已实现 | Android/iOS 真机往返           |
| REQ-DATA-004    | 清除全部数据                     | 数据概览、确认短语、全表事务清除与失败回滚测试            |     已实现 | 真机低存储/中断验收            |
| REQ-CUSTOM-001  | 用户自定义分类和账户             | 手动记账选择器可就地新建，统一 repository 持久化          | 已实现基础 | 重命名/隐藏作为后续增强        |
| REQ-BUDGET-001  | 月度总预算和分类预算设置         | 月份切换、总额/分类编辑、原子替换、UI/数据库测试          |     已实现 | 真机大字体验收                 |
| REQ-DUP-001     | 重复识别、统计排除、导入撤销     | 导入指纹、确定/疑似重复、批量审核与整批撤销测试           |     已实现 | 多来源真实样本对账             |
| REQ-ANDROID-008 | 支付通知自动记账                 | 未开始                                                    |     阶段 8 | 只在阶段 1–7 P0 稳定后开始     |
| REQ-IOS-009     | 快捷入口/分享/OCR 结构           | deep link、quick action、Share Extension、Vision 本地 OCR |       候选 | macOS 编译与 iPhone 真机       |

“阶段 1–7 已实现”描述的是开发阶段，不代表上表所有第一版发布条件已经完成。

## 3. 原始验收用例映射

| 验收 ID  | 主题                             | 自动化证据                            |                    当前判定 |
| -------- | -------------------------------- | ------------------------------------- | --------------------------: |
| AT-01–03 | 午餐、早餐、酒店解析             | `textClassification.test.ts` 明确映射 |                  自动化覆盖 |
| AT-04–05 | 旅行分类/项目标签                | 分类测试有旅行上下文用例              |        部分覆盖，需逐条命名 |
| AT-06–10 | 转账、还款、退款、报销、朋友还款 | 分类优先级与 analytics tests          | 部分覆盖，需保存/统计端到端 |
| AT-11    | 一句话多笔                       | text/voice tests                      |                  自动化覆盖 |
| AT-12–13 | 充值、个人付款歧义               | `textClassification.test.ts`          |                  自动化覆盖 |
| AT-14    | 三次纠正、第四次规则             | personalization learning tests        |                  自动化覆盖 |
| AT-15    | 导入重复交易                     | statement import repository/UI tests  |                  自动化覆盖 |
| AT-16    | 离线核心功能                     | 本地架构成立                          |              需真机断网验收 |
| AT-17    | 关闭 AI 后完全本地               | 当前未接云 AI                         |             需设置/网络断言 |
| AT-18    | 删除与短期恢复                   | manual/repository tests               |              自动化基础覆盖 |
| AT-19–20 | 特殊交易统计、退款冲减           | `analytics.test.ts` 明确映射          |                  自动化覆盖 |

新增或修改测试时，应在测试名称中包含相应 `REQ-*`/`AT-*`，避免靠人工猜测覆盖关系。

## 4. 非功能与发布追踪

| ID               | 要求                       |                                                    当前状态 | 下一证据                                            |
| ---------------- | -------------------------- | ----------------------------------------------------------: | --------------------------------------------------- |
| NFR-SEC-001      | 生产签名与身份隔离         | Android 轨道与 fail-closed 配置已建立，仍待 CI/真实证书验证 | `release:identity:check` 通过 + 证书指纹 + 升级路径 |
| NFR-CI-001       | 每次合并自动质量门禁       |                                               workflow 候选 | 首次 GitHub Actions 绿色运行                        |
| NFR-IOS-001      | iOS 可编译运行             |                                              Windows 未验证 | macOS simulator + 真机证据                          |
| NFR-MIG-001      | migration 重复、原子、兼容 |                        v1–v14 原子迁移 + SHA-256 不可变门禁 | N-1 真实数据库升级                                  |
| NFR-ERR-001      | 错误明确且不泄露           |                 AppError 安全文案、稳定错误码、根边界及测试 | Release 日志/截图人工复核                           |
| NFR-A11Y-001     | 辅助功能                   |                               role/label 与 48dp token 基础 | TalkBack/VoiceOver、大字体、对比度矩阵              |
| NFR-PERF-001     | 快速启动和大数据量         |                                                 无预算/基准 | 冷启动、10k/100k、SQL query plan                    |
| NFR-SUPPLY-001   | 可复现依赖                 |         pnpm lock；已修复可获取补丁的公告；危险图片格式门禁 | `image-size >=2.0.3` 发布后升级；Pod/Gem locks      |
| NFR-ROLLBACK-001 | 失败后安全修复             |                        migration future-version fail-closed | roll-forward 演练和运行手册证据                     |

## 5. Pull Request 最小追踪字段

```text
Requirement IDs:
Acceptance IDs:
Out-of-scope confirmation:
Data added/read/retained/deleted:
Migration and rollback impact:
Automated tests:
Android device/build evidence:
iOS device/build evidence:
Known P0/P1 and owner:
```
