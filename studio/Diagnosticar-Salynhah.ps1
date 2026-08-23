param(
  [string]$FfmpegPath = 'E:\Programas\FFmpeg\bin\ffmpeg.exe',
  [string]$OutputPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

if (-not (Test-Path -LiteralPath $FfmpegPath)) {
  $command = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if (-not $command) { throw 'FFmpeg não encontrado.' }
  $FfmpegPath = $command.Source
}

function Get-FfmpegText([string[]]$Arguments) {
  return (& $FfmpegPath @Arguments 2>&1 | Out-String)
}

$version = Get-FfmpegText @('-version')
$filters = Get-FfmpegText @('-hide_banner', '-filters')
$encoders = Get-FfmpegText @('-hide_banner', '-encoders')
$muxers = Get-FfmpegText @('-hide_banner', '-muxers')
$nvencHelp = Get-FfmpegText @('-hide_banner', '-h', 'encoder=h264_nvenc')

$gpuRows = @()
$nvidiaSmi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if ($nvidiaSmi) {
  $gpuCsv = & $nvidiaSmi.Source '--query-gpu=name,driver_version,utilization.gpu,utilization.encoder,memory.total' '--format=csv,noheader,nounits' 2>$null
  foreach ($line in $gpuCsv) {
    $parts = $line -split ',\s*'
    if ($parts.Count -ge 5) {
      $gpuRows += [ordered]@{
        name = $parts[0]
        driver = $parts[1]
        gpuUtilizationPercent = [double]$parts[2]
        encoderUtilizationPercent = [double]$parts[3]
        memoryMiB = [double]$parts[4]
      }
    }
  }
}

$displayControllers = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{
    name = $_.Name
    width = $_.CurrentHorizontalResolution
    height = $_.CurrentVerticalResolution
    refreshHz = $_.CurrentRefreshRate
    driverVersion = $_.DriverVersion
  }
})

$screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  [ordered]@{
    deviceName = $_.DeviceName
    width = $_.Bounds.Width
    height = $_.Bounds.Height
    primary = $_.Primary
  }
})

$report = [ordered]@{
  schemaVersion = 1
  generatedAt = [DateTime]::UtcNow.ToString('o')
  ffmpegPath = $FfmpegPath
  ffmpegVersion = (($version -split "`r?`n")[0])
  capabilities = [ordered]@{
    gfxcapture = $filters -match '\bgfxcapture\b'
    scaleD3d11 = $filters -match '\bscale_d3d11\b'
    h264Nvenc = $encoders -match '\bh264_nvenc\b'
    hevcNvenc = $encoders -match '\bhevc_nvenc\b'
    av1Nvenc = $encoders -match '\bav1_nvenc\b'
    whipMuxer = $muxers -match '\bwhip\b'
    d3d11Input = $nvencHelp -match 'Supported pixel formats:.*\bd3d11\b'
    surfacesOption = $nvencHelp -match '\-surfaces'
    multipassOption = $nvencHelp -match '\-multipass'
    lowDelayKeyFrameScaleOption = $nvencHelp -match '\-ldkfs'
  }
  gpu = $gpuRows
  displayControllers = $displayControllers
  screens = $screens
  notes = @(
    'refreshHz vem do driver WMI e pode não mapear um-para-um em setups com vários monitores.',
    'A presença do codec confirma suporte do build; um encode curto confirma suporte do hardware/driver.'
  )
}

$json = $report | ConvertTo-Json -Depth 8
if ($OutputPath) {
  $parent = Split-Path -Parent $OutputPath
  if ($parent) { [void](New-Item -ItemType Directory -Force -Path $parent) }
  [System.IO.File]::WriteAllText($OutputPath, $json, [System.Text.UTF8Encoding]::new($false))
}
$json

