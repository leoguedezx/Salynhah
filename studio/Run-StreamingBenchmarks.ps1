param(
  [ValidateSet('Capture', 'Encoder')]
  [string]$Source = 'Capture',
  [ValidateSet('1080p60', '1440p60', '1080p120')]
  [string[]]$Profiles = @('1080p60'),
  [int]$MonitorIndex = 0,
  [ValidateRange(3, 120)]
  [int]$DurationSeconds = 8,
  [switch]$FullMatrix,
  [string]$FfmpegPath = 'E:\Programas\FFmpeg\bin\ffmpeg.exe',
  [string]$OutputDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $FfmpegPath)) {
  $command = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if (-not $command) { throw 'FFmpeg não encontrado.' }
  $FfmpegPath = $command.Source
}
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $PSScriptRoot 'diagnostics'
}
[void](New-Item -ItemType Directory -Force -Path $OutputDirectory)

$profileTable = @{
  '1080p60' = [ordered]@{ width = 1920; height = 1080; fps = 60; bitrateMbps = 10 }
  '1440p60' = [ordered]@{ width = 2560; height = 1440; fps = 60; bitrateMbps = 16 }
  '1080p120' = [ordered]@{ width = 1920; height = 1080; fps = 120; bitrateMbps = 16 }
}

function Get-Percentile([double[]]$Values, [double]$Percentile) {
  if (-not $Values -or $Values.Count -eq 0) { return $null }
  $sorted = @($Values | Sort-Object)
  $index = [math]::Floor(($sorted.Count - 1) * $Percentile)
  return [double]$sorted[$index]
}

function Get-Variance([double[]]$Values) {
  if (-not $Values -or $Values.Count -lt 2) { return $null }
  $average = ($Values | Measure-Object -Average).Average
  $sum = 0.0
  foreach ($value in $Values) { $sum += [math]::Pow($value - $average, 2) }
  return $sum / $Values.Count
}

function Invoke-Benchmark([string]$ProfileName, [hashtable]$Case) {
  $profile = $profileTable[$ProfileName]
  $bitrate = "$($profile.bitrateMbps)M"
  $vbvBits = [math]::Ceiling(($profile.bitrateMbps * 1000000) / $profile.fps)
  $sourceExpression = if ($Source -eq 'Capture') {
    "gfxcapture=monitor_idx=$MonitorIndex`:max_framerate=$($profile.fps)`:width=$($profile.width)`:height=$($profile.height)`:resize_mode=scale_aspect`:scale_mode=bicubic`:capture_cursor=0"
  } else {
    "testsrc2=size=$($profile.width)x$($profile.height)`:rate=$($profile.fps)"
  }

  $arguments = [System.Collections.Generic.List[string]]::new()
  @('-hide_banner', '-loglevel', 'error', '-nostats', '-stats_period', '0.5', '-progress', 'pipe:1', '-f', 'lavfi', '-i', $sourceExpression, '-an') | ForEach-Object { $arguments.Add([string]$_) }
  @('-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'ull', '-profile:v', 'high', '-rc', 'cbr', '-b:v', $bitrate, '-minrate', $bitrate, '-maxrate', $bitrate, '-bufsize', [string]$vbvBits, '-g', [string]($profile.fps * $Case.gopSeconds), '-keyint_min', [string]($profile.fps * $Case.gopSeconds), '-bf', '0', '-rc-lookahead', '0', '-multipass', $Case.multipass, '-spatial_aq', '0', '-strict_gop', '1', '-nonref_p', '1', '-ldkfs', '1', '-zerolatency', '1', '-forced-idr', '1', '-delay', '0') | ForEach-Object { $arguments.Add([string]$_) }
  if ($Case.surfaces -ne 'auto') { $arguments.Add('-surfaces'); $arguments.Add([string]$Case.surfaces) }
  if ($Case.pacing -eq 'cfr') {
    $arguments.Add('-r'); $arguments.Add([string]$profile.fps); $arguments.Add('-fps_mode'); $arguments.Add('cfr')
  } else {
    $arguments.Add('-fps_mode'); $arguments.Add('passthrough')
  }
  @('-t', [string]$DurationSeconds, '-f', 'null', 'NUL') | ForEach-Object { $arguments.Add([string]$_) }

  $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $processInfo.FileName = $FfmpegPath
  foreach ($argument in $arguments) { [void]$processInfo.ArgumentList.Add($argument) }
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $processInfo
  $samples = [System.Collections.Generic.List[object]]::new()
  $block = @{}
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  [void]$process.Start()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  while (-not $process.StandardOutput.EndOfStream) {
    $line = $process.StandardOutput.ReadLine()
    if ($line -match '^([^=]+)=(.*)$') {
      $block[$matches[1]] = $matches[2]
      if ($matches[1] -eq 'progress') {
        $samples.Add([pscustomobject]@{
          wallMs = $clock.Elapsed.TotalMilliseconds
          frame = if ($block.frame) { [long]$block.frame } else { 0L }
          dup = if ($block.dup_frames) { [long]$block.dup_frames } else { 0L }
          drop = if ($block.drop_frames) { [long]$block.drop_frames } else { 0L }
          bitrate = if ($block.bitrate) { [string]$block.bitrate } else { '' }
          outTime = if ($block.out_time) { [string]$block.out_time } else { '' }
          speed = if ($block.speed) { [string]$block.speed } else { '' }
        })
        $block = @{}
      }
    }
  }
  $process.WaitForExit()
  $clock.Stop()
  $stderr = $stderrTask.GetAwaiter().GetResult()

  $intervalFps = [System.Collections.Generic.List[double]]::new()
  $uniqueFps = [System.Collections.Generic.List[double]]::new()
  for ($index = 1; $index -lt $samples.Count; $index++) {
    $elapsed = ($samples[$index].wallMs - $samples[$index - 1].wallMs) / 1000
    if ($elapsed -lt 0.25) { continue }
    $deltaFrames = $samples[$index].frame - $samples[$index - 1].frame
    $deltaDup = $samples[$index].dup - $samples[$index - 1].dup
    $intervalFps.Add($deltaFrames / $elapsed)
    $uniqueFps.Add([math]::Max(0, ($deltaFrames - $deltaDup) / $elapsed))
  }
  $fpsValues = [double[]]$intervalFps.ToArray()
  $uniqueValues = [double[]]$uniqueFps.ToArray()
  $last = if ($samples.Count) { $samples[$samples.Count - 1] } else { [pscustomobject]@{ frame = 0; dup = 0; drop = 0; speed = ''; bitrate = ''; outTime = '' } }
  $throughputFps = if ($clock.Elapsed.TotalSeconds -gt 0) { $last.frame / $clock.Elapsed.TotalSeconds } else { 0 }
  $frameTimes = [double[]]@($fpsValues | Where-Object { $_ -gt 0 } | ForEach-Object { 1000.0 / $_ })
  $measurementMode = if ($fpsValues.Count) { 'sliding-window' } else { 'throughput-fallback' }
  return [ordered]@{
    timestamp = [DateTime]::UtcNow.ToString('o')
    source = $Source
    profile = $ProfileName
    width = $profile.width
    height = $profile.height
    targetFps = $profile.fps
    bitrateMbps = $profile.bitrateMbps
    vbvBits = $vbvBits
    pacing = $Case.pacing
    surfaces = $Case.surfaces
    multipass = $Case.multipass
    gopSeconds = $Case.gopSeconds
    exitCode = $process.ExitCode
    wallSeconds = [math]::Round($clock.Elapsed.TotalSeconds, 3)
    frames = $last.frame
    duplicatedFrames = $last.dup
    droppedFrames = $last.drop
    samplesRecorded = $fpsValues.Count
    measurementMode = $measurementMode
    throughputFps = [math]::Round($throughputFps, 2)
    averageOutputFps = if ($fpsValues.Count) { [math]::Round(($fpsValues | Measure-Object -Average).Average, 2) } else { [math]::Round($throughputFps, 2) }
    medianOutputFps = if ($fpsValues.Count) { [math]::Round((Get-Percentile $fpsValues 0.5), 2) } else { $null }
    onePercentLowFps = if ($fpsValues.Count) { [math]::Round((Get-Percentile $fpsValues 0.01), 2) } else { $null }
    uniqueFpsEstimate = if ($uniqueValues.Count) { [math]::Round(($uniqueValues | Measure-Object -Average).Average, 2) } else { $null }
    frameTimeVariance = if ($frameTimes.Count) { [math]::Round((Get-Variance $frameTimes), 4) } else { $null }
    finalSpeed = $last.speed
    finalBitrate = $last.bitrate
    outTime = $last.outTime
    error = if ($process.ExitCode -ne 0) { $stderr.Trim() } else { '' }
  }
}

$cases = if ($FullMatrix) {
  foreach ($pacing in @('native', 'cfr')) {
    foreach ($surfaces in @('auto', '1', '2', '3', '4')) {
      foreach ($multipass in @('disabled', 'qres')) {
        foreach ($gop in @(1, 2)) {
          @{ pacing = $pacing; surfaces = $surfaces; multipass = $multipass; gopSeconds = $gop }
        }
      }
    }
  }
} else {
  @(
    @{ pacing = 'cfr'; surfaces = '1'; multipass = 'qres'; gopSeconds = 2 },
    @{ pacing = 'native'; surfaces = 'auto'; multipass = 'disabled'; gopSeconds = 2 },
    @{ pacing = 'cfr'; surfaces = 'auto'; multipass = 'disabled'; gopSeconds = 2 },
    @{ pacing = 'cfr'; surfaces = '2'; multipass = 'disabled'; gopSeconds = 2 },
    @{ pacing = 'cfr'; surfaces = '3'; multipass = 'disabled'; gopSeconds = 2 },
    @{ pacing = 'cfr'; surfaces = '4'; multipass = 'disabled'; gopSeconds = 2 },
    @{ pacing = 'cfr'; surfaces = 'auto'; multipass = 'qres'; gopSeconds = 2 },
    @{ pacing = 'cfr'; surfaces = 'auto'; multipass = 'disabled'; gopSeconds = 1 }
  )
}

$results = [System.Collections.Generic.List[object]]::new()
foreach ($profileName in $Profiles) {
  foreach ($case in $cases) {
    Write-Host "Testando $profileName · $Source · pacing=$($case.pacing) · surfaces=$($case.surfaces) · multipass=$($case.multipass) · GOP=$($case.gopSeconds)s"
    $results.Add((Invoke-Benchmark $profileName $case))
  }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$jsonPath = Join-Path $OutputDirectory "benchmark-$stamp.json"
$csvPath = Join-Path $OutputDirectory "benchmark-$stamp.csv"
$json = $results | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($jsonPath, $json, [System.Text.UTF8Encoding]::new($false))
$results | ForEach-Object { [pscustomobject]$_ } | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $csvPath
$results | ForEach-Object { [pscustomobject]$_ } | Format-Table profile,source,pacing,surfaces,multipass,gopSeconds,averageOutputFps,onePercentLowFps,uniqueFpsEstimate,duplicatedFrames,droppedFrames,finalSpeed,exitCode -Auto
Write-Host "JSON: $jsonPath"
Write-Host "CSV:  $csvPath"
