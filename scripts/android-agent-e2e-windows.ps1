[CmdletBinding()]
param(
  [string]$AdbPath,
  [string]$DeviceSerial,
  [switch]$AcknowledgeCreatesPendingRecords,
  [ValidateRange(5, 120)][int]$TimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

if (-not $AcknowledgeCreatesPendingRecords) {
  throw 'This regression creates one synthetic PENDING record in the Internal app. Pass -AcknowledgeCreatesPendingRecords to continue.'
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cliPath = Join-Path $projectRoot 'build\qingji-cli\scripts\qingji-cli.js'
$tscPath = Join-Path $projectRoot 'node_modules\.bin\tsc.cmd'
if (-not (Test-Path -LiteralPath $tscPath -PathType Leaf)) {
  throw 'Project dependencies are missing. Run pnpm install --frozen-lockfile first.'
}

function Resolve-AdbExecutable {
  $candidates = @($AdbPath)
  foreach ($sdkRoot in @(
    $env:ANDROID_SDK_ROOT,
    $env:ANDROID_HOME,
    'D:\Android_SDK',
    'D:\CodexData\Android\Sdk'
  )) {
    if (-not [string]::IsNullOrWhiteSpace($sdkRoot)) {
      $candidates += (Join-Path $sdkRoot 'platform-tools\adb.exe')
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
  throw 'adb.exe was not found. Pass -AdbPath.'
}

function Select-AuthorizedDevice {
  param([Parameter(Mandatory = $true)][string]$ResolvedAdb)

  $lines = @(& $ResolvedAdb devices 2>&1 | ForEach-Object { "$_" })
  if ($LASTEXITCODE -ne 0) { throw 'ADB could not list devices.' }
  $ready = @()
  foreach ($line in $lines) {
    if ($line -match '^([^\s]+)\s+device(?:\s|$)') { $ready += $Matches[1] }
  }
  if (-not [string]::IsNullOrWhiteSpace($DeviceSerial)) {
    if ($DeviceSerial -notmatch '^[A-Za-z0-9._:-]{1,128}$' -or
        $ready -notcontains $DeviceSerial) {
      throw 'The requested device is not authorized and online.'
    }
    return $DeviceSerial
  }
  if ($ready.Count -ne 1) {
    throw "Expected exactly one authorized device, found $($ready.Count). Pass -DeviceSerial when multiple devices are attached."
  }
  return $ready[0]
}

function Invoke-QingjiCli {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $output = @(& node $cliPath @Arguments 2>&1 | ForEach-Object { "$_" })
  if ($LASTEXITCODE -ne 0) {
    throw "QingJi CLI failed.`n$($output -join "`n")"
  }
  try {
    return ($output -join "`n") | ConvertFrom-Json
  } catch {
    throw 'QingJi CLI did not return valid JSON.'
  }
}

function Wait-AgentStatus {
  param(
    [Parameter(Mandatory = $true)][string]$RequestKey,
    [Parameter(Mandatory = $true)][string]$ExpectedStatus,
    [Parameter(Mandatory = $true)][string]$ResolvedAdb,
    [Parameter(Mandatory = $true)][string]$Serial
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $result = Invoke-QingjiCli -Arguments @(
      'bill', 'status-android',
      '--request-key', $RequestKey,
      '--serial', $Serial,
      '--adb', $ResolvedAdb
    )
    if ($result.status -eq $ExpectedStatus) { return $result }
    if ($result.status -eq 'REJECTED' -and $ExpectedStatus -ne 'REJECTED') {
      throw "The app rejected the operation: $($result.errorCode)"
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for $ExpectedStatus."
}

$resolvedAdb = Resolve-AdbExecutable
$serial = Select-AuthorizedDevice -ResolvedAdb $resolvedAdb

Push-Location $projectRoot
try {
  & $tscPath -p tsconfig.cli.json
  if ($LASTEXITCODE -ne 0) { throw 'QingJi CLI compilation failed.' }

  $callerId = 'qingji-usb-e2e'
  $idempotencyKey = "usb-e2e-$([Guid]::NewGuid().ToString('N'))"
  $firstText = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String('5LuK5aSp5rWL6K+V5Y2I6aWtMjXlhYPvvIzlvq7kv6HmlK/ku5g=')
  )
  $conflictingText = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String('5LuK5aSp5rWL6K+V5pma6aWtMjblhYPvvIzlvq7kv6HmlK/ku5g=')
  )
  $baseArguments = @(
    'bill', 'queue-pending-android', $firstText,
    '--caller-id', $callerId,
    '--idempotency-key', $idempotencyKey,
    '--serial', $serial,
    '--adb', $resolvedAdb
  )

  $firstQueue = Invoke-QingjiCli -Arguments $baseArguments
  $first = Wait-AgentStatus -RequestKey $firstQueue.requestKey `
    -ExpectedStatus 'COMMITTED' -ResolvedAdb $resolvedAdb -Serial $serial

  $duplicateQueue = Invoke-QingjiCli -Arguments $baseArguments
  if ($duplicateQueue.requestKey -ne $firstQueue.requestKey) {
    throw 'The same payload did not produce the same requestKey.'
  }
  $duplicate = Wait-AgentStatus -RequestKey $firstQueue.requestKey `
    -ExpectedStatus 'ALREADY_COMMITTED' -ResolvedAdb $resolvedAdb -Serial $serial

  $conflictArguments = @(
    'bill', 'queue-pending-android', $conflictingText,
    '--caller-id', $callerId,
    '--idempotency-key', $idempotencyKey,
    '--serial', $serial,
    '--adb', $resolvedAdb
  )
  $conflictQueue = Invoke-QingjiCli -Arguments $conflictArguments
  if ($conflictQueue.requestKey -eq $firstQueue.requestKey) {
    throw 'Different payloads must not produce the same requestKey.'
  }
  $conflict = Wait-AgentStatus -RequestKey $conflictQueue.requestKey `
    -ExpectedStatus 'REJECTED' -ResolvedAdb $resolvedAdb -Serial $serial
  if ($conflict.errorCode -ne 'AGENT-IDEMPOTENCY-PAYLOAD-MISMATCH') {
    throw "Unexpected idempotency conflict code: $($conflict.errorCode)"
  }

  [ordered]@{
    schemaVersion = 1
    command = 'android-agent-e2e'
    status = 'PASSED'
    privacy = [ordered]@{
      syntheticBillOnly = $true
      deviceSerialStored = $false
      logcatCollected = $false
    }
    requestKey = $firstQueue.requestKey
    transactionIds = @($first.transactionIds)
    firstStatus = $first.status
    duplicateStatus = $duplicate.status
    conflictStatus = $conflict.status
    conflictErrorCode = $conflict.errorCode
    cleanup = 'Delete the synthetic record from the Internal app pending list.'
  } | ConvertTo-Json -Depth 6
} finally {
  Pop-Location
}
