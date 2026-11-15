<#
  test-1223-live-pass-asked.ps1

      pwsh -NoProfile -File .\scripts\tests\test-1223-live-pass-asked.ps1

  #1223. The live join pass hold and the written role lists change only when
  the person deploying asks for it in that run, never because a build holds
  them.

  WHY. Deploy-Gamemode.ps1 -RequirePass, -Devs and -Playtesters wrote
  thornswoodRequirePass, thornswoodDevs and thornswoodPlaytesters into a
  machine's build, the build is read back and added to so they stayed there
  for good, and Deploy-Server.ps1 took them from the build as release keys
  ($ThornswoodGamemodeKeys). A build on a second machine given -RequirePass
  off a week before turned the live hold off on its next Deploy-Server, with
  nothing said but the key's name.

  It proves:
    1. ServerSettings.ps1 lists none of the three among the keys taken from
       a build, and names them as the keys a run asks for.
    2. A build holding an old thornswoodRequirePass, and old role lists, does
       not change the live server's: the carry on the box (the real
       $settingsCarryBlock, with the lines Deploy-Server puts in front of it)
       keeps live's and says so.
    3. -RequirePass on|off, -Devs and -Playtesters, as Deploy-Server turns
       them into the line the box runs, set them in the carry, and say so;
       asking for what live already has says that instead.
    4. Swap.ps1's read-back, handed the keys Deploy-Server hands it, lets an
       asked key move and stops on one nobody asked for.
    5. Deploy-Server.ps1 takes the switches, hands the asked keys to the
       carry, the check and the swap, and refuses them with -PutBack before
       anything goes to the box (run whole, with ssh and scp stand-ins).
    6. Deploy-Gamemode.ps1 takes none of the three, writes none of them, and
       takes an old one out of the build.

  Nothing leaves this machine. Scratch files go under the temp folder.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $Here)
$deploy = Join-Path (Join-Path $repo 'scripts') 'deploy'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$file, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $text, $utf8)
}

. (Join-Path $deploy 'ServerSettings.ps1')
. (Join-Path $deploy 'Swap.ps1')

# ---- 1. the lists ----------------------------------------------------------------
Write-Host 'ServerSettings.ps1'
$three = @('thornswoodRequirePass', 'thornswoodDevs', 'thornswoodPlaytesters')
Yes 'none of the three is a key Deploy-Server takes from a build' (@($three | Where-Object { $ThornswoodGamemodeKeys -contains $_ }).Count -eq 0)
Yes '  nor one a server install takes from a payload' (@($three | Where-Object { $ThornswoodInstallKeys -contains $_ }).Count -eq 0)
Yes '  and they are the keys a run asks for' ((@($ThornswoodAskedKeys | Sort-Object) -join ',') -eq (@($three | Sort-Object) -join ','))
Yes 'what Deploy-Gamemode writes for live on purpose is still taken from the build' (
    $ThornswoodGamemodeKeys -contains 'thornswoodServer' -and $ThornswoodGamemodeKeys -contains 'thornswoodVoicePort' -and
    $ThornswoodGamemodeKeys -contains 'npcEnabled' -and $ThornswoodGamemodeKeys -contains 'loadOrder')

$a = New-ThornswoodAsked
Yes 'nothing given asks for nothing' ($a.Count -eq 0)
$a = New-ThornswoodAsked 'off' @(5, 6) @(7)
Yes '-RequirePass off asks for a real false' ($a.Contains('thornswoodRequirePass') -and $a['thornswoodRequirePass'] -is [bool] -and -not $a['thornswoodRequirePass'])
Yes '-Devs and -Playtesters ask for those lists' ((@($a['thornswoodDevs']) -join ',') -eq '5,6' -and (@($a['thornswoodPlaytesters']) -join ',') -eq '7')
$a = New-ThornswoodAsked 'on'
Yes '-RequirePass on alone asks for a real true and nothing else' ($a.Count -eq 1 -and $a['thornswoodRequirePass'] -eq $true)

# ---- 2 and 3. the carry on the box ----------------------------------------------
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-1223-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null

# The live server as it runs, and a build an older Deploy-Gamemode -RequirePass
# off -Devs 99 left on some machine.
$live = [ordered]@{ port = 7777; name = 'Thornswood'; thornswoodServer = 'main'; loadOrder = @('C:/s/Skyrim.esm')
                    thornswoodRequirePass = $true; thornswoodDevs = @(10); thornswoodPlaytesters = @(20, 21) }
$oldBuild = [ordered]@{ port = 7777; name = 'Thornswood'; thornswoodServer = 'main'; loadOrder = @('C:/s/Skyrim.esm'); npcEnabled = $false
                        thornswoodRequirePass = $false; thornswoodDevs = @(99); thornswoodPlaytesters = @(98) }

# Deploy-Server's carry, as it reaches the box: ServerSettings.ps1's text,
# SwapVars' lines with the keys Deploy-Server hands over, the $Asked line, then
# the block. Run in a process of its own, with no strict mode, as the box runs it.
function Carry($running, $build, [string]$RequirePass = '', [long[]]$Devs = @(), [long[]]$Playtesters = @()) {
    $root = Join-Path $T ([Guid]::NewGuid().ToString('N').Substring(0, 8))
    $stage = '.stage-20261005-010000'
    Put (Join-Path $root 'server-settings.json') ($running | ConvertTo-Json -Depth 10)
    Put (Join-Path (Join-Path $root $stage) 'server-settings.json') ($build | ConvertTo-Json -Depth 10)
    $asked = New-ThornswoodAsked $RequirePass $Devs $Playtesters
    $keys = @($ThornswoodGamemodeKeys + @($asked.Keys))
    $text = [IO.File]::ReadAllText((Join-Path $deploy 'ServerSettings.ps1')) + "`r`n" +
            (SwapVars $root 'Thornswood Test' $stage '.prev-20261005-010000' 5 ([ordered]@{}) $keys) +
            (Get-ThornswoodAskedLine $asked) + $settingsCarryBlock
    $file = Join-Path $T ('carry-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.ps1')
    Put $file $text
    $shell = (Get-Process -Id $PID).Path
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $said = @(& $shell -NoProfile -NonInteractive -File $file 2>&1 | ForEach-Object { "$_".Trim() }) }
    finally { $ErrorActionPreference = $eap }
    $sp = Join-Path (Join-Path $root $stage) 'server-settings.json'
    $staged = $null
    if (Test-Path -LiteralPath $sp) { $staged = [IO.File]::ReadAllText($sp) | ConvertFrom-Json }
    return [pscustomobject]@{
        Said = $said; Text = ($said -join "`n"); Staged = $staged; Keys = $keys
        Carried = (@($said | Where-Object { $_ -match '^CARRIED [0-9a-f]{64}$' }).Count -eq 1)
        Refused = ($said -contains 'CARRY REFUSED')
    }
}
function Js($v) { return (ConvertTo-Json -InputObject $v -Compress -Depth 10) }

try {
    Write-Host ''
    Write-Host 'the carry Deploy-Server sends to the box'
    $r = Carry $live $oldBuild
    Yes 'a build holding an old thornswoodRequirePass false over live true: carried, and live keeps true' (
        $r.Carried -and $r.Staged.thornswoodRequirePass -eq $true)
    Yes '  and the build''s old role lists do not replace live''s' ((Js $r.Staged.thornswoodDevs) -eq '[10]' -and (Js $r.Staged.thornswoodPlaytesters) -eq '[20,21]')
    Yes '  while what Deploy-Gamemode writes for live still comes from the build' ($r.Staged.npcEnabled -eq $false)
    Yes '  and the run says the build''s were not taken' ($r.Text -match 'kept as the running server has them, not as the release had them: .*thornswoodRequirePass' -and
                                                      $r.Text -match 'kept as the running server has them, not as the release had them: .*thornswoodDevs')
    Yes '  and says nothing was asked for, so nothing is set' ($r.Text -notmatch 'as this run asked')
    Yes '  and prints no value of any of them' ($r.Text -notmatch '\b99\b' -and $r.Text -notmatch '\b98\b' -and $r.Text -notmatch 'False')

    $r = Carry $live $oldBuild 'off'
    Yes '-RequirePass off over live true: carried as a real false' ($r.Carried -and $r.Staged.thornswoodRequirePass -is [bool] -and -not $r.Staged.thornswoodRequirePass)
    Yes '  and says it set it as this run asked' ($r.Text -match 'set as this run asked: thornswoodRequirePass')
    Yes '  and the role lists, not asked for, stay live''s' ((Js $r.Staged.thornswoodDevs) -eq '[10]')
    Yes '  and the read-back is handed the asked key' ($r.Keys -contains 'thornswoodRequirePass' -and $r.Keys -notcontains 'thornswoodDevs')

    $r = Carry $live $oldBuild 'on'
    Yes '-RequirePass on over live true: carried, and said to be already as asked' ($r.Carried -and $r.Staged.thornswoodRequirePass -eq $true -and
                                                                                  $r.Text -match 'already as this run asked, so unchanged: thornswoodRequirePass')

    $r = Carry $live $oldBuild '' @(5, 6) @(7)
    Yes '-Devs 5,6 -Playtesters 7: both lists replaced on the box' ($r.Carried -and (Js $r.Staged.thornswoodDevs) -eq '[5,6]' -and (Js $r.Staged.thornswoodPlaytesters) -eq '[7]')
    Yes '  and live''s join pass, not asked for, stays true' ($r.Staged.thornswoodRequirePass -eq $true)
    $setLine = @($r.Said | Where-Object { $_ -like 'set as this run asked:*' })
    Yes '  and the run names both, and no profile number' ($setLine.Count -eq 1 -and $setLine[0] -eq 'set as this run asked: thornswoodDevs, thornswoodPlaytesters' -and
                                                       @($r.Said | Where-Object { $_ -match '\b[567]\b' -and $_ -notmatch '^every other setting' }).Count -eq 0)

    $noPass = [ordered]@{}
    foreach ($k in $live.Keys) { if ($k -ne 'thornswoodRequirePass') { $noPass[$k] = $live[$k] } }
    $r = Carry $noPass $oldBuild
    Yes 'live with no join pass switch, a build saying false, nothing asked: CARRY REFUSED' ($r.Refused -and -not $r.Carried)
    Yes '  saying to run Deploy-Server.ps1 -RequirePass on, or off' ($r.Text -match 'Deploy-Server\.ps1 -RequirePass on, or off')
    Yes '  and the stage is cleared' ($null -eq $r.Staged)
    $r = Carry $noPass $oldBuild 'on'
    Yes '  and with -RequirePass on it is carried as true' ($r.Carried -and $r.Staged.thornswoodRequirePass -eq $true)

    # ---- 4. the swap's read-back ------------------------------------------------
    Write-Host ''
    Write-Host 'Swap.ps1''s read-back, with the keys Deploy-Server hands it'
    $swap = [IO.File]::ReadAllText((Join-Path $deploy 'Swap.ps1'))
    $i = $swap.IndexOf('# READ BACK, BEFORE ANYTHING STARTS')
    $j = if ($i -ge 0) { $swap.IndexOf("`nif (`$moved) {", $i) } else { -1 }
    Yes 'Swap.ps1 still has the read-back before the start' ($i -ge 0 -and $j -gt $i)
    if (-not ($i -ge 0 -and $j -gt $i)) { Done }
    $readBack = $swap.Substring($i, $j - $i)
    function ReadBack($had, $placed, [string[]]$keys) {
        $rb = Join-Path $T ('rb-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
        $prev = Join-Path $rb 'prev'
        Put (Join-Path $prev 'server-settings.json') ($had | ConvertTo-Json -Depth 10)
        Put (Join-Path $rb 'server-settings.json') ($placed | ConvertTo-Json -Depth 10)
        $out = @(& ([scriptblock]::Create('param($moved, $placed, $ReleaseKeys, $prevDir, $Root) ' + $readBack + "`n" + '[pscustomobject]@{ Moved = $moved }')) $true @('server-settings.json') $keys $prev $rb)
        return [pscustomobject]@{ Moved = @($out | Where-Object { $_ -is [pscustomobject] })[-1].Moved; Said = (@($out | Where-Object { $_ -is [string] }) -join "`n") }
    }
    $off = [ordered]@{}
    foreach ($k in $live.Keys) { $off[$k] = $live[$k] }
    $off.thornswoodRequirePass = $false
    $rb = ReadBack $live $off @($ThornswoodGamemodeKeys + @((New-ThornswoodAsked 'off').Keys))
    Yes 'a join pass this run asked to move passes the read-back' ($rb.Moved -and $rb.Said -match 'every setting outside this release is the one the server had')
    $rb = ReadBack $live $off @($ThornswoodGamemodeKeys + @((New-ThornswoodAsked).Keys))
    Yes 'one that moved with nobody asking stops the swap, named' (-not $rb.Moved -and $rb.Said -match 'read back: thornswoodRequirePass would not be what the server had')
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 5. Deploy-Server.ps1 ------------------------------------------------------------
Write-Host ''
Write-Host 'Deploy-Server.ps1'
$dsPath = Join-Path $deploy 'Deploy-Server.ps1'
$ds = [IO.File]::ReadAllText($dsPath)
$errs = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($ds, [ref]$null, [ref]$errs)
Yes 'it parses' (@($errs).Count -eq 0)
function Param([string]$name) { return @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq $name })[0] }
$p = Param 'RequirePass'
$vs = @(if ($p) { $p.Attributes | Where-Object { $_.TypeName.Name -eq 'ValidateSet' } })
Yes 'it takes -RequirePass on, off, or nothing' ($vs.Count -eq 1 -and ((@($vs[0].PositionalArguments | ForEach-Object { $_.Value }) | Sort-Object) -join ',') -eq ',off,on')
foreach ($n in 'Devs', 'Playtesters') {
    $p = Param $n
    Yes ("it takes -$n as profile numbers") ($null -ne $p -and $p.StaticType -eq [long[]])
}
Yes 'it turns them into what the box is asked, with the shared function' ($ds -match '\$asked = New-ThornswoodAsked \$RequirePass \$Devs \$Playtesters')
# The -DropPlugins line (#2320) comes between the $Asked line and the block.
Yes 'the carry gets the $Asked line, after SwapVars and before the block' (
    $ds -match '\(SwapVars \$Root \$Task \$stageName \$prevName \$Wait \$hashes \$liveKeys\) \+ \(Get-ThornswoodAskedLine \$asked\) \+\s+\(Get-ThornswoodDropLine \$DropPlugins\) \+ \$settingsCarryBlock')
Yes 'the keys handed over are the build''s plus only what was asked' ($ds -match '\$liveKeys = @\(\$ThornswoodGamemodeKeys \+ @\(\$asked\.Keys\)\)')
# Five: the carry, -GamemodeOnly's keep and -FromStore's in its place (#1089,
# #459, where $liveKeys is none), the check and the swap.
Yes 'the carry, the check and the swap are all handed those keys' (
    ([regex]::Matches($ds, 'SwapVars \$Root \$Task \$stageName \$prevName \$Wait \$hashes \$liveKeys\)')).Count -eq 5 -and
    $ds -notmatch 'SwapVars \$Root \$Task \$stageName \$prevName \$Wait \$hashes \$ThornswoodGamemodeKeys\)')

# Run whole: -PutBack with a switch is refused before anything goes to the box.
$W = Join-Path ([IO.Path]::GetTempPath()) ('ts-1223-ds-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$bin = Join-Path $W 'bin'
$calls = Join-Path $W 'calls.log'
foreach ($n in 'ssh', 'scp') {
    Put (Join-Path $bin ($n + '.ps1')) ("[IO.File]::AppendAllText(`$env:TS_1223_CALLS, ('$n ' + (`$args -join ' ') + [Environment]::NewLine))`r`nexit 1`r`n")
}
$oldPath = $env:PATH
$env:PATH = $bin + [IO.Path]::PathSeparator + $oldPath
$env:TS_1223_CALLS = $calls
try {
    foreach ($case in @(@('-RequirePass', 'off'), @('-Devs', '5'), @('-Playtesters', '7'))) {
        if (Test-Path -LiteralPath $calls) { Remove-Item -LiteralPath $calls -Force }
        $shell = (Get-Process -Id $PID).Path
        $eap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $o = (& $shell -NoProfile -NonInteractive -File $dsPath -Vps 127.0.0.1 -User test -PutBack -Now $case[0] $case[1] 2>&1 | Out-String)
            $code = $LASTEXITCODE
        } finally { $ErrorActionPreference = $eap }
        $failed = $script:fail
        Yes ("-PutBack $($case[0]) $($case[1]) is refused (exit $code)") ($code -ne 0 -and $o -match '-PutBack sets no setting: it puts the previous files back with the live server''s own settings\.')
        Yes '  before anything went to the box: no ssh, no scp' (-not (Test-Path -LiteralPath $calls))
        if ($script:fail -gt $failed) { Write-Host (($o -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 8) -join "`n") }
    }
} finally {
    $env:PATH = $oldPath
    Remove-Item Env:\TS_1223_CALLS -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $W -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 6. Deploy-Gamemode.ps1 -----------------------------------------------------------
Write-Host ''
Write-Host 'Deploy-Gamemode.ps1'
$gmPath = Join-Path $deploy 'Deploy-Gamemode.ps1'
$gm = [IO.File]::ReadAllText($gmPath)
$gast = [Management.Automation.Language.Parser]::ParseInput($gm, [ref]$null, [ref]$errs)
Yes 'it parses' (@($errs).Count -eq 0)
$gparams = @($gast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
Yes 'it takes no -RequirePass, -Devs or -Playtesters' (@('RequirePass', 'Devs', 'Playtesters' | Where-Object { $gparams -contains $_ }).Count -eq 0)
Yes 'it writes none of the three into the build' ($gm -notmatch 'NotePropertyName thornswood(RequirePass|Devs|Playtesters)')
# The lines that take an old one out of the build, run on a build that has all three.
$k = $gm.IndexOf('$fromBuild = @(')
$e = if ($k -ge 0) { $gm.IndexOf("Write-Host '  join pass and role lists", $k) } else { -1 }
Yes 'the lines that take them out of the build are there' ($k -ge 0 -and $e -gt $k)
if ($k -ge 0 -and $e -gt $k) {
    $s = [pscustomobject][ordered]@{ port = 7777; thornswoodRequirePass = $false; thornswoodDevs = @(99); thornswoodPlaytesters = @(98); thornswoodServer = 'main' }
    $said = @(& { param($s) . ([scriptblock]::Create($gm.Substring($k, $e - $k))) } $s 6>&1 | ForEach-Object { "$_" })
    $left = @($s.PSObject.Properties | ForEach-Object { $_.Name })
    Yes 'a build an older run gave all three loses them' (@($three | Where-Object { $left -contains $_ }).Count -eq 0 -and $left -contains 'port' -and $left -contains 'thornswoodServer')
    Yes '  and says which it took out, and no value' (($said -join "`n") -match 'taken out of this build, because the live server keeps its own: thornswoodRequirePass, thornswoodDevs, thornswoodPlaytesters' -and
                                                    ($said -join "`n") -notmatch '\b99\b')
}

Done
