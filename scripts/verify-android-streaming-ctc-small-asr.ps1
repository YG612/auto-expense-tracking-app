[CmdletBinding()]
param(
  [string]$JavaHome
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$comparisonRoot = Join-Path $projectRoot 'android\app\build\outputs\asr-comparison'
$assembledApk = Join-Path $projectRoot 'android\app\build\outputs\apk\internal\app-internal.apk'
$baselineApk = Join-Path $comparisonRoot 'app-internal-ordinary.apk'
$candidateApk = Join-Path $comparisonRoot 'app-internal-ctc-small.apk'

$javaCandidates = @(
  $JavaHome,
  $env:JAVA_HOME,
  'D:\.jdks\openjdk-21.0.1',
  'D:\.jdks\temurin-17',
  'C:\Program Files\Android\Android Studio\jbr'
)
$resolvedJavaHome = $null
foreach ($candidate in $javaCandidates) {
  if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
  $javaExecutable = Join-Path $candidate 'bin\java.exe'
  if (-not (Test-Path -LiteralPath $javaExecutable -PathType Leaf)) { continue }
  $productVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($javaExecutable).ProductVersion
  $majorText = ($productVersion -split '\.')[0]
  $major = 0
  if ([Int32]::TryParse($majorText, [ref]$major) -and $major -ge 17) {
    $resolvedJavaHome = [IO.Path]::GetFullPath($candidate)
    break
  }
}
if ($null -eq $resolvedJavaHome) {
  throw 'A JDK 17 or newer is required for the Android verification build.'
}
$env:JAVA_HOME = $resolvedJavaHome
Write-Output "VERIFY_JAVA_HOME=$resolvedJavaHome"

function Invoke-Checked([string]$Name, [string]$FilePath, [string[]]$StepArguments) {
  Write-Output "VERIFY_STEP=$Name"
  & $FilePath @StepArguments
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
}

Push-Location $projectRoot
try {
  Invoke-Checked 'RUNTIME_VERIFY' $powershell @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $PSScriptRoot 'build-android-streaming-ctc-small-runtime.ps1'),
    '-VerifyOnly'
  )
  Invoke-Checked 'SUPPLY_CHAIN_VERIFY' $powershell @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $PSScriptRoot 'prepare-android-streaming-ctc-small-asr.ps1'),
    '-VerifyOnly'
  )
  Invoke-Checked 'OFFICIAL_SAMPLE_EQUIVALENCE' $powershell @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $PSScriptRoot 'verify-android-streaming-ctc-small-samples.ps1')
  )
  Invoke-Checked 'TYPESCRIPT_TYPECHECK' $pnpm @('exec', 'tsc', '--noEmit')
  Invoke-Checked 'ESLINT' $pnpm @('exec', 'eslint', '.')
  Invoke-Checked 'JEST' $pnpm @('exec', 'jest', '--runInBand')
  Invoke-Checked 'ASR_SCORER_SELF_TEST' $pnpm @('run', 'asr:benchmark:test')

  New-Item -ItemType Directory -Force -Path $comparisonRoot | Out-Null
  Invoke-Checked 'ORDINARY_INTERNAL_BUILD' $powershell @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $PSScriptRoot 'android-build-windows.ps1'),
    '-Variant', 'Internal', '-RunUnitTests', '-Offline'
  )
  Copy-Item -LiteralPath $assembledApk -Destination $baselineApk -Force

  Invoke-Checked 'CTC_SMALL_INTERNAL_BUILD' $powershell @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $PSScriptRoot 'android-build-windows.ps1'),
    '-Variant', 'Internal', '-StreamingAsr',
    '-StreamingAsrEngine', 'onnx-ctc-small', '-RunUnitTests', '-Offline'
  )
  Copy-Item -LiteralPath $assembledApk -Destination $candidateApk -Force

  Invoke-Checked 'APK_BUDGET_REPORT' $powershell @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $PSScriptRoot 'report-android-asr-artifact-budget.ps1'),
    '-BaselineApk', $baselineApk, '-CandidateApk', $candidateApk
  )
  Write-Output 'STREAMING_CTC_SMALL_ENGINEERING_VERIFY=PASS'
  Write-Output 'STREAMING_CTC_SMALL_ACCURACY=WAITING_FOR_AUTHORIZED_WAV'
  Write-Output "STREAMING_CTC_SMALL_APK=$candidateApk"
} finally {
  Pop-Location
}
