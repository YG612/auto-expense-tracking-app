[CmdletBinding()]
param(
  [switch]$VerifyOnly,
  [string]$RuntimeArtifact = '',
  [string]$RequiredOperators = 'E:\CodexData\Models\QingJiAI\paraformer-compact-work\runtime\required_operators.config',
  [string]$RuntimeLicense = 'E:\CodexData\Models\QingJiAI\paraformer-compact-work\runtime\runtime-LICENSE.txt'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lockPath = Join-Path $projectRoot 'android\app\src\internal\streaming-paraformer-compact-asr-lock.json'
$assetDirectory = 'speech/paraformer-zh-compact'
$assetRoot = Join-Path $projectRoot 'android\app\src\streamingOnnxParaformerCompact\assets\speech\paraformer-zh-compact'
$runtimeDirectory = Join-Path $projectRoot 'android\app\src\streamingOnnxParaformerCompact\libs'
$runtimeName = 'qingji-sherpa-onnx-arm64-compact.aar'
$runtimeDestination = Join-Path $runtimeDirectory $runtimeName
$tokensSource = 'D:\CodexData\Caches\QingJiAI\sherpa-onnx-paraformer-small\sherpa-onnx-paraformer-zh-small-2024-03-09\tokens.txt'
$noticeSource = Join-Path $projectRoot 'android\app\src\internal\paraformer-model-NOTICE.txt'
if ([string]::IsNullOrWhiteSpace($RuntimeArtifact)) { $RuntimeArtifact = $runtimeDestination }

$models = @(
  [ordered]@{ id='baseline-int8'; label='Original Paraformer INT8'; fileName='model.baseline-int8.qgz'; source='E:\CodexData\Models\QingJiAI\paraformer-compact-work\baseline\model.baseline-int8.qgz'; sizeBytes=74343945L; sha256='1a62cbe5f6b1633194abb2325bb089ecd6a9971328ce87d6779e82a1efaec369'; unpackedSizeBytes=81828675L; unpackedSha256='3ef6c19369b912f7caf3cef8e545c5ccd1a33d9d7ec792a46668dc41c4b229ec'; evaluation='accuracy-baseline' },
  [ordered]@{ id='rtn-safe'; label='RTN safe-layer INT4'; fileName='model.rtn-safe.qgz'; source='E:\CodexData\Models\QingJiAI\paraformer-compact-work\compression\model.int4.onnx.gz'; sizeBytes=63510652L; sha256='9ae585e851047a5d896591a2f0c9e7f51d0d16f42f6495ee812409be3fab3583'; unpackedSizeBytes=72355603L; unpackedSha256='39cd81e97e74705900569ecd1d0d27d58e9855b6cb451bce2e8c1b2d30dc3782'; evaluation='automatic-zero-regression' },
  [ordered]@{ id='hqq-safe'; label='HQQ safe-layer INT4'; fileName='model.hqq-safe.qgz'; source='E:\CodexData\Models\QingJiAI\paraformer-compact-work\hqq-safe\model.hqq-int4.qgz'; sizeBytes=64611962L; sha256='e2ee88d190a0a8642c67f8d6d408d6b0e02d03c995aee28c74280c41467d8f15'; unpackedSizeBytes=73180485L; unpackedSha256='8e1e00fb4336795b2ab6517617b73746723d41b026b61bc84c0c97396d12bb58'; evaluation='validation-promising-device-test-required' },
  [ordered]@{ id='asym-ffn'; label='Asymmetric INT4 FFN'; fileName='model.asym-ffn.qgz'; source='E:\CodexData\Models\QingJiAI\paraformer-compact-work\asym-candidates\model.candidate1.qgz'; sizeBytes=55101450L; sha256='8c6cb48607dc519a7af0761d96a1cc36008186a38d6f3d1edbd19b48c6c316fe'; unpackedSizeBytes=63584888L; unpackedSha256='a63df157d5987374d48bd304c06afd1e25ede264fe239c9b286462836884e73b'; evaluation='experimental-device-test-required' },
  [ordered]@{ id='asym-ffn-decoder'; label='Asymmetric INT4 FFN+decoder'; fileName='model.asym-ffn-decoder.qgz'; source='E:\CodexData\Models\QingJiAI\paraformer-compact-work\asym-candidates\model.candidate2.qgz'; sizeBytes=52891738L; sha256='dfca35b24100dd3b5600c3d7b9e636846efd4af5758872365b6c30e961df9582'; unpackedSizeBytes=61718939L; unpackedSha256='f13cd5005a5d6e4318bd0f085d322f6cba8a45bc6be9be3daf7b2eafcd911487'; evaluation='experimental-device-test-required' },
  [ordered]@{ id='asym-full'; label='Asymmetric INT4 full'; fileName='model.asym-full.qgz'; source='E:\CodexData\Models\QingJiAI\paraformer-compact-work\asym-candidates\model.candidate3.qgz'; sizeBytes=45137197L; sha256='6c49bb14b81bef721d16fbffa790fd584b8339073593c3557c17e951267c6cc7'; unpackedSizeBytes=55360963L; unpackedSha256='ced10ecc75ba09e682a156b2ab0c40bae5043a7df361c7f1844cf3d7263e6c62'; evaluation='experimental-device-test-required' }
)

function Get-Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Assert-File([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
}
function File-Spec([string]$Path, [string]$Name) {
  [ordered]@{ name=$Name; sizeBytes=(Get-Item -LiteralPath $Path).Length; sha256=Get-Sha256 $Path }
}

function Assert-GzipPayload($Model) {
  Assert-File $Model.source "Model $($Model.id)"
  if ((Get-Item -LiteralPath $Model.source).Length -ne $Model.sizeBytes -or (Get-Sha256 $Model.source) -ne $Model.sha256) {
    throw "Compressed model does not match lock constants: $($Model.id)"
  }
  $gzip = [IO.File]::OpenRead($Model.source)
  try {
    $inflated = [IO.Compression.GZipStream]::new($gzip, [IO.Compression.CompressionMode]::Decompress)
    try {
      $sha = [Security.Cryptography.SHA256]::Create()
      try {
        $buffer = [byte[]]::new(1MB); $bytes = 0L
        while (($count = $inflated.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $sha.TransformBlock($buffer, 0, $count, $null, 0) | Out-Null; $bytes += $count
        }
        $sha.TransformFinalBlock([byte[]]::new(0), 0, 0) | Out-Null
        $hash = [BitConverter]::ToString($sha.Hash).Replace('-', '').ToLowerInvariant()
      } finally { $sha.Dispose() }
    } finally { $inflated.Dispose() }
  } finally { $gzip.Dispose() }
  if ($bytes -ne $Model.unpackedSizeBytes -or $hash -ne $Model.unpackedSha256) {
    throw "Inflated model does not match lock constants: $($Model.id)"
  }
}

function Assert-Prepared {
  Assert-File $lockPath 'Compact model-lab lock'
  $lock = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($lock.schemaVersion -ne 2 -or $lock.engine -ne 'onnx-paraformer-compact' -or $lock.candidateStatus -ne 'MODEL_LAB' -or
      $lock.runtime.status -ne 'prepared' -or @($lock.model.candidates).Count -ne 6) {
    throw 'Compact assets are not in the six-model fail-closed lab state.'
  }
  Assert-File $runtimeDestination 'Compact runtime'
  if ((Get-Item $runtimeDestination).Length -ne $lock.runtime.sizeBytes -or (Get-Sha256 $runtimeDestination) -ne $lock.runtime.sha256) {
    throw 'Prepared compact runtime does not match the lock.'
  }
  foreach ($spec in $lock.model.requiredFiles) {
    $path = Join-Path $assetRoot $spec.name; Assert-File $path "Compact asset $($spec.name)"
    if ((Get-Item $path).Length -ne $spec.sizeBytes -or (Get-Sha256 $path) -ne $spec.sha256) { throw "Prepared compact asset does not match the lock: $($spec.name)" }
  }
  foreach ($name in @('prepared-assets.json','runtime-LICENSE.txt','paraformer-model-NOTICE.txt','paraformer-compact-sbom.json','required_operators.config')) {
    Assert-File (Join-Path $assetRoot $name) "Compact provenance $name"
  }
  $prepared = Get-Content -LiteralPath (Join-Path $assetRoot 'prepared-assets.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($prepared.lockSha256 -ne (Get-Sha256 $lockPath) -or $prepared.status -ne 'MODEL_LAB') { throw 'Prepared compact provenance does not match the current lock.' }
  Write-Output 'PARAFORMER_MODEL_LAB_SUPPLY_CHAIN=VERIFIED'
}

if ($VerifyOnly) { Assert-Prepared; exit 0 }
foreach ($model in $models) { Assert-GzipPayload $model }
foreach ($spec in @(
  [pscustomobject]@{ Path=$RuntimeArtifact; Label='Compact runtime AAR' }, [pscustomobject]@{ Path=$RequiredOperators; Label='Required-operator config' },
  [pscustomobject]@{ Path=$RuntimeLicense; Label='Runtime licenses' }, [pscustomobject]@{ Path=$tokensSource; Label='Locked tokens' },
  [pscustomobject]@{ Path=$noticeSource; Label='Model notice' }
)) { Assert-File $spec.Path $spec.Label }
if ((Get-Item $RuntimeArtifact).Length -gt 9MB) { throw 'Selected compact runtime exceeds 9 MiB.' }
if (-not (Select-String -LiteralPath $RequiredOperators -SimpleMatch 'MatMulNBits' -Quiet) -or
    -not (Select-String -LiteralPath $RequiredOperators -SimpleMatch 'MatMulIntegerToFloat' -Quiet) -or
    -not (Select-String -LiteralPath $RequiredOperators -SimpleMatch 'DynamicQuantizeMatMul' -Quiet) -or
    -not (Select-String -LiteralPath $RequiredOperators -SimpleMatch 'FusedConv' -Quiet) -or
    -not (Select-String -LiteralPath $RequiredOperators -SimpleMatch 'FusedMatMul' -Quiet) -or
    -not (Select-String -LiteralPath $RequiredOperators -SimpleMatch 'SkipLayerNormalization' -Quiet) -or
    -not (Select-String -LiteralPath $RequiredOperators -SimpleMatch 'ai.onnx;17;LayerNormalization' -Quiet)) {
  throw 'Required-operator config does not include the model-lab contrib operator closure.'
}

New-Item -ItemType Directory -Force -Path $assetRoot, $runtimeDirectory | Out-Null
$expectedModelFiles = @($models | ForEach-Object { $_.fileName })
Get-ChildItem -LiteralPath $assetRoot -File -ErrorAction SilentlyContinue | Where-Object { $_.Name.StartsWith('model.') -and $_.Name -notin $expectedModelFiles } | Remove-Item -Force
foreach ($model in $models) { Copy-Item -LiteralPath $model.source -Destination (Join-Path $assetRoot $model.fileName) -Force }
Copy-Item -LiteralPath $tokensSource -Destination (Join-Path $assetRoot 'tokens.txt') -Force
if (-not [IO.Path]::GetFullPath($RuntimeArtifact).Equals([IO.Path]::GetFullPath($runtimeDestination), [StringComparison]::OrdinalIgnoreCase)) {
  Copy-Item -LiteralPath $RuntimeArtifact -Destination $runtimeDestination -Force
}
Copy-Item -LiteralPath $RequiredOperators -Destination (Join-Path $assetRoot 'required_operators.config') -Force
Copy-Item -LiteralPath $RuntimeLicense -Destination (Join-Path $assetRoot 'runtime-LICENSE.txt') -Force
Copy-Item -LiteralPath $noticeSource -Destination (Join-Path $assetRoot 'paraformer-model-NOTICE.txt') -Force

$modelSpecs = @($models | ForEach-Object {
  $copy = Join-Path $assetRoot $_.fileName
  [pscustomobject][ordered]@{ id=$_.id; label=$_.label; fileName=$_.fileName; compression='gzip'; sizeBytes=(Get-Item $copy).Length; sha256=Get-Sha256 $copy; unpackedSizeBytes=$_.unpackedSizeBytes; unpackedSha256=$_.unpackedSha256; evaluation=$_.evaluation }
})
$tokensSpec = File-Spec $tokensSource 'tokens.txt'; $runtimeSpec = File-Spec $RuntimeArtifact $runtimeName
$operatorSpec = File-Spec $RequiredOperators 'required_operators.config'; $noticeSpec = File-Spec $noticeSource 'paraformer-model-NOTICE.txt'
$runtimeLicenseSpec = File-Spec $RuntimeLicense 'runtime-LICENSE.txt'
$requiredFiles = @($modelSpecs | ForEach-Object { [ordered]@{ name=$_.fileName; sizeBytes=$_.sizeBytes; sha256=$_.sha256 } }) + @($tokensSpec)
$bundledModelBytes = [long](($modelSpecs | Measure-Object -Property sizeBytes -Sum).Sum)

$lock = [ordered]@{
  schemaVersion=2; engine='onnx-paraformer-compact'; track='internal-arm64-model-lab'; assetDirectory=$assetDirectory; candidateStatus='MODEL_LAB'; defaultModelId='baseline-int8'
  source=[ordered]@{ repository='https://www.modelscope.cn/iic/speech_paraformer_asr_nat-zh-cn-16k-common-vocab8358-tensorflow1.git'; checkpoint=[ordered]@{ path='model.pt'; sizeBytes=284469859; sha256='e8e666e6f58a776b96eb57279b965bcece18f689efa3e53f75db82676916e130' }; exportRevision='f99c635361efbf20b3b2bc7d170452174d42a4a2'; fp32OnnxSha256='1316d557a58103d5984968542b0bd60023aa541942fb1ec31d141e95e07deb2e' }
  quantization=[ordered]@{ algorithms=@('existing-int8','RTN','HQQ','asymmetric-INT4'); blockSize=128; bits=4; opset=21 }
  model=[ordered]@{ mode='multi-model-lab'; candidates=$modelSpecs; requiredFiles=$requiredFiles; bundledModelBytes=$bundledModelBytes; vocabularySize=8359; lfrWindowSize=7; featureDimension=80 }
  runtime=[ordered]@{ status='prepared'; name=$runtimeName; version='sherpa-onnx-1.13.2+onnxruntime-1.24.4-custom'; sizeBytes=$runtimeSpec.sizeBytes; sha256=$runtimeSpec.sha256; requiredOperatorsSha256=$operatorSpec.sha256; requiredArm64Libraries=@('libonnxruntime.so','libsherpa-onnx-jni.so'); forbiddenAbiPrefixes=@('jni/armeabi-v7a/','jni/x86/','jni/x86_64/') }
  licenses=[ordered]@{ runtime=[ordered]@{ fileName=$runtimeLicenseSpec.name; sha256=$runtimeLicenseSpec.sha256 }; model=[ordered]@{ noticeName=$noticeSpec.name; sourceLicense='Apache-2.0 (source repository); exported checkpoint distribution requires review' } }
  budgets=[ordered]@{ maximumBundledModelBytes=370MB; maximumRuntimeAarBytes=9MB; maximumCandidateApkBytes=430MB; ordinaryInternalApkBytes=34867671; maximumAsrIncrementBytes=400MB }
  evaluation=[ordered]@{ policy='Human device A/B decides promotion; candidates remain separately identified'; baseline='baseline-int8'; selectedAutomaticCandidate='rtn-safe' }
}
$lock | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $lockPath -Encoding UTF8
$sbom = [ordered]@{ schemaVersion=2; track='onnx-paraformer-compact-model-lab'; components=@([ordered]@{ name='sherpa-onnx'; version='1.13.2'; revision='13d0ae6c539d2809d32f5eaa3ef1db0c459d0b24'; license='Apache-2.0' }, [ordered]@{ name='onnxruntime'; version='1.24.4'; revision='2d924974ef147392ced8409d36bd6d2e7fcc8a74'; license='MIT'; requiredOperatorsSha256=$operatorSpec.sha256 }, [ordered]@{ name='paraformer-vocab8358'; exportRevision=$lock.source.exportRevision; vocabularySha256=$tokensSpec.sha256; models=$modelSpecs }) }
$sbom | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $assetRoot 'paraformer-compact-sbom.json') -Encoding UTF8
$prepared = [ordered]@{ schemaVersion=2; status='MODEL_LAB'; lockSha256=Get-Sha256 $lockPath; modelCount=6; bundledModelBytes=$bundledModelBytes; runtimeSha256=$runtimeSpec.sha256 }
$prepared | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $assetRoot 'prepared-assets.json') -Encoding UTF8
Assert-Prepared
Write-Output 'PARAFORMER_MODEL_LAB_PREPARE=COMPLETE'
