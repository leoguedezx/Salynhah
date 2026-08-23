Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $appRoot 'config.private.json'
$progressPath = Join-Path $env:TEMP 'cineleo-studio-progress.txt'
$siteUrl = 'https://cineleo.manoelguedess.chatgpt.site/?room=cineleo-palco'

if (-not (Test-Path -LiteralPath $configPath)) {
  [System.Windows.MessageBox]::Show('O arquivo privado de configuração não foi encontrado. Mantenha config.private.json ao lado do aplicativo.', 'CineLéo Studio', 'OK', 'Error') | Out-Null
  exit 1
}

$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
if (-not $config.ingressUrl -or -not $config.ingressToken) {
  [System.Windows.MessageBox]::Show('A configuração da transmissão está incompleta.', 'CineLéo Studio', 'OK', 'Error') | Out-Null
  exit 1
}

$ffmpegCandidates = @(
  'E:\Programas\FFmpeg\bin\ffmpeg.exe',
  (Join-Path $appRoot 'ffmpeg.exe')
)
$ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
if ($ffmpegCommand) { $ffmpegCandidates += $ffmpegCommand.Source }
$ffmpegPath = $ffmpegCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="CineLéo Studio" Width="820" Height="830" MinWidth="760" MinHeight="720"
        WindowStartupLocation="CenterScreen" Background="#0D0E0C" Foreground="#EFE9DC">
  <Window.Resources>
    <SolidColorBrush x:Key="Gold" Color="#D6A451"/>
    <SolidColorBrush x:Key="Red" Color="#D9452F"/>
    <Style TargetType="TextBlock"><Setter Property="FontFamily" Value="Segoe UI"/></Style>
    <Style TargetType="Button">
      <Setter Property="Foreground" Value="#F7F1E6"/><Setter Property="Background" Value="#242520"/>
      <Setter Property="BorderBrush" Value="#4B4C45"/><Setter Property="Padding" Value="16,11"/>
      <Setter Property="FontWeight" Value="SemiBold"/><Setter Property="Cursor" Value="Hand"/>
    </Style>
    <Style TargetType="ComboBox">
      <Setter Property="Foreground" Value="#F1EBDD"/><Setter Property="Background" Value="#171814"/>
      <Setter Property="BorderBrush" Value="#494A43"/><Setter Property="Padding" Value="12,8"/>
    </Style>
    <Style TargetType="TextBox">
      <Setter Property="Foreground" Value="#E8E1D4"/><Setter Property="Background" Value="#131410"/>
      <Setter Property="BorderBrush" Value="#3E3F39"/><Setter Property="Padding" Value="10"/>
    </Style>
  </Window.Resources>
  <Grid>
    <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
    <Border Grid.Row="0" Background="#141511" BorderBrush="#373832" BorderThickness="0,0,0,1" Padding="28,20">
      <Grid><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
        <StackPanel Orientation="Horizontal">
          <Border Width="45" Height="45" CornerRadius="23" BorderBrush="#D6A451" BorderThickness="1" Background="#1C1D18">
            <TextBlock Text="CL" Foreground="#D6A451" FontFamily="Georgia" FontStyle="Italic" FontSize="20" HorizontalAlignment="Center" VerticalAlignment="Center"/>
          </Border>
          <StackPanel Margin="14,1,0,0"><TextBlock Text="CINELÉO STUDIO" FontFamily="Georgia" FontSize="23"/><TextBlock Text="TRANSMISSOR NATIVO PARA WINDOWS" Foreground="#888A82" FontSize="9" FontWeight="Bold"/></StackPanel>
        </StackPanel>
        <Border Grid.Column="1" Background="#2B2015" BorderBrush="#80612F" BorderThickness="1" CornerRadius="15" Padding="13,7" VerticalAlignment="Center">
          <TextBlock x:Name="BadgeText" Text="1080P60 · ESTÁVEL · RTX" Foreground="#E3B45F" FontSize="10" FontWeight="Bold"/>
        </Border>
      </Grid>
    </Border>

    <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto">
      <StackPanel Margin="30,24,30,20">
        <TextBlock Text="1. ESCOLHA A TELA" Foreground="{StaticResource Gold}" FontWeight="Bold" FontSize="10"/>
        <ComboBox x:Name="MonitorCombo" Margin="0,9,0,16" Height="44" DisplayMemberPath="Label"/>

        <TextBlock Text="2. ESCOLHA O PERFIL" Foreground="{StaticResource Gold}" FontWeight="Bold" FontSize="10"/>
        <ComboBox x:Name="ProfileCombo" Margin="0,9,0,16" Height="44" DisplayMemberPath="Label"/>

        <TextBlock Text="BITRATE DO PERFIL" Foreground="#8D8E86" FontWeight="Bold" FontSize="9"/>
        <ComboBox x:Name="BitrateCombo" Margin="0,8,0,16" Height="42"/>

        <Grid Margin="0,0,0,20"><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="16"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
          <Border Grid.Column="0" Background="#171814" BorderBrush="#3B3C36" BorderThickness="1" Padding="18">
            <StackPanel><TextBlock x:Name="ResolutionMetric" Text="1920 × 1080" FontFamily="Georgia" FontSize="25"/><TextBlock Text="RESOLUÇÃO DE SAÍDA" Foreground="#777970" FontSize="9" Margin="0,5,0,0"/></StackPanel>
          </Border>
          <Border Grid.Column="2" Background="#171814" BorderBrush="#725A30" BorderThickness="1" Padding="18">
            <StackPanel><TextBlock x:Name="OutputFpsMetric" Text="60 FPS" Foreground="{StaticResource Gold}" FontFamily="Georgia" FontSize="25"/><TextBlock x:Name="ProfileNote" Text="MENOS PERDA · MAIS ESTÁVEL" Foreground="#8D8E86" FontSize="9" Margin="0,5,0,0"/></StackPanel>
          </Border>
        </Grid>

        <TextBlock Text="3. OPÇÕES" Foreground="{StaticResource Gold}" FontWeight="Bold" FontSize="10"/>
        <Border Margin="0,9,0,20" Background="#151612" BorderBrush="#393A34" BorderThickness="1" Padding="16">
          <StackPanel>
            <CheckBox x:Name="CursorCheck" IsChecked="True" Content="Mostrar o cursor do mouse" Foreground="#D7D2C7" Margin="0,0,0,11"/>
            <CheckBox x:Name="MicCheck" Content="Incluir meu microfone no Studio (opcional)" Foreground="#D7D2C7"/>
            <TextBox x:Name="MicDevice" Margin="0,10,0,0" Text="Microfone (3- HyperX Cloud Flight for PS)" IsEnabled="False" ToolTip="Nome exato do dispositivo de áudio do Windows"/>
            <CheckBox x:Name="DiagnosticCheck" Margin="0,12,0,0" Content="Modo diagnóstico: registrar métricas em JSONL e CSV" Foreground="#D7D2C7"/>
            <TextBlock Text="Dica: para conversar, você também pode usar o botão FALAR NA SALA do site. Isso evita eco." Foreground="#777970" TextWrapping="Wrap" FontSize="10" Margin="0,10,0,0"/>
          </StackPanel>
        </Border>

        <TextBlock Text="4. TRANSMITA" Foreground="{StaticResource Gold}" FontWeight="Bold" FontSize="10"/>
        <Grid Margin="0,9,0,14"><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="12"/><ColumnDefinition Width="190"/></Grid.ColumnDefinitions>
          <Button x:Name="StartButton" Grid.Column="0" Content="▶  INICIAR TRANSMISSÃO 1080P60" Background="#D9452F" BorderBrush="#F0715C" FontSize="12" Padding="18,15"/>
          <Button x:Name="OpenSiteButton" Grid.Column="2" Content="ABRIR CABINE ↗" Padding="15"/>
        </Grid>

        <Border Background="#10110E" BorderBrush="#34352F" BorderThickness="1" Padding="17">
          <Grid><Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
            <Ellipse x:Name="StatusDot" Width="9" Height="9" Fill="#777970" VerticalAlignment="Top" Margin="0,4,12,0"/>
            <StackPanel Grid.Column="1"><TextBlock x:Name="StatusTitle" Text="PRONTO PARA ENTRAR NO AR" FontWeight="Bold" FontSize="10"/><TextBlock x:Name="StatusDetail" Text="Captura Windows + NVENC + LiveKit WHIP" Foreground="#85877E" Margin="0,5,0,0" FontSize="10" TextWrapping="Wrap"/></StackPanel>
            <StackPanel Grid.Column="2" HorizontalAlignment="Right"><TextBlock x:Name="FpsMetric" Text="— FPS" Foreground="{StaticResource Gold}" FontFamily="Georgia" FontSize="21" HorizontalAlignment="Right"/><TextBlock x:Name="BitrateMetric" Text="10 Mbps alvo" Foreground="#74766E" FontSize="9" HorizontalAlignment="Right"/></StackPanel>
          </Grid>
        </Border>
        <Grid Margin="0,10,0,0">
          <Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition/><ColumnDefinition/><ColumnDefinition/></Grid.ColumnDefinitions>
          <Grid.RowDefinitions><RowDefinition/><RowDefinition/></Grid.RowDefinitions>
          <Border Grid.Row="0" Grid.Column="0" BorderBrush="#34352F" BorderThickness="1" Padding="10"><StackPanel><TextBlock x:Name="CaptureFpsMetric" Text="—" Foreground="#D6A451" FontFamily="Georgia" FontSize="17"/><TextBlock Text="CAPTURA ÚNICA (EST.)" Foreground="#6F7169" FontSize="7"/></StackPanel></Border>
          <Border Grid.Row="0" Grid.Column="1" BorderBrush="#34352F" BorderThickness="0,1,1,1" Padding="10"><StackPanel><TextBlock x:Name="EncodeFpsMetric" Text="—" Foreground="#D6A451" FontFamily="Georgia" FontSize="17"/><TextBlock Text="ENCODE / ENVIO" Foreground="#6F7169" FontSize="7"/></StackPanel></Border>
          <Border Grid.Row="0" Grid.Column="2" BorderBrush="#34352F" BorderThickness="0,1,1,1" Padding="10"><StackPanel><TextBlock x:Name="DuplicateMetric" Text="0" Foreground="#D6A451" FontFamily="Georgia" FontSize="17"/><TextBlock Text="DUPLICADOS" Foreground="#6F7169" FontSize="7"/></StackPanel></Border>
          <Border Grid.Row="0" Grid.Column="3" BorderBrush="#34352F" BorderThickness="0,1,1,1" Padding="10"><StackPanel><TextBlock x:Name="DropMetric" Text="0" Foreground="#D6A451" FontFamily="Georgia" FontSize="17"/><TextBlock Text="DESCARTADOS" Foreground="#6F7169" FontSize="7"/></StackPanel></Border>
          <Border Grid.Row="1" Grid.Column="0" BorderBrush="#34352F" BorderThickness="1,0,1,1" Padding="10"><StackPanel><TextBlock x:Name="GpuMetric" Text="—" Foreground="#D6A451" FontFamily="Georgia" FontSize="15"/><TextBlock Text="GPU / NVENC" Foreground="#6F7169" FontSize="7"/></StackPanel></Border>
          <Border Grid.Row="1" Grid.Column="1" BorderBrush="#34352F" BorderThickness="0,0,1,1" Padding="10"><StackPanel><TextBlock x:Name="SpeedMetric" Text="—" Foreground="#D6A451" FontFamily="Georgia" FontSize="15"/><TextBlock Text="VELOCIDADE" Foreground="#6F7169" FontSize="7"/></StackPanel></Border>
          <Border Grid.Row="1" Grid.Column="2" BorderBrush="#34352F" BorderThickness="0,0,1,1" Padding="10"><StackPanel><TextBlock x:Name="RecoveryMetric" Text="0 / 0" Foreground="#D6A451" FontFamily="Georgia" FontSize="15"/><TextBlock Text="NACK / RTX" Foreground="#6F7169" FontSize="7"/></StackPanel></Border>
          <Border Grid.Row="1" Grid.Column="3" BorderBrush="#34352F" BorderThickness="0,0,1,1" Padding="10"><StackPanel><TextBlock Text="N/D" Foreground="#85877E" FontFamily="Georgia" FontSize="15"/><TextBlock Text="FILA / LATÊNCIA NVENC" Foreground="#6F7169" FontSize="7"/></StackPanel></Border>
        </Grid>
      </StackPanel>
    </ScrollViewer>

    <Border Grid.Row="2" Background="#141511" BorderBrush="#34352F" BorderThickness="0,1,0,0" Padding="26,13">
      <TextBlock Text="O Studio envia uma única cópia da tela ao servidor. Cada espectador recebe uma rota própria, sem multiplicar seu upload." Foreground="#777970" FontSize="9" TextAlignment="Center"/>
    </Border>
  </Grid>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)
$monitorCombo = $window.FindName('MonitorCombo')
$profileCombo = $window.FindName('ProfileCombo')
$bitrateCombo = $window.FindName('BitrateCombo')
$cursorCheck = $window.FindName('CursorCheck')
$micCheck = $window.FindName('MicCheck')
$micDevice = $window.FindName('MicDevice')
$diagnosticCheck = $window.FindName('DiagnosticCheck')
$startButton = $window.FindName('StartButton')
$openSiteButton = $window.FindName('OpenSiteButton')
$statusDot = $window.FindName('StatusDot')
$statusTitle = $window.FindName('StatusTitle')
$statusDetail = $window.FindName('StatusDetail')
$fpsMetric = $window.FindName('FpsMetric')
$bitrateMetric = $window.FindName('BitrateMetric')
$badgeText = $window.FindName('BadgeText')
$resolutionMetric = $window.FindName('ResolutionMetric')
$outputFpsMetric = $window.FindName('OutputFpsMetric')
$profileNote = $window.FindName('ProfileNote')
$captureFpsMetric = $window.FindName('CaptureFpsMetric')
$encodeFpsMetric = $window.FindName('EncodeFpsMetric')
$duplicateMetric = $window.FindName('DuplicateMetric')
$dropMetric = $window.FindName('DropMetric')
$gpuMetric = $window.FindName('GpuMetric')
$speedMetric = $window.FindName('SpeedMetric')
$recoveryMetric = $window.FindName('RecoveryMetric')

$screens = [System.Windows.Forms.Screen]::AllScreens
for ($index = 0; $index -lt $screens.Count; $index++) {
  $screen = $screens[$index]
  $primary = if ($screen.Primary) { ' · PRINCIPAL' } else { '' }
  [void]$monitorCombo.Items.Add([pscustomobject]@{ Index = $index; Label = "Monitor $($index + 1) · $($screen.Bounds.Width)×$($screen.Bounds.Height)$primary" })
}
if ($monitorCombo.Items.Count -gt 0) { $monitorCombo.SelectedIndex = 0 }

$profiles = @(
  [pscustomobject]@{ Label = '1080p60 Estável · recomendado'; Short = '1080P60'; Badge = '1080P60 · ESTÁVEL · NVIDIA'; Width = 1920; Height = 1080; Fps = 60; DefaultBitrate = 10; Bitrates = @(8, 10, 12, 15, 20); Note = 'MENOS PERDA · MAIS ESTÁVEL' },
  [pscustomobject]@{ Label = '2K60 Alta qualidade'; Short = '2K60'; Badge = '2K60 · ALTA QUALIDADE · NVIDIA'; Width = 2560; Height = 1440; Fps = 60; DefaultBitrate = 16; Bitrates = @(12, 16, 20, 25, 30); Note = 'MAIS DEFINIÇÃO · 60 FPS' },
  [pscustomobject]@{ Label = '1080p120 Ultra · experimental'; Short = '1080P120'; Badge = '1080P120 · EXPERIMENTAL · NVIDIA'; Width = 1920; Height = 1080; Fps = 120; DefaultBitrate = 16; Bitrates = @(12, 16, 20, 25, 30); Note = 'SÓ USE APÓS VALIDAR 60 FPS' }
)
foreach ($profile in $profiles) { [void]$profileCombo.Items.Add($profile) }
$profileCombo.SelectedIndex = 0

$script:ffmpegProcess = $null
$script:lastProgress = ''
$script:lastFrame = $null
$script:lastDup = 0L
$script:lastDrop = 0L
$script:lastSampleAt = $null
$script:nackCount = 0L
$script:rtxCount = 0L
$script:lastGpuPoll = [DateTime]::MinValue
$script:lastGpu = $null
$script:diagnosticJsonl = ''
$script:diagnosticCsv = ''

function Quote-Argument([string]$value) {
  return '"' + $value.Replace('"', '\"') + '"'
}

function Set-StudioStatus([string]$title, [string]$detail, [string]$color) {
  $statusTitle.Text = $title
  $statusDetail.Text = $detail
  $statusDot.Fill = New-Object Windows.Media.SolidColorBrush ([Windows.Media.ColorConverter]::ConvertFromString($color))
}

function Get-SelectedProfile {
  if ($profileCombo.SelectedItem) { return $profileCombo.SelectedItem }
  return $profiles[0]
}

function Get-SelectedBitrateMbps {
  $profile = Get-SelectedProfile
  if ($bitrateCombo.SelectedItem -ne $null) { return [int]$bitrateCombo.SelectedItem }
  return [int]$profile.DefaultBitrate
}

function Get-VbvBufferBits([int]$bitrateMbps, [int]$fps) {
  return [int][math]::Ceiling(($bitrateMbps * 1000000.0) / $fps)
}

function Update-BitrateOptions {
  $profile = Get-SelectedProfile
  $bitrateCombo.Items.Clear()
  foreach ($value in $profile.Bitrates) { [void]$bitrateCombo.Items.Add([int]$value) }
  $bitrateCombo.SelectedItem = [int]$profile.DefaultBitrate
}

function Reset-HostMetrics {
  $script:lastFrame = $null
  $script:lastDup = 0L
  $script:lastDrop = 0L
  $script:lastSampleAt = $null
  $script:nackCount = 0L
  $script:rtxCount = 0L
  $script:lastGpu = $null
  $script:lastGpuPoll = [DateTime]::MinValue
  $captureFpsMetric.Text = '—'
  $encodeFpsMetric.Text = '—'
  $duplicateMetric.Text = '0'
  $dropMetric.Text = '0'
  $gpuMetric.Text = '—'
  $speedMetric.Text = '—'
  $recoveryMetric.Text = 'N/D'
}

function Initialize-DiagnosticSession {
  $script:diagnosticJsonl = ''
  $script:diagnosticCsv = ''
  if (-not $diagnosticCheck.IsChecked) { return }
  $directory = Join-Path $appRoot 'diagnostics'
  [void](New-Item -ItemType Directory -Force -Path $directory)
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $script:diagnosticJsonl = Join-Path $directory "host-$stamp.jsonl"
  $script:diagnosticCsv = Join-Path $directory "host-$stamp.csv"
  [System.IO.File]::WriteAllText($script:diagnosticCsv, "timestamp,capture_fps_estimate,encode_fps,send_fps,frames,duplicated,dropped,bitrate,speed,gpu_percent,nvenc_percent,nack,rtx,out_time`r`n", [System.Text.UTF8Encoding]::new($false))
}

function Write-DiagnosticSample([System.Collections.IDictionary]$sample) {
  if (-not $script:diagnosticJsonl) { return }
  $jsonLine = ($sample | ConvertTo-Json -Compress) + "`n"
  [System.IO.File]::AppendAllText($script:diagnosticJsonl, $jsonLine, [System.Text.UTF8Encoding]::new($false))
  $fields = @('timestamp','capture_fps_estimate','encode_fps','send_fps','frames','duplicated','dropped','bitrate','speed','gpu_percent','nvenc_percent','nack','rtx','out_time') | ForEach-Object { [string]$sample[$_] }
  [System.IO.File]::AppendAllText($script:diagnosticCsv, ([string]::Join(',', $fields) + "`r`n"), [System.Text.UTF8Encoding]::new($false))
}

function Get-GpuTelemetry {
  $command = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
  if (-not $command) { return $null }
  $line = & $command.Source '--query-gpu=utilization.gpu,utilization.encoder' '--format=csv,noheader,nounits' 2>$null | Select-Object -First 1
  if (-not $line) { return $null }
  $parts = $line -split ',\s*'
  if ($parts.Count -lt 2) { return $null }
  return [pscustomobject]@{ Gpu = [double]$parts[0]; Encoder = [double]$parts[1] }
}

function Update-ProfileUi {
  $profile = Get-SelectedProfile
  $bitrateMbps = Get-SelectedBitrateMbps
  $badgeText.Text = $profile.Badge
  $resolutionMetric.Text = "$($profile.Width) × $($profile.Height)"
  $outputFpsMetric.Text = "$($profile.Fps) FPS"
  $profileNote.Text = $profile.Note
  $bitrateMetric.Text = "$bitrateMbps Mbps alvo · VBV $((Get-VbvBufferBits $bitrateMbps $profile.Fps)) bits"
  if (-not ($script:ffmpegProcess -and -not $script:ffmpegProcess.HasExited)) {
    $startButton.Content = "▶  INICIAR TRANSMISSÃO $($profile.Short)"
  }
}

function Stop-Studio {
  if ($script:ffmpegProcess -and -not $script:ffmpegProcess.HasExited) {
    try { $script:ffmpegProcess.StandardInput.WriteLine('q') } catch {}
  }
  $profile = Get-SelectedProfile
  $startButton.Content = "▶  INICIAR TRANSMISSÃO $($profile.Short)"
  $startButton.Background = New-Object Windows.Media.SolidColorBrush ([Windows.Media.ColorConverter]::ConvertFromString('#D9452F'))
  Set-StudioStatus 'TRANSMISSÃO ENCERRADA' 'Pronto para iniciar novamente.' '#777970'
  $fpsMetric.Text = '— FPS'
  Reset-HostMetrics
}

$micCheck.Add_Checked({ $micDevice.IsEnabled = $true })
$micCheck.Add_Unchecked({ $micDevice.IsEnabled = $false })
$profileCombo.Add_SelectionChanged({ Update-BitrateOptions; Update-ProfileUi })
$bitrateCombo.Add_SelectionChanged({ Update-ProfileUi })
$openSiteButton.Add_Click({ Start-Process $siteUrl })

$startButton.Add_Click({
  if ($script:ffmpegProcess -and -not $script:ffmpegProcess.HasExited) {
    Stop-Studio
    return
  }
  if (-not $ffmpegPath) {
    [System.Windows.MessageBox]::Show('FFmpeg não foi encontrado. O CineLéo esperava encontrá-lo em E:\Programas\FFmpeg\bin\ffmpeg.exe.', 'CineLéo Studio', 'OK', 'Error') | Out-Null
    return
  }
  if (-not $monitorCombo.SelectedItem) {
    [System.Windows.MessageBox]::Show('Escolha um monitor para transmitir.', 'CineLéo Studio', 'OK', 'Warning') | Out-Null
    return
  }

  $monitorIndex = [int]$monitorCombo.SelectedItem.Index
  $profile = Get-SelectedProfile
  $bitrateMbps = Get-SelectedBitrateMbps
  $bitrate = "$bitrateMbps`M"
  $bufferBits = Get-VbvBufferBits $bitrateMbps $profile.Fps
  $drawMouse = if ($cursorCheck.IsChecked) { 1 } else { 0 }
  $capture = "gfxcapture=monitor_idx=$monitorIndex`:max_framerate=$($profile.Fps)`:width=$($profile.Width)`:height=$($profile.Height)`:resize_mode=scale_aspect`:scale_mode=bicubic`:capture_cursor=$drawMouse"
  $arguments = @(
    '-hide_banner', '-loglevel', 'warning', '-nostats', '-stats_period', '0.5', '-progress', $progressPath,
    '-fflags', 'nobuffer', '-flags', 'low_delay',
    '-f', 'lavfi', '-i', $capture
  )

  if ($micCheck.IsChecked -and $micDevice.Text.Trim()) {
    $arguments += @('-thread_queue_size', '1024', '-f', 'dshow', '-i', "audio=$($micDevice.Text.Trim())", '-map', '0:v:0', '-map', '1:a:0')
  } else {
    $arguments += @('-map', '0:v:0', '-an')
  }

  $arguments += @(
    '-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'ull', '-profile:v', 'high', '-level', '5.2',
    '-rc', 'cbr', '-b:v', $bitrate, '-minrate', $bitrate, '-maxrate', $bitrate, '-bufsize', $bufferBits,
    '-g', ([int]$profile.Fps * 2), '-keyint_min', ([int]$profile.Fps * 2), '-bf', '0', '-rc-lookahead', '0', '-multipass', 'disabled', '-surfaces', '2',
    '-spatial_aq', '0', '-strict_gop', '1', '-nonref_p', '1', '-ldkfs', '1', '-cbr_padding', '0',
    '-zerolatency', '1', '-forced-idr', '1', '-delay', '0', '-r', $profile.Fps, '-fps_mode', 'cfr',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'
  )
  if ($micCheck.IsChecked -and $micDevice.Text.Trim()) {
    $arguments += @('-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2')
  }
  $arguments += @('-f', 'whip', '-handshake_timeout', '15000', '-pkt_size', '1200', '-ts_buffer_size', '16777216', '-rtp_history', '2048', '-authorization', [string]$config.ingressToken, [string]$config.ingressUrl)

  if (Test-Path -LiteralPath $progressPath) { Remove-Item -LiteralPath $progressPath -Force -ErrorAction SilentlyContinue }
  Reset-HostMetrics
  Initialize-DiagnosticSession
  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  $processInfo.FileName = $ffmpegPath
  $processInfo.Arguments = ($arguments | ForEach-Object { Quote-Argument ([string]$_) }) -join ' '
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $processInfo.RedirectStandardInput = $true
  $processInfo.RedirectStandardError = $false
  $processInfo.WorkingDirectory = $appRoot

  try {
    $script:ffmpegProcess = New-Object System.Diagnostics.Process
    $script:ffmpegProcess.StartInfo = $processInfo
    [void]$script:ffmpegProcess.Start()
    try { $script:ffmpegProcess.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::High } catch {}
    $startButton.Content = '■  ENCERRAR TRANSMISSÃO'
    $startButton.Background = New-Object Windows.Media.SolidColorBrush ([Windows.Media.ColorConverter]::ConvertFromString('#2B2C27'))
    Set-StudioStatus 'CONECTANDO AO PROJETOR…' 'Negociando a rota WebRTC com o LiveKit.' '#D6A451'
  } catch {
    Set-StudioStatus 'NÃO FOI POSSÍVEL INICIAR' $_.Exception.Message '#D9452F'
  }
})

$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(700)
$timer.Add_Tick({
  if ($script:ffmpegProcess -and $script:ffmpegProcess.HasExited) {
    if ($startButton.Content -like '■*') {
      $code = $script:ffmpegProcess.ExitCode
      $profile = Get-SelectedProfile
      $startButton.Content = "▶  INICIAR TRANSMISSÃO $($profile.Short)"
      $startButton.Background = New-Object Windows.Media.SolidColorBrush ([Windows.Media.ColorConverter]::ConvertFromString('#D9452F'))
      if ($code -eq 0) { Set-StudioStatus 'TRANSMISSÃO ENCERRADA' 'Pronto para iniciar novamente.' '#777970' }
      else { Set-StudioStatus 'TRANSMISSÃO INTERROMPIDA' "O transmissor encerrou com código $code. Verifique a tela escolhida e tente novamente." '#D9452F' }
    }
    return
  }
  if (-not (Test-Path -LiteralPath $progressPath)) { return }
  try {
    $progress = Get-Content -Raw -LiteralPath $progressPath -ErrorAction Stop
    if ($progress -eq $script:lastProgress) { return }
    $script:lastProgress = $progress
    $blocks = $progress -split "progress="
    $latest = $blocks | Where-Object { $_ -match 'frame=' } | Select-Object -Last 1
    if (-not $latest) { return }
    $values = @{}
    foreach ($line in ($latest -split "`r?`n")) {
      if ($line -match '^([^=]+)=(.*)$') { $values[$matches[1]] = $matches[2] }
    }
    $now = [DateTime]::UtcNow
    $frame = if ($values.frame) { [long]$values.frame } else { 0L }
    $dup = if ($values.dup_frames) { [long]$values.dup_frames } else { 0L }
    $drop = if ($values.drop_frames) { [long]$values.drop_frames } else { 0L }
    if (($now - $script:lastGpuPoll).TotalSeconds -ge 2) {
      $script:lastGpuPoll = $now
      try { $script:lastGpu = Get-GpuTelemetry } catch { $script:lastGpu = $null }
      if ($script:lastGpu) { $gpuMetric.Text = "$([math]::Round($script:lastGpu.Gpu))% / $([math]::Round($script:lastGpu.Encoder))%" }
    }
    if ($script:lastFrame -ne $null -and $script:lastSampleAt) {
      $elapsed = ($now - $script:lastSampleAt).TotalSeconds
      if ($elapsed -ge 0.2 -and $frame -ge $script:lastFrame) {
        $deltaFrame = $frame - [long]$script:lastFrame
        $deltaDup = [math]::Max(0, $dup - $script:lastDup)
        $encodeFps = $deltaFrame / $elapsed
        $captureEstimate = [math]::Max(0, ($deltaFrame - $deltaDup) / $elapsed)
        $fpsMetric.Text = "$([math]::Round($encodeFps, 1)) FPS"
        $captureFpsMetric.Text = "$([math]::Round($captureEstimate, 1)) FPS"
        $encodeFpsMetric.Text = "$([math]::Round($encodeFps, 1)) FPS"
        $duplicateMetric.Text = [string]$dup
        $dropMetric.Text = [string]$drop
        $speedMetric.Text = if ($values.speed) { [string]$values.speed } else { '—' }
        $gpuPercent = if ($script:lastGpu) { [double]$script:lastGpu.Gpu } else { '' }
        $nvencPercent = if ($script:lastGpu) { [double]$script:lastGpu.Encoder } else { '' }
        Write-DiagnosticSample ([ordered]@{
          timestamp = $now.ToString('o')
          capture_fps_estimate = [math]::Round($captureEstimate, 3)
          encode_fps = [math]::Round($encodeFps, 3)
          send_fps = [math]::Round($encodeFps, 3)
          frames = $frame
          duplicated = $dup
          dropped = $drop
          bitrate = if ($values.bitrate) { [string]$values.bitrate } else { '' }
          speed = if ($values.speed) { [string]$values.speed } else { '' }
          gpu_percent = $gpuPercent
          nvenc_percent = $nvencPercent
          nack = ''
          rtx = ''
          out_time = if ($values.out_time) { [string]$values.out_time } else { '' }
        })
      }
    }
    $script:lastFrame = $frame
    $script:lastDup = $dup
    $script:lastDrop = $drop
    $script:lastSampleAt = $now
    if ($values.bitrate -and $values.bitrate -ne 'N/A') { $bitrateMetric.Text = $values.bitrate }
    $speedText = if ($values.speed) { " · velocidade $($values.speed)" } else { '' }
    $profile = Get-SelectedProfile
    $diagnosticText = if ($script:diagnosticJsonl) { ' · diagnóstico ativo' } else { '' }
    Set-StudioStatus "NO AR · $($profile.Short)" "NVENC enviando ao LiveKit$speedText$diagnosticText" '#D9452F'
  } catch {}
})
$timer.Start()
Update-BitrateOptions
Update-ProfileUi

$window.Add_Closing({ Stop-Studio; $timer.Stop() })
[void]$window.ShowDialog()
