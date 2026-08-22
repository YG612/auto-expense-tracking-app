# PR #12 隐私生命周期专项审查

日期：2026-08-22

范围：删除全部数据、加密备份恢复、Android 支付通知事件箱、Android Agent 临时命令、iOS Share Extension 临时载荷。

## 结论

代码级 P1 问题已关闭，并新增独立 CI 门禁 `pnpm review:privacy-lifecycle`。合并前仍需完成 Android/iOS 真机残留检查；专项审查不替代完整 PR 审查，也不覆盖 PR 中的 ASR、OCR、分类模型等其他模块。

## 已关闭问题

### 1. 删除全部数据遗漏原生敏感存储

修复后的删除顺序：

1. 用户输入固定确认语句并通过系统身份验证。
2. 并行尝试清理全部原生临时存储；任何一个失败都阻止数据库删除，并返回可重试错误。
3. Android 支付通知清理会关闭本机采集开关、删除 AtomicFile、取消后台 Job 和待确认提醒。
4. Android Agent 清理会删除 inbox 与 results 两个 no-backup 目录。
5. iOS 清理会删除 App Group 中所有 `shared-entry.` 前缀载荷。
6. 原生清理成功后，SQLite 用户数据在单个事务中删除并执行空表验证。

跨 SQLite、SharedPreferences、文件系统和 App Group 无法组成同一个事务，因此 UI 不再宣称“全部本机数据全局原子删除”。如果数据库事务失败，原生临时数据可能已经被安全清除，但 SQLite 不会部分提交。

### 2. 备份恢复了设备级通知同意

新建备份时，`experimental_feature_settings.payment_notifications_enabled` 固定序列化为 `0`；恢复历史备份时再次强制归零。`image_ocr_enabled` 等非设备授权设置仍按备份恢复。

恢复流程先完成解密和文档完整性验证，再清理当前设备的通知、Agent 与分享临时输入，最后进入 SQLite 恢复事务。这样错误口令或损坏文件不会清空临时输入，成功恢复也不会让旧输入污染恢复后的账本。

## 自动化证据

专项门禁覆盖：

- 删除页面在身份验证后调用三类原生清理，并在完成后清空 SQLite。
- 任一原生存储清理失败时，其他存储仍会被尝试，最终返回不完整清理错误。
- 新备份不携带通知监听同意。
- 带有旧通知同意值的历史备份恢复后仍保持关闭。
- Android 通知清理关闭采集、取消 Job 和提醒。
- Android Agent inbox/results 与 iOS App Group 均暴露明确清理桥接。

运行命令：

```text
pnpm review:privacy-lifecycle
pnpm typecheck
pnpm lint
pnpm format:check
```

## 合并前人工检查

- Android：开启通知监听、制造未导入通知与待确认提醒，执行删除全部后检查开关、Job、通知和 no-backup 事件箱。
- Android Internal：注入一条 Agent command 和 result，执行删除全部后检查两个目录为空，重启后不得重新生成待确认账。
- iOS：从 Share Extension 写入但不消费载荷，执行删除全部后检查 App Group 不再包含 `shared-entry.` 键。
- 备份恢复：在当前设备关闭通知辅助记账，恢复一个历史上开启过该功能的备份；重启和前后台切换后仍必须保持关闭。
- 故障注入：让一个原生清理桥拒绝，确认 SQLite 删除未开始，错误文案不声称全部数据保持原状。

## 剩余风险

- Android/iOS 真机文件与权限状态尚不能由 Linux CI 完整验证。
- 用户通过系统文件面板保存的 CSV 或加密备份属于用户控制的外部副本，删除 App 内数据不会删除这些文件；UI 必须持续明确这一边界。
- PR #12 仍然体量过大，建议对通知/OCR、Agent、ASR、模型、账本完整性分别保留模块负责人审查记录。
