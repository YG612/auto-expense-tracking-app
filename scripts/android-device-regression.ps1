[CmdletBinding()]
param(
  [string]$AdbPath,
  [string]$DeviceSerial,
  [string]$EvidenceRoot = 'D:\CodexData\TestEvidence\QingJiAI',
  [switch]$Launch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$packageId = 'com.qingjiai.internal'

function Resolve-Adb {
  $candidates = @($AdbPath)
  foreach ($root in @(
    $env:ANDROID_SDK_ROOT,
    $env:ANDROID_HOME,
    'D:\CodexData\Android\Sdk'
  )) {
    if (-not [string]::IsNullOrWhiteSpace($root)) {
      $candidates += (Join-Path $root 'platform-tools\adb.exe')
    }
  }
  $command = Get-Command adb.exe -ErrorAction SilentlyContinue
  if ($null -ne $command) { $candidates += $command.Source }
  foreach ($candidate in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and
        (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return [IO.Path]::GetFullPath($candidate)
    }
  }
  throw 'adb.exe was not found. Pass -AdbPath or install the SDK on D:.'
}

function Invoke-Adb {
  param([string[]]$Arguments, [switch]$WithoutTarget, [switch]$AllowFailure)
  $allArguments = @()
  if (-not $WithoutTarget) { $allArguments += @('-s', $script:selectedSerial) }
  $allArguments += $Arguments
  # Windows PowerShell 5 wraps any native stderr line in a NativeCommandError.
  # adb/monkey writes normal diagnostics to stderr even when it exits 0, so use
  # the native exit code as the authority without weakening the script globally.
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& $script:resolvedAdb @allArguments 2>&1 | ForEach-Object { "$_" })
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if (-not $AllowFailure -and $exitCode -ne 0) {
    throw "adb command failed: $($Arguments[0])"
  }
  return [pscustomobject]@{
    ExitCode = $exitCode
    Lines = $output
    Text = ($output -join "`n").Trim()
  }
}

function Get-Property {
  param([string]$Name)
  $result = Invoke-Adb -Arguments @('shell', 'getprop', $Name)
  return (($result.Text -replace '[\x00-\x1f]', '').Trim()).Substring(
    0,
    [Math]::Min(160, ($result.Text -replace '[\x00-\x1f]', '').Trim().Length)
  )
}

function Get-Components {
  param([string]$QueryKind, [string]$Action)
  $result = Invoke-Adb -AllowFailure -Arguments @(
    'shell', 'cmd', 'package', $QueryKind, '--brief', '-a', $Action
  )
  return @([regex]::Matches(
      $result.Text,
      '[A-Za-z0-9._]+/[A-Za-z0-9._$]+'
    ) | ForEach-Object { $_.Value } | Sort-Object -Unique)
}

$fullEvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)
if (-not [IO.Path]::GetPathRoot($fullEvidenceRoot).Equals(
    'D:\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'EvidenceRoot must be on D: to avoid consuming C: drive space.'
}
$script:resolvedAdb = Resolve-Adb
$devicesResult = Invoke-Adb -WithoutTarget -Arguments @('devices')
$devices = @()
foreach ($line in $devicesResult.Lines) {
  if ($line -match '^([^\s]+)\s+(device|unauthorized|offline)(?:\s|$)') {
    $devices += [pscustomobject]@{ Serial = $Matches[1]; State = $Matches[2] }
  }
}
if ([string]::IsNullOrWhiteSpace($DeviceSerial)) {
  $ready = @($devices | Where-Object State -eq 'device')
  if ($ready.Count -ne 1) {
    throw "Expected exactly one authorized device, found $($ready.Count). Use -DeviceSerial when multiple devices are connected."
  }
  $script:selectedSerial = $ready[0].Serial
} else {
  $match = @($devices | Where-Object {
      $_.Serial -eq $DeviceSerial -and $_.State -eq 'device'
    })
  if ($match.Count -ne 1) { throw 'The requested device is not authorized and online.' }
  $script:selectedSerial = $DeviceSerial
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidenceDirectory = Join-Path $fullEvidenceRoot $timestamp
New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null

$defaultProviderResult = Invoke-Adb -AllowFailure -Arguments @(
  'shell', 'settings', 'get', 'secure', 'voice_recognition_service'
)
$currentUserResult = Invoke-Adb -AllowFailure -Arguments @(
  'shell', 'am', 'get-current-user'
)
$permissionResult = $null
if (
  $currentUserResult.ExitCode -eq 0 -and
  $currentUserResult.Text.Trim() -match '^\d+$'
) {
  $currentUserId = $currentUserResult.Text.Trim()
  # Android 16 OEM builds may omit `cmd package check-permission`. This narrow
  # query returns only 0 (granted) or -1 (denied) for one app and permission.
  $permissionResult = Invoke-Adb -AllowFailure -Arguments @(
    'shell', 'dumpsys', 'package', 'check-permission',
    'android.permission.RECORD_AUDIO', $packageId, $currentUserId
  )
}
$appOpsResult = Invoke-Adb -AllowFailure -Arguments @(
  'shell', 'cmd', 'appops', 'get', $packageId, 'RECORD_AUDIO'
)
$installedResult = Invoke-Adb -AllowFailure -Arguments @(
  'shell', 'pm', 'path', $packageId
)

$launchAttempted = [bool]$Launch
$launchCommandSucceeded = $false
if ($Launch -and $installedResult.Text -match '^package:') {
  $launchResult = Invoke-Adb -AllowFailure -Arguments @(
    'shell', 'monkey', '-p', $packageId,
    '-c', 'android.intent.category.LAUNCHER', '1'
  )
  $launchCommandSucceeded = $launchResult.ExitCode -eq 0
  Start-Sleep -Seconds 3
}
$pidResult = Invoke-Adb -AllowFailure -Arguments @(
  'shell', 'pidof', $packageId
)
$exitInfoResult = Invoke-Adb -AllowFailure -Arguments @(
  'shell', 'dumpsys', 'activity', 'exit-info', $packageId
)
$safeExitInfo = @($exitInfoResult.Lines |
  Where-Object { $_ -match '^\s*(timestamp|reason|status|importance)=' } |
  ForEach-Object { $_.Trim() } |
  Select-Object -First 24)

$permissionState = if (
  $null -ne $permissionResult -and
  $permissionResult.ExitCode -eq 0 -and
  $permissionResult.Text.Trim() -eq '0'
) {
  'GRANTED'
} elseif (
  $null -ne $permissionResult -and
  $permissionResult.ExitCode -eq 0 -and
  $permissionResult.Text.Trim() -eq '-1'
) {
  'DENIED'
} else {
  'UNKNOWN'
}
$safeAppOps = @($appOpsResult.Lines |
  Where-Object { $_ -match '(?i)RECORD_AUDIO' } |
  ForEach-Object {
    if ($_ -match '(?i)(allow|deny|ignore|foreground|default)') {
      $Matches[1].ToUpperInvariant()
    }
  } | Sort-Object -Unique)

$evidence = [ordered]@{
  schemaVersion = 1
  collectedAt = (Get-Date).ToUniversalTime().ToString('o')
  privacy = [ordered]@{
    deviceSerialStored = $false
    ledgerTextStored = $false
    logcatCollected = $false
    rawAudioCollected = $false
  }
  device = [ordered]@{
    manufacturer = Get-Property 'ro.product.manufacturer'
    model = Get-Property 'ro.product.model'
    androidRelease = Get-Property 'ro.build.version.release'
    api = Get-Property 'ro.build.version.sdk'
    abiList = Get-Property 'ro.product.cpu.abilist'
    buildId = Get-Property 'ro.build.id'
  }
  app = [ordered]@{
    packageId = $packageId
    installed = $installedResult.Text -match '^package:'
    microphonePermission = $permissionState
    microphoneAppOpsModes = $safeAppOps
    launchAttempted = $launchAttempted
    launchCommandSucceeded = $launchCommandSucceeded
    processRunningAfterLaunch = -not [string]::IsNullOrWhiteSpace($pidResult.Text)
    exitMetadata = $safeExitInfo
  }
  speech = [ordered]@{
    defaultRecognitionService = $defaultProviderResult.Text.Trim()
    recognitionServices = @(Get-Components 'query-services' 'android.speech.RecognitionService')
    recognitionActivities = @(Get-Components 'query-activities' 'android.speech.action.RECOGNIZE_SPEECH')
    localeReadiness = 'MANUAL_APP_CHECK_REQUIRED'
  }
  manualRegression = @(
    [ordered]@{ id = 'REG-01'; status = 'NOT_RUN'; expected = 'One expense candidate, CNY 25.00, groceries; quantity 2 is not an amount or second card.' },
    [ordered]@{ id = 'REG-02'; status = 'NOT_RUN'; expected = 'Salary CNY 8000.00 is INCOME / salary.' },
    [ordered]@{ id = 'REG-03'; status = 'NOT_RUN'; expected = 'After edited confirmation succeeds, the card disappears exactly once.' },
    [ordered]@{ id = 'REG-04'; status = 'NOT_RUN'; expected = 'Returning from permission settings rechecks state without recording or network access.' },
    [ordered]@{ id = 'REG-05'; status = 'NOT_RUN'; expected = 'Model download is explicit; recheck waits until READY and never starts early.' },
    [ordered]@{ id = 'REG-06'; status = 'NOT_RUN'; expected = 'Ambiguous or incomplete candidates do not expose direct confirm.' },
    [ordered]@{ id = 'REG-09'; status = 'NOT_RUN'; expected = 'Internet-cafe spending is entertainment and a complete safe card exposes the outer Confirm action.' },
    [ordered]@{ id = 'REG-10'; status = 'NOT_RUN'; expected = 'An explicit product overrides the venue default: water is food/drinks and a mouse is shopping/digital.' },
    [ordered]@{ id = 'REG-11'; status = 'NOT_RUN'; expected = 'Five bottles at CNY 10 each produces exactly one CNY 50 candidate.' },
    [ordered]@{ id = 'REG-12'; status = 'NOT_RUN'; expected = 'Top-up and deposit stay review-required; refund keeps refund semantics instead of entertainment.' },
    [ordered]@{ id = 'REG-13'; status = 'NOT_RUN'; expected = 'A complete personal rule for transport plus WeChat exposes outer Confirm without forced editing.' },
    [ordered]@{ id = 'REG-14'; status = 'NOT_RUN'; expected = 'Single or rapid double confirmation writes exactly one transaction and removes the card once.' },
    [ordered]@{ id = 'REG-15'; status = 'NOT_RUN'; expected = 'Internet access and instant noodles form two isolated candidates with the correct amounts and categories.' },
    [ordered]@{ id = 'REG-16'; status = 'NOT_RUN'; expected = 'Provider endpointing preserves partial text and offers Continue speaking or Use this text without duplicate cards.' }
  )
}

$jsonPath = Join-Path $evidenceDirectory 'device-evidence.json'
$evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
$checklistPath = Join-Path $evidenceDirectory 'manual-regression-checklist.md'
@'
# QingJi AI Android manual regression

Do not enter real financial, merchant, account, contact, address, or identity data.
Do not attach unredacted screenshots. The harness intentionally does not collect system logs,
screen recordings, raw audio, device serials, or ledger text.

- [ ] REG-01: Enter/say the fixed synthetic phrase `today afternoon went to the mall, bought two bottles of milk, spent 25 yuan` in Chinese. Exactly one expense card; CNY 25.00; groceries; quantity 2 is not another amount/card.
- [ ] REG-02: Enter/say the fixed synthetic phrase `salary 8000 yuan arrived` in Chinese. One INCOME / salary card for CNY 8000.00.
- [ ] REG-03: Edit a synthetic candidate, confirm it, and verify the card disappears once and appears once in transactions.
- [ ] REG-04: Deny/block microphone, open system settings, allow it, return, and use recheck. Recheck must not start recording or network access.
- [ ] REG-05: On a device with a downloadable local Mandarin model, trigger download explicitly, return, and recheck until READY. No recording before READY.
- [ ] REG-06: Enter synthetic ambiguous text `recharge 100 yuan` in Chinese. There must be no `Confirm` direct action before review/edit.
- [ ] REG-07: Disable the Android global microphone switch while app permission stays granted. The UI must identify microphone privacy state instead of claiming app permission is absent.
- [ ] REG-08: Cancel system speech input and rapidly tap start twice. No duplicate card, permanent busy state, crash, or silent network fallback.
- [ ] REG-09: Enter `今天在网吧消费10元，微信付的`. One CNY 10 expense card in entertainment; when all fields are complete, the card itself exposes `确认入账`.
- [ ] REG-10: Enter `在网吧买水3元，微信付的`, then `在网吧买鼠标80元，微信付的`. The first is food/drinks and the second is shopping/digital; the venue must not override the explicit product.
- [ ] REG-11: Enter `买5瓶牛奶每瓶10元，微信付的`. Exactly one CNY 50 card; neither 5 nor 10 becomes the total.
- [ ] REG-12: Enter `网吧充值100元`, `交网吧押金100元`, and `网吧退给我10元`. Top-up and deposit must not direct-confirm; refund keeps refund semantics and must not become entertainment.
- [ ] REG-13: Create one personal rule that maps `坐车` to transport and WeChat, then enter `坐车来回花了4元`. The complete CNY 4 card exposes the outer confirm action without forcing the full editor.
- [ ] REG-14: Confirm a synthetic card once, then repeat with a rapid double tap. Each run writes exactly one transaction and removes the card once.
- [ ] REG-15: Enter `网吧上网10元，然后买泡面5元，微信付的`. Exactly two cards: CNY 10 entertainment and CNY 5 food; no amount/category leakage.
- [ ] REG-16: Speak a long synthetic sentence with a natural pause. If the system provider ends early, the app offers `继续说` and `使用这段文字`; continuing appends rather than overwrites or duplicates before final review.

For every failure record only: scenario ID, screen state, stable error label, route
(on-device/system activity/direct), elapsed time, and a redacted screenshot if needed.
'@ | Set-Content -LiteralPath $checklistPath -Encoding UTF8

Write-Output "EVIDENCE_JSON=$jsonPath"
Write-Output "MANUAL_CHECKLIST=$checklistPath"
Write-Output "DEVICE_MODEL=$($evidence.device.manufacturer) $($evidence.device.model)"
Write-Output "APP_INSTALLED=$($evidence.app.installed)"
Write-Output "APP_RUNNING=$($evidence.app.processRunningAfterLaunch)"
Write-Output "SPEECH_DEFAULT=$($evidence.speech.defaultRecognitionService)"
