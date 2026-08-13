## 需求与范围

- Requirement IDs:
- Acceptance IDs:
- 本 PR 是否严格位于当前 PRD/阶段范围内：
- 明确未实现或未改变的内容：

## 架构与数据

- 领域不变量或写入边界变化：
- 新增/读取/保留/删除的数据：
- migration、升级和前向修复影响：
- Android/iOS 差异与降级：

## 安全与隐私

- 权限、网络、日志、原始文字/语音、导出或第三方依赖变化：
- 是否触及包名、版本、签名或 CI secret：
- 威胁模型已更新：是 / 不适用（说明原因）

## 验证证据

- [ ] `pnpm release:identity:test`
- [ ] `pnpm release:identity:check`
- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test:ci`
- [ ] Android JVM tests/internal assemble（如适用）
- [ ] iOS macOS build（涉及 iOS/原生代码时必需）
- 真机设备、系统和步骤：

## 风险与发布

- 已知 P0/P1、负责人和退出条件：
- 失败检测与 roll-forward 方式：
- 截图或用户可见变化：
