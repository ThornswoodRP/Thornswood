<#
  test-4667-one-voice-client.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4667-one-voice-client.ps1

  #4667. The native engine in the launcher carries voice (#4666), and the V3
  decision of 26 Oct wants one voice client. The WebView2 host went with
  #4823, but the launcher still fed the game's browser voice: at every Play
  Mics.Apply wrote this machine's microphone name into the game's
  Thornswood.ini as MicrophoneName, which only the game's own WebRTC page
  reads (game\plugins\thornswood-voice.js hands it to getUserMedia), and
  YourSettings held that one line back from the site.

  This compiles the real launcher (tests\Launcher-Csc.ps1), runs Mics.Apply
  on a made-up game folder in a temp folder, and reads launcher\app:
    - Apply writes no MicrophoneName line and takes out one an older
      launcher left, and still writes the voice port, address and socket the
      game's overlay needs for the speaking marks;
    - it still names the microphone voice will open, for the log;
    - YourSettings holds nothing back any more (no Strip, no MachineLines);
    - no code in launcher\app or launcher\ names a browser voice API, the old
      voice page, or the WebView2 SDK;
    - the native engine is still there: VoiceSession, Mics.OpenForVoice.
  On main before #4667 the Apply and YourSettings cases fail.

  No microphone, Steam, launcher or game is opened. The microphone name is a
  fixture set in the config, so Windows is never asked.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $repo 'tests/Launcher-Csc.ps1')
$pass = 0; $fail = 0
function Yes([string]$name, [bool]$ok) { if ($ok) { $script:pass++; Write-Host "PASS  $name" } else { $script:fail++; Write-Host "FAIL  $name" } }

# ---- launcher\app holds no browser voice code -----------------------------------
# Comments are left out: they say what voice was, and that is history, not code.
function CodeOf([string]$text) {
    $t = [regex]::Replace($text, '(?s)/\*.*?\*/', '')
    $t = [regex]::Replace($t, '(?s)<!--.*?-->', '')
    $keep = foreach ($line in ($t -split "`n")) { if ($line.TrimStart() -notmatch '^(//|;)') { $line } }
    return ($keep -join "`n")
}
$app = Join-Path $repo 'launcher/app'
$files = @(Get-ChildItem -LiteralPath $app -Recurse -File | Where-Object { $_.Extension -in '.cs', '.axaml', '.csproj', '.props', '.targets' })
$files += @(Get-ChildItem -LiteralPath (Join-Path $repo 'launcher') -File | Where-Object { $_.Extension -in '.html', '.js' })
Yes ('launcher\app has code to read (' + $files.Count + ' files)') ($files.Count -gt 20)
$markers = @('RTCPeerConnection', 'getUserMedia', 'CoreWebView2', 'Microsoft.Web.WebView2', 'WebView2Loader', 'voice-host', 'EnsureCoreWebView2', '"MicrophoneName = "')
$found = New-Object System.Collections.Generic.List[string]
foreach ($f in $files) {
    $code = CodeOf ([IO.File]::ReadAllText($f.FullName))
    foreach ($m in $markers) { if ($code.Contains($m)) { $found.Add($f.Name + ': ' + $m) } }
}
Yes ('no launcher code names a browser voice API, the voice page, WebView2 or the browser''s microphone line (' + ($found -join '; ') + ')') ($found.Count -eq 0)
$html = @(Get-ChildItem -LiteralPath (Join-Path $repo 'launcher') -Recurse -File -Filter '*.html' | Where-Object { $_.FullName -notmatch '[\\/]tests[\\/]' })
Yes ('and the launcher carries no page at all (' + (($html | ForEach-Object Name) -join ', ') + ')') ($html.Count -eq 0)

# ---- the real Mics.Apply and YourSettings ----------------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4667-' + [Guid]::NewGuid().ToString('n'))
[void][IO.Directory]::CreateDirectory($work)
try {
    $asm = Add-LauncherAssembly
    $ct = $asm.GetType('Thornswood.Config', $true)
    $mt = $asm.GetType('Thornswood.Mics', $true)
    $pt = $asm.GetType('Thornswood.Paths', $true)
    $yt = $asm.GetType('Thornswood.YourSettings', $true)
    $all = [Reflection.BindingFlags]'Public, NonPublic, Static'

    Yes 'the native engine is still the voice client: VoiceSession is there' ($null -ne $asm.GetType('Thornswood.VoiceSession', $false))
    Yes '  and voice opens the microphone itself, through Mics.OpenForVoice' ($null -ne $mt.GetMethod('OpenForVoice', $all))

    $cfg = [Activator]::CreateInstance($ct)
    $cfg.MicrophoneName = 'Fixture microphone'
    $cfg.VoicePort = '7789'
    $pt.GetField('Game').SetValue($null, $work)
    $ini = [IO.Path]::Combine($work, 'Data\SKSE\Plugins\Thornswood.ini')
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($ini))

    # An ini an older launcher wrote: the browser's microphone line under [Voice].
    [IO.File]::WriteAllText($ini, "[Voice]`nMicrophoneName = old`nPushToTalk = 47`nVoicePort = 7778`n")
    $said = [string]$mt.GetMethod('Apply').Invoke($null, @($cfg))
    $text = [IO.File]::ReadAllText($ini)
    Yes 'Play writes no MicrophoneName line, and takes out the one an older launcher left' ($text -notmatch '(?im)^\s*MicrophoneName\s*=')
    Yes '  and leaves the rest of [Voice] as it was' ($text -match '(?m)^\[Voice\]\r?$' -and $text -match '(?m)^PushToTalk = 47\r?$')
    Yes '  and still tells the overlay the voice port' ($text -match '(?m)^VoicePort = 7789\r?$')
    Yes '  and the voice address and socket, for the speaking marks' (
        $text -match ('(?m)^VoiceUrl = ' + [regex]::Escape($cfg.VoiceBase()) + '\r?$') -and
        $text -match ('(?m)^VoiceSocketUrl = ' + [regex]::Escape($cfg.VoiceSocket()) + '\r?$'))
    Yes ('  and names the microphone voice opens, for the log (' + $said + ')') ($said -ceq 'Fixture microphone')

    # The shipped template, which never had the line: none is added.
    [IO.File]::WriteAllText($ini, "[Voice]`nPushToTalk = 47`n")
    $null = $mt.GetMethod('Apply').Invoke($null, @($cfg))
    $text = [IO.File]::ReadAllText($ini)
    Yes 'an ini with no microphone line gets none' ($text -notmatch '(?im)^\s*MicrophoneName\s*=')

    Yes 'YourSettings holds no line back from the site any more (no Strip, no MachineLines)' (
        $null -eq $yt.GetMethod('Strip', $all) -and $null -eq $yt.GetField('MachineLines', $all))
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
