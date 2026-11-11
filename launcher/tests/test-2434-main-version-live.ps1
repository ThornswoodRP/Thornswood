<#
  test-2434-main-version-live.ps1

      pwsh -NoProfile -File .\launcher\tests\test-2434-main-version-live.ps1

  The dev News tab names this build by its own version and what main is on
  from main's newest Release, read when the tab is shown (#2434, #5385).

  WHY THIS EXISTS. Patrick, 12 Oct: "dev says main is on 1.2.3 even tho it's
  on 1.2.4 is there not a way to make this dynamic". The tab read mainVersion
  out of the dev feed as the launcher last checked it, and a launcher left
  open never checks again by itself, so it was made to ask main's feed. Since
  #4825 the feed's launcherVersion and mainVersion stay at the last launcher
  from before Velopack, so on 9 Nov 2026 the tab still named 1.2.16 for both
  while dev and main ran 1.3.0 (#5385). What this proves:
    - Updater.MainVersionOf takes the highest full package of main's feed as
      ChannelSource cut it, never a delta, and throws with a reason when
      there is none
    - MainLauncherVersion reads the newest Release with releases.main.json
      through ChannelSource, the update check's own source, and the update
      check still reads eleven
    - the header reads "This is the dev build, on <Updater.Version>. Main is
      on <main>." once main has answered, only this build while main has not
      answered or could not be read, and nothing of the feed's frozen numbers;
      a failed read says why once in launcher.log
    - BuildNews asks only while the News page is the one shown, and keeps the
      header line so an answer lands without rebuilding the list

  HOW. Builds launcher\app\Thornswood.csproj as it is, with the .NET 10 SDK
  the launcher builds with (Add-LauncherAssembly, tests\Launcher-Csc.ps1,
  #4823), loads it into this PowerShell, which runs on .NET 10 as the
  launcher does, and calls the methods by reflection. So it runs on any
  machine with the SDK. Paths points at a temp folder. Nothing under
  C:\Thornswood is read or written, and nothing touches the network.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's SDK (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Here = Split-Path -Parent (Split-Path -Parent $Here)
$Src = Join-Path (Join-Path $Here 'launcher') 'app'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tsmainver-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Force -Path $tmp

function Run {
    Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
    if (-not (Test-Path -LiteralPath $LauncherDotnet)) { return }
    $asm = $null
    try { $asm = Add-LauncherAssembly } catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes 'the launcher builds from its project, the way the build makes it' ($null -ne $asm)
    if ($null -eq $asm) { return }

    $U = $asm.GetType('Thornswood.Updater')
    $S = $asm.GetType('Thornswood.Shell')
    $P = $asm.GetType('Thornswood.Paths')
    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    $mOf = $U.GetMethod('MainVersionOf', $flags)
    $mLive = $U.GetMethod('MainLauncherVersion', $flags)
    $mHead = $S.GetMethod('DevHeadText', $flags)
    $mRead = $S.GetMethod('MainVersionRead', $flags)
    $fLive = $S.GetField('mainLive', $flags)
    $fReading = $S.GetField('mainReading', $flags)
    Yes 'Updater.MainLauncherVersion and MainVersionOf, and Shell.DevHeadText and MainVersionRead, are in the build' (
        $null -ne $mOf -and $null -ne $mLive -and $null -ne $mHead -and $null -ne $mRead -and $null -ne $fLive)
    if ($null -eq $mOf -or $null -eq $mHead) { return }

    $profile = Join-Path $tmp 'Profile'
    $null = New-Item -ItemType Directory -Force -Path $profile
    $logFile = Join-Path $profile 'launcher.log'
    $P.GetField('ProfileDir').SetValue($null, $profile)
    $P.GetField('LogFile').SetValue($null, $logFile)

    # ---- 1. main's number out of main's feed ------------------------------------------
    # Velopack from the build's own context, the copy the launcher code in
    # $asm was bound to (Launcher-Csc.ps1, BuildContext), so its types are
    # the ones the launcher's methods take.
    $velo = [Runtime.Loader.AssemblyLoadContext]::GetLoadContext($asm).LoadFromAssemblyName([Reflection.AssemblyName]'Velopack')
    $tAsset = $velo.GetType('Velopack.VelopackAsset')
    $tKind = $velo.GetType('Velopack.VelopackAssetType')
    $tSem = $velo.GetType('Velopack.SemanticVersion')
    function Asset([string]$v, [string]$kind) {
        $a = [Activator]::CreateInstance($tAsset)
        $a.Version = $tSem.GetMethod('Parse', [type[]]@([string])).Invoke($null, @($v))
        $a.Type = [Enum]::Parse($tKind, $kind)
        return $a
    }
    function Feed([object[]]$list) {
        $arr = [Array]::CreateInstance($tAsset, $list.Count)
        for ($i = 0; $i -lt $list.Count; $i++) { $arr.SetValue($list[$i], $i) }
        return ,$arr
    }
    function Of($feed) {
        try { return @{ v = [string]$mOf.Invoke($null, @(,$feed)); why = '' } }
        catch { return @{ v = $null; why = [string]$_.Exception.InnerException.Message } }
    }
    $a = Of (Feed @((Asset '1.3.1' 'Full'), (Asset '1.3.2' 'Full'), (Asset '1.3.2' 'Delta')))
    Yes ('the newest Release''s own full package is main''s number, not its delta base: ' + $a.v + $a.why) ($a.v -eq '1.3.2')
    $a = Of (Feed @((Asset '1.3.3' 'Delta'), (Asset '1.3.2' 'Full')))
    Yes ('a delta numbered higher is not a launcher main is on: ' + $a.v + $a.why) ($a.v -eq '1.3.2')
    $a = Of (Feed @((Asset '1.3.2' 'Delta')))
    Yes ('a feed with no full package throws with a reason: ' + $a.why) ($null -eq $a.v -and $a.why -match 'carries no launcher package')
    $a = Of (Feed @())
    Yes '  and so does an empty one' ($null -eq $a.v -and $a.why -match 'carries no launcher package')
    $a = Of $null
    Yes '  and no feed at all' ($null -eq $a.v -and $a.why -match 'carries no launcher package')

    # ---- 2. the header ---------------------------------------------------------------
    $mine = [string]$U.GetField('Version', $flags).GetValue($null)
    $on = if ($mine -eq '0.0.0') { 'This is the dev build.' } else { "This is the dev build, on $mine." }
    $fLive.SetValue($null, '')
    $h = [string]$mHead.Invoke($null, @())
    Yes ('before main answers, the header names only this build, by its own version: ' + $h) ($h -eq $on)
    [void]$mRead.Invoke($null, @('1.3.0', $null))
    $h = [string]$mHead.Invoke($null, @())
    Yes ('main answered 1.3.0, and that is what the header says: ' + $h) ($h -eq "$on Main is on 1.3.0." -and -not [bool]$fReading.GetValue($null))
    $logBefore = if (Test-Path -LiteralPath $logFile) { [IO.File]::ReadAllText($logFile) } else { '' }
    Yes '  and a read that worked writes nothing in launcher.log' ($logBefore -notmatch 'News tab')
    [void]$mRead.Invoke($null, @($null, 'could not reach GitHub'))
    $h = [string]$mHead.Invoke($null, @())
    $log = if (Test-Path -LiteralPath $logFile) { [IO.File]::ReadAllText($logFile) } else { '' }
    Yes ('a read that failed goes back to naming only this build: ' + $h) ($h -eq $on)
    Yes '  and says why in launcher.log, naming main''s Release' ($log -match 'The News tab could not read what main is on from main''s newest Release on GitHub \(releases\.main\.json\) \(could not reach GitHub\)')
    [void]$mRead.Invoke($null, @($null, 'a second failure'))
    $log = [IO.File]::ReadAllText($logFile)
    Yes '  once a session, not at every opening of the tab' (([regex]::Matches($log, 'The News tab could not read')).Count -eq 1)

    # ---- 3. where it is asked, and the fence -------------------------------------------
    $mv = Get-Content -LiteralPath (Join-Path $Src 'MainVersion.cs') -Raw
    Yes 'MainLauncherVersion reads the newest Release with main''s feed through ChannelSource, then MainVersionOf' ($mv -match '(?s)public static string MainLauncherVersion\(Config cfg\).*?new ChannelSource\("main", 1\);.*?GetReleaseFeed\(.*?"main"\).*?return MainVersionOf\(')
    $vu = Get-Content -LiteralPath (Join-Path $Src 'VeloUpdate.cs') -Raw
    Yes '  and the update check still reads the newest and the ten before it' ($vu -match 'new ChannelSource\(channel, 11\)' -and $vu -match '\.Take\(take\)')
    $sn = Get-Content -LiteralPath (Join-Path $Src 'ShellNews.cs') -Raw
    Yes 'the header names nothing of the feed''s frozen numbers' ($sn -match '(?s)static string DevHeadText\(\)\s*\{.*?Updater\.Version.*?\n        \}' -and $sn -notmatch 'pendingDoc\.mainVersion' -and $sn -notmatch 'pendingDoc\.launcherVersion')
    Yes 'BuildNews asks main only on a dev build, and only while the News page is the one shown' ($sn -match '(?s)if \(cfg\.IsDev\)\s*\{.*?if \(pages != null && pages\[PageNews\]\.IsVisible\) ReadMainVersion\(\);')
    Yes 'BuildNews keeps the header line, so an answer is put in without rebuilding the list' ($sn -match 'newsHead = ht;' -and $sn -match '(?s)static void MainVersionRead\(string got, string why\).*?if \(newsHead != null\) newsHead\.Text = DevHeadText\(\);')
    Yes 'the read is on a pool thread and the answer comes back on the window''s' ($sn -match '(?s)static void ReadMainVersion\(\).*?ThreadPool\.QueueUserWorkItem.*?Updater\.MainLauncherVersion\(cfg\).*?Dispatcher\.UIThread\.Post\(delegate \{ MainVersionRead\(got, why\); \}\);')
    Yes 'one read at a time' ($sn -match '(?s)static void ReadMainVersion\(\)\s*\{\s*if \(mainReading\) return;\s*mainReading = true;')
    Yes 'the DEV marks are the notes'' own (ReleaseNews.cs marks them from main''s Deployment)' ($sn -match 'if \(items\[i\]\.IsDev\) ahead\+\+;')
}

try {
    try { Run }
    catch { Yes ('the harness ran to the end, and stopped on: ' + $_.Exception.Message) $false }
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
