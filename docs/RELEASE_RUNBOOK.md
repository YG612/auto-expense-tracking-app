# 轻记 AI 发布与回滚运行手册

本文区分“可在真机验证的内部包”和“可公开分发的生产包”。任何本地构建成功都不能自动升级为生产发布结论。

## 1. 当前目标身份

权威值位于 `config/release-identity.json`：

| 项目                        | 当前目标                |
| --------------------------- | ----------------------- |
| 产品版本                    | `1.0.7`                 |
| Android versionCode         | `8`                     |
| iOS CURRENT_PROJECT_VERSION | `8`                     |
| Android 生产 ID             | `com.qingjiai`          |
| Android 内部 ID             | `com.qingjiai.internal` |
| iOS 生产 Bundle ID          | `com.qingjiai`          |
| iOS Share Extension ID      | `com.qingjiai.share`    |

版本和 build 必须单调递增。修改版本时先更新 metadata 和历史，再同步平台文件；`pnpm release:identity:check` 会拒绝漂移。

本轮候选新增显式 Android Internal `streamingAsr` 实验轨道：App 自持 AudioRecord，关闭模型端点自动提交，只有用户点按“说完了”才产生 final。APK 已完成构建与静态产物审计，但尚未完成 USB 真机、性能或准确率验证，不得作为生产发布结论。

## 2. 发布轨道与签名

### Android internal

- 使用独立 `internal` build type，并通过 `.internal` 后缀与生产 ID 隔离；它继承 Release 的 Bundle 行为，但使用公开 Debug key。
- 可以使用模板 Debug key，仅供受控测试；不得上传应用商店或称为 Production Release。
- CI 只编译 arm64 internal APK 并运行 JVM tests，不保存任何生产签名 secret。
- 这是默认轻量测试轨道；不得把语音模型、sherpa-onnx 或其他离线推理运行时混入该制品。

### Android internal streamingAsr 实验轨道

- 只有显式传入 `streamingAsr=true` 的 Internal 构建可以加入 sherpa-ncnn 与约 25 MB 的 Zipformer 普通话模型。已废弃的 200 MB 级 SenseVoice PoC 不再保留可执行构建入口。
- 该实验轨道由 App 自持 AudioRecord 采集 16 kHz 单声道 PCM16，音频只在原生层流式解码，不跨 React Native、不落盘也不上传。
- decoder 的 endpoint detection 必须关闭；partial 仅作转写预览，只有用户点按“说完了”才停止采集并产生 final。取消、生命周期离开与 30 秒安全超时均不得产生 final。
- 普通 Internal、Production、Debug 与 iOS 不内置模型或 sherpa-ncnn。系统兼容包仍可由用户显式选择系统语音，但不能把系统端点行为描述为 App 自持流式识别。
- runtime/model 准备门为 fail-closed；arm64 APK 已完成构建、权限、ABI、模型哈希、许可证/SBOM、16 KB ELF 对齐和 v2 测试签名审计。USB 真机、普通话准确率、口音、噪声、内存、延迟、功耗与长时间稳定性仍是发布阻断证据。

```powershell
pnpm android:streaming-asr:verify:windows
pnpm android:verify:streaming-asr:windows
```

### Android production

- 使用 `release` build type 和仓库外 `productionRelease` signing config。
- 仅引用以下 CI/签名机 secret 名称：

```text
QINGJI_ANDROID_RELEASE_STORE_FILE
QINGJI_ANDROID_RELEASE_STORE_PASSWORD
QINGJI_ANDROID_RELEASE_KEY_ALIAS
QINGJI_ANDROID_RELEASE_KEY_PASSWORD
```

- secret 缺失、文件不存在或签名校验失败时必须停止，不允许回退 `signingConfigs.debug`。
- 仓库允许保留 `android/app/debug.keystore` 供隔离的 internal 轨道使用；其他 `.keystore`、`.jks`、`.p12` 和 provisioning profile 不得提交。

### iOS production

- Bundle ID 固定为 `com.qingjiai`。
- Apple Distribution certificate、profile 和 Team 配置只存在于受控 macOS/CI 环境。
- Windows 只能做源文件检查，不能声称完成 Xcode、Archive、签名或真机验证。

## 3. 合并前门禁

```powershell
pnpm install --frozen-lockfile
pnpm release:identity:test
pnpm release:identity:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:ci
```

Android 还必须运行 JVM tests 与普通 internal assemble。触及轻量流式实验代码时，必须额外运行 `android:verify:streaming-asr:windows` 及最终 APK 后验。默认 CI 的无模型 Internal 不能替代显式实验包证据。iOS 在 `Gemfile.lock` 和 `ios/Podfile.lock` 经过 macOS 审核并提交后，CI 才执行 CocoaPods deployment install 和 simulator build。缺少这些锁时，CI 只报告静态检查，不能记为 iOS build pass。

## 4. 候选发布步骤

1. 冻结需求 ID、数据库 schema、依赖 lockfile 和目标版本。
2. 确认 Pull Request 无未解决 P0，独立代码审查通过。
3. 从干净 checkout 使用 frozen lock 安装依赖。
4. 执行全部 JS、数据库、Android JVM 和 iOS native 门禁。
5. 在至少一台目标 Android 和一台目标 iPhone 执行冷启动、升级、离线、权限拒绝、语音不可用、低存储、进程被杀和大字体用例。
6. 使用 N-1 真实数据库安装升级，不允许测试过程清除 App 数据。
7. 生产构建只在签名环境执行；记录 commit、版本、build、依赖锁哈希和构建时间。
8. Android 使用 `apksigner verify --verbose --print-certs` 和 `zipalign -c`；iOS 使用 Xcode Archive validation。
9. 计算最终 APK/AAB/IPA 的 SHA-256，制品与测试证据一起归档。
10. 先进入内部/小范围测试，观察明确时间窗后再扩大。当前没有隐私合规的遥测，不得虚构 crash-free 指标；用可复现工单和稳定错误码收集反馈。

## 5. 生产发布阻断项

以下任一项未完成，都不得把制品标记为生产可用：

- [ ] `pnpm release:identity:check` 通过。
- [ ] Production Release 不使用 Debug key，且签名 secret 未进入仓库或日志。
- [ ] Android internal 包名不是 `com.qingjiai`。
- [ ] iOS macOS simulator/Archive、签名和真机测试通过。
- [ ] `Gemfile.lock` 与 `ios/Podfile.lock` 已审查并锁定。
- [ ] PRD 第一版的 CSV、备份恢复、隐私锁、原始文本开关和删除全部数据已验收。
- [ ] 数据库 N-1 升级、失败原子性和 future schema fail-closed 通过。
- [ ] 隐私政策、敏感权限说明、数据删除说明和第三方清单已准备。
- [ ] 生产制品哈希、签名证书指纹和测试矩阵已归档。
- [ ] `streamingAsr` 已完成 runtime/model 准备、APK 构建后验和 USB 真机性能/准确率矩阵；在此之前只允许标记为实验候选。

## 6. 已安装 Debug 签名包的处理

历史测试包曾使用 `com.qingjiai` + 公共 Debug key。Android 不允许普通更新把既有包切换到新生产签名。测试用户需要：

1. 将其中数据视为测试数据；
2. 在生产签名切换前按明确说明卸载旧包；
3. 安装新的 `.internal` 测试包继续测试；
4. 生产版只从可信渠道安装。

在应用内备份恢复尚未实现时，卸载会删除本地账本，因此不得要求持有真实重要数据的用户直接卸载而不告知数据后果。

## 7. 数据库发布与回滚

### 发布规则

- 已发布 migration 永不修改、重排或复用版本号。
- 只添加向前 migration，并在事务中应用。
- CI 记录 migration fingerprint，并从 N-1 数据库验证升级后的行数、金额、关联和统计。
- 新代码必须拒绝未知 future schema，不得自动清空或降级。

### 回滚规则

移动数据库不执行破坏性的 down migration。若新版本有严重问题：

1. 停止扩大分发；
2. 保留受影响数据库，不要求清数据重装；
3. 从问题 commit 切出 hotfix；
4. 使用更高 versionCode/build 发布前向兼容修复；
5. 如必须禁用某入口，只关闭入口，不删除其数据结构；
6. 用故障数据库副本验证修复，再签名分发；
7. 完成根因、影响、检测缺口和回归测试复盘。

重新发布较旧二进制不等于安全回滚；旧代码可能不理解新 schema，并且应用商店/系统通常要求 build 单调递增。

## 8. 发布证据模板

```text
Commit:
Version / build:
Track: internal | production
Android application ID / certificate SHA-256:
iOS bundle ID / Team / profile:
pnpm lock SHA-256:
Migration versions and fingerprint:
JS tests:
Android JVM/build/device tests:
iOS simulator/archive/device tests:
Upgrade source version and database fixture:
Artifact SHA-256:
Known limitations / approved exceptions:
Reviewer:
Release decision and time:
```
