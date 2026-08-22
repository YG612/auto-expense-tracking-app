# 微信 / 支付宝自动记账执行记录

日期：2026-08-22

范围：在不使用无障碍、屏幕监控、Hook、Root 或消费者账号密码的前提下，增强 Android 支付通知候选路线，并补齐账单文件导入这一主要降级路径。

## 已执行

1. 用 Android API 24+ 内置 `JobScheduler` 替换从通知监听器直接启动后台 Service 的路径。
2. Job 直接启动既有 React Native Headless JS 任务；任务完成后检查原生事件箱，非空则请求退避重试。
3. 保留 App 启动/回前台补导，形成“系统 Job + 前台恢复”两级补偿。
4. 同一个系统通知发生原位更新时，用最新载荷替换尚未导入的旧载荷。
5. Android 13+ 在用户单独允许 `POST_NOTIFICATIONS` 后，成功生成候选会显示本地提醒并深链到 `qingjiai://pending`；拒绝权限不影响记账候选。
6. 共享 TypeScript 解析边界再次校验微信/支付宝包名，防止伪造原生 DTO 绕过白名单。
7. 增加结构化合成通知夹具，覆盖支出、收入、退款、转账、订单号干扰、无金额和普通消息。
8. 账单导入页接入系统文件选择器；Android/iOS 文件桥支持 UTF-8 和 GBK/GB18030 文本。

## 自动证据

- `tsc --noEmit`：通过。
- 全量 Jest：87 个测试套件、708 项测试通过。
- 自动记账/导入定向回归：10 个测试套件、44 项测试通过。
- `git diff --check`：无空白错误。

## 未完成且不得降级表述

- 当前受限执行环境不能写共享 Gradle 缓存锁；复制到工作区后，离线缓存又缺少 React Native Gradle 插件可解析元数据，而联网补全被网络策略禁止。因此 Android Kotlin 编译和 JVM 测试没有在本次执行中形成新证据，临时复制的 1.67 GiB 缓存已经删除。
- 没有连接目标 Android 真机；通知权限、Job 调度、后台延迟、深链提醒和 OEM 杀进程行为均未实测。
- 没有 100 条授权、脱敏的微信/支付宝真实通知；合成夹具不代表真实格式覆盖。
- iOS GB18030 文件读取改动仍需 macOS/Xcode 编译验证。
- 自动生成结果继续固定为待确认，不允许据此宣传“无需核对的自动确认入账”。

## 下一门禁

1. 在可写 Gradle 缓存环境运行 `:app:compileInternalKotlin :app:testInternalUnitTest`。
2. 构建普通 Internal APK，并审计权限仅新增用户可拒绝的 `POST_NOTIFICATIONS`，仍不含网络、无障碍或悬浮窗权限。
3. 在至少一台 AOSP/Pixel 和三种目标 OEM 系统完成通知发布、更新、锁屏、划掉 App、省电限制、重启和权限撤销矩阵。
4. 收集至少 100 条授权脱敏样本，分别报告 precision、coverage、金额准确率、方向准确率、重复率和 P50/P95 导入延迟。
5. 在 macOS 完成 iOS 文件桥与 Share Extension 的 Xcode 构建和真机回归。
