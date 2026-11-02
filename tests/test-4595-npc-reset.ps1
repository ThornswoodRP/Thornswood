<#
  test-4595-npc-reset.ps1

      pwsh -NoProfile -File .\tests\test-4595-npc-reset.ps1

  Issue #4595: the NPC-only reset, scripts\ops\Reset-Npcs.ps1 with its box
  half scripts\ops\NpcReset.ps1. Engine fork #98 marks an NPC's own gear and
  leaves out vanilla pockets only when the NPC's inventory is first made, so
  NPCs saved before it need their change forms moved aside, and nothing
  else: every character, every other reference and every private register
  stays.

  This runs the box half, as the script sends it, over stand-in server
  folders in a scratch folder:

    P  both scripts parse, and the box half is plain ASCII
    K  which change form is which: an actor with no profile is an NPC, by
       kind (placed, patrol, staff-run, staff-kept, runtime); a character,
       profile 0 included, any other reference, and a file that does not
       read or whose name is not its own formDesc are kept
    S  a survey says the counts, the NPCs with and without #98's mark, the
       characters with kill-contract history for an NPC being moved and each
       creature staff kept, and moves nothing
    M  a reset moves exactly the NPC files into changeForms\_discarded-<stamp>,
       leaves every other file, folder and register byte for byte, and a
       second run finds no NPC; a folder of that stamp already there stops it
       with nothing moved
    J  the save journal (.pending-batch): one whose checksum matches has its
       entries that are not NPCs written to their files and is moved aside;
       its NPC entries are not written; one whose checksum does not match
       stops the reset with nothing moved
    G  the gate: Reset-Npcs-Dev and Reset-Npcs-Main run this script held to
       their server with -Yes and -NoPause and take only -Survey; main is a
       live verb
    B  the box step checks the server's own settings name it, holds it
       from before its stop until it answers again (#5155), leaves alone a
       server somebody else holds, and stops it the way Reset-Character does

  Read only, apart from its scratch folder.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function P([string]$rel) { return (Join-Path $Repo ($rel.Replace('/', [IO.Path]::DirectorySeparatorChar))) }

# ---- P ----------------------------------------------------------------------
foreach ($f in 'scripts/ops/Reset-Npcs.ps1', 'scripts/ops/NpcReset.ps1') {
    $err = $null
    [void][Management.Automation.Language.Parser]::ParseFile((P $f), [ref]$null, [ref]$err)
    Yes "P $f parses" (-not $err -or $err.Count -eq 0)
}
$bytes = [IO.File]::ReadAllBytes((P 'scripts/ops/NpcReset.ps1'))
Yes 'P NpcReset.ps1 is plain ASCII' (-not @($bytes | Where-Object { $_ -gt 126 -or ($_ -lt 32 -and $_ -ne 9 -and $_ -ne 10 -and $_ -ne 13) }).Count)
. (P 'scripts/ops/NpcReset.ps1')
$err = $null
[void][Management.Automation.Language.Parser]::ParseInput($ThornswoodNpcReset, [ref]$null, [ref]$err)
Yes 'P the text it sends to the box parses' (-not $err -or $err.Count -eq 0)
. ([scriptblock]::Create($ThornswoodNpcReset))

# ---- stand-in servers -------------------------------------------------------
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('tw-4595-' + [Guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Form([string]$desc, [int]$rec, [int]$profile, $dyn = $null, $entries = @()) {
    $o = [ordered]@{
        recType = $rec; formDesc = $desc; baseDesc = '13bbf:Skyrim.esm'; position = @(10.4, -20.6, 30)
        worldOrCellDesc = '3c:Skyrim.esm'; inv = [ordered]@{ entries = @($entries) }; profileId = $profile
        isDead = $false
    }
    if ($dyn) { $o.dynamicFields = $dyn } else { $o.dynamicFields = [ordered]@{} }
    return ($o | ConvertTo-Json -Depth 10)
}
function FileOf([string]$desc) { return (($desc -replace ':', '_') + '.json') }
function New-Server([string]$name) {
    $root = Join-Path $scratch $name
    $forms = Join-Path $root 'world/changeForms'
    Put (Join-Path $root 'server-settings.json') '{ "port": 7777, "thornswoodServer": "dev" }'
    Put (Join-Path $root 'private/characters.json') '{ "who": { "5": {} } }'
    Put (Join-Path $root 'private/property.json') '{ "held": [] }'
    $f = @{
        # characters: a runtime form with letters in its hex, and profile 0
        'char'      = @('1a', (Form '1a' 1 5 ([ordered]@{ thornswoodQuests = [ordered]@{ killHistory = [ordered]@{ '10:Skyrim.esm' = 2; '77:Skyrim.esm' = 0 } } })))
        'char0'     = @('2', (Form '2' 1 0))
        'char3'     = @('3', (Form '3' 1 7 ([ordered]@{ thornswoodQuests = [ordered]@{ killHistory = [ordered]@{ '55:Skyrim.esm' = 1 } } })))
        # NPCs
        'placed'    = @('10:Skyrim.esm', (Form '10:Skyrim.esm' 1 -1 ([ordered]@{ _skympNpcLifeGeneration = 3 }) @([ordered]@{ baseId = 15; count = 30 })))
        'marked'    = @('11:Skyrim.esm', (Form '11:Skyrim.esm' 1 -1 $null @([ordered]@{ baseId = 5; count = 1; npcEquipment = $true })))
        'patrol'    = @('ff', (Form 'ff' 1 -1 ([ordered]@{ thornswoodNpcPatrol = [ordered]@{ road = 'r1'; slot = 0 } })))
        'staffkept' = @('100', (Form '100' 1 -1 ([ordered]@{ thornswoodNpcCommanded = [ordered]@{ keep = $true } })))
        # one marked item and one without the mark counts as without it
        'staffrun'  = @('101', (Form '101' 1 -1 ([ordered]@{ thornswoodNpcCommanded = [ordered]@{ run = 'abc' } }) @([ordered]@{ baseId = 5; count = 1; npcEquipment = $true }, [ordered]@{ baseId = 15; count = 2 })))
        'runtime'   = @('102', (Form '102' 1 -1))
        # other references
        'chest'     = @('20:Skyrim.esm', (Form '20:Skyrim.esm' 0 -1))
        'drop'      = @('103', (Form '103' 0 -1))
    }
    foreach ($k in $f.Keys) { Put (Join-Path $forms (FileOf $f[$k][0])) $f[$k][1] }
    Put (Join-Path $forms 'bad.json') '{ not json'
    # its name is not its formDesc's
    Put (Join-Path $forms '30_Skyrim.esm.json') (Form '31:Skyrim.esm' 1 -1)
    Put (Join-Path $forms '_discarded-20261001-101010/9.json') (Form '9' 1 4)
    Put (Join-Path $forms '104.json.tmp') 'half a file'
    return $root
}
function Snapshot([string]$root) {
    $h = @{}
    foreach ($f in Get-ChildItem -LiteralPath $root -Recurse -File -Force) {
        $h[[IO.Path]::GetRelativePath($root, $f.FullName).Replace('\', '/')] = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName))
    }
    return $h
}
function Line($lines, [string]$tag) { return @($lines | Where-Object { "$_" -like ($tag + '|*') }) }

try {
    # ---- K --------------------------------------------------------------------
    function Kind([string]$json, [string]$file) { return (Get-ThornswoodFormKind ($json | ConvertFrom-Json) $file).kind }
    Yes 'K an actor with profile 5 is a character' ((Kind (Form '1a' 1 5) '1a.json') -eq 'character')
    Yes 'K profile 0 is a character too' ((Kind (Form '2' 1 0) '2.json') -eq 'character')
    Yes 'K an actor a plugin places, with no profile, is a placed NPC' ((Kind (Form '10:Skyrim.esm' 1 -1) '10_Skyrim.esm.json') -eq 'placed')
    Yes 'K a chest is another reference' ((Kind (Form '20:Skyrim.esm' 0 -1) '20_Skyrim.esm.json') -eq 'object')
    Yes 'K a form under another name is not read' ((Kind (Form '31:Skyrim.esm' 1 -1) '30_Skyrim.esm.json') -eq 'unread')
    Yes 'K a profileId that is not a number is not read' ((Kind ((Form '5' 1 -1) -replace '"profileId": -1', '"profileId": "x"') '5.json') -eq 'unread')
    Yes 'K a recType that is not a number is not read' ((Kind ((Form '5' 1 -1) -replace '"recType": 1', '"recType": null') '5.json') -eq 'unread')

    # ---- S --------------------------------------------------------------------
    $root = New-Server 'dev'
    $before = Snapshot $root
    $s = @(Invoke-ThornswoodNpcReset -Root $root -Stamp '20261031-120000')
    $after = Snapshot $root
    Yes 'S a survey moves nothing and writes nothing' (($before.Keys.Count -eq $after.Keys.Count) -and -not @($before.Keys | Where-Object { $after[$_] -ne $before[$_] }).Count)
    Yes 'S it names 6 NPCs, 3 characters kept, 2 other references, 2 not read' ((Line $s 'NPCRESET') -eq 'NPCRESET|6|3|2|2')
    Yes 'S by kind' ((Line $s 'NPCKINDS') -eq 'NPCKINDS|placed=2|patrol=1|staff-run=1|staff-kept=1|runtime=1')
    Yes 'S one NPC has every item marked, two have an item without the mark, three carry nothing' ((Line $s 'NPCMARKS') -eq 'NPCMARKS|1|2|3')
    Yes 'S the survey says the three counts in words' ((Get-Content -Raw -LiteralPath (Join-Path $Repo 'scripts/ops/Reset-Npcs.ps1')) -match "an item without it: \{1\}; nothing: \{2\}")
    Yes 'S one character holds kill history for one NPC being moved' ((Line $s 'KILLHISTORY') -eq 'KILLHISTORY|1|1')
    Yes 'S the creature staff kept is named with its record and place' ((Line $s 'STAFFKEPT') -eq 'STAFFKEPT|100|13bbf:Skyrim.esm|3c:Skyrim.esm|10,-21,30')
    # The server build in the folder against main's record.
    $wc = '6ebd3487d478bbe73f3d32a2956c55fe404b555b'; $ws = ('ab' * 32)
    Yes 'S no server-build.json is an unknown build' ((Test-ThornswoodServerBuild $root $wc $ws) -eq "SERVERBUILD|unknown|none there||$wc|$ws")
    Put (Join-Path $root 'server-build.json') ('{ "sha256": "' + $ws + '", "source": { "commit": "' + $wc + '" } }')
    Yes 'S the build main''s record holds is the same' ((Test-ThornswoodServerBuild $root $wc $ws) -eq "SERVERBUILD|same|$wc|$ws|$wc|$ws")
    Put (Join-Path $root 'server-build.json') ('{ "sha256": "' + ('cd' * 32) + '", "source": { "commit": "1111111111111111111111111111111111111111" } }')
    Yes 'S another build differs' ((Test-ThornswoodServerBuild $root $wc $ws) -like 'SERVERBUILD|differs|1111111111111111111111111111111111111111|cdcd*')
    Put (Join-Path $root 'server-build.json') '{ "sha256": "'
    Yes 'S a record that will not read is unknown' ((Test-ThornswoodServerBuild $root $wc $ws) -like 'SERVERBUILD|unknown|it will not read|*')
    Remove-Item -LiteralPath (Join-Path $root 'server-build.json')
    Yes 'S each file not read is named' (@(Line $s 'NOTREAD').Count -eq 2 -and @(Line $s 'NOTREAD' | Where-Object { $_ -like 'NOTREAD|30_Skyrim.esm.json|*' }).Count -eq 1)
    Yes 'S no STOP or FAILED' (-not @(Line $s 'STOP').Count -and -not @(Line $s 'FAILED').Count)

    # ---- M --------------------------------------------------------------------
    $m = @(Invoke-ThornswoodNpcReset -Root $root -Stamp '20261031-120000' -Move)
    $forms = Join-Path $root 'world/changeForms'
    $aside = Join-Path $forms '_discarded-20261031-120000'
    $npcFiles = @('10_Skyrim.esm.json', '11_Skyrim.esm.json', 'ff.json', '100.json', '101.json', '102.json')
    Yes 'M it says it moved 6' ((Line $m 'NPCRESET') -eq 'NPCRESET|6|3|2|2')
    Yes 'M every NPC file is in the folder of its stamp' (-not @($npcFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $aside $_)) }).Count)
    Yes 'M and none is left where the engine loads' (-not @($npcFiles | Where-Object { Test-Path -LiteralPath (Join-Path $forms $_) }).Count)
    Yes 'M nothing else went into it' (@(Get-ChildItem -LiteralPath $aside -Force).Count -eq 6)
    $now = Snapshot $root
    $kept = @($before.Keys | Where-Object { $npcFiles -notcontains ($_ -replace '^world/changeForms/', '') })
    Yes 'M every other file is there byte for byte: characters, chests, registers, the older folder, a half file' (
        $kept.Count -eq ($before.Keys.Count - 6) -and -not @($kept | Where-Object { $now[$_] -ne $before[$_] }).Count)
    Yes 'M the moved files are the files as they were' (-not @($npcFiles | Where-Object { $now['world/changeForms/_discarded-20261031-120000/' + $_] -ne $before['world/changeForms/' + $_] }).Count)
    $again = @(Invoke-ThornswoodNpcReset -Root $root -Stamp '20261031-130000' -Move)
    Yes 'M a second run finds no NPC' ((Line $again 'NPCRESET') -eq 'NPCRESET|0|3|2|2' -and @($again | Where-Object { $_ -eq 'no NPC was saved, so nothing was moved' }).Count -eq 1)
    $root2 = New-Server 'twice'
    $null = New-Item -ItemType Directory -Path (Join-Path $root2 'world/changeForms/_discarded-20261031-120000') -Force
    $b2 = Snapshot $root2
    $t = @(Invoke-ThornswoodNpcReset -Root $root2 -Stamp '20261031-120000' -Move)
    $a2 = Snapshot $root2
    Yes 'M a folder of that stamp already there stops it, with nothing moved' (@(Line $t 'STOP').Count -eq 1 -and $b2.Keys.Count -eq $a2.Keys.Count -and -not @($b2.Keys | Where-Object { $a2[$_] -ne $b2[$_] }).Count)
    $root3 = Join-Path $scratch 'otherdb'
    Put (Join-Path $root3 'server-settings.json') '{ "databaseName": "store" }'
    Put (Join-Path $root3 'store/changeForms/12_Skyrim.esm.json') (Form '12:Skyrim.esm' 1 -1)
    $d = @(Invoke-ThornswoodNpcReset -Root $root3 -Stamp '20261031-120000' -Move)
    Yes 'M the world folder is the one databaseName names' ((Line $d 'NPCRESET') -eq 'NPCRESET|1|0|0|0' -and (Test-Path -LiteralPath (Join-Path $root3 'store/changeForms/_discarded-20261031-120000/12_Skyrim.esm.json')))

    # ---- J --------------------------------------------------------------------
    function Journal([string]$forms, $entries, [switch]$Wrong) {
        $batch = ConvertTo-Json -Compress -Depth 5 -InputObject @($entries | ForEach-Object { [ordered]@{ file = $_[0]; json = $_[1] } })
        $sha = [Security.Cryptography.SHA256]::Create()
        $hex = -join ($sha.ComputeHash($utf8.GetBytes($batch)) | ForEach-Object { $_.ToString('x2') })
        if ($Wrong) { $hex = ('0' * 64) }
        Put (Join-Path $forms '.pending-batch') ('{"batch":' + $batch + ',"checksum":"' + $hex + '","version":1}')
    }
    $root4 = New-Server 'journal'
    $forms4 = Join-Path $root4 'world/changeForms'
    $newChar = Form '1a' 1 5 ([ordered]@{ thornswoodQuests = [ordered]@{ killHistory = [ordered]@{} } ; saved = 'newer' })
    $newChest = Form '21:Skyrim.esm' 0 -1
    $newNpc = Form '13:Skyrim.esm' 1 -1
    $oldNpc = Form '10:Skyrim.esm' 1 -1 ([ordered]@{ saved = 'newer' })
    $entries4 = @(@('1a.json', $newChar), @('21_Skyrim.esm.json', $newChest), @('13_Skyrim.esm.json', $newNpc), @('10_Skyrim.esm.json', $oldNpc))
    Journal $forms4 $entries4
    $sj = @(Invoke-ThornswoodNpcReset -Root $root4 -Stamp '20261031-120000')
    Yes 'J a survey counts an NPC only in the journal as an NPC' ((Line $sj 'NPCRESET') -eq 'NPCRESET|7|3|3|2')
    Yes 'J and leaves the journal where it is' (Test-Path -LiteralPath (Join-Path $forms4 '.pending-batch'))
    $mj = @(Invoke-ThornswoodNpcReset -Root $root4 -Stamp '20261031-120000' -Move)
    $aside4 = Join-Path $forms4 '_discarded-20261031-120000'
    Yes 'J the character in it is written to its file, as the start would have' ([IO.File]::ReadAllText((Join-Path $forms4 '1a.json')) -eq $newChar)
    Yes 'J and the chest it adds' ([IO.File]::ReadAllText((Join-Path $forms4 '21_Skyrim.esm.json')) -eq $newChest)
    Yes 'J its NPCs are not written' (-not (Test-Path -LiteralPath (Join-Path $forms4 '13_Skyrim.esm.json')) -and -not (Test-Path -LiteralPath (Join-Path $forms4 '10_Skyrim.esm.json')))
    Yes 'J the journal goes aside with the NPCs, so nothing writes them back' (-not (Test-Path -LiteralPath (Join-Path $forms4 '.pending-batch')) -and (Test-Path -LiteralPath (Join-Path $aside4 '.pending-batch')))
    Yes 'J the NPC on disk is moved as it was before the journal' ((Test-Path -LiteralPath (Join-Path $aside4 '10_Skyrim.esm.json')) -and ([IO.File]::ReadAllText((Join-Path $aside4 '10_Skyrim.esm.json')) -notmatch 'newer'))
    Yes 'J no STOP or FAILED' (-not @(Line $mj 'STOP').Count -and -not @(Line $mj 'FAILED').Count)
    $root5 = New-Server 'badjournal'
    $entries5 = @(, @('1a.json', $newChar))
    Journal (Join-Path $root5 'world/changeForms') $entries5 -Wrong
    $b5 = Snapshot $root5
    $bj = @(Invoke-ThornswoodNpcReset -Root $root5 -Stamp '20261031-120000' -Move)
    $a5 = Snapshot $root5
    Yes 'J a journal whose checksum does not match stops it, with nothing moved or written' (@(Line $bj 'STOP' | Where-Object { $_ -match 'checksum' }).Count -eq 1 -and
        $b5.Keys.Count -eq $a5.Keys.Count -and -not @($b5.Keys | Where-Object { $a5[$_] -ne $b5[$_] }).Count)
}
finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- G ----------------------------------------------------------------------
# GateRules.ps1 reads optional fields of verbs.json as the broker does, with
# strict mode off.
Set-StrictMode -Off
$verbs = [IO.File]::ReadAllText((P 'scripts/vps/gate/verbs.json')) | ConvertFrom-Json
. (P 'scripts/vps/gate/GateRules.ps1')
function Words([string]$line) { $r = Test-ThornswoodGateRequest -Line $line -Verbs $verbs; if ($r.Ok) { return ($r.Args -join '|') } else { return 'REFUSED' } }
Yes 'G Reset-Npcs-Dev runs Reset-Npcs.ps1 on dev, and takes -Survey and nothing else' (
    $verbs.verbs.'Reset-Npcs-Dev'.script -eq 'scripts/ops/Reset-Npcs.ps1' -and -not $verbs.verbs.'Reset-Npcs-Dev'.PSObject.Properties['build'] -and
    (Words 'Reset-Npcs-Dev') -eq '-Server|dev|-Yes|-NoPause' -and (Words 'Reset-Npcs-Dev -Survey') -eq '-Server|dev|-Yes|-NoPause|-Survey' -and
    (Words 'Reset-Npcs-Dev -Server main') -eq 'REFUSED' -and (Words 'Reset-Npcs-Dev -Vps 1.2.3.4') -eq 'REFUSED')
Yes 'G Reset-Npcs-Main is a live verb, held to main' (
    $verbs.verbs.'Reset-Npcs-Main'.script -eq 'scripts/ops/Reset-Npcs.ps1' -and $verbs.verbs.'Reset-Npcs-Main'.build -eq $true -and
    (@($verbs.verbs.'Reset-Npcs-Main'.fixed) -join ' ') -eq '-Server main -Yes -NoPause' -and (Words 'Reset-Npcs-Main -Survey') -eq 'REFUSED')
Yes 'G no verb runs it for any other server or lets the caller add a word' (
    @($verbs.verbs.PSObject.Properties | Where-Object { $_.Value.script -eq 'scripts/ops/Reset-Npcs.ps1' -and
        ((@($_.Value.fixed) -join ' ') -notin @('-Server dev -Yes -NoPause', '-Server main -Yes -NoPause') -or
         (@($_.Value.params.PSObject.Properties.Name) -join ',') -ne 'Survey') }).Count -eq 0)

# ---- B ----------------------------------------------------------------------
$rn = [IO.File]::ReadAllText((P 'scripts/ops/Reset-Npcs.ps1'))
Yes 'B the box step stops unless the folder''s own settings name the server' ($rn.Contains('[string]$cfg.thornswoodServer -ne $Want'))
Yes 'B it opens and waits for the server on its own port, as Reset-Character does' ($rn.Contains('Get-ThornswoodProcessHeld $pids') -and $rn.Contains('Stop-ThornswoodProcessHeld $held') -and $rn.Contains("'..\deploy\StopAndMove.ps1'"))
$set = $rn.IndexOf("Set-ThornswoodHold -Target `$Task -Why 'resetting the NPCs'")
Yes 'B it holds the server before it stops it, so the watchdog leaves it alone while the files move (#5155)' ($set -gt 0 -and $set -lt $rn.IndexOf('Stop-ScheduledTask -TaskName $Task'))
Yes 'B and takes the hold away on every way out after it' (@([regex]::Matches($rn, 'Clear-ThornswoodHold -Target \$Task')).Count -eq 3 -and
    $rn.LastIndexOf('Clear-ThornswoodHold -Target $Task') -lt $rn.IndexOf("if (`$up) { 'ANSWERED|'"))
Yes 'B a server somebody else holds is left as it is, with nothing moved' ($rn.IndexOf('is held by another stop on purpose') -gt 0 -and $rn.IndexOf('is held by another stop on purpose') -lt $set)
$gate = $rn.IndexOf("if (-not `$serverBuild.StartsWith('SERVERBUILD|same|'))")
Yes 'B a reset moves nothing unless the server is the build main''s record holds, checked before the hold and the stop' ($gate -gt $rn.IndexOf('if ($Survey) {') -and $gate -lt $set -and $gate -lt $rn.IndexOf('Stop-ScheduledTask -TaskName $Task'))
Yes 'B the box step is told main''s record' ($rn.Contains("Join-Path `$Here '..\..\records\server-build.json'") -and $rn.Contains('`$WantSha = $(Q ([string]$build.sha256))'))
Yes 'B a survey sends no stop and no hold' ($rn.Contains("`$(if (`$Survey) { '' } else { (Get-ThornswoodHoldScript -Script 'Reset-Npcs.ps1') + `$stopAndMove"))
Yes 'B a reset asks for RESET unless -Yes' ($rn.Contains("`$typed -cne 'RESET'"))
# The box step as the script builds it, for a survey and for a reset.
. (P 'scripts/vps/ServerHold.ps1')
$from = $rn.IndexOf('$stopAndMove = ')
$to = $rn.IndexOf("Write-Host ''", $from)
Yes 'B the box step is built in the script' ($from -gt 0 -and $to -gt $from)
foreach ($survey in $true, $false) {
    $sb = [scriptblock]::Create("param(`$Here, `$Survey, `$root, `$task, `$Server, `$stamp, `$ThornswoodNpcReset)`nfunction Q([string]`$s) { return `"'`" + (`$s -replace `"'`", `"''`") + `"'`" }`n" + $rn.Substring($from, $to - $from) + "`nreturn `$boxScript")
    $box = & $sb (P 'scripts/ops') $survey 'C:\Thornswood-Server-Dev' 'Thornswood Dev Server' 'dev' '20261031-120000' $ThornswoodNpcReset
    $err = $null
    [void][Management.Automation.Language.Parser]::ParseInput($box, [ref]$null, [ref]$err)
    $what = if ($survey) { 'survey' } else { 'reset' }
    Yes "B the box step for a $what parses" (-not $err -or $err.Count -eq 0)
    Yes "B and names the dev folder, its task and its stamp" ($box.Contains("`$Root = 'C:\Thornswood-Server-Dev'") -and $box.Contains("`$Task = 'Thornswood Dev Server'") -and $box.Contains("`$Stamp = '20261031-120000'") -and $box.Contains("`$Survey = `$$survey"))
    Yes "B and names main's server build record" ($box -match "\`$WantCommit = '[0-9a-f]{40}'" -and $box -match "\`$WantSha = '[0-9a-f]{64}'")
    Yes "B and carries the stop and the hold only for a reset" ($box.Contains('function Stop-ThornswoodProcessHeld') -ne $survey -and $box.Contains('function Set-ThornswoodHold') -ne $survey)
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
