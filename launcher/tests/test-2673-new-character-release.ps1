<#
  test-2673-new-character-release.ps1

      pwsh -NoProfile -File .\launcher\tests\test-2673-new-character-release.ps1

  Issue #2673, after #2668: scripts\ops\New-Character.ps1 threw the local
  test characters away and wrote no release list, so a guild trader's supply
  waits and a trade waiting on that character stayed for good, keyed to a
  form id the world hands to the next character made. It now writes the list
  through the one writer (scripts\ops\Release-List.ps1), naming characters
  by form id and never a profile, the way Reset-Character.ps1 does. The
  launcher's own copy of the discard (SkyMp.Fresh), which nothing called and
  which wrote no list, is gone, so there is no second path that can drop a
  character without one.

  This runs the real New-Character.ps1 under PowerShell 7, which runs it on
  the box and wherever a developer runs it from (#5356), against stand-in
  server folders in a scratch folder:

    S  it loads the one writer and writes no list of its own; the launcher
       keeps no discard of characters' change forms; Reset-Character no longer
       points at a launcher switch
    N  the list names the characters it threw away by form id and no
       profile, merges into a list waiting there with done cleared, goes in
       the server's privDir, is written with -NoBackup too, is not written
       for -WhatIf or when nobody was thrown away; a list naming no profile
       has 'saves' done (it acts only on profiles, and no server on this
       machine starts under server-log.js); a list there that is not one, a
       server-settings.json that will not parse, or a -World that is not a
       server's world\changeForms, stops it with nothing moved; a change
       form that will not parse is named
    G  the list it wrote is read by the gamemode's own release block, and
       every part but the saves waits on it

  Nothing leaves this machine. The scratch folder goes at the end.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$NewPs = Join-Path $Repo 'scripts\ops\New-Character.ps1'
$ResetPs = Join-Path $Repo 'scripts\ops\Reset-Character.ps1'
$ListPs = Join-Path $Repo 'scripts\ops\Release-List.ps1'
$Gm = Join-Path $Repo 'game\gamemode.js'
$App = Join-Path $Repo 'launcher\app'

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

# ---- S: the one writer, and no second discard ----------------------------------
$N = Parse $NewPs; $L = Parse $ListPs; $R = Parse $ResetPs
Yes 'S1 New-Character.ps1 and Release-List.ps1 parse' ($N.errors -eq 0 -and $L.errors -eq 0)
Yes 'S2 New-Character loads the one writer and runs it in place' (
    $N.text.Contains(". (Join-Path `$Here 'Release-List.ps1')") -and $N.text.Contains('. ([scriptblock]::Create($ThornswoodReleaseList))'))
Yes 'S3 and writes no list of its own: no path to deleted-characters.json, one call to the writer' (
    $N.text -notmatch "deleted-characters\.json'" -and ([regex]::Matches($N.text, 'Write-ThornswoodReleaseList ')).Count -eq 1 -and
    $N.text.Contains('Write-ThornswoodReleaseList -Root $Root -Actors $ids'))
Yes 'S4 each form id is read before its change form is moved or deleted' (
    $N.text.IndexOf('Get-ThornswoodCharacterIds @($f.FullName)') -gt 0 -and
    $N.text.IndexOf('Get-ThornswoodCharacterIds @($f.FullName)') -lt $N.text.IndexOf('Remove-Item -LiteralPath $f.FullName'))
$discard = @(Get-ChildItem -LiteralPath $App -Filter '*.cs' -File | Where-Object {
    $t = [IO.File]::ReadAllText($_.FullName); $t.Contains('_discarded-') -or $t -match 'world\\\\changeForms' })
Yes ('S5 the launcher keeps no discard of characters'' change forms of its own (' + (($discard | ForEach-Object { $_.Name }) -join ', ') + ')') ($discard.Count -eq 0)
Yes 'S6 SkyMp.Fresh is gone' (-not ([IO.File]::ReadAllText((Join-Path $App 'SkyMp.cs'))).Contains('static string Fresh('))
Yes 'S7 Reset-Character no longer points at a launcher switch that is not there' ($R.text -notmatch 'launcher has a switch for this')

. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')
$boxPs = Get-BoxPowerShell

$T = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-2673-' + [Guid]::NewGuid().ToString('N'))
$A1 = 4278192641; $A2 = 4278192642; $A9 = 4278192649     # ff000a01, ff000a02, ff000a09
function Put([string]$path, [string]$body) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $body)
}
function RunNew([string]$exe, [string[]]$arg) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $out = @(& $exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $NewPs @arg 2>&1 | ForEach-Object { "$_" })
        return @{ out = $out; code = $LASTEXITCODE }
    }
    finally { $ErrorActionPreference = $eap }
}
function ListOf([string]$file) {
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    return ([IO.File]::ReadAllText($file) | ConvertFrom-Json)
}
function Ids($a) { return ((@($a) | ForEach-Object { [long]$_ }) -join ',') }
function Forms([string]$root) { return @(Get-ChildItem -LiteralPath (Join-Path $root 'world\changeForms') -Filter '*.json' -File) }
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
    # ---- N: a new character ---------------------------------------------------------
    $n1 = Server 'merge' '{"privDir":"private"}'
    Put (Join-Path $n1 'private\deleted-characters.json') ('{"profiles":[6001],"actors":[' + $A9 + '],"done":{"farms":1,"property":2}}')
    $x = RunNew $boxPs @('-World', (Join-Path $n1 'world\changeForms'))
    $l = ListOf (Join-Path $n1 'private\deleted-characters.json')
    $bins = @(Get-ChildItem -LiteralPath (Join-Path $n1 'world\changeForms') -Directory -Filter '_discarded-*')
    Yes ('N1 it throws the characters away and says it wrote the list (' + (@($x.out | Where-Object { $_ -like '*release list*' }) -join ' / ') + ')') (
        $x.code -eq 0 -and @($x.out | Where-Object { $_ -like '*release list: *3 character(s)*' }).Count -eq 1 -and
        (Forms $n1).Count -eq 1 -and $bins.Count -eq 1 -and @(Get-ChildItem -LiteralPath $bins[0].FullName -File).Count -eq 3)
    Yes ('N2 the list names the characters it threw away by form id, merged into the one waiting (' + (Ids $l.actors) + ')') ($l -and (Ids $l.actors) -eq "$A1,$A2,$A9")
    Yes ('N3 it adds no profile: only the one already waiting is there (' + (Ids $l.profiles) + ')') ((Ids $l.profiles) -eq '6001')
    Yes 'N4 and done is cleared, so every part runs for the new ids' ($l -and $null -eq $l.done)
    Yes 'N5 the world object stays and a character with a plugin in its desc is not named' (
        (Test-Path -LiteralPath (Join-Path $n1 'world\changeForms\13164_JKs Whiterun.esp.json')) -and -not ((Ids $l.actors) -match '(^|,)2561(,|$)'))

    $n2 = Server 'fresh' '{"privDir":"secret"}'
    $x = RunNew $boxPs @('-World', (Join-Path $n2 'world\changeForms'))
    $file = Join-Path $n2 'secret\deleted-characters.json'
    Yes 'N6 with no list there, the list goes in the server''s own privDir' (
        $x.code -eq 0 -and (Test-Path -LiteralPath $file) -and -not (Test-Path -LiteralPath (Join-Path $n2 'private\deleted-characters.json')))
    $got = ''; if (Test-Path -LiteralPath $file) { $got = [IO.File]::ReadAllText($file) }
    Yes ('N7 and is exactly the characters, with no profile, and only saves done, which acts on profiles alone and which no server on this machine runs (' + $got + ')') (
        $got -match ('^\{"profiles":\[\],"actors":\[' + $A1 + ',' + $A2 + '\],"done":\{"saves":[1-9][0-9]*\}\}$'))
    $lists.fresh = $got

    $n3 = Server 'nobackup' '{}'
    $x = RunNew $boxPs @('-World', (Join-Path $n3 'world\changeForms'), '-NoBackup')
    $l = ListOf (Join-Path $n3 'private\deleted-characters.json')
    Yes 'N8 with -NoBackup the change forms are deleted, with no _discarded folder' (
        $x.code -eq 0 -and (Forms $n3).Count -eq 1 -and @(Get-ChildItem -LiteralPath (Join-Path $n3 'world\changeForms') -Directory).Count -eq 0)
    Yes ('N9 and the list still names them, read before the delete (' + (Ids $l.actors) + ')') ($l -and (Ids $l.actors) -eq "$A1,$A2" -and @($l.profiles).Count -eq 0)

    $n4 = Server 'whatif' '{}'
    $x = RunNew $boxPs @('-World', (Join-Path $n4 'world\changeForms'), '-WhatIf')
    Yes 'N10 -WhatIf throws nothing away and writes no list' (
        $x.code -eq 0 -and (Forms $n4).Count -eq 4 -and -not (Test-Path -LiteralPath (Join-Path $n4 'private\deleted-characters.json')))

    $n5 = Server 'badlist' '{}'
    Put (Join-Path $n5 'private\deleted-characters.json') '{"profiles":"nobody"}'
    $x = RunNew $boxPs @('-World', (Join-Path $n5 'world\changeForms'))
    Yes ('N11 a list there that is not one stops it (' + (@($x.out | Where-Object { $_ -like 'STOP*' }) -join ' / ') + ')') (
        $x.code -eq 1 -and @($x.out | Where-Object { $_ -like 'STOP. *not a list of deleted characters, so nothing was thrown away*' }).Count -eq 1)
    Yes 'N12 with nothing moved and the list left as it was' (
        (Forms $n5).Count -eq 4 -and [IO.File]::ReadAllText((Join-Path $n5 'private\deleted-characters.json')) -eq '{"profiles":"nobody"}')

    $n6 = Join-Path $T 'empty'
    Put (Join-Path $n6 'server-settings.json') '{}'
    Put (Join-Path $n6 'world\changeForms\13164_JKs Whiterun.esp.json') '{}'
    $x = RunNew $boxPs @('-World', (Join-Path $n6 'world\changeForms'))
    Yes 'N13 with nobody to throw away, no list is written' ($x.code -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $n6 'private\deleted-characters.json')))

    $n7 = Join-Path $T 'loose\forms'
    Put (Join-Path $n7 '0.json') ('{"formDesc":"a01","profileId":5001}')
    $x = RunNew $boxPs @('-World', $n7)
    Yes ('N14 a -World that is not a server''s world\changeForms stops it with nothing moved (' + (@($x.out | Where-Object { $_ -like 'STOP*' }) -join ' / ') + ')') (
        $x.code -eq 1 -and (Test-Path -LiteralPath (Join-Path $n7 '0.json')) -and
        @(Get-ChildItem -LiteralPath $T -Recurse -Filter 'deleted-characters.json' | Where-Object { $_.FullName -like (Join-Path $T 'loose*') }).Count -eq 0)

    $n8 = Server 'pwsh' '{"privDir":"secret"}'
    $x = RunNew $boxPs @('-World', (Join-Path $n8 'world\changeForms'))
    $f8 = Join-Path $n8 'secret\deleted-characters.json'
    $g8 = ''; if (Test-Path -LiteralPath $f8) { $g8 = [IO.File]::ReadAllText($f8) }
    # The same but for the time 'saves' was marked done.
    $shape = { param($s) $s -replace '"saves":[0-9]+', '"saves":T' }
    Yes ('N15 with its private folder named secret it writes the same list there (' + $g8 + ')') ($x.code -eq 0 -and $g8 -and (& $shape $g8) -eq (& $shape $lists.fresh))

    $n9 = Server 'badsettings' '{"privDir": '
    $x = RunNew $boxPs @('-World', (Join-Path $n9 'world\changeForms'))
    Yes ('N16 a server-settings.json that will not parse stops it: where the list goes is not guessed (' + (@($x.out | Where-Object { $_ -like 'STOP*' }) -join ' / ') + ')') (
        $x.code -eq 1 -and @($x.out | Where-Object { $_ -like 'STOP. *server-settings.json will not parse*Nothing was thrown away.' }).Count -eq 1 -and
        (Forms $n9).Count -eq 4 -and -not (Test-Path -LiteralPath (Join-Path $n9 'private')))

    $n10 = Server 'badform' '{}'
    Put (Join-Path $n10 'world\changeForms\3.json') '{"formDesc":"ff000a0'
    $x = RunNew $boxPs @('-World', (Join-Path $n10 'world\changeForms'))
    $l = ListOf (Join-Path $n10 'private\deleted-characters.json')
    Yes ('N17 a change form that will not parse is named, and the others are still listed (' + (@($x.out | Where-Object { $_ -like '*will not parse*' }) -join ' / ') + ')') (
        $x.code -eq 0 -and @($x.out | Where-Object { $_ -like '*3.json will not parse, so its character, if it is one, is not on the release list' }).Count -eq 1 -and
        $l -and (Ids $l.actors) -eq "$A1,$A2")

    # ---- G: the gamemode reads what it wrote -----------------------------------------
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Write-Host 'SKIP  G needs node to run the gamemode''s release block' }
    else {
        $parts = @()
        $m = [regex]::Match([IO.File]::ReadAllText($Gm), "var PARTS = \[([^\]]*)\];")
        if ($m.Success) { $parts = @([regex]::Matches($m.Groups[1].Value, "'([a-z]+)'") | ForEach-Object { $_.Groups[1].Value }) }
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
        $d = Join-Path $T 'g-fresh'
        Put (Join-Path $d 'server-settings.json') '{}'
        Put (Join-Path $d 'private\deleted-characters.json') $lists.fresh
        $G = $null
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $G = (& $node.Source $js $Gm $d $A1 2>&1 | Out-String) | ConvertFrom-Json } catch { $G = $null }
        finally { $ErrorActionPreference = $eap }
        $others = @($parts | Where-Object { $_ -ne 'embassy' -and $_ -ne 'saves' })
        Yes ('G1 the release block reads the list and every part but the saves, already done, waits on it (' + (@($G.waiting) -join ', ') + ')') (
            $G -and -not $G.unread -and $parts.Count -ge 6 -and (@($G.waiting) -join ',') -eq ($others -join ','))
        Yes 'G2 it names the thrown-away character, and the profile of neither the character nor another' (
            $G -and (@($G.seen) -join ',') -eq 'True,False,False')
    }
}
catch {
    Yes ('the harness ran to the end: ' + $_.Exception.Message) $false
}
finally {
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
}
Done
