[CmdletBinding()]
param(
  [string]$ApkPath,
  [string]$AdbPath,
  [string]$DeviceSerial
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Write-Step {
  param([Parameter(Mandatory = $true)][string]$Message)

  Write-Output "[轻记 AI] $Message"
}

function Resolve-AdbExecutable {
  param([string]$RequestedPath)

  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
    $candidates += $RequestedPath
  }
  foreach ($sdkRoot in @(
    [Environment]::GetEnvironmentVariable('ANDROID_SDK_ROOT', 'Process'),
    [Environment]::GetEnvironmentVariable('ANDROID_HOME', 'Process'),
    [Environment]::GetEnvironmentVariable('ANDROID_SDK_ROOT', 'User'),
    [Environment]::GetEnvironmentVariable('ANDROID_HOME', 'User'),
    'D:\CodexData\Android\Sdk'
  )) {
    if (-not [string]::IsNullOrWhiteSpace($sdkRoot)) {
      $candidates += (Join-Path $sdkRoot 'platform-tools\adb.exe')
    }
  }

  $adbCommand = Get-Command adb.exe -ErrorAction SilentlyContinue
  if ($null -ne $adbCommand) {
    $candidates += $adbCommand.Source
  }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return [IO.Path]::GetFullPath($candidate)
    }
  }

  throw '找不到 adb.exe。请确认 Android SDK 位于 D:\CodexData\Android\Sdk，或用 -AdbPath 指定。'
}

function Resolve-AaptExecutable {
  param([Parameter(Mandatory = $true)][string]$ResolvedAdbPath)

  $sdkRoot = Split-Path (Split-Path $ResolvedAdbPath -Parent) -Parent
  $buildToolsRoot = Join-Path $sdkRoot 'build-tools'
  if (-not (Test-Path -LiteralPath $buildToolsRoot -PathType Container)) {
    return $null
  }

  return Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
    Sort-Object {
      try { [version]$_.Name } catch { [version]'0.0' }
    } -Descending |
    ForEach-Object { Join-Path $_.FullName 'aapt.exe' } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
}

function Invoke-Adb {
  param(
    [Parameter(Mandatory = $true)][string]$ResolvedAdbPath,
    [string]$Serial,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $commandArguments = @()
  if (-not [string]::IsNullOrWhiteSpace($Serial)) {
    $commandArguments += @('-s', $Serial)
  }
  $commandArguments += $Arguments

  $output = @(& $ResolvedAdbPath @commandArguments 2>&1 | ForEach-Object { "$_" })
  return [pscustomobject]@{
    ExitCode = $LASTEXITCODE
    Output = $output
    Text = ($output -join "`n").Trim()
  }
}

function Get-ConnectedDevices {
  param([Parameter(Mandatory = $true)][string]$ResolvedAdbPath)

  $result = Invoke-Adb -ResolvedAdbPath $ResolvedAdbPath -Arguments @('devices', '-l')
  if ($result.ExitCode -ne 0) {
    throw "ADB 无法列出设备。`n$($result.Text)"
  }

  $devices = @()
  foreach ($line in $result.Output) {
    if ($line -match '^([^\s]+)\s+(device|unauthorized|offline|recovery|sideload|no permissions)(?:\s|$)') {
      $devices += [pscustomobject]@{
        Serial = $Matches[1]
        State = $Matches[2]
        Description = $line.Trim()
      }
    }
  }
  return $devices
}

function Select-InstallDevice {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Devices,
    [string]$RequestedSerial
  )

  if (-not [string]::IsNullOrWhiteSpace($RequestedSerial)) {
    if ($RequestedSerial -notmatch '^[A-Za-z0-9._:-]+$') {
      throw '设备序列号格式无效。'
    }
    $matching = @($Devices | Where-Object { $_.Serial -eq $RequestedSerial })
    if ($matching.Count -eq 0) {
      throw '没有找到指定设备。请重新检查 USB 连接和 -DeviceSerial 参数。'
    }
    $selected = $matching[0]
  } else {
    $readyDevices = @($Devices | Where-Object { $_.State -eq 'device' })
    if ($readyDevices.Count -eq 0) {
      $unauthorized = @($Devices | Where-Object { $_.State -eq 'unauthorized' })
      if ($unauthorized.Count -gt 0) {
        throw '手机尚未授权这台电脑。请解锁手机，在“允许 USB 调试”提示中确认后重试。'
      }
      $offline = @($Devices | Where-Object { $_.State -ne 'device' })
      if ($offline.Count -gt 0) {
        throw "设备当前不可安装（状态：$($offline[0].State)）。请重新连接 USB 并保持手机解锁。"
      }
      throw '没有检测到手机。请连接 USB、开启开发者选项和 USB 调试，并保持手机解锁。'
    }
    if ($readyDevices.Count -gt 1) {
      throw "检测到 $($readyDevices.Count) 台手机。请用 -DeviceSerial 指定安装目标。"
    }
    $selected = $readyDevices[0]
  }

  if ($selected.State -eq 'unauthorized') {
    throw '手机尚未授权这台电脑。请解锁手机，在“允许 USB 调试”提示中确认后重试。'
  }
  if ($selected.State -ne 'device') {
    throw "指定设备当前不可安装（状态：$($selected.State)）。"
  }
  return $selected
}

function Get-AdbProperty {
  param(
    [Parameter(Mandatory = $true)][string]$ResolvedAdbPath,
    [Parameter(Mandatory = $true)][string]$Serial,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $result = Invoke-Adb -ResolvedAdbPath $ResolvedAdbPath -Serial $Serial -Arguments @(
    'shell',
    'getprop',
    $Name
  )
  if ($result.ExitCode -ne 0) {
    throw "读取设备属性 $Name 失败。`n$($result.Text)"
  }
  return $result.Text.Trim()
}

function Get-ApkMetadata {
  param(
    [Parameter(Mandatory = $true)][string]$ResolvedApkPath,
    [string]$AaptPath
  )

  $metadata = [ordered]@{
    PackageName = $null
    VersionCode = $null
    VersionName = $null
    MinSdk = $null
    NativeAbis = @()
  }
  if ([string]::IsNullOrWhiteSpace($AaptPath)) {
    return [pscustomobject]$metadata
  }

  $badging = @(& $AaptPath dump badging $ResolvedApkPath 2>&1 | ForEach-Object { "$_" })
  if ($LASTEXITCODE -ne 0) {
    throw "APK 元数据读取失败，文件可能不完整。`n$($badging -join "`n")"
  }
  foreach ($line in $badging) {
    if ($line -match "^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'") {
      $metadata.PackageName = $Matches[1]
      $metadata.VersionCode = $Matches[2]
      $metadata.VersionName = $Matches[3]
    } elseif ($line -match "^sdkVersion:'([0-9]+)'") {
      $metadata.MinSdk = [int]$Matches[1]
    } elseif ($line -match '^native-code:\s+(.+)$') {
      $metadata.NativeAbis = @([regex]::Matches($Matches[1], "'([^']+)'") | ForEach-Object {
        $_.Groups[1].Value
      })
    }
  }
  return [pscustomobject]$metadata
}

function Get-InstallFailureAdvice {
  param([Parameter(Mandatory = $true)][string]$InstallOutput)

  $rules = @(
    @('INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match|inconsistent certificates', '已安装版本与当前内测包签名不同。脚本不会卸载或清除数据；请先备份账本，再由你决定是否手动卸载旧内测版。'),
    @('INSTALL_FAILED_VERSION_DOWNGRADE|version downgrade', '手机中的版本号更高。为保护数据，本脚本不会强制降级；请使用 versionCode 更高的新包。'),
    @('INSTALL_FAILED_INSUFFICIENT_STORAGE|insufficient storage', '手机可用空间不足。请清理手机存储后重试。'),
    @('INSTALL_FAILED_USER_RESTRICTED|INSTALL_CANCELED_BY_USER|User rejected|install not allowed|blocked by policy', '系统或用户阻止了 USB 安装。请解锁手机并确认安装；小米/Redmi/部分国产系统还需在开发者选项中允许“USB 安装”。'),
    @('INSTALL_FAILED_NO_MATCHING_ABIS|NO_MATCHING_ABIS', '手机 CPU 架构与 APK 不兼容。当前内测包仅面向 arm64-v8a。'),
    @('INSTALL_FAILED_OLDER_SDK|OLDER_SDK', '手机 Android 版本低于 APK 最低要求。'),
    @('INSTALL_PARSE_FAILED|PARSE_ERROR|Failed to parse', 'APK 解析失败，可能是文件下载不完整或已损坏。请核对 SHA-256 后重新构建。'),
    @('INSTALL_FAILED_PERMISSION_MODEL_DOWNGRADE', '目标版本的权限模型低于已安装版本。请提升构建配置，不能用覆盖安装绕过。'),
    @('INSTALL_FAILED_TEST_ONLY', 'APK 被标记为 testOnly。当前脚本不会使用允许测试包的绕过参数，请重新生成可安装构建。'),
    @('device unauthorized', '手机尚未授权这台电脑。请在手机上确认 USB 调试授权。'),
    @('device offline|no devices/emulators found', 'ADB 未连接到可用手机。请重新连接 USB 并保持手机解锁。')
  )

  foreach ($rule in $rules) {
    if ($InstallOutput -match $rule[0]) {
      return $rule[1]
    }
  }
  return '安装失败但未命中已知类别。请保留完整输出；不要先卸载应用，以免丢失本地账本。'
}

function Invoke-QingJiInternalInstall {
  param(
    [string]$RequestedApkPath,
    [string]$RequestedAdbPath,
    [string]$RequestedDeviceSerial
  )

  if ($env:OS -ne 'Windows_NT') {
    throw '此安装脚本仅支持 Windows。'
  }

  $defaultApkDirectory = Join-Path $PSScriptRoot '..\android\app\build\outputs\apk\internal'
  $candidateApkPath = if ([string]::IsNullOrWhiteSpace($RequestedApkPath)) {
    $latestInternalApk =
      Get-ChildItem -LiteralPath $defaultApkDirectory -Filter 'app-internal-*.apk' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($null -eq $latestInternalApk) {
      throw "找不到 Internal APK：$defaultApkDirectory。请先执行内测构建。"
    }
    $latestInternalApk.FullName
  } else {
    $RequestedApkPath
  }
  if (-not (Test-Path -LiteralPath $candidateApkPath -PathType Leaf)) {
    throw "找不到 APK：$candidateApkPath。请先执行内测构建。"
  }
  $resolvedApkPath = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $candidateApkPath).Path)
  $resolvedAdbPath = Resolve-AdbExecutable -RequestedPath $RequestedAdbPath
  $aaptPath = Resolve-AaptExecutable -ResolvedAdbPath $resolvedAdbPath
  $apkMetadata = Get-ApkMetadata -ResolvedApkPath $resolvedApkPath -AaptPath $aaptPath
  if ($apkMetadata.PackageName -and $apkMetadata.PackageName -ne 'com.qingjiai.internal') {
    throw "拒绝安装非内测包：$($apkMetadata.PackageName)。期望 com.qingjiai.internal。"
  }

  Write-Step "APK：$resolvedApkPath"
  Write-Step "SHA-256：$((Get-FileHash -LiteralPath $resolvedApkPath -Algorithm SHA256).Hash)"
  if ($apkMetadata.VersionName) {
    Write-Step "包名/版本：$($apkMetadata.PackageName) $($apkMetadata.VersionName) ($($apkMetadata.VersionCode))"
  }

  $devices = @(Get-ConnectedDevices -ResolvedAdbPath $resolvedAdbPath)
  $device = Select-InstallDevice -Devices $devices -RequestedSerial $RequestedDeviceSerial
  $deviceApiText = Get-AdbProperty -ResolvedAdbPath $resolvedAdbPath -Serial $device.Serial -Name 'ro.build.version.sdk'
  $deviceAbisText = Get-AdbProperty -ResolvedAdbPath $resolvedAdbPath -Serial $device.Serial -Name 'ro.product.cpu.abilist'
  if ([string]::IsNullOrWhiteSpace($deviceAbisText)) {
    $deviceAbisText = Get-AdbProperty -ResolvedAdbPath $resolvedAdbPath -Serial $device.Serial -Name 'ro.product.cpu.abi'
  }
  $deviceAbis = @($deviceAbisText.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $model = Get-AdbProperty -ResolvedAdbPath $resolvedAdbPath -Serial $device.Serial -Name 'ro.product.model'
  Write-Step "设备：$model，Android API $deviceApiText，ABI $($deviceAbis -join ', ')"

  $deviceApi = 0
  if (-not [int]::TryParse($deviceApiText, [ref]$deviceApi)) {
    throw "设备返回了无效的 Android API：$deviceApiText"
  }
  if ($apkMetadata.MinSdk -and $deviceApi -lt $apkMetadata.MinSdk) {
    throw "设备 API $deviceApi 低于 APK 最低 API $($apkMetadata.MinSdk)，无法安装。"
  }
  if ($apkMetadata.NativeAbis.Count -gt 0) {
    $matchingAbi = @($deviceAbis | Where-Object { $apkMetadata.NativeAbis -contains $_ })
    if ($matchingAbi.Count -eq 0) {
      throw "ABI 不兼容：APK=$($apkMetadata.NativeAbis -join ', ')；设备=$($deviceAbis -join ', ')。"
    }
  }

  if ($apkMetadata.PackageName) {
    $existing = Invoke-Adb -ResolvedAdbPath $resolvedAdbPath -Serial $device.Serial -Arguments @(
      'shell',
      'pm',
      'path',
      $apkMetadata.PackageName
    )
    if ($existing.ExitCode -eq 0 -and $existing.Text -match '^package:') {
      Write-Step '检测到已安装的内测版，将执行覆盖安装并保留应用数据。'
    } else {
      Write-Step '未检测到已安装的内测版，将执行首次安装。'
    }
  }

  Write-Step '开始安全安装：只使用 adb install -r；不会卸载应用、清除数据、强制降级或自动授予权限。'
  $installResult = Invoke-Adb -ResolvedAdbPath $resolvedAdbPath -Serial $device.Serial -Arguments @(
    'install',
    '-r',
    $resolvedApkPath
  )
  if ($installResult.ExitCode -ne 0 -or $installResult.Text -notmatch '(?m)^Success\s*$') {
    $advice = Get-InstallFailureAdvice -InstallOutput $installResult.Text
    Write-Output $installResult.Text
    throw "安装未完成：$advice"
  }

  Write-Output $installResult.Text
  Write-Step '安装成功，原有应用数据已保留。请在手机上手动打开“轻记 AI（内测）”并按需授予麦克风权限。'
}

if ($MyInvocation.InvocationName -ne '.') {
  Invoke-QingJiInternalInstall `
    -RequestedApkPath $ApkPath `
    -RequestedAdbPath $AdbPath `
    -RequestedDeviceSerial $DeviceSerial
}
