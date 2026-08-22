# 离线语音公开数据获取记录

更新日期：2026-08-21

## 当前结论

- 已完整获取并校验 FLEURS 简体中文训练集、验证集和测试集。
- 已获取、校验并解包 AISHELL-1 与 THCHS-30 的官方小型资源包，原始归档仍保留。
- AISHELL-1、THCHS-30 及其测试噪声完整归档均已下载并校验；下载不等于批准用于产品训练。
- FLEURS 归类为公开开发语料，可用于普通话声学回归、微调试验和模型间对照。
- FLEURS 不是金融记账口语验收集，不能据此宣称金额、商户和多笔记账准确率达标。
- 真实验收状态仍为 `WAITING_FOR_AUTHORIZED_FINANCIAL_WAV`。

## 锁定数据

数据集：`google/fleurs`，配置：`cmn_hans_cn`，许可证：`CC-BY-4.0`。

默认外部缓存：`E:\CodexData\Datasets\QingJiAI\fleurs-cmn-hans-cn\parquet`。数据文件不提交 Git。

获取当日的 FLEURS 数据卡、CC BY 4.0 法律文本以及 OpenSLR 18/33 数据页已快照到：

`E:\CodexData\Datasets\QingJiAI\provenance-snapshots\2026-08-21`

| 快照                      |  字节数 | SHA-256            |
| ------------------------- | ------: | ------------------ |
| `fleurs-README.md`        | 385,614 | `688f79f2…98e71c6` |
| `cc-by-4.0-legalcode.txt` |  18,657 | `9ba9550a…429411`  |
| `openslr-33.html`         |   4,011 | `072e77c5…7b019d9` |
| `openslr-18.html`         |   5,261 | `4cb5506d…f891935` |

| split      |    预期字节数 | 当前状态                |
| ---------- | ------------: | ----------------------- |
| validation |   287,985,961 | `ACQUIRED_AND_VERIFIED` |
| test       |   695,674,033 | `ACQUIRED_AND_VERIFIED` |
| train      | 2,214,262,858 | `ACQUIRED_AND_VERIFIED` |

- validation SHA-256：`18698ffdd46c36c54af641821684d3f0313a7b64e0a49615597ec61a98f2b57e`
- test SHA-256：`87c0aebbe183f3a36ac87b5c3421b6ab57036824744ff695029a3f858e7622fd`
- train SHA-256：`b7310d1e78afe209a1cbc40412d0de18a218ac614bbff0d2d1b87aba2c066b3d`

## 验证集静态检查

- 409 条音频，总时长 4,576 秒（1.271111 小时）。
- 16 kHz、单声道、32-bit IEEE float WAV；音频字节内嵌在 Parquet 中。
- 单条时长 3.300–27.720 秒，中位数 10.260 秒。
- 0 条空转写，0 条包含 Unicode 替换字符的转写。
- `id` 是提示文本标识，不是说话人标识；该 Parquet 不提供可用于说话人去重的 ID。
- Windows 终端若未使用 UTF-8 可能显示乱码；Unicode 码点检查确认源转写没有损坏。

三个 split 的内容检查均通过：

| split      |  条数 |    小时数 | 空转写 | 损坏字符行 |
| ---------- | ----: | --------: | -----: | ---------: |
| train      | 3,246 |  9.725967 |      0 |          0 |
| validation |   409 |  1.271111 |      0 |          0 |
| test       |   945 |  3.073661 |      0 |          0 |
| 总计       | 4,600 | 14.070739 |      0 |          0 |

## 可重复命令

下载或续传：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/asr-data/download-fleurs-cmn-hans-cn.ps1 -Split validation,test,train
```

只校验已下载文件：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/asr-data/download-fleurs-cmn-hans-cn.ps1 -Split validation -VerifyOnly
```

内容检查需要工具环境提供 `pyarrow`：

```powershell
python scripts/asr-data/inspect-fleurs-cmn-hans-cn.py E:\CodexData\Datasets\QingJiAI\fleurs-cmn-hans-cn\parquet\validation-0000.parquet
```

## 仍需授权或用途复核

- WenetSpeech 下载需要申请并取得数据密码，不能绕过授权流程。
- AISHELL-1 与 THCHS-30 的页面同时出现 Apache 2.0 标识和偏学术用途说明；在将其用于产品训练前需保留许可证快照并完成用途复核。
- 项目自身的 238 条金融提示清单没有对应录音。应由授权说话人录制，保留同意记录、设备与噪声元数据，并将其作为独立且不参与训练的验收集。

完整 OpenSLR 归档预期大小：

| 归档               |     预期字节数 | 当前状态                                    |
| ------------------ | -------------: | ------------------------------------------- |
| `data_aishell.tgz` | 15,582,913,665 | `ACQUIRED_AND_VERIFIED_USE_REVIEW_REQUIRED` |
| `data_thchs30.tgz` |  6,453,425,169 | `ACQUIRED_AND_VERIFIED_USE_REVIEW_REQUIRED` |
| `test-noise.tgz`   |  1,971,460,210 | `ACQUIRED_AND_VERIFIED_USE_REVIEW_REQUIRED` |

完整压缩流检查：`data_aishell.tgz` 可列出 404 个外层条目，`data_thchs30.tgz` 可列出 53,566 个条目，`test-noise.tgz` 可列出 7,504 个条目；三次 `tar -tzf` 均以 0 退出。AISHELL 外层主要包含按说话人分组的内层归档，因此外层条目数不是音频条数。

- AISHELL-1 SHA-256：`a4a0313cde0a933e0e01a451f77de0a23d6c942f4694af5bb7f40b9dc38143fe`
- THCHS-30 SHA-256：`87e9231726af43b8ada6f84d2870fec4ebb23cb730439adbaacdc1dee77dbd1e`
- THCHS-30 test noise SHA-256：`e1e7a9135754fd691f264e9d4e055a0507ff9ccd9061d45900f93a390138a418`

复核或续传完整归档：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/asr-data/download-openslr-mandarin-speech.ps1 -Corpus aishell1,thchs30,thchs30-noise -VerifyOnly
```

## OpenSLR 资源包

| 数据页            | 本次获取内容           |     字节数 | SHA-256           | 说明                                         |
| ----------------- | ---------------------- | ---------: | ----------------- | -------------------------------------------- |
| AISHELL-1 / SLR33 | `resource_aishell.tgz` |  1,246,920 | `1a674985…f77409` | 词表与说话人元数据，不含完整语音             |
| THCHS-30 / SLR18  | `resource.tgz`         | 24,813,708 | `5f10b11a…2d85ee` | 词典及 car/cafe/white 噪声资源，不含完整语音 |

小型资源包已解压到各数据集目录下的 `resource-extracted`，原始 `.tgz` 保留。AISHELL 解出 2 个文件，共 3,550,819 字节；THCHS 解出 11 个文件，共 29,206,440 字节。

THCHS 小资源包中的 `car.wav`、`cafe.wav`、`white.wav` 均通过 `ffprobe` 检查：16 kHz、单声道、PCM S16LE、各 300 秒，总计 15 分钟，可直接作为受控噪声增强素材。

本次 E 盘数据目录共 25 个文件、27,264,953,326 字节（25.39 GiB，包含归档、FLEURS Parquet、解包后的小资源与来源快照）。Parquet 检查工具使用外置 `pyarrow 25.0.1`，位于 `D:\CodexData\Tools\asr-parquet`，未加入应用运行时依赖。

复核或重新获取：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/asr-data/download-openslr-mandarin-resources.ps1 -VerifyOnly
```
