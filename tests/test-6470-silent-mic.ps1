<#
  test-6470-silent-mic.ps1

    pwsh -NoProfile -File tests/test-6470-silent-mic.ps1

  The launcher notices a microphone that gives nothing but digital silence
  while push to talk is held, and says so (#6470).

  In the 19 Nov 2026 Dev playtest that reproduced one way voice, one PC's
  Windows communications microphone (a headset's "Game" endpoint) peaked at
  6.7e-11 over more than 5,000 held frames. The launcher encoded and sent
  every frame, the other PC decoded Opus silence, and nobody was told: the
  indicator lights from push to talk. Every working microphone in the 71 log
  sets testers sent since 18 Nov peaked between 0.08 and 1.0 while held.

    S  the real MicSilence (launcher/app/VoiceMeter.cs, compiled here): the
       measured silence turns silent after five seconds of held frames and
       not one frame sooner, says so once, and the first frame with sound
       ends it; a quiet but real microphone, one sample over the floor, or
       a NaN-only frame each do what they should
    W  VoiceSession feeds it only frames taken while push to talk is held,
       before the peers check, so somebody alone is told too; Voice.cs
       writes the fifth word of voice-status.txt, puts "silent" in the
       relay's answer and says a line naming what to do

  Runs anywhere in PowerShell 7. Needs no Windows device.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'launcher/app'
$failed = 0
$passed = 0
function Yes([string]$What, [bool]$Ok) {
    if ($Ok) { $script:passed++; Write-Host "PASS  $What" } else { $script:failed++; Write-Host "FAIL  $What" }
}

$probe = @'
using System;
namespace Thornswood {
 public static class MicSilenceProbe {
  static float[] Frame(float v) { var f = new float[960]; Array.Fill(f, v); return f; }
  // What each frame said, in order, as text: "." for 0, "+" and "-".
  public static string Run(float[][] frames) {
   var s = new MicSilence(); var o = new System.Text.StringBuilder();
   foreach (var f in frames) { int r = s.Held(f); o.Append(r == 0 ? '.' : (r > 0 ? '+' : '-')); }
   return o.ToString();
  }
  public static float[][] Repeat(float v, int n) { var a = new float[n][]; for (int i = 0; i < n; i++) a[i] = Frame(v); return a; }
  public static float[] One(float v, float spike) { var f = Frame(v); f[480] = spike; return f; }
  public static int Frames() { return MicSilence.Frames; }
  public static float Floor() { return MicSilence.Floor; }
 }
}
'@
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')
$null = Add-LauncherType -File @((Join-Path $app 'VoiceMeter.cs'), (Join-Path $app 'VoiceMix.cs'),
    (Join-Path $app 'VoiceHrtf.cs')) -Source $probe
$P = [Thornswood.MicSilenceProbe]
$n = $P::Frames()
$dead = [float]6.7e-11

function Say([float[][]]$Frames) { return $P::Run($Frames) }
function Join([object[]]$Parts) { $all = New-Object System.Collections.Generic.List[float[]]; foreach ($p in $Parts) { foreach ($f in $p) { $all.Add($f) } }; return ,$all.ToArray() }

Yes 'S five seconds of 20 ms frames, and a floor far under any real microphone' ($n -eq 250 -and $P::Floor() -le 1e-4 -and $P::Floor() -gt 1e-9)

$r = Say ($P::Repeat($dead, $n - 1))
Yes 'S the measured silence held one frame short of five seconds is not silent yet' ($r -notmatch '\+')
$r = Say ($P::Repeat($dead, $n + 100))
Yes 'S at five seconds it is silent, said once' ($r.IndexOf('+') -eq ($n - 1) -and ($r.ToCharArray() | Where-Object { $_ -eq '+' }).Count -eq 1)

$r = Say (Join @(($P::Repeat($dead, $n)), ($P::Repeat([float]0.2, 1)), ($P::Repeat($dead, 10))))
Yes 'S the first frame with sound ends it, said once' ($r.Substring($n) -ceq '-..........')

$r = Say (Join @(($P::Repeat($dead, $n - 10)), ($P::Repeat([float]0.2, 1)), ($P::Repeat($dead, $n - 1))))
Yes 'S sound before five seconds starts the count again' ($r -notmatch '\+')

$r = Say ($P::Repeat([float]1e-4, $n * 3))
Yes 'S a quiet but real microphone (1e-4) is never silent' ($r -notmatch '\+')

$spiky = New-Object 'float[][]' ($n * 2)
for ($i = 0; $i -lt $spiky.Length; $i++) { $spiky[$i] = $P::One($dead, [float]-2e-5) }
Yes 'S one sample over the floor in every frame, either sign, is sound' ((Say $spiky) -notmatch '\+')

$r = Say ($P::Repeat([float]::NaN, $n))
Yes 'S a frame of nothing but NaN carries no sound' ($r.EndsWith('+'))

$r = Say ($P::Repeat([float]0, $n))
Yes 'S exact zeros, as Windows gives for a buffer it marks silent, are silent' ($r.EndsWith('+'))

# ------------------------------------------------------------------ W --
$session = Get-Content -Raw -LiteralPath (Join-Path $app 'VoiceSession.cs')
$frame = [regex]::Match($session, '(?s)void Frame\(float\[\] pcm\)\s*\{(.*?)\n        \}')
$f = $frame.Groups[1].Value
$gate = $f.IndexOf('if (!micLive) return;')
$feed = $f.IndexOf('micSilence.Held(pcm)')
$peers = $f.IndexOf('if (to.Length == 0) return;')
Yes 'W only frames taken while push to talk is held are fed to it' ($frame.Success -and $gate -ge 0 -and $feed -gt $gate)
Yes 'W before the peers check, so somebody alone is told too' ($feed -ge 0 -and $peers -gt $feed)
Yes 'W a change goes to the launcher on the session''s own thread' ($f -match 'Post\(delegate \{ Host\("micsilent", silence > 0 \? "1" : "0"\); \}\)')

$voice = Get-Content -Raw -LiteralPath (Join-Path $app 'Voice.cs')
Yes 'W voice-status.txt carries the fifth word' ($voice -match '\(voiceMode \?\? "local"\) \+ " " \+\s*\(micSilent \? "1" : "0"\)')
Yes 'W the relay''s answer carries silent' ($voice -match '\\"silent\\":" \+ \(micSilent \? "true" : "false"\)')
$said = [regex]::Match($voice, '(?s)if \(kind == "micsilent"\)\s*\{(.*?)return;\s*\}')
Yes 'W the launcher says what to do: another microphone in its settings, then a restart' ($said.Success -and
    $said.Groups[1].Value -match 'sending no sound' -and $said.Groups[1].Value -match 'under Microphone in the launcher' -and
    $said.Groups[1].Value -match 'restart the launcher')

Write-Host ''
Write-Host "$passed passed, $failed failed"
exit $(if ($failed) { 1 } else { 0 })
