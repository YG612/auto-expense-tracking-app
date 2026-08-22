[CmdletBinding()]
param(
  [string]$DestinationRoot = '',
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
  $baseDrive = if (Test-Path -LiteralPath 'E:\') { 'E:\' } else { 'D:\' }
  $DestinationRoot = Join-Path $baseDrive 'CodexData\Datasets\QingJiAI'
}

$artifacts = @(
  @{
    Name = 'aishell1-resource'
    Directory = 'openslr-33-aishell1'
    FileName = 'resource_aishell.tgz'
    Url = 'https://www.openslr.org/resources/33/resource_aishell.tgz'
    Bytes = 1246920L
    Sha256 = '1a6749854456e9402bc7295767937367afed1327799a5e1df0ed64baa5f77409'
  },
  @{
    Name = 'thchs30-resource'
    Directory = 'openslr-18-thchs30'
    FileName = 'resource.tgz'
    Url = 'https://www.openslr.org/resources/18/resource.tgz'
    Bytes = 24813708L
    Sha256 = '5f10b11a86930d159250c979b2dccb26ac2527775b2aa628df08513af32d85ee'
  }
)

$curl = Get-Command curl.exe -ErrorAction Stop

foreach ($artifact in $artifacts) {
  $directory = Join-Path $DestinationRoot $artifact.Directory
  $path = Join-Path $directory $artifact.FileName

  if (-not $VerifyOnly) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }

  if (-not (Test-Path -LiteralPath $path)) {
    if ($VerifyOnly) {
      throw "Missing OpenSLR resource: $path"
    }
    & $curl.Source -L --fail --retry 8 --retry-delay 3 --retry-all-errors --speed-limit 262144 --speed-time 90 --continue-at - --output $path $artifact.Url
    if ($LASTEXITCODE -ne 0) {
      throw "curl failed for $($artifact.Name) with exit code $LASTEXITCODE"
    }
  }

  $actualBytes = (Get-Item -LiteralPath $path).Length
  if ($actualBytes -ne $artifact.Bytes) {
    throw "Size mismatch for $($artifact.Name): expected $($artifact.Bytes), got $actualBytes"
  }

  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  if ($actualHash -ne $artifact.Sha256) {
    throw "SHA-256 mismatch for $($artifact.Name): expected $($artifact.Sha256), got $actualHash"
  }

  Write-Output ("OPENSLR_RESOURCE_OK name={0} bytes={1} sha256={2} path={3}" -f $artifact.Name, $actualBytes, $actualHash, $path)
}
