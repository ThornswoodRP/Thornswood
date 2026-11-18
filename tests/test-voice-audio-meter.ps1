# Audio levels, never audio: exercise the real mixer without Windows devices.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$file = Join-Path $root 'launcher/app/VoiceMeter.cs'
if (-not (Test-Path -LiteralPath $file)) { throw 'Voice audio boundaries have no level diagnostics' }
$probe = @'
using System;
namespace Thornswood {
 public static class AudioMeterProbe {
  public static string[] Run() {
   var m = new VoiceMix(); m.Add(7, false); m.SetPosition(7,0,0,0);
   var pcm = new float[3840]; Array.Fill(pcm,0.25f);
   m.Meter.Capture(new float[]{0.5f,float.NaN},false);
   m.Meter.Encoded(80); m.Meter.Protected(); m.Meter.SendCall();
   m.Push(7,pcm); var stereo=new float[7680]; m.Render(stereo,3840);
   string first=m.AudioSummary(1000);
   m.SetAudible(7,false);m.SetLevel(7,0,"muted-or-hushed");m.Push(7,pcm);
   string muted=m.AudioSummary(2000);
   string empty=m.AudioSummary(3000);
   for(int i=10;i<30;i++)m.Add(i,false);
   string bounded=m.AudioSummary(4000);
   return new[]{first,muted,empty,bounded};
  }
 }
}
'@
Add-Type -TypeDefinition ((Get-Content $file -Raw) + "`n" +
    (Get-Content (Join-Path $root 'launcher/app/VoiceMix.cs') -Raw) + "`n" +
    (Get-Content (Join-Path $root 'launcher/app/VoiceHrtf.cs') -Raw) + "`n" + $probe)
$rows = [Thornswood.AudioMeterProbe]::Run() | ForEach-Object { $_ | ConvertFrom-Json }
function Check($name, $ok) { if (-not $ok) { throw $name }; Write-Host "PASS $name" }
Check 'capture is measured before the live gate and nonfinite input is counted' (
    $rows[0].capture.peak -eq 0.5 -and $rows[0].capture.nonfinite -eq 1 -and $rows[0].captureFrames -eq 1 -and $rows[0].captureLiveFrames -eq 0)
Check 'encoded, protected and ICE send calls are separate counters' (
    $rows[0].encodedPackets -eq 1 -and $rows[0].protectedPackets -eq 1 -and $rows[0].sendCalls -eq 1)
Check 'decoded, accepted and rendered PCM retain absolute amplitude' (
    $rows[0].decoded.peak -eq 0.25 -and $rows[0].accepted.peak -eq 0.25 -and $rows[0].rendered.peak -ge 0.2)
Check 'a muted peer is measured before its PCM is dropped' (
    $rows[1].decoded.peak -eq 0.25 -and $rows[1].accepted.samples -eq 0 -and
    $rows[1].sources[0].reason -eq 'muted-or-hushed' -and -not $rows[1].sources[0].audible)
Check 'interval counters reset while mute and gain state remain' (
    $rows[2].decoded.samples -eq 0 -and $rows[2].rendered.samples -eq 0 -and
    $rows[2].sources[0].target -eq 0 -and -not $rows[2].sources[0].audible -and $rows[2].intervalMs -eq 3000)
Check 'the summary bounds source rows and counts omitted peers' (
    $rows[3].sources.Count -eq 8 -and $rows[3].peers -eq 21 -and $rows[3].omitted -eq 13)
