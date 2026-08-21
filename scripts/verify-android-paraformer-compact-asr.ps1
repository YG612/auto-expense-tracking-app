[CmdletBinding()]
param([string]$JavaHome)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$selectionPath = 'E:\CodexData\Models\QingJiAI\paraformer-compact-work\evaluation\compact-selection.json'
$comparisonRoot = Join-Path $projectRoot 'android\app\build\outputs\asr-comparison'
$assembledApk = Join-Path $projectRoot 'android\app\build\outputs\apk\internal\app-internal.apk'
$ordinaryApk = Join-Path $comparisonRoot 'app-internal-ordinary.apk'
$baselineApk = Join-Path $comparisonRoot 'app-internal-paraformer-baseline.apk'
$compactApk = Join-Path $comparisonRoot 'app-internal-paraformer-compact.apk'

$javaCandidates = @($JavaHome, $env:JAVA_HOME, 'D:\.jdks\temurin-17', 'C:\Program Files\Android\Android Studio\jbr')
$resolvedJavaHome = $null
foreach ($candidate in $javaCandidates) {
  if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
  $java = Join-Path $candidate 'bin\java.exe'
  if (-not (Test-Path -LiteralPath $java -PathType Leaf)) { continue }
  $major = 0
  if ([Int32]::TryParse(([Diagnostics.FileVersionInfo]::GetVersionInfo($java).ProductVersion -split '\.')[0], [ref]$major) -and $major -ge 17) {
    $resolvedJavaHome = [IO.Path]::GetFullPath($candidate)
    break
  }
}
if ($null -eq $resolvedJavaHome) { throw 'A JDK 17 or newer is required.' }
$env:JAVA_HOME = $resolvedJavaHome

function Invoke-Checked([string]$Name, [string]$FilePath, [string[]]$Arguments) {
  Write-Output "VERIFY_STEP=$Name"
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
}

if (-not (Test-Path -LiteralPath $selectionPath -PathType Leaf)) {
  throw 'Compact selection report is missing; no candidate can be promoted.'
}
$selection = Get-Content -LiteralPath $selectionPath -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Output "PARAFORMER_COMPACT_SELECTION=$($selection.status)"
if ($selection.status -ne 'PROMOTED_COMPACT_PARAFORMER') {
  throw "Compact candidate is not eligible for an APK build: $($selection.status)"
}

Push-Location $projectRoot
try {
  Invoke-Checked 'RUNTIME_VERIFY' $powershell @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'build-android-paraformer-compact-runtime.ps1'),'-VerifyOnly')
  Invoke-Checked 'SUPPLY_CHAIN_VERIFY' $powershell @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'prepare-android-paraformer-compact-asr.ps1'),'-VerifyOnly')
  Invoke-Checked 'TYPESCRIPT_TYPECHECK' $pnpm @('exec','tsc','--noEmit')
  Invoke-Checked 'ESLINT' $pnpm @('exec','eslint','.')
  Invoke-Checked 'JEST' $pnpm @('exec','jest','--runInBand')
  Invoke-Checked 'ASR_SCORER_SELF_TEST' $pnpm @('run','asr:benchmark:test')
  New-Item -ItemType Directory -Force -Path $comparisonRoot | Out-Null

  Invoke-Checked 'ORDINARY_INTERNAL_BUILD' $powershell @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'android-build-windows.ps1'),'-Variant','Internal','-RunUnitTests','-Offline')
  Copy-Item -LiteralPath $assembledApk -Destination $ordinaryApk -Force
  Invoke-Checked 'BASELINE_PARAFORMER_BUILD' $powershell @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'android-build-windows.ps1'),'-Variant','Internal','-StreamingAsr','-StreamingAsrEngine','onnx-paraformer-small','-RunUnitTests','-Offline')
  Copy-Item -LiteralPath $assembledApk -Destination $baselineApk -Force
  Invoke-Checked 'COMPACT_PARAFORMER_BUILD' $powershell @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'android-build-windows.ps1'),'-Variant','Internal','-StreamingAsr','-StreamingAsrEngine','onnx-paraformer-compact','-RunUnitTests','-Offline')
  Copy-Item -LiteralPath $assembledApk -Destination $compactApk -Force

  $size = (Get-Item -LiteralPath $compactApk).Length
  if ($size -gt 100MB) { throw "Compact APK exceeds 100 MiB: $size bytes." }
  if ($size - (Get-Item -LiteralPath $ordinaryApk).Length -gt 67MB) { throw 'Compact ASR increment exceeds 67 MiB.' }
  Write-Output 'PARAFORMER_COMPACT_ENGINEERING_VERIFY=PASS'
  Write-Output "PARAFORMER_COMPACT_APK=$compactApk"
  Write-Output "PARAFORMER_COMPACT_APK_SHA256=$((Get-FileHash -LiteralPath $compactApk -Algorithm SHA256).Hash.ToLowerInvariant())"
} finally { Pop-Location }
