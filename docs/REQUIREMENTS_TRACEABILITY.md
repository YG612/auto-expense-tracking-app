# 轻记 AI 需求追踪矩阵

状态：骨架。当前工作区中的权威需求文件位于 App 仓库之外的 `work/source_docs/`。在它们以受审查的只读副本纳入 GitHub 仓库前，本表只能帮助追踪，不能防止权威文档漂移。

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

| ID              | 需求                             | 当前证据                                                    |       状态 | 发布门槛                            |
| --------------- | -------------------------------- | ----------------------------------------------------------- | ---------: | ----------------------------------- |
| REQ-DATA-001    | SQLite、整数分、版本迁移、软删除 | v4 revision/CAS；migration integrity 门禁；repository tests | 已实现基础 | N-1 真实数据库升级与低存储验证      |
| REQ-MANUAL-001  | 手动新增、编辑、删除、恢复       | 统一写入校验、CAS；`manualBookkeeping.test.ts`              |     已实现 | 真机并发/冲突闭环                   |
| REQ-STATS-001   | 月度收入、支出、结余和分类统计   | analytics service/tests                                     | 已实现基础 | 大数据量和设备性能验证              |
| REQ-TEXT-001    | 中文文字解析、多笔、确认、待确认 | classification/session tests                                | 已实现基础 | 验收 1–13 的显式映射补齐            |
| REQ-VOICE-001   | 语音转文字并进入同一解析         | speech native/controller/tests                              |       候选 | ColorOS/iOS 真机矩阵仍必需          |
| REQ-LEARN-001   | 纠正反馈与可管理规则             | personalization repositories/UI/tests                       | 已实现基础 | 删除全部与保留策略覆盖              |
| REQ-PRIV-001    | 默认不保存音频                   | 原生模块和共享入口                                          | 已实现基础 | 真机/Release 隐私验证               |
| REQ-PRIV-002    | 可关闭原始文字保存               | 设置开关、统一写入策略、事务性历史清除及测试                | 已实现基础 | 真机升级与隐私验收                  |
| REQ-PRIV-003    | 基础 PIN/指纹/面容锁             | 无                                                          |   **缺失** | 第一版发布阻断                      |
| REQ-DATA-002    | CSV 导出                         | 无                                                          |   **缺失** | 第一版发布阻断                      |
| REQ-DATA-003    | 本地备份和恢复                   | 无                                                          |   **缺失** | 第一版发布阻断                      |
| REQ-DATA-004    | 清除全部数据                     | 无                                                          |   **缺失** | 覆盖交易/回收站/规则/反馈/设置/缓存 |
| REQ-CUSTOM-001  | 用户自定义分类和账户管理         | 当前仅默认数据/规则管理                                     |       部分 | 按 PRD 补验收，不扩展会计范围       |
| REQ-BUDGET-001  | 月度总预算和分类预算设置         | 数据/展示存在，设置入口未闭环                               |       部分 | 第一版设置与验收                    |
| REQ-DUP-001     | 重复标记、统计排除、合并来源     | schema/统计排除存在                                         |       部分 | 检测、合并和验收 15 未闭环          |
| REQ-ANDROID-008 | 支付通知自动记账                 | 持久事件箱、Headless JS、前台补偿、幂等落库与测试           |   候选实现 | 微信/支付宝真实通知与 OEM 真机矩阵  |
| REQ-IOS-009     | App Intent/分享/OCR 结构         | 未开始                                                      |     阶段 9 | 不承诺监听其他 App 通知             |

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
| AT-15    | 导入重复交易                     | 只有 schema/统计排除                  |                      未闭环 |
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
| NFR-MIG-001      | migration 重复、原子、兼容 |                         v1–v4 原子迁移 + SHA-256 不可变门禁 | N-1 真实数据库升级                                  |
| NFR-ERR-001      | 错误明确且不泄露           |                 AppError 安全文案、稳定错误码、根边界及测试 | Release 日志/截图人工复核                           |
| NFR-A11Y-001     | 辅助功能                   |                               role/label 与 48dp token 基础 | TalkBack/VoiceOver、大字体、对比度矩阵              |
| NFR-PERF-001     | 快速启动和大数据量         |                                                 无预算/基准 | 冷启动、10k/100k、SQL query plan                    |
| NFR-SUPPLY-001   | 可复现依赖                 |                   frozen CI、pnpm lock、Gradle 分发 SHA-256 | Pod/Gem locks 与 Gradle dependency verification     |
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
