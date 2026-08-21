# 离线语音工程执行阻塞报告

## 状态

```text
NEW_CTC_ENGINEERING=PASS
ACCURACY=WAITING_FOR_AUTHORIZED_WAV
LEGACY_ONNX_COMPATIBILITY=PASS
LEGACY_NCNN_COMPATIBILITY=BLOCKED_BY_LOCKED_AAR_PROVENANCE
AUTO_SHUTDOWN=NOT_SCHEDULED
```

按照实施计划，“旧语音轨道不受影响”属于整体成功条件。旧 ncnn Internal 需要本地文件 `qingji-sherpa-ncnn-arm64-2.1.7-qingji.1.aar`，该文件被 `.gitignore` 排除、没有公开下载 URL，公开搜索也找不到文件名或锁定 SHA-256。因此本次不能把整体状态标为成功，也没有执行关机命令。

## 已完成的自助恢复

从锁文件中的官方 URL 下载并验证了四个归档：

- sherpa-ncnn commit `72ea103e9b2f56c052e7c400a8c965c143153f31`
- `kaldi-native-fbank-1.18.6.tar.gz`
- `ncnn-sherpa-1.1.tar.gz`
- `sherpa-ncnn-streaming-zipformer-zh-14M-2023-02-23.tar.bz2`

修复了旧脚本的三个 Windows 可复现问题：

- Git 不再硬编码到不存在的 `D:\360Downloads\Git\cmd\git.exe`。
- patch 和 Apache 许可证在校验/打包前统一为 LF，避免 Windows checkout 的 CRLF 改变锁定哈希。
- 旧 onnx 不再为了共享捕获代码解析缺失的 ncnn AAR；共享引擎已位于 main source set，因此旧 onnx 已独立构建通过。

第一次使用实际 SDK 路径构建时，DWARF 中的绝对路径导致原生库与锁不一致。随后创建 `D:\CodexData\Android\Sdk -> D:\Android_SDK` 目录联接，并设置 `SOURCE_DATE_EPOCH` 使 `NCNN_VERSION_STRING=1.0.20260813`。第二次构建出的四个原生库与旧锁逐字节一致：

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `libkaldi-native-fbank-core.so` | 1,022,120 | `d9caaf86e76c4b1b22d5601513a1b58bb6674d7f8b687b0bf9e8bb62cf939f47` |
| `libncnn.so` | 22,555,648 | `e047f45fa533015581210df1979e570d5ba7c47568d3569f478d44b404c2a535` |
| `libsherpa-ncnn-core.so` | 4,822,952 | `283c06862deccd9477d070bc0dd1a29c826a59c5204a1b4c67d80ca7cc3d9dcb` |
| `libsherpa-ncnn-jni.so` | 245,072 | `43d2cb75de7b03847ece13306e84570792459798df9ea6a6b70d25de4d61d1fb` |

这证明源码、依赖、NDK、绝对路径和源码日期已经复原。剩余差异只在 Kotlin `classes.jar` 的生成工具：

| 项目 | 锁定值 | JDK 17.0.20 | JDK 20.0.2 | JDK 21.0.1 |
| --- | ---: | ---: | ---: | ---: |
| `classes.jar` 字节 | 15,086 | 15,094 | 15,076 | 15,076 |
| SHA-256 | `7be1e04d4a291e34740161fe318a69cfeec069ea2bb128f9a48ee95d2dc59c99` | `bdbd35537fad272e155a55c6efca279027060f64a626cc0643384adf1fe67c8e` | `2df6c78c05c3a28a9c26d9757307ae5acafbddf98f70351714bca7bcca07e7fd` | `5b37e159dbe03544c52572e35ed8493c1a86496c23ca6d2102a74b0eea61e4ef` |

旧锁/SBOM 没有记录原始 JDK vendor、完整版本或 `SOURCE_DATE_EPOCH`。猜测性修改旧锁会掩盖供应链漂移，所以没有采用。

## 解除阻塞所需输入

满足任一项即可继续：

1. 提供锁定 AAR，要求 7,188,317 字节且 SHA-256 为 `85a1ba9432c793c9a81f7fd97d02a4f6a3a9cd2036a663f42b06b92827488231`；或
2. 提供生成该 AAR 时的确切 JDK vendor/version 和源码日期；或
3. 单独授权对旧 ncnn AAR 进行重新基线，并补做其官方 WAV 转录等价验证。

在此之前，新 CTC APK 和报告均保持可读取，但不会登记 `shutdown.exe`。
