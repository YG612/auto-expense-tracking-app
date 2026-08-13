Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

. (Join-Path $PSScriptRoot 'android-install-internal-windows.ps1')

function Assert-Equal {
  param(
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Actual,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if ($Expected -ne $Actual) {
    throw "$Name 失败。`n期望：$Expected`n实际：$Actual"
  }
}

$cases = @(
  @('Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]', '已安装版本与当前内测包签名不同。脚本不会卸载或清除数据；请先备份账本，再由你决定是否手动卸载旧内测版。', '签名冲突'),
  @('Failure [INSTALL_FAILED_VERSION_DOWNGRADE]', '手机中的版本号更高。为保护数据，本脚本不会强制降级；请使用 versionCode 更高的新包。', '版本降级'),
  @('Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]', '手机可用空间不足。请清理手机存储后重试。', '空间不足'),
  @('Failure [INSTALL_FAILED_USER_RESTRICTED: Install canceled by user]', '系统或用户阻止了 USB 安装。请解锁手机并确认安装；小米/Redmi/部分国产系统还需在开发者选项中允许“USB 安装”。', '系统阻止'),
  @('Failure [INSTALL_FAILED_NO_MATCHING_ABIS]', '手机 CPU 架构与 APK 不兼容。当前内测包仅面向 arm64-v8a。', 'ABI 不兼容'),
  @('Failure [INSTALL_FAILED_OLDER_SDK]', '手机 Android 版本低于 APK 最低要求。', '系统版本过低'),
  @('Failure [INSTALL_PARSE_FAILED_BAD_MANIFEST]', 'APK 解析失败，可能是文件下载不完整或已损坏。请核对 SHA-256 后重新构建。', 'APK 损坏'),
  @('unexpected failure', '安装失败但未命中已知类别。请保留完整输出；不要先卸载应用，以免丢失本地账本。', '未知失败')
)

foreach ($case in $cases) {
  Assert-Equal -Expected $case[1] -Actual (Get-InstallFailureAdvice -InstallOutput $case[0]) -Name $case[2]
}

$installerSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'android-install-internal-windows.ps1') -Raw -Encoding UTF8
$forbiddenCommands = @(
  '(?im)^\s*&?\s*adb(?:\.exe)?\s+uninstall\b',
  "(?i)'uninstall'",
  "(?i)'pm',\s*'clear'",
  "(?i)'install',\s*'-r',\s*'-d'",
  "(?i)'install',\s*'-r',\s*'-g'"
)
foreach ($pattern in $forbiddenCommands) {
  if ($installerSource -match $pattern) {
    throw "安装脚本包含禁止的破坏性或绕过参数：$pattern"
  }
}
if ($installerSource -notmatch "'install',\s*\r?\n\s*'-r'") {
  throw '安装脚本没有使用预期的 adb install -r。'
}
if ($installerSource -match 'Write-(?:Output|Step)[^\r\n]*Serial') {
  throw '安装脚本不得把设备序列号写入用户可见输出。'
}
if ($installerSource -match 'throw[^\r\n]*RequestedSerial') {
  throw '安装错误不得回显用户提供的设备序列号。'
}

Write-Output "ANDROID_INSTALL_SCRIPT_TESTS_PASSED=$($cases.Count + 3)"
