[CmdletBinding()]
param(
  [string]$Python = 'E:\CodexData\Envs\QingJiAI\paraformer-compact\python.exe',
  [string]$Fp32Model = 'E:\CodexData\Models\QingJiAI\paraformer-compact-work\fp32\model.onnx',
  [string]$BaselineModel = 'D:\CodexData\Caches\QingJiAI\sherpa-onnx-paraformer-small\sherpa-onnx-paraformer-zh-small-2024-03-09\model.int8.onnx',
  [string]$OutputDirectory = 'E:\CodexData\Models\QingJiAI\paraformer-compact-work\exact-candidates',
  [string]$OnnxRuntimeSource = 'E:\CodexData\Sources\QingJiAI\onnxruntime-1.24.4'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$quantizer = Join-Path $projectRoot 'scripts\asr-benchmark\quantize-paraformer-compact.py'
$requiredOperatorTool = Join-Path $OnnxRuntimeSource 'tools\python\create_reduced_build_config.py'
$requiredOperatorPath = Join-Path $OutputDirectory 'required_operators.config'

function Assert-File([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label is missing: $Path"
  }
}

Assert-File $Python 'Pinned Python runtime'
Assert-File $Fp32Model 'Locked FP32 model'
Assert-File $BaselineModel 'Locked INT8 baseline'
Assert-File $quantizer 'Compact quantizer'
Assert-File $requiredOperatorTool 'ONNX Runtime operator-config generator'

$fp32Hash = (Get-FileHash -LiteralPath $Fp32Model -Algorithm SHA256).Hash.ToLowerInvariant()
$baselineHash = (Get-FileHash -LiteralPath $BaselineModel -Algorithm SHA256).Hash.ToLowerInvariant()
if ($fp32Hash -ne '1316d557a58103d5984968542b0bd60023aa541942fb1ec31d141e95e07deb2e') {
  throw "FP32 source hash is not the locked export: $fp32Hash"
}
if ($baselineHash -ne '3ef6c19369b912f7caf3cef8e545c5ccd1a33d9d7ec792a46668dc41c4b229ec') {
  throw "INT8 baseline hash is not the locked model: $baselineHash"
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
& $Python $quantizer --fp32 $Fp32Model --baseline $BaselineModel --output-dir $OutputDirectory
if ($LASTEXITCODE -ne 0) { throw "Compact quantization failed with exit code $LASTEXITCODE." }

$largestCandidate = Join-Path $OutputDirectory 'model.candidate3_ffn_decoder_attention.int4.onnx'
Assert-File $largestCandidate 'Operator-superset INT4 candidate'
& $Python $requiredOperatorTool $largestCandidate $requiredOperatorPath
if ($LASTEXITCODE -ne 0) { throw "Required-operator generation failed with exit code $LASTEXITCODE." }

$reportPath = Join-Path $OutputDirectory 'quantization-report.json'
$report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($report.quantization.algorithm -ne 'RTN' -or
    $report.quantization.signed -ne $true -or
    $report.quantization.blockSize -ne 128 -or
    $report.source.candidateOpset -ne 21) {
  throw 'Quantization report violates the compact-track lock.'
}

Write-Output "PARAFORMER_COMPACT_QUANTIZATION=COMPLETE"
Write-Output "PARAFORMER_COMPACT_FP32_SHA256=$fp32Hash"
Write-Output "PARAFORMER_COMPACT_BASELINE_SHA256=$baselineHash"
Write-Output "PARAFORMER_COMPACT_REQUIRED_OPERATORS_SHA256=$((Get-FileHash -LiteralPath $requiredOperatorPath -Algorithm SHA256).Hash.ToLowerInvariant())"
