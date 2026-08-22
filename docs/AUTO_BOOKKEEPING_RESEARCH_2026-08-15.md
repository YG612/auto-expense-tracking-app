# 微信 / 支付宝自动记账：方案调研与实现决策

更新时间：2026-08-15

适用版本：轻记 AI `1.0.7` / Android API 24+

## 1. 结论

普通消费者不存在一个可由第三方记账 App 授权后实时拉取其完整微信、支付宝交易的官方开放 API。微信支付成功回调和查询订单面向接入支付的商户，支付宝账单下载接口也面向商户或获商户授权的服务商；它们不能解决个人跨商户消费同步。

因此，Android 第一版采用系统公开的 `NotificationListenerService`，只允许微信 `com.tencent.mm` 与支付宝 `com.eg.android.AlipayGphone`，再以“原生持久事件箱 → Headless JS 自动分析和幂等落库 → 前台恢复补偿”形成闭环。它不使用无障碍、不截屏、不 Hook 支付 App、不联网，也不索取账号密码。

由于支付通知可能缺少真实资金账户、商品明细或分类，新记录默认进入“待确认”，不直接污染资产和统计。这里的“自动”指交易发生后无需进入设置点导入，系统自动捕获并生成账本候选；最终确认仍是风险边界。

## 2. 官方能力边界

- Android 官方的 [`NotificationListenerService`](https://developer.android.com/reference/android/service/notification/NotificationListenerService) 会在新通知发布时收到系统回调，但必须在 Manifest 声明受系统权限保护的服务，并由用户在系统设置显式授予通知使用权。
- [微信支付成功回调](https://pay.wechatpay.cn/doc/v3/merchant/4012791861)发送到商户下单时配置的 `notify_url`；[查询订单](https://pay.wechatpay.cn/doc/v2/merchant/4011987538)同样要求直连商户的 appid、商户订单号等身份。
- [支付宝账单下载接口](https://developer.alibaba.com/docs/doc.htm?articleId=1054&docType=4&treeId=180)明确描述的是商户交易收单账单或经商户授权的服务商账单。
- iOS 的 [`UNNotificationServiceExtension`](https://developer.apple.com/documentation/usernotifications/unnotificationserviceextension)只会在“本 App 收到符合条件的远程通知”时被系统加载，不是读取其他 App 通知的入口。可行降级是用户主动调用 [Share Extension](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html) 分享截图或文本。

## 3. 同类软件与开源方案

| 方案                  | 代表实现                                                                                                                                  | 优点                                               | 主要代价                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| 无障碍读取支付成功页  | [小星记账](https://cxincx.com/support/auto/3.html)、[钱迹 Android](https://docs.qianjiapp.com/work-log/log202412.html)                    | 可读金额、商户、付款账户、优惠、订单号，覆盖面较广 | 持续读取屏幕树，依赖悬浮窗/后台保活，支付页一改就要适配；权限与披露负担高 |
| 通知监听              | [AutoAccounting](https://github.com/AutoAccountingOrg/AutoAccounting)列出的“应用通知”渠道                                                 | Android 公开 API、事件驱动、权限更窄、无需屏幕监控 | 支付 App 未发通知或通知不含金额时无法识别，部分 ROM 可能限制后台启动      |
| Xposed / Hook         | AutoAccounting 的应用内数据渠道                                                                                                           | 可直接读取应用内部消息、数据库或 WebView，精度高   | 依赖 Root/框架，强耦合私有实现，安全与分发风险不可接受                    |
| OCR / 截图 / 快捷指令 | [一木记账 iOS](https://www.yimuapp.com/doc/bill/autoios.html)、[钱迹 HarmonyOS](https://docs.qianjiapp.com/auto/qianji_auto_harmony.html) | 跨平台，支付页信息丰富，用户主动触发时隐私边界清楚 | 不能保证交易发生时无人值守；OCR 和 UI 变化带来误差                        |
| 历史账单文件导入      | [小星记账账单导入](https://cxincx.com/support/common/import.html)                                                                         | 适合补历史、字段相对完整                           | 非实时；导出流程长，文件格式会变化                                        |

竞品更新记录也反复出现“订单号误判金额、支付页面变化、系统后台限制、重复弹窗”等问题。这说明高质量自动记账不是增加几个正则即可，而需要持久化、幂等、失败补偿、严格金额上下文和可诊断边界。

Google Play 对无障碍 API 要求单独声明、显著披露与明确同意，并要求能用更窄 API 时优先使用更窄 API，见 [AccessibilityService 政策](https://support.google.com/googleplay/android-developer/answer/10964491)。这进一步支持通知优先而不是无障碍优先。

## 4. 本项目实现

```text
微信 / 支付宝通知
        │ 系统回调；包名白名单 + 支付语义 + 聊天消息排除
        ▼
Android noBackupFilesDir 原子事件箱（最多 100 条、最长 7 天）
        │
        ├─ JobScheduler 启动 Headless JS：自动导入、非空队列退避重试
        └─ OEM 继续限制后台：下次 App 启动/回前台补导
        ▼
金额/方向/商户解析 → 共享本地分类与账户管线
        ▼
SQLite 原子批次、source_reference_id 幂等去重
        ▼
待确认（用户核对账户、分类、转账目标）
```

关键约束：

- 默认关闭；仅用户在 App 内开启后，原生端才开始接收并持久化候选。
- 不扫描开启前的活动通知。关闭功能会立即清除尚未导入的通知原文。
- 事件箱使用 `AtomicFile`，位于 `noBackupFilesDir`，App 私有且不进入系统备份；上限 100 条，超过 7 天自动丢弃。
- 主 Manifest 显式移除离线 OCR 依赖传递的 `INTERNET` 与 `ACCESS_NETWORK_STATE`；普通 Internal 产物门禁直接检查最终 APK 并拒绝网络权限。只有 Debug 覆盖恢复 Metro 所需的 `INTERNET`。
- 原生层只采集最小 DTO；交易语义、分类和数据库写入仍走共享 TypeScript 领域层。
- 只有账本事务成功后才确认删除整个通知批次。进程崩溃、数据库失败或后台任务失败都会保留事件用于重试。
- 同一通知以稳定来源哈希去重；即使“已落库、尚未确认事件”时崩溃，重放也不会产生第二笔账。
- 同一系统通知原位更新时，尚未导入的事件箱记录会替换为最新有效内容，避免永久保留“处理中”等旧载荷。
- Android 13+ 只有在用户另行允许 App 发送通知后才显示待确认提醒；拒绝提醒权限不影响捕获、落库或前台补导。
- 无金额通知会在一次成功批次后丢弃，避免敏感原文永久滞留。
- 系统文件选择器可直接读取微信/支付宝 CSV，并在 UTF-8 之外支持常见的 GBK/GB18030；源文件不复制进账本，解析结果继续进入待确认。

## 5. 已知边界与下一步

1. 微信或支付宝关闭通知、隐藏金额、使用仅支付页展示结果的场景，通知路径无能为力。后续可把现有本地截图 OCR 作为用户主动补录，而不是静默升级为无障碍监控。
2. 通知通常只能确定“支付渠道”，不一定能确定花呗、银行卡或零钱等真实资金账户，因此默认待确认。
3. 部分 OEM 会阻止后台启动 React Native。持久事件箱保证不丢，前台补导保证最终一致，但是否能达到秒级需要真机矩阵验证。
4. 支付 App 文案会演进。解析规则必须以脱敏、授权的真实通知样本回归，不能依赖网络收集用户通知。
5. iOS 不承诺后台监听。应继续使用已有 Share Extension + 本地 OCR，并可增加 App Intent / 快捷指令以缩短主动触发路径。
6. 仓库中的 `data/fixtures/payment-notifications.synthetic.json` 是明确标记的合成回归数据，不得用它宣称真实捕获率或生产准确率。

## 6. 真机验收

- 开关默认关闭；授予系统通知使用权但不开 App 内开关时，不生成事件。
- 开启后分别完成微信消费、支付宝消费、微信收款、支付宝退款和微信转账；核对金额、方向、渠道账户、时间、商户与待确认状态。
- 模拟 App 被划掉、锁屏、后台、省电限制：支付后重新打开 App，事件应自动补导且只出现一次。
- 在账本提交后、原生确认前强杀进程并重试，不得重复入账。
- 发送包含“付款成功 100 元”字样的普通微信聊天，不能触发。
- 关闭开关后检查队列为 0，后续支付不再捕获；撤销通知使用权后不得再接收新事件。
- 收集至少 100 条经授权、脱敏的不同微信/支付宝版本通知样本，统计捕获率、金额准确率、误触发率和后台延迟。
