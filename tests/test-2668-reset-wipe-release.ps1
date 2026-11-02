<#
  test-2668-reset-wipe-release.ps1

      pwsh -NoProfile -File .\tests\test-2668-reset-wipe-release.ps1

  Issue #2668, after #2652: scripts\ops\Reset-Character.ps1 and
  scripts\ops\Wipe-Saves.ps1 threw characters away and wrote no release
  list, so a guild trader's supply waits and a trade waiting on a reset or
  wiped character stayed for good, keyed to a form id the world hands to the
  next character made. Both now write the list Delete-Person.ps1 writes,
  private\deleted-characters.json, through one writer
  (scripts\ops\Release-List.ps1), naming characters by form id and never a
  profile, since the profile keeps its id and what it holds.

  This lifts the steps each script sends to the server out of the real
  script, filled in as the script fills them, and runs them under PowerShell
  7, which is what runs them there since #5356, against stand-in server
  folders in a scratch folder:

    S  both scripts carry the one writer, and the wipe marks done exactly
       the release parts (game\gamemode.js PARTS) whose registers it moves,
       which is every part but the merchants' and the saves (server-log.js's,
       and mod-settings.json stays)
    R  a reset: the list names the characters it threw away by form id and
       no profile, merges into a list waiting there with done cleared, goes
       in the server's privDir, and is not written when nobody was thrown
       away; a list that names no profile has 'saves' done, the part that
       acts only on profiles and that no server on this machine runs; a list
       there that is not one, or a server-settings.json that will not parse,
       stops the reset with nothing moved; a change form that will not parse
       is named
    W  a wipe: the list names every character in the world it set aside,
       carries the ids of the list it set aside (which stays as it was), is
       marked done for every part but the merchants' and, while it carries a
       deleted profile, the saves; nobody to name writes nothing; a list set
       aside that is not one is said and not carried; a server whose move
       did not finish gets no list
    B  the reset's stop and start (#2871): the box opens the server on the
       root's own port before it is stopped, waits for it to exit, runs the
       reset, starts the task and waits for both ports within the shared
       ceiling; this machine tries once from outside; nothing sleeps a fixed
       time; settings that will not read, or name no port, stop it with
       nothing stopped
    G  each list the scripts wrote is read by the gamemode's own release
       block: a reset's waits on every part (with no profile, all but the
       saves), a wipe's only on the merchants' (and the saves while it
       carries a deleted profile)

  Nothing leaves this machine. The scratch folder goes at the end.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$ResetPs = Join-Path $Repo 'scripts\ops\Reset-Character.ps1'
$WipePs = Join-Path $Repo 'scripts\ops\Wipe-Saves.ps1'
$ListPs = Join-Path $Repo 'scripts\ops\Release-List.ps1'
$Gm = Join-Path $Repo 'game\gamemode.js'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function Parse([string]$f) {
    $t = $null; $e = $null
    $a = [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$t, [ref]$e)
    return @{ ast = $a; errors = $e.Count; text = [IO.File]::ReadAllText($f) }
}

# ---- S: the one writer, and what the wipe marks done ---------------------------
$L = Parse $ListPs; $R = Parse $ResetPs; $W = Parse $WipePs
Yes 'S1 Release-List.ps1, Reset-Character.ps1 and Wipe-Saves.ps1 parse' ($L.errors -eq 0 -and $R.errors -eq 0 -and $W.errors -eq 0)
. $ListPs
$e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($ThornswoodReleaseList, [ref]$null, [ref]$e)
Yes 'S2 the writer it sends parses on its own' ($ThornswoodReleaseList -and $e.Count -eq 0)
$dot = ". (Join-Path `$Here 'Release-List.ps1')"
Yes 'S3 both scripts load the one writer, and neither writes a list of its own' (
    $R.text.Contains($dot) -and $W.text.Contains($dot) -and
    $R.text -notmatch 'deleted-characters\.json''' -and $W.text -notmatch "Join-Path [^\r\n]*'deleted-characters\.json'")
$parts = @()
$gmText = [IO.File]::ReadAllText($Gm)
$m = [regex]::Match($gmText, "var PARTS = \[([^\]]*)\];")
if ($m.Success) { $parts = @([regex]::Matches($m.Groups[1].Value, "'([a-z]+)'") | ForEach-Object { $_.Groups[1].Value }) }
Yes ('S4 the gamemode''s release parts are read (' + ($parts -join ', ') + ')') ($parts.Count -ge 6 -and ($parts -contains 'merchants'))
$assign = @($W.ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($n.Left)" -in '$Moves', '$WipeDone' }, $true))
$Moves = @(); $WipeDone = @()
foreach ($a in $assign) { Set-Variable -Name ("$($a.Left)".TrimStart('$')) -Value @(& ([scriptblock]::Create($a.Right.Extent.Text))) }
# Not 'merchants', the ledger a wipe keeps, nor 'saves' (server-log.js's),
# since mod-settings.json stays too.
$expect = @($parts | Where-Object { $_ -ne 'merchants' -and $_ -ne 'saves' })
Yes ('S5 the wipe marks done every part but the merchants'' and the saves (' + ($WipeDone -join ', ') + ')') (
    $WipeDone.Count -eq $expect.Count -and @($expect | Where-Object { $WipeDone -notcontains $_ }).Count -eq 0)
$registers = @{ farms = @('farm-claims.json'); property = @('property.json', 'law.json', 'beds.json'); embassy = @('embassy.json')
                dungeon = @('dungeon-rewards-ledger.json'); cargo = @('trade-cargo.json'); stalls = @('market-stalls.json'); carts = @('trade-carts.json')
                books = @('books.json', 'last-left.json') }
$all = $true
foreach ($p in $WipeDone) {
    if (-not $registers.ContainsKey($p)) { $all = $false; Write-Host "      no register known for $p"; continue }
    foreach ($f in $registers[$p]) { if ($Moves -notcontains "private\$f") { $all = $false; Write-Host "      $p keeps private\$f, which the wipe does not move" } }
}
Yes 'S6 each of those parts'' registers is one the wipe moves aside' $all
Yes 'S7 and the merchant ledger, the one it waits on, is one the wipe keeps' ($Moves -notcontains 'private\merchant-ledger.json')

function Body([string]$text, [string]$after) {
    $at = $text.IndexOf($after)
    if ($at -lt 0) { return $null }
    $open = $text.IndexOf('Remote @"', $at)
    $start = $text.IndexOf("`n", $open) + 1
    $end = $text.IndexOf("`n" + '"@', $start)
    if ($open -lt 0 -or $end -lt 0) { return $null }
    return $text.Substring($start, $end - $start)
}
$move = Body $W.text "Head 'Moving the old storage aside'"
Yes 'S8 the wipe''s move sends the writer and asks it for the list once' (
    $move -and $move.Contains('$ThornswoodReleaseList') -and ([regex]::Matches($move, 'Write-ThornswoodReleaseList ')).Count -eq 1 -and
    $move.Contains('-Done @($wipeDoneLit)'))
$bodyAssign = @($R.ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($n.Left)" -eq '$body' }, $true))
$resetBody = $null
if ($bodyAssign.Count -eq 1) { $resetBody = & ([scriptblock]::Create($bodyAssign[0].Right.Extent.Text)) }
Yes 'S9 the reset''s body carries the writer and asks it for a list with no profile and nothing carried' (
    $resetBody -and $resetBody.StartsWith('param([string]$Root)') -and $resetBody.Contains('function Write-ThornswoodReleaseList') -and
    $resetBody.Contains('$found = Get-ThornswoodCharacterIds $moved') -and
    ([regex]::Matches($resetBody, 'Write-ThornswoodReleaseList -Root \$Root -Actors \$found\.ids\)\)')).Count -eq 1)

# ---- B: the reset's stop and start (#2871) -----------------------------------
# The box's script, built as the reset builds it.
function RightOf([string]$name) {
    $n = '$' + $name
    $a = @($R.ast.FindAll({ param($x) $x -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($x.Left)" -eq $n }.GetNewClosure(), $true))
    if ($a.Count -ne 1) { return $null }
    return $a[0].Right.Extent.Text
}
$resetRun = $null
$rights = @((RightOf 'stopAndMove'), (RightOf 'readyWait'), (RightOf 'run'))
if (@($rights | Where-Object { $_ }).Count -eq 3) {
    $resetRun = & {
        $Here = Join-Path $Repo 'scripts\ops'
        . (Join-Path $Repo 'scripts\vps\ServerHold.ps1')   # its hold goes in front (#5155)
        $stopAndMove = & ([scriptblock]::Create($rights[0]))
        $readyWait = & ([scriptblock]::Create($rights[1]))
        & ([scriptblock]::Create($rights[2]))
    }
}
$e = $null
if ($resetRun) { [void][System.Management.Automation.Language.Parser]::ParseInput($resetRun, [ref]$null, [ref]$e) }
Yes 'B1 the box''s stop and start script parses, and is plain ASCII' (
    $resetRun -and $e.Count -eq 0 -and -not ($resetRun.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
function At([string]$s) { if (-not $resetRun) { return -1 }; return $resetRun.IndexOf($s) }
$order = @((At '$held = @(Get-ThornswoodProcessHeld $pids)'), (At 'Stop-ScheduledTask -TaskName $Task'), (At '$still = @(Stop-ThornswoodProcessHeld $held)'),
           (At '-File C:\thornswood-reset.ps1 -Root $Root'), (At 'Start-ScheduledTask -TaskName $Task'), (At '$Wait = Get-ThornswoodServerReadyWait'))
Yes ('B2 it opens the server on the root''s own port, then stops the task, waits for it to exit, resets, starts it and waits within the shared ceiling (' + ($order -join ',') + ')') (
    -not ($order | Where-Object { $_ -lt 0 }) -and (@($order) -join ',') -eq (@($order | Sort-Object) -join ',') -and
    $resetRun.Contains('$_.LocalPort -eq $port') -and $resetRun.Contains("BeginConnect('127.0.0.1', `$resPort"))
Yes 'B3 a server still there, or one that could not be opened, moves nothing' (
    $resetRun -and $resetRun.Contains('STOP. The server has not exited, so nothing was thrown away') -and
    $resetRun.Contains('STOP. The server could not be opened to wait for it. Nothing was stopped or thrown away.'))
Yes 'B3a it holds the server before it stops it, so the watchdog leaves it stopped (#5155)' (
    (At 'Set-ThornswoodHold -Target $Task') -ge 0 -and (At 'Set-ThornswoodHold -Target $Task') -lt (At 'Stop-ScheduledTask -TaskName $Task') -and
    $resetRun.LastIndexOf('Clear-ThornswoodHold -Target $Task') -gt (At 'Start-ScheduledTask -TaskName $Task'))
Yes 'B4 nothing in the reset sleeps a fixed time or knocks on a fixed port from here' (
    $R.text -notmatch 'Start-Sleep -Seconds' -and $R.text -notmatch 'BeginConnect\(\$VpsHost' -and $R.text -notmatch 'Stop-Process')
Yes 'B5 -UseLocal opens and waits on what it stops' (
    $R.text.Contains('$held = @(Get-ThornswoodProcessHeld @($node | ForEach-Object { $_.Id }))') -and
    $R.text.Contains('$still = @(Stop-ThornswoodProcessHeld $held)'))
Yes 'B6 this machine tries the resources port the box named once from outside, beside a witness' (
    ([regex]::Matches($R.text, 'Test-ThornswoodFromOutside ')).Count -eq 1 -and
    $R.text.Contains('$outside = Test-ThornswoodFromOutside $VpsHost $resPort $witness'))

. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell

$T = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-2668-' + [Guid]::NewGuid().ToString('N'))
$A1 = 4278192641; $A2 = 4278192642; $A9 = 4278192649     # ff000a01, ff000a02, ff000a09
function Put([string]$path, [string]$body) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $body)
}
function Lit($a) { return (($a | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ',') }
function RunBox([string]$body, [string[]]$arg) {
    $f = Join-Path $T ('step-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText($f, $body, (New-Object Text.UTF8Encoding $true))
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $out = @(& $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $f @arg 2>&1 | ForEach-Object { "$_" })
        return @{ out = $out; code = $LASTEXITCODE }
    }
    finally { $ErrorActionPreference = $eap; Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
}
function ListOf([string]$file) {
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    return ([IO.File]::ReadAllText($file) | ConvertFrom-Json)
}
function Ids($a) { return ((@($a) | ForEach-Object { [long]$_ }) -join ',') }
function Server([string]$name, [string]$settings) {
    $root = Join-Path $T $name
    Put (Join-Path $root 'server-settings.json') $settings
    Put (Join-Path $root 'world\changeForms\0.json') ('{"formDesc":"a01","profileId":5001,"appearanceDump":{"name":"A"}}')
    Put (Join-Path $root 'world\changeForms\1.json') ('{"formDesc":"a02","profileId":5002}')
    # Not a character made in the world (a plugin in its desc), and a world object: neither is named.
    Put (Join-Path $root 'world\changeForms\2.json') ('{"formDesc":"a01:Skyrim.esm","profileId":5003}')
    Put (Join-Path $root 'world\changeForms\13164_JKs Whiterun.esp.json') ('{"formDesc":"13164:JKs Whiterun.esp"}')
    return $root
}
$lists = @{}

try {
    # ---- R: a reset ----------------------------------------------------------------
    $r1 = Server 'reset-merge' '{"privDir":"private"}'
    Put (Join-Path $r1 'private\deleted-characters.json') ('{"profiles":[6001],"actors":[' + $A9 + '],"done":{"farms":1,"property":2}}')
    $x = RunBox $resetBody @('-Root', $r1)
    $l = ListOf (Join-Path $r1 'private\deleted-characters.json')
    Yes ('R1 a reset throws the characters away and says it wrote the list (' + ($x.out -join ' / ') + ')') (
        $x.code -eq 0 -and @($x.out | Where-Object { $_ -like 'release list: *3 character(s)*' }).Count -eq 1 -and
        @(Get-ChildItem -LiteralPath (Join-Path $r1 'world\changeForms') -Filter '*.json' -File).Count -eq 1)
    Yes ('R2 the list names the characters it threw away by form id, merged into the one waiting (' + (Ids $l.actors) + ')') ($l -and (Ids $l.actors) -eq "$A1,$A2,$A9")
    Yes ('R3 it adds no profile: only the one already waiting is there (' + (Ids $l.profiles) + ')') ((Ids $l.profiles) -eq '6001')
    Yes 'R4 and done is cleared, so every part runs for the new ids' ($null -eq $l.done)
    Yes 'R5 the world object and a character with a plugin in its desc are not named' (
        (Test-Path -LiteralPath (Join-Path $r1 'world\changeForms\13164_JKs Whiterun.esp.json')) -and -not ((Ids $l.actors) -match '^2561$'))
    $lists.reset = [IO.File]::ReadAllText((Join-Path $r1 'private\deleted-characters.json'))

    $r2 = Server 'reset-fresh' '{"privDir":"secret"}'
    $x = RunBox $resetBody @('-Root', $r2)
    $file = Join-Path $r2 'secret\deleted-characters.json'
    $l = ListOf $file
    Yes 'R6 with no list there, the list goes in the server''s own privDir' ($x.code -eq 0 -and $l -and -not (Test-Path -LiteralPath (Join-Path $r2 'private\deleted-characters.json')))
    Yes ('R7 and is exactly the characters, with no profile, and only saves done, which acts on profiles alone (' + [IO.File]::ReadAllText($file) + ')') (
        [IO.File]::ReadAllText($file) -match ('^\{"profiles":\[\],"actors":\[' + $A1 + ',' + $A2 + '\],"done":\{"saves":[1-9][0-9]*\}\}$'))
    $lists.resetFresh = [IO.File]::ReadAllText($file)

    $r3 = Server 'reset-bad' '{}'
    Put (Join-Path $r3 'private\deleted-characters.json') '{"profiles":"nobody"}'
    $x = RunBox $resetBody @('-Root', $r3)
    Yes ('R8 a list there that is not one stops the reset (' + ($x.out -join ' / ') + ')') ($x.code -eq 1 -and @($x.out | Where-Object { $_ -like 'STOP. *not a list of deleted characters, so nothing was thrown away*' }).Count -eq 1)
    Yes 'R9 with nothing moved and the list left as it was' (
        @(Get-ChildItem -LiteralPath (Join-Path $r3 'world\changeForms') -Filter '*.json' -File).Count -eq 4 -and
        [IO.File]::ReadAllText((Join-Path $r3 'private\deleted-characters.json')) -eq '{"profiles":"nobody"}')

    $r4 = Join-Path $T 'reset-empty'
    Put (Join-Path $r4 'server-settings.json') '{}'
    Put (Join-Path $r4 'world\changeForms\13164_JKs Whiterun.esp.json') '{}'
    $x = RunBox $resetBody @('-Root', $r4)
    Yes 'R10 with nobody to throw away, no list is written' ($x.code -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $r4 'private\deleted-characters.json')))

    $r5 = Server 'reset-badsettings' '{"privDir": '
    $x = RunBox $resetBody @('-Root', $r5)
    Yes ('R11 a server-settings.json that will not parse stops the reset: where the list goes is not guessed (' + ($x.out -join ' / ') + ')') (
        $x.code -eq 1 -and @($x.out | Where-Object { $_ -like 'STOP. *server-settings.json will not parse*Nothing was thrown away.' }).Count -eq 1 -and
        @(Get-ChildItem -LiteralPath (Join-Path $r5 'world\changeForms') -Filter '*.json' -File).Count -eq 4 -and
        -not (Test-Path -LiteralPath (Join-Path $r5 'private')))

    # The box's stop and start, as far as it goes before anything is stopped.
    $b7 = Server 'run-badsettings' '{"port": '
    $x = RunBox $resetRun @('-Root', $b7, '-Task', 'Thornswood test task that is not there')
    Yes ('B7 settings that will not read stop the box''s script before anything is stopped (' + ($x.out -join ' / ') + ')') (
        $x.code -eq 1 -and @($x.out | Where-Object { $_ -like 'STOP. *server-settings.json will not read*Nothing was stopped or thrown away.' }).Count -eq 1 -and
        -not @($x.out | Where-Object { $_ -like 'stopped pid*' }).Count -and
        @(Get-ChildItem -LiteralPath (Join-Path $b7 'world\changeForms') -Filter '*.json' -File).Count -eq 4)
    $b8 = Server 'run-noport' '{"privDir":"private"}'
    $x = RunBox $resetRun @('-Root', $b8, '-Task', 'Thornswood test task that is not there')
    Yes ('B8 settings that name no port stop it too: which server is not guessed (' + ($x.out -join ' / ') + ')') (
        $x.code -eq 1 -and @($x.out | Where-Object { $_ -like 'STOP. *names no port*Nothing was stopped or thrown away.' }).Count -eq 1 -and
        @(Get-ChildItem -LiteralPath (Join-Path $b8 'world\changeForms') -Filter '*.json' -File).Count -eq 4)

    $r6 = Server 'reset-badform' '{}'
    Put (Join-Path $r6 'world\changeForms\3.json') '{"formDesc":"ff000a0'
    $x = RunBox $resetBody @('-Root', $r6)
    $l = ListOf (Join-Path $r6 'private\deleted-characters.json')
    Yes ('R12 a change form that will not parse is named, and the others are still listed (' + ($x.out -join ' / ') + ')') (
        $x.code -eq 0 -and @($x.out | Where-Object { $_ -like '*3.json will not parse, so its character, if it is one, is not on the release list' }).Count -eq 1 -and
        $l -and (Ids $l.actors) -eq "$A1,$A2")

    # ---- W: a wipe -----------------------------------------------------------------
    $stamp = '20261017-2100'
    function FillMove([string]$root) {
        $rootsLit = Lit @($root)
        $movesLit = Lit $Moves
        $wipeDoneLit = Lit $WipeDone
        $stamp = $stamp
        return $ExecutionContext.InvokeCommand.ExpandString($move)
    }
    function Registers([string]$root) {
        foreach ($f in 'characters.json', 'property.json', 'farm-claims.json', 'law.json', 'beds.json', 'embassy.json', 'books.json',
                       'last-left.json', 'take-limit.json', 'dungeon-rewards-ledger.json', 'mod-settings.json', 'merchant-ledger.json') {
            Put (Join-Path $root "private\$f") ('{"file":"' + $f + '"}')
        }
    }
    $w1 = Server 'wipe' '{}'
    Registers $w1
    $old = '{"profiles":[7001],"actors":[' + $A9 + '],"done":{"farms":1}}'
    Put (Join-Path $w1 'private\deleted-characters.json') $old
    $x = RunBox (FillMove $w1)
    $file = Join-Path $w1 'private\deleted-characters.json'
    $l = ListOf $file
    Yes ('W1 a wipe moves everything and writes the list (' + (@($x.out | Where-Object { $_ -like 'RELEASE*' }) -join ' / ') + ')') (
        @($x.out | Where-Object { $_ -like 'FAILED*' }).Count -eq 0 -and @($x.out | Where-Object { $_ -like ('RELEASE|' + $file + '|1|3|done: *') }).Count -eq 1)
    Yes ('W2 it names every character in the world it set aside, with the ids of the list it set aside (' + (Ids $l.actors) + ')') ($l -and (Ids $l.actors) -eq "$A1,$A2,$A9")
    Yes ('W3 the only profile is the deleted one carried over: a wiped character''s is never named (' + (Ids $l.profiles) + ')') ((Ids $l.profiles) -eq '7001')
    $dk = @(); if ($l -and $l.done) { $dk = @($l.done.PSObject.Properties | ForEach-Object { $_.Name }) }
    Yes ('W4 done is every part but the merchants'' and, with a deleted profile carried over, the saves, each a time (' + ($dk -join ', ') + ')') (
        $dk.Count -eq $expect.Count -and @($expect | Where-Object { $dk -notcontains $_ }).Count -eq 0 -and
        @($l.done.PSObject.Properties | Where-Object { -not ([long]$_.Value -gt 0) }).Count -eq 0)
    Yes 'W5 the list it set aside stays as it was, for an undo' ([IO.File]::ReadAllText((Join-Path $w1 "private\deleted-characters-before-$stamp.json")) -eq $old)
    Yes 'W6 the merchant ledger and the mod menu choices stay where they were' (
        (Test-Path -LiteralPath (Join-Path $w1 'private\merchant-ledger.json')) -and (Test-Path -LiteralPath (Join-Path $w1 'private\mod-settings.json')))
    $lists.wipe = [IO.File]::ReadAllText($file)

    $w2 = Join-Path $T 'wipe-nobody'
    Put (Join-Path $w2 'server-settings.json') '{}'
    Put (Join-Path $w2 'world\changeForms\13164_JKs Whiterun.esp.json') '{}'
    Registers $w2
    $x = RunBox (FillMove $w2)
    Yes 'W7 with nobody to name and no list set aside, no list is written' (($x.out -contains 'RELEASE|none') -and -not (Test-Path -LiteralPath (Join-Path $w2 'private\deleted-characters.json')))

    $w3 = Server 'wipe-badlist' '{}'
    Registers $w3
    Put (Join-Path $w3 'private\deleted-characters.json') '{"file":"not a list"}'
    $x = RunBox (FillMove $w3)
    $l = ListOf (Join-Path $w3 'private\deleted-characters.json')
    Yes ('W8 a list set aside that is not one is said, not carried, and left as it was (' + (@($x.out | Where-Object { $_ -like 'RELEASENOTE*' }) -join ' / ') + ')') (
        @($x.out | Where-Object { $_ -like 'RELEASENOTE|*not a list of deleted characters, so nothing was carried from it*' }).Count -eq 1 -and
        $l -and (Ids $l.actors) -eq "$A1,$A2" -and @($l.profiles).Count -eq 0 -and
        [IO.File]::ReadAllText((Join-Path $w3 "private\deleted-characters-before-$stamp.json")) -eq '{"file":"not a list"}')
    $dk3 = @(); if ($l -and $l.done) { $dk3 = @($l.done.PSObject.Properties | ForEach-Object { $_.Name }) }
    Yes ('W8b with no profile carried, the saves are marked done as well, so only the merchants'' part waits (' + ($dk3 -join ', ') + ')') (
        $dk3.Count -eq ($expect.Count + 1) -and ($dk3 -contains 'saves') -and @($expect | Where-Object { $dk3 -notcontains $_ }).Count -eq 0)
    $lists.wipeNoProfile = [IO.File]::ReadAllText((Join-Path $w3 'private\deleted-characters.json'))

    # A file held open with no sharing stops its move only where share modes
    # are kept, which is Windows, the box's system: off Windows the move goes.
    if ($OnWindows) {
        $w4 = Server 'wipe-held' '{}'
        Registers $w4
        $lock = [IO.File]::Open((Join-Path $w4 'private\embassy.json'), 'Open', 'Read', 'None')
        try { $x = RunBox (FillMove $w4) } finally { $lock.Dispose() }
        Yes ('W9 a server whose move did not finish gets no list, and says so (' + (@($x.out | Where-Object { $_ -like 'RELEASENOTE*' }) -join ' / ') + ')') (
            @($x.out | Where-Object { $_ -like 'FAILED*embassy.json*' }).Count -eq 1 -and
            @($x.out | Where-Object { $_ -like 'RELEASENOTE|*no release list, because the move did not finish' }).Count -eq 1 -and
            -not (Test-Path -LiteralPath (Join-Path $w4 'private\deleted-characters.json')))
    } else { Write-Host 'SKIP  W9 a move that does not finish: it holds a file open with no sharing, and share modes are Windows''; off Windows an open file stops no move' }

    # ---- G: the gamemode reads what they wrote --------------------------------------
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Write-Host 'SKIP  G needs node to run the gamemode''s release block' }
    else {
        $js = Join-Path $T 'read.js'
        [IO.File]::WriteAllText($js, @'
const fs = require('fs'), path = require('path'), vm = require('vm');
const gm = fs.readFileSync(process.argv[2], 'utf8').split(String.fromCharCode(13)).join('');
const a = gm.indexOf('// ==== thornswood release of deleted characters ===='), b = gm.indexOf('// ==== end thornswood release of deleted characters ====');
const dir = process.argv[3];
const logged = [];
const box = { require: require, console: { log: (s) => logged.push(s) }, log: (s) => logged.push(s) };
box.globalThis = box;
vm.createContext(box);
const was = process.cwd(); process.chdir(dir);
try {
  vm.runInContext(gm.slice(a, b), box);
  const seen = [];
  box.__thornswoodRelease('embassy', (who) => { seen.push(who.actor(Number(process.argv[4])), who.profile(5001), who.profile(5002)); return { counts: {}, saved: true }; });
  process.stdout.write(JSON.stringify({ waiting: box.__thornswoodReleaseWaiting(), seen: seen, unread: logged.some((l) => /not a list/.test(l)) }));
} finally { process.chdir(was); }
'@)
        $G = @{}
        foreach ($k in 'reset', 'resetFresh', 'wipe', 'wipeNoProfile') {
            $d = Join-Path $T ('g-' + $k)
            Put (Join-Path $d 'server-settings.json') '{}'
            Put (Join-Path $d 'private\deleted-characters.json') $lists[$k]
            $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            try { $G[$k] = (& $node.Source $js $Gm $d $A1 2>&1 | Out-String) | ConvertFrom-Json } catch { $G[$k] = $null }
            finally { $ErrorActionPreference = $eap }
        }
        $others = @($parts | Where-Object { $_ -ne 'embassy' })
        Yes ('G1 the release block reads the reset''s list and every part waits on it (' + (@($G.reset.waiting) -join ', ') + ')') (
            $G.reset -and -not $G.reset.unread -and (@($G.reset.waiting) -join ',') -eq ($others -join ','))
        Yes 'G2 it names the thrown-away character, and the profile of neither the character nor another' (
            $G.resetFresh -and -not $G.resetFresh.unread -and (@($G.resetFresh.seen) -join ',') -eq 'True,False,False')
        Yes ('G2b a reset''s list with no profile has every part but the saves waiting on it, the saves being done already (' + (@($G.resetFresh.waiting) -join ', ') + ')') (
            $G.resetFresh -and (@($G.resetFresh.waiting) -join ',') -eq (@($others | Where-Object { $_ -ne 'saves' }) -join ','))
        Yes ('G3 the release block reads the wipe''s list, carrying a deleted profile, and only the saves and the merchants'' part wait on it (' + (@($G.wipe.waiting) -join ', ') + ')') (
            $G.wipe -and -not $G.wipe.unread -and (@($G.wipe.waiting) -join ',') -eq 'saves,merchants')
        Yes ('G4 a wipe''s list with no profile has only the merchants'' part waiting on it (' + (@($G.wipeNoProfile.waiting) -join ', ') + ')') (
            $G.wipeNoProfile -and -not $G.wipeNoProfile.unread -and (@($G.wipeNoProfile.waiting) -join ',') -eq 'merchants')
    }
}
catch {
    Yes ('the harness ran to the end: ' + $_.Exception.Message) $false
}
finally {
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
}
Done
