<#
  test-5189-collection-record.ps1

      pwsh -NoProfile -File tests\test-5189-collection-record.ps1

  #5189: a mod change is one pull request to records\collection.json, the
  collection as it should be, and its merge drafts the revision on Nexus,
  holds the draft to the record and publishes it.

  WHY. A revision used to be worked out as a New-NexusRevision.ps1 line by
  hand, and what proved it (each page's permissions, the load order, the
  servers' order) ran after it was drafted or after it was published. The
  pull request's check (Check-CollectionRecord.ps1) reads only the
  repository, so it has to say NO to each way a record can go wrong, and the
  merge (Publish-CollectionRecord.ps1) has to ask Nexus for exactly the
  change the record makes.

  It checks:
    R  the real records\collection.json passes the check against the real
       records and the servers' order, names the revision
       records\collection-plugins.json is, and is written in the record's
       own layout (a mod and a plugin to a line)
    C  the check, run as a child process on a planted repository: YES on a
       good record, and NO, naming it, on a rule naming a plugin the record
       does not install, a list that breaks a rule, a rule that loops with
       the order the game sets, a full plugin no rule holds, a mod whose
       page has not been read, a plugin the servers load taken out without
       dropped, a full plugin moved to another index without wipe (a new
       master, and two plugins swapped), a revision that is not
       collection-plugins.json's, and a light plugin written as not light;
       YES again once dropped and wipe say why
    S  the change set the merge asks of Nexus: a new file is -Add with its
       plugins' rules, a mod gone whole is -Remove, a mod's one file moved is
       -Mod and -FileId with its dropPatch, a changed rule is -Rule; and a
       record that keeps one of a mod's two files, or drops a patch with no
       move, is refused before anything is drafted
    L  the record made from a laid out revision (New-CollectionRecordFromLayout)
       reads each plugin's facts from its own header, the file that puts it
       in Data from files.txt and the rules in the list's own spelling; its
       text reads back to the same bytes; and Compare-CollectionRecord finds
       a light flag, a master, a rule and the order that part
    P  the Last recipe's sources are read from the recipe itself, as many as
       game\data\last-plugin.json says it has
    W  .github\workflows\collection-record.yml runs Publish-CollectionRecord.ps1
       on main alone, in the desk environment, after a push that changes the
       record, one Nexus run at a time
    D  Publish-CollectionRecord.ps1 stops on a record behind or ahead of
       Nexus, discards a draft that does not match the record and publishes
       only after the match (read in the script, run against the stand-in
       by tests\test-2914-nexus-scripts.ps1's Nexus where it can)

  Builds everything else under its own temp folder and removes it.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $Repo 'scripts/release/CollectionRecord.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond, [string]$detail = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what$(if ($detail) { ': ' + $detail })" }
}
$shell = (Get-Process -Id $PID).Path
$utf8 = New-Object Text.UTF8Encoding($false)
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-5189-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    # ---------------------------------------------------------------- R ----
    $real = Join-Path $Repo 'records/collection.json'
    Yes 'R0 records/collection.json is there' (Test-Path -LiteralPath $real -PathType Leaf)
    if (Test-Path -LiteralPath $real -PathType Leaf) {
        $out = @(& $shell -NoProfile -File (Join-Path $Repo 'scripts/release/Check-CollectionRecord.ps1') 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
        Yes 'R1 the real record passes Check-CollectionRecord.ps1' ($code -eq 0) (($out | Where-Object { $_ -match 'NO  |STOP' }) -join ' | ')
        $rr = Read-CollectionRecord $real
        $cp = Read-CollectionRecord (Join-Path $Repo 'records/collection-plugins.json')
        Yes 'R2 it names the collection and revision collection-plugins.json does' ([string]$rr.collection -eq [string]$cp.collection -and [int]$rr.revision -eq [int]$cp.revision)
        # The line ends are the checkout's: a Windows runner with
        # core.autocrlf true checks the record out CRLF, and git stores it
        # LF as the writer writes it. The layout is what is held here.
        $text = [IO.File]::ReadAllText($real).Replace("`r`n", "`n")
        Yes 'R3 it is written in the record''s own layout, a mod and a plugin to a line' ($text -ceq (ConvertTo-CollectionRecordText $rr)) 'write it with ConvertTo-CollectionRecordText (New-CollectionRecord.ps1 does)'
        $cpNames = @(@($cp.plugins) | Where-Object { -not (Test-CollectionName $script:CollectionGameOwn $_.name) } | ForEach-Object { ([string]$_.name).ToLowerInvariant() } | Sort-Object)
        $rrNames = @(@($rr.plugins) | Where-Object { -not (Test-CollectionName $script:CollectionOurs $_.name) } | ForEach-Object { ([string]$_.name).ToLowerInvariant() } | Sort-Object)
        $dropNames = @(@($rr.dropped) | Where-Object { $_ } | ForEach-Object { ([string]$_.name).ToLowerInvariant() })
        # A change on its way (merged, not yet followed by the records)
        # adds plugins collection-plugins.json does not have yet, and takes
        # out only the ones its dropped names.
        $gone = @($cpNames | Where-Object { $rrNames -notcontains $_ -and $dropNames -notcontains $_ })
        Yes 'R4 every plugin collection-plugins.json has is still installed, or under dropped for the change on its way' (-not $gone.Count) ($gone -join ', ')
    }

    # ---------------------------------------------------------------- C ----
    function New-Fixture([string]$name, [scriptblock]$change) {
        $root = Join-Path $tmp $name
        New-Item -ItemType Directory -Force -Path (Join-Path $root 'records'), (Join-Path $root 'game/data') | Out-Null
        $r = [pscustomobject][ordered]@{
            version = 1; issue = 5189; what = 'a planted record'; collection = '7essxf'; game = 'skyrimspecialedition'; revision = 6
            mods    = @(
                [pscustomobject][ordered]@{ modId = 100; fileId = 1000; name = 'Alpha'; plugins = @('A.esm', 'L.esl') },
                [pscustomobject][ordered]@{ modId = 200; fileId = 2000; name = 'Beta'; plugins = @('B.esp') },
                [pscustomobject][ordered]@{ modId = 300; fileId = 3000; name = 'Gamma'; plugins = @('C.esp') },
                [pscustomobject][ordered]@{ modId = 192001; fileId = 829844; name = 'Thornswood Content'; plugins = @('Thornswood-Content.esp') }
            )
            plugins = @(
                [pscustomobject][ordered]@{ name = 'A.esm'; master = $true; light = $false; masters = @('Skyrim.esm'); after = @() },
                [pscustomobject][ordered]@{ name = 'L.esl'; master = $true; light = $true; masters = @('Skyrim.esm'); after = @('A.esm') },
                [pscustomobject][ordered]@{ name = 'B.esp'; master = $false; light = $false; masters = @('Skyrim.esm', 'A.esm'); after = @('A.esm') },
                [pscustomobject][ordered]@{ name = 'C.esp'; master = $false; light = $false; masters = @('Skyrim.esm'); after = @('B.esp') },
                [pscustomobject][ordered]@{ name = 'Thornswood-Content.esp'; master = $false; light = $false; masters = @('Skyrim.esm'); after = @('C.esp') }
            )
            dropped = @()
        }
        $perm = [ordered]@{
            version = 1; builtBy = 'planted'; collection = '7essxf'; revision = 6
            mods    = @(
                [ordered]@{ modId = 100; name = 'Alpha'; author = 'a'; files = @(@{ fileId = 1000 }); plugins = @('A.esm', 'L.esl'); page = 'https://www.nexusmods.com/skyrimspecialedition/mods/100?tab=description'; ours = $true; reading = $null },
                [ordered]@{ modId = 200; name = 'Beta'; author = 'b'; files = @(@{ fileId = 2000 }); plugins = @('B.esp'); page = 'https://www.nexusmods.com/skyrimspecialedition/mods/200?tab=description'; reading = [ordered]@{ read = '2026-11-01'; by = 'a planted reading'; collections = 'allowed'; terms = @{ 'Upload permission' = 'yes' } } },
                [ordered]@{ modId = 300; name = 'Gamma'; author = 'c'; files = @(@{ fileId = 3000 }); plugins = @('C.esp'); page = 'https://www.nexusmods.com/skyrimspecialedition/mods/300?tab=description'; ours = $true; reading = $null },
                [ordered]@{ modId = 777; name = 'Unread'; author = 'u'; files = @(@{ fileId = 7770 }); plugins = @('D.esp'); page = 'https://www.nexusmods.com/skyrimspecialedition/mods/777?tab=description'; reading = $null },
                [ordered]@{ modId = 192001; name = 'Thornswood Content'; author = 't'; files = @(@{ fileId = 829844 }); plugins = @('Thornswood-Content.esp'); page = 'https://www.nexusmods.com/skyrimspecialedition/mods/192001?tab=description'; ours = $true; reading = $null }
            )
        }
        $plugins = [ordered]@{ version = 1; builtBy = 'planted'; collection = '7essxf'; revision = 6; plugins = @(
                @($script:CollectionGameOwn + @('A.esm', 'L.esl', 'B.esp', 'C.esp')) | ForEach-Object { [ordered]@{ name = $_; size = 1; sha256 = ('0' * 64) } }) }
        $last = [ordered]@{ version = 1; loadOrder = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', '_ResourcePack.esl', 'A.esm', 'L.esl', 'B.esp', 'C.esp', 'Thornswood-Content.esp') }
        $ctx = [pscustomobject]@{ Record = $r; Permissions = $perm; Plugins = $plugins; Last = $last }
        if ($change) { & $change $ctx }
        [IO.File]::WriteAllText((Join-Path $root 'records/collection.json'), (ConvertTo-CollectionRecordText $ctx.Record), $utf8)
        [IO.File]::WriteAllText((Join-Path $root 'records/collection-permissions.json'), ($ctx.Permissions | ConvertTo-Json -Depth 8), $utf8)
        [IO.File]::WriteAllText((Join-Path $root 'records/collection-plugins.json'), ($ctx.Plugins | ConvertTo-Json -Depth 6), $utf8)
        [IO.File]::WriteAllText((Join-Path $root 'game/data/last-plugin.json'), ($ctx.Last | ConvertTo-Json -Depth 4), $utf8)
        return $root
    }
    function Invoke-Check([string]$root) {
        $o = @(& $shell -NoProfile -File (Join-Path $Repo 'scripts/release/Check-CollectionRecord.ps1') -Root $root -Record (Join-Path $root 'records/collection.json') 2>&1 | ForEach-Object { "$_" })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($o -join "`n") }
    }
    # The checks read the planted records, and Check-CollectionRecord.ps1 and
    # collection-permissions.js of this checkout.
    function Find($c, [string]$name) { return @($c.Record.plugins | Where-Object { $_.name -eq $name })[0] }

    $r = Invoke-Check (New-Fixture 'good' $null)
    Yes 'C1 a good record: YES' ($r.Code -eq 0 -and $r.Out -match 'YES') $r.Out

    $r = Invoke-Check (New-Fixture 'missing' { param($c) (Find $c 'C.esp').after = @('Nowhere.esp') })
    Yes 'C2 a rule naming a plugin the record does not install: NO' ($r.Code -eq 1 -and $r.Out -match 'C\.esp is to load after Nowhere\.esp, which the record does not install') $r.Out

    # Revision 6's shape: its own list leaves a plugin out, so it is installed
    # switched off, and the servers load it, as the launcher's plugin list
    # switches it on. A rule may name it and chain through it, and it is not
    # taken out.
    $r = Invoke-Check (New-Fixture 'off' { param($c)
            $m = @($c.Record.mods)
            $c.Record.mods = @($m[0], $m[1], $m[2], [pscustomobject][ordered]@{ modId = 400; fileId = 4000; name = 'Delta'; plugins = @('Off.esp') }, $m[3])
            $c.Record.plugins = @($c.Record.plugins) + @([pscustomobject][ordered]@{ name = 'Off.esp'; enabled = $false; master = $false; light = $false; masters = @('Skyrim.esm'); after = @('B.esp') })
            (Find $c 'C.esp').after = @('Off.esp')
            $pm = @($c.Permissions.mods)
            $c.Permissions.mods = @($pm[0], $pm[1], $pm[2], [ordered]@{ modId = 400; name = 'Delta'; author = 'd'; files = @(@{ fileId = 4000 }); plugins = @('Off.esp'); page = 'https://www.nexusmods.com/skyrimspecialedition/mods/400?tab=description'; ours = $true; reading = $null }, $pm[3], $pm[4])
            $c.Plugins.plugins = @($c.Plugins.plugins) + @([ordered]@{ name = 'Off.esp'; size = 1; sha256 = ('0' * 64) })
            $c.Last.loadOrder = @('Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm', '_ResourcePack.esl', 'A.esm', 'L.esl', 'B.esp', 'Off.esp', 'C.esp', 'Thornswood-Content.esp') })
    Yes 'C2b a plugin installed switched off that the servers load: a rule may name it and chain through it, and it is not taken out' ($r.Code -eq 0 -and $r.Out -match 'YES') $r.Out

    # #4603: the layout of a revision puts the plugins switched off after the
    # list, in name order, and the draft is held to the record in that order.
    # Revision 7's first draft was discarded for a new plugin written below one.
    $offBelow = { param($c)
        $p = @($c.Record.plugins)
        $c.Record.plugins = @($p[0], $p[1], $p[2], $p[3], [pscustomobject][ordered]@{ name = 'Off.esp'; enabled = $false; master = $false; light = $false; masters = @('Skyrim.esm'); after = @() }, $p[4])
        $m = @($c.Record.mods)
        $c.Record.mods = @($m[0], $m[1], $m[2], [pscustomobject][ordered]@{ modId = 400; fileId = 4000; name = 'Delta'; plugins = @('Off.esp') }, $m[3])
        $pm = @($c.Permissions.mods)
        $c.Permissions.mods = @($pm[0], $pm[1], $pm[2], [ordered]@{ modId = 400; name = 'Delta'; author = 'd'; files = @(@{ fileId = 4000 }); plugins = @('Off.esp'); page = 'https://www.nexusmods.com/skyrimspecialedition/mods/400?tab=description'; ours = $true; reading = $null }, $pm[3], $pm[4])
        $c.Plugins.plugins = @($c.Plugins.plugins) + @([ordered]@{ name = 'Off.esp'; size = 1; sha256 = ('0' * 64) }) }
    $r = Invoke-Check (New-Fixture 'off-below' $offBelow)
    Yes 'C2c a plugin of the list below one switched off: NO, saying where the layout puts it' ($r.Code -eq 1 -and $r.Out -match 'Thornswood-Content\.esp is below Off\.esp, which is switched off') $r.Out
    $r = Invoke-Check (New-Fixture 'off-order' { param($c) & $offBelow $c
            $p = @($c.Record.plugins)
            $c.Record.plugins = @($p[0], $p[1], $p[2], $p[3], $p[5], $p[4], [pscustomobject][ordered]@{ name = 'Aoff.esp'; enabled = $false; master = $false; light = $false; masters = @('Skyrim.esm'); after = @() })
            $m = @($c.Record.mods); $m[3].plugins = @('Off.esp', 'Aoff.esp')
            $c.Permissions.mods[3].plugins = @('Off.esp', 'Aoff.esp')
            $c.Plugins.plugins = @($c.Plugins.plugins) + @([ordered]@{ name = 'Aoff.esp'; size = 1; sha256 = ('0' * 64) }) })
    Yes 'C2c and plugins switched off out of name order: NO, giving the order' ($r.Code -eq 1 -and $r.Out -match 'not in name order, the order the layout of the revision gives them: Aoff\.esp, Off\.esp' -and $r.Out -notmatch 'is below') $r.Out

    # #4603: held to a base whose record already has a FOMOD file, the file
    # keeps its answers, as the published entry carries them.
    $fb = New-Fixture 'fomod-base' { param($c) $c.Record.mods[1] | Add-Member -NotePropertyName choices -NotePropertyValue ([pscustomobject]@{ type = 'fomod'; options = @([pscustomobject]@{ name = 'Main'; groups = @([pscustomobject]@{ name = 'Pick'; choices = @([pscustomobject]@{ name = 'Full'; idx = 0 }) }) }) }) }
    $gitOk = $true
    try {
        foreach ($g in @(@('init', '-q'), @('add', '-A'), @('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base'))) { & git -C $fb @g 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { $gitOk = $false } }
    } catch { $gitOk = $false }
    if ($gitOk) {
        $o = @(& $shell -NoProfile -File (Join-Path $Repo 'scripts/release/Check-CollectionRecord.ps1') -Root $fb -Record (Join-Path $fb 'records/collection.json') -Base HEAD 2>&1 | ForEach-Object { "$_" }) -join "`n"
        Yes 'C2d held to a base that has a FOMOD file, the file keeps its answers: no change for Nexus' ($LASTEXITCODE -eq 0 -and $o -match 'against HEAD: no change for Nexus' -and $o -notmatch 'gives choices that are not') $o
    } else { Write-Host 'SKIP  C2d needs git' }

    $r = Invoke-Check (New-Fixture 'broken' { param($c)
            $p = @($c.Record.plugins); $c.Record.plugins = @($p[0], $p[1], $p[3], $p[2], $p[4]) })
    Yes 'C3 a list that breaks a rule: NO' ($r.Code -eq 1 -and $r.Out -match 'the list puts C\.esp above B\.esp') $r.Out

    $r = Invoke-Check (New-Fixture 'loop' { param($c) (Find $c 'L.esl').after = @('B.esp')
            $p = @($c.Record.plugins); $c.Record.plugins = @($p[0], $p[2], $p[1], $p[3], $p[4]) })
    Yes 'C4 an .esl to load after a plugin that is not a master loops with the game''s order: NO' ($r.Code -eq 1 -and $r.Out -match 'cyclic interaction' -and $r.Out -match 'L\.esl loads as a master and B\.esp does not') $r.Out

    $r = Invoke-Check (New-Fixture 'floats' { param($c) (Find $c 'C.esp').after = @('A.esm') })
    Yes 'C5 a full plugin no chain of rules holds under the one above it: NO' ($r.Code -eq 1 -and $r.Out -match 'no rule keeps C\.esp after B\.esp') $r.Out

    $r = Invoke-Check (New-Fixture 'unread' { param($c)
            $c.Record.mods = @($c.Record.mods | Where-Object { $_.modId -lt 777 }) + [pscustomobject][ordered]@{ modId = 777; fileId = 7770; name = 'Unread'; plugins = @('D.esp') } + @($c.Record.mods | Where-Object { $_.modId -gt 777 })
            $c.Record.plugins = @($c.Record.plugins) + [pscustomobject][ordered]@{ name = 'D.esp'; master = $false; light = $false; masters = @('Skyrim.esm'); after = @('Thornswood-Content.esp') } })
    Yes 'C6 a mod whose page has not been read: NO, naming the page' ($r.Code -eq 1 -and $r.Out -match 'mod 777 \(Unread\): its page has not been read') $r.Out
    Yes 'C6 and the new plugin at the end of its kind moves nothing' ($r.Out -notmatch 'to another index') $r.Out
    Yes 'C6 and the check says which plugin the change adds' ($r.Out -match 'NOTE  plugins revision 6 does not have: D\.esp') $r.Out

    $takeC = { param($c)
        $c.Record.mods = @($c.Record.mods | Where-Object { $_.modId -ne 300 })
        $c.Record.plugins = @($c.Record.plugins | Where-Object { $_.name -ne 'C.esp' })
        (Find $c 'Thornswood-Content.esp').after = @('B.esp') }
    $r = Invoke-Check (New-Fixture 'drop' $takeC)
    Yes 'C7 a plugin the servers load taken out with no dropped line: NO' ($r.Code -eq 1 -and $r.Out -match 'the servers load C\.esp and the record takes it out') $r.Out
    $r = Invoke-Check (New-Fixture 'dropped' { param($c) & $takeC $c
            $c.Record.dropped = @([pscustomobject][ordered]@{ name = 'C.esp'; mod = 300; why = 'a planted plugin whose forms no world stored, read from its header' }) })
    Yes 'C7 and YES once dropped says why' ($r.Code -eq 0) $r.Out
    Yes 'C7 and the check says the change takes it out' ($r.Out -match 'takes out: C\.esp') $r.Out

    $newMaster = { param($c)
        $c.Record.mods = @($c.Record.mods | Where-Object { $_.modId -lt 400 }) + [pscustomobject][ordered]@{ modId = 400; fileId = 4000; name = 'New master'; plugins = @('N.esm') } + @($c.Record.mods | Where-Object { $_.modId -ge 400 })
        $p = @($c.Record.plugins)
        $n = [pscustomobject][ordered]@{ name = 'N.esm'; master = $true; light = $false; masters = @('Skyrim.esm'); after = @('A.esm') }
        $c.Record.plugins = @($p[0], $p[1], $n) + @($p[2..4])
        (Find $c 'B.esp').after = @('N.esm')
        $c.Permissions.mods = @($c.Permissions.mods) + [ordered]@{ modId = 400; name = 'New master'; author = 'n'; files = @(@{ fileId = 4000 }); plugins = @('N.esm'); page = 'https://www.nexusmods.com/skyrimspecialedition/mods/400?tab=description'; ours = $true; reading = $null }
        $c.Permissions.mods = @($c.Permissions.mods | Sort-Object { $_.modId }) }
    $r = Invoke-Check (New-Fixture 'shift' $newMaster)
    Yes 'C8 a new master moves the full plugins after it to another index: NO' ($r.Code -eq 1 -and $r.Out -match 'moves 3 full plugin\(s\) the servers load to another index \(B\.esp from 6 to 7') $r.Out
    $r = Invoke-Check (New-Fixture 'wipe' { param($c) & $newMaster $c; $c.Record | Add-Member -NotePropertyName wipe -NotePropertyValue 'Patrick, a planted answer' })
    Yes 'C8 and YES once wipe names the decision' ($r.Code -eq 0) $r.Out

    $r = Invoke-Check (New-Fixture 'swap' { param($c)
            $p = @($c.Record.plugins); $c.Record.plugins = @($p[0], $p[1], $p[3], $p[2], $p[4])
            (Find $c 'C.esp').after = @('A.esm'); (Find $c 'B.esp').after = @('C.esp'); (Find $c 'Thornswood-Content.esp').after = @('B.esp') })
    Yes 'C9 two full plugins the servers load swapped: NO' ($r.Code -eq 1 -and $r.Out -match 'C\.esp from 7 to 6' -and $r.Out -match 'B\.esp from 6 to 7') $r.Out

    $r = Invoke-Check (New-Fixture 'revision' { param($c) $c.Record.revision = 7 })
    Yes 'C10 a revision that is not collection-plugins.json''s: NO' ($r.Code -eq 1 -and $r.Out -match 'follows revision 7, and collection-plugins\.json is revision 6') $r.Out

    $r = Invoke-Check (New-Fixture 'light' { param($c) (Find $c 'L.esl').light = $false })
    Yes 'C11 an .esl written as not light: NO' ($r.Code -eq 1 -and $r.Out -match 'L\.esl: the game loads an \.esl as light') $r.Out

    $r = Invoke-Check (New-Fixture 'orphan' { param($c) $c.Record.mods[1].plugins = @() })
    Yes 'C12 a plugin on the list that no file puts in Data: NO' ($r.Code -eq 1 -and $r.Out -match 'B\.esp is on the plugin list and no file puts it in Data') $r.Out

    # ---------------------------------------------------------------- S ----
    $pubJson = [pscustomobject]@{
        mods        = @(
            [pscustomobject]@{ name = 'one'; source = [pscustomobject]@{ type = 'nexus'; modId = 1; fileId = 10 } },
            [pscustomobject]@{ name = 'two'; source = [pscustomobject]@{ type = 'nexus'; modId = 2; fileId = 20 } },
            [pscustomobject]@{ name = 'three'; source = [pscustomobject]@{ type = 'nexus'; modId = 3; fileId = 30 } },
            [pscustomobject]@{ name = 'four a'; source = [pscustomobject]@{ type = 'nexus'; modId = 4; fileId = 40 } },
            [pscustomobject]@{ name = 'four b'; source = [pscustomobject]@{ type = 'nexus'; modId = 4; fileId = 41 } })
        pluginRules = [pscustomobject]@{ plugins = @([pscustomobject]@{ name = 'b.esp'; after = @('a.esm') }, [pscustomobject]@{ name = 'c.esp'; after = @('b.esp') }) }
    }
    $rec = [pscustomobject]@{
        mods    = @(
            [pscustomobject]@{ modId = 1; fileId = 10; name = 'one'; plugins = @('A.esm') },
            [pscustomobject]@{ modId = 2; fileId = 21; name = 'two'; plugins = @('B.esp'); dropPatch = @('B.esp') },
            [pscustomobject]@{ modId = 4; fileId = 40; name = 'four a'; plugins = @('C.esp') },
            [pscustomobject]@{ modId = 4; fileId = 41; name = 'four b'; plugins = @() },
            [pscustomobject]@{ modId = 5; fileId = 50; name = 'five'; plugins = @('E.esp') })
        plugins = @(
            [pscustomobject]@{ name = 'A.esm'; after = @() },
            [pscustomobject]@{ name = 'B.esp'; after = @('A.esm') },
            [pscustomobject]@{ name = 'C.esp'; after = @('A.esm') },
            [pscustomobject]@{ name = 'E.esp'; after = @('C.esp') })
    }
    $cs = Get-CollectionChangeSet $rec $pubJson
    Yes 'S1 a new file is -Add, with its plugins'' rules' (@($cs.Add).Count -eq 1 -and $cs.Add[0].modId -eq 5 -and $cs.Add[0].fileId -eq 50 -and $cs.Add[0].plugins[0].name -eq 'E.esp' -and ($cs.Add[0].plugins[0].after -join ',') -eq 'C.esp')
    Yes 'S2 a mod gone whole is -Remove' ((@($cs.Remove) -join ',') -eq '3')
    Yes 'S3 a mod''s one file moved is -Mod and -FileId, with its dropPatch' (@($cs.Move).Count -eq 1 -and $cs.Move[0].modId -eq 2 -and $cs.Move[0].fileId -eq 21 -and ($cs.Move[0].dropPatch -join ',') -eq 'B.esp')
    Yes 'S4 a changed rule is -Rule, and a rule kept is not' (@($cs.Rule).Count -eq 1 -and $cs.Rule[0].name -eq 'C.esp' -and ($cs.Rule[0].after -join ',') -eq 'A.esm')
    Yes 'S5 and nothing in it is refused' (-not @($cs.Problems).Count) (@($cs.Problems) -join ' | ')
    Yes 'S6 the change reads as a line each' ((@(Format-CollectionChangeSet $cs) -join "`n") -match 'add mod 5 file 50: E\.esp after C\.esp' -and (@(Format-CollectionChangeSet $cs) -join "`n") -match 'move mod 2 to file 21, dropping its patch of B\.esp')
    $rec2 = [pscustomobject]@{ mods = @($rec.mods | Where-Object { -not ($_.modId -eq 4 -and $_.fileId -eq 41) } | ForEach-Object { if ($_.modId -eq 2) { [pscustomobject]@{ modId = 2; fileId = 20; name = 'two'; plugins = @('B.esp'); dropPatch = @('B.esp') } } else { $_ } }); plugins = $rec.plugins }
    $cs2 = Get-CollectionChangeSet $rec2 $pubJson
    Yes 'S7 one of a mod''s two files taken out is refused' (@($cs2.Problems | Where-Object { $_ -match 'keeps its others' }).Count -eq 1) (@($cs2.Problems) -join ' | ')
    Yes 'S8 a dropPatch on a file that does not move is refused' (@($cs2.Problems | Where-Object { $_ -match 'names dropPatch and its file does not move' }).Count -eq 1) (@($cs2.Problems) -join ' | ')
    $same = [pscustomobject]@{ mods = @($pubJson.mods | ForEach-Object { [pscustomobject]@{ modId = $_.source.modId; fileId = $_.source.fileId; name = $_.name; plugins = @() } }); plugins = @([pscustomobject]@{ name = 'B.esp'; after = @('A.esm') }, [pscustomobject]@{ name = 'C.esp'; after = @('B.esp') }) }
    Yes 'S9 a record that is the published revision asks for nothing' ((Get-CollectionChangeSet $same $pubJson).Empty)
    # A FOMOD's answers (#5189): they go with a file the record adds, the
    # record writes them on the mod's line, and a kept or moved file's are
    # the published revision's.
    $ch = '{"type":"fomod","options":[{"name":"Options","groups":[{"name":"Add-ons","choices":[{"name":"Dawnguard","idx":0}]}]}]}' | ConvertFrom-Json
    $rec3 = [pscustomobject]@{ mods = @($rec.mods | ForEach-Object { if ($_.modId -eq 5) { [pscustomobject]@{ modId = 5; fileId = 50; name = 'five'; plugins = @('E.esp'); choices = $ch } } else { $_ } }); plugins = $rec.plugins }
    $cs3 = Get-CollectionChangeSet $rec3 $pubJson
    Yes 'S10 a new file''s choices go with it to -Add' ($cs3.Add[0].choices.options[0].groups[0].choices[0].name -eq 'Dawnguard' -and -not @($cs3.Problems).Count) (@($cs3.Problems) -join ' | ')
    $rec4 = [pscustomobject]@{ mods = @($rec.mods | ForEach-Object { if ($_.modId -eq 1) { [pscustomobject]@{ modId = 1; fileId = 10; name = 'one'; plugins = @('A.esm'); choices = $ch } } elseif ($_.modId -eq 2) { [pscustomobject]@{ modId = 2; fileId = 21; name = 'two'; plugins = @('B.esp'); choices = $ch; dropPatch = @('B.esp') } } else { $_ } }); plugins = $rec.plugins }
    $cs4 = Get-CollectionChangeSet $rec4 $pubJson
    Yes 'S11 choices on a kept file that are not the published entry''s are refused' (@($cs4.Problems | Where-Object { $_ -match 'mod 1 file 10 gives choices that are not the published revision''s' }).Count -eq 1) (@($cs4.Problems) -join ' | ')
    Yes 'S12 and so are choices on a file that moves' (@($cs4.Problems | Where-Object { $_ -match 'mod 2 moves to file 21 with choices' }).Count -eq 1) (@($cs4.Problems) -join ' | ')
    $pubJson.mods[0] | Add-Member -NotePropertyName choices -NotePropertyValue $ch
    $cs5 = Get-CollectionChangeSet ([pscustomobject]@{ mods = @($rec4.mods | Where-Object { $_.modId -ne 2 }); plugins = $rec.plugins }) $pubJson
    Yes 'S13 a kept file''s choices that say the published ones again are fine' (-not @($cs5.Problems | Where-Object { $_ -match 'choices' }).Count) (@($cs5.Problems) -join ' | ')
    $pubJson.mods[0].PSObject.Properties.Remove('choices')
    $rr5 = [pscustomobject]@{ version = 1; issue = 5189; what = 'w'; collection = '7essxf'; game = 'skyrimspecialedition'; revision = 6; mods = @([pscustomobject]@{ modId = 5; fileId = 50; name = 'five'; plugins = @('E.esp'); choices = $ch }); plugins = @([pscustomobject]@{ name = 'E.esp'; master = $false; light = $false; masters = @(); after = @('Skyrim.esm') }); dropped = @() }
    $t5 = ConvertTo-CollectionRecordText $rr5
    Yes 'S14 the record writes a mod''s choices on its line, and they read back the same' ($t5 -match '"choices": \{ "type": "fomod", "options": \[\{ "name": "Options", "groups": \[\{ "name": "Add-ons", "choices": \[\{ "name": "Dawnguard", "idx": 0 \}\] \}\] \}\] \}' -and (ConvertTo-CollectionRecordText ($t5 | ConvertFrom-Json)) -ceq $t5 -and -not @(Get-CollectionRecordShapeProblems ($t5 | ConvertFrom-Json)).Count) (@(Get-CollectionRecordShapeProblems ($t5 | ConvertFrom-Json)) -join ' | ')
    $bad = $t5.Replace('"idx": 0', '"idx": -1')
    Yes 'S15 choices not shaped as Vortex writes them are refused' (@(Get-CollectionRecordShapeProblems ($bad | ConvertFrom-Json) | Where-Object { $_ -match 'mod 5 file 50: a choice in group "Add-ons"' }).Count -eq 1)

    # ---------------------------------------------------------------- L ----
    # A plugin file with a TES4 header: flags (0x1 master, 0x200 light) and a
    # MAST field for each master, then DATA, as the game writes them.
    function Write-Plugin([string]$path, [uint32]$flags, [string[]]$masters) {
        $fields = New-Object IO.MemoryStream
        $add = { param([string]$type, [byte[]]$data) $t = [Text.Encoding]::ASCII.GetBytes($type); $fields.Write($t, 0, 4); $l = [BitConverter]::GetBytes([uint16]$data.Length); $fields.Write($l, 0, 2); $fields.Write($data, 0, $data.Length) }
        & $add 'HEDR' (New-Object byte[] 12)
        foreach ($m in $masters) { & $add 'MAST' ([Text.Encoding]::GetEncoding(1252).GetBytes($m + [char]0)); & $add 'DATA' (New-Object byte[] 8) }
        $body = $fields.ToArray()
        $h = New-Object byte[] 24
        [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($h, 0)
        [BitConverter]::GetBytes([uint32]$body.Length).CopyTo($h, 4)
        [BitConverter]::GetBytes($flags).CopyTo($h, 8)
        [IO.File]::WriteAllBytes($path, [byte[]]($h + $body))
    }
    $lay = Join-Path $tmp 'layout'
    New-Item -ItemType Directory -Force -Path (Join-Path $lay 'plugins') | Out-Null
    Write-Plugin (Join-Path $lay 'plugins/A.esm') 1 @('Skyrim.esm')
    Write-Plugin (Join-Path $lay 'plugins/L.esp') 0x200 @('Skyrim.esm', 'A.esm')
    Write-Plugin (Join-Path $lay 'plugins/B.esp') 0 @('Skyrim.esm', 'A.esm')
    Write-Plugin (Join-Path $lay 'plugins/Off.esp') 0 @('Skyrim.esm')
    $layoutObj = [ordered]@{
        schema = 1; collection = [ordered]@{ slug = '7essxf'; domain = 'skyrimspecialedition'; revision = 7 }
        mods = @([ordered]@{ name = 'Beta'; modId = 200; fileId = 2000 }, [ordered]@{ name = 'Alpha'; modId = 100; fileId = 1000 })
        plugins = @([ordered]@{ name = 'A.esm'; enabled = $true }, [ordered]@{ name = 'L.esp'; enabled = $true }, [ordered]@{ name = 'B.esp'; enabled = $true }, [ordered]@{ name = 'Off.esp'; enabled = $false })
        pluginRules = @([ordered]@{ name = 'l.esp'; after = @('a.esm') }, [ordered]@{ name = 'b.esp'; after = @('a.esm', 'skyrim.esm') })
    }
    [IO.File]::WriteAllText((Join-Path $lay 'layout.json'), ($layoutObj | ConvertTo-Json -Depth 5), $utf8)
    [IO.File]::WriteAllText((Join-Path $lay 'files.txt'), ("# header`r`n" + (@("aa`t1`t1000`tData\A.esm", "aa`t1`t1000`tData\L.esp", "aa`t1`t1000`tData\textures\x.dds", "aa`t1`t2000`tData\B.esp", "aa`t1`t2000`tData\Off.esp") -join "`r`n") + "`r`n"), $utf8)
    $made = New-CollectionRecordFromLayout $lay
    $pa = @($made.plugins | Where-Object name -eq 'A.esm')[0]
    $pl = @($made.plugins | Where-Object name -eq 'L.esp')[0]
    $pb = @($made.plugins | Where-Object name -eq 'B.esp')[0]
    $po = @($made.plugins | Where-Object name -eq 'Off.esp')[0]
    Yes 'L1 facts come from each header: the 0x1 flag is a master, 0x200 light, MAST its masters' ($pa.master -and -not $pa.light -and $pl.light -and -not $pl.master -and ($pb.masters -join ',') -eq 'Skyrim.esm,A.esm')
    Yes 'L2 rules are in the list''s own spelling, base masters as the game spells them' (($pb.after -join ',') -eq 'A.esm,Skyrim.esm' -and ($pl.after -join ',') -eq 'A.esm')
    Yes 'L3 a plugin switched off says so, and the others say nothing' ($po.enabled -eq $false -and ((Get-CollectionKeys $pa) -notcontains 'enabled'))
    Yes 'L4 each file''s plugins come from files.txt, in the list''s order, and mods in modId order' ($made.mods[0].modId -eq 100 -and ($made.mods[0].plugins -join ',') -eq 'A.esm,L.esp' -and ($made.mods[1].plugins -join ',') -eq 'B.esp,Off.esp')
    Yes 'L5 the revision is the layout''s and nothing is dropped' ($made.revision -eq 7 -and -not @($made.dropped).Count)
    $t1 = ConvertTo-CollectionRecordText $made
    $f = Join-Path $tmp 'made.json'
    [IO.File]::WriteAllText($f, $t1, $utf8)
    $back = Read-CollectionRecord $f
    Yes 'L6 its text reads back to the same bytes' ((ConvertTo-CollectionRecordText $back) -ceq $t1)
    Yes 'L7 a mod and a plugin to a line' (@($t1 -split "`n" | Where-Object { $_ -match '"modId": 100, "fileId": 1000' }).Count -eq 1 -and @($t1 -split "`n" | Where-Object { $_ -match '^\s+\{ "name": "B\.esp", "master": false' }).Count -eq 1)
    Yes 'L8 two records alike compare alike, whatever their mod names' (-not @(Compare-CollectionRecord $back $made).Count)
    $other = Read-CollectionRecord $f
    @($other.plugins | Where-Object name -eq 'L.esp')[0].light = $false
    @($other.plugins | Where-Object name -eq 'B.esp')[0].after = @('L.esp')
    @($other.plugins | Where-Object name -eq 'A.esm')[0].masters = @()
    $other.mods[0].name = 'renamed'
    $diff = @(Compare-CollectionRecord $other $made)
    Yes 'L9 a light flag, a master and a rule that part are each named' (@($diff | Where-Object { $_ -match 'L\.esp: the record says light False' }).Count -and @($diff | Where-Object { $_ -match 'B\.esp: the record says it loads after \[L\.esp\]' }).Count -and @($diff | Where-Object { $_ -match 'A\.esm: the record says its masters are \[\]' }).Count -and -not @($diff | Where-Object { $_ -match 'renamed' }).Count) ($diff -join ' | ')
    $other2 = Read-CollectionRecord $f
    $p2 = @($other2.plugins); $other2.plugins = @($p2[1], $p2[0], $p2[2], $p2[3])
    Yes 'L10 an order that parts is named, with the first place it parts' (@(Compare-CollectionRecord $other2 $made | Where-Object { $_ -match 'at 1 the record has L\.esp, the draft A\.esm' }).Count -eq 1)
    Remove-Item -LiteralPath (Join-Path $lay 'plugins/B.esp')
    $threw = ''
    try { [void](New-CollectionRecordFromLayout $lay) } catch { $threw = $_.Exception.Message }
    Yes 'L11 a plugin the layout did not keep stops it, naming the plugin' ($threw -match 'has no B\.esp') $threw
    $line = ConvertTo-CollectionPluginLine (Join-Path $lay 'plugins/L.esp')
    Yes 'L12 a plugin file gives the record''s line for a pull request to paste, its rule left to fill in' ($line -ceq '    { "name": "L.esp", "master": false, "light": true, "masters": ["Skyrim.esm", "A.esm"], "after": [] },') $line
    Yes 'L13 a file that is not a plugin gives none' ($null -eq (ConvertTo-CollectionPluginLine (Join-Path $lay 'layout.json')))

    # ---------------------------------------------------------------- P ----
    $sources = @(Read-CollectionLastRecipeSources (Join-Path $Repo 'game/data/last-plugin.recipe'))
    $manifest = Read-CollectionRecord (Join-Path $Repo 'game/data/last-plugin.json')
    Yes 'P1 the Last recipe''s sources read from the recipe are as many as last-plugin.json says' ($sources.Count -eq [int]$manifest.recipe.sources -and $sources[0].Name -eq 'Skyrim.esm' -and $sources[0].Sha256 -match '^[0-9a-f]{64}$')

    # ---------------------------------------------------------------- W ----
    $wfPath = Join-Path $Repo '.github/workflows/collection-record.yml'
    Yes 'W0 .github/workflows/collection-record.yml is there' (Test-Path -LiteralPath $wfPath)
    if (Test-Path -LiteralPath $wfPath) {
        $wf = [IO.File]::ReadAllText($wfPath)
        Yes 'W1 a push to main that changes the record starts it' ($wf -match "(?s)push:\s+branches:\s+\[main\]\s+paths:\s+-\s+'records/collection\.json'")
        Yes 'W2 its job runs on main alone, in the desk environment' ($wf -match "if: github\.ref == 'refs/heads/main'" -and $wf -match 'environment: desk')
        Yes 'W3 one Nexus run at a time, with nexus-run.yml''s' ($wf -match 'group: nexus-run' -and $wf -match 'cancel-in-progress: false')
        Yes 'W4 it runs Publish-CollectionRecord.ps1 with the key in that step alone' ($wf -match 'Publish-CollectionRecord\.ps1' -and ([regex]::Matches($wf, 'secrets\.NEXUS_API_KEY')).Count -eq 1)
    }

    # ---------------------------------------------------------------- D ----
    $pubPath = Join-Path $Repo 'scripts/release/Publish-CollectionRecord.ps1'
    Yes 'D0 Publish-CollectionRecord.ps1 is there' (Test-Path -LiteralPath $pubPath)
    if (Test-Path -LiteralPath $pubPath) {
        $pub = [IO.File]::ReadAllText($pubPath)
        $iDraft = $pub.IndexOf('Invoke-RecordStep ''New-NexusRevision''')
        $iLay = $pub.IndexOf('Invoke-RecordStep ''Install-NexusRevision''')
        $iCmp = $pub.IndexOf('Compare-CollectionRecord $want $got')
        $iDiscard = $pub.IndexOf('Discard = $draft')
        $iPublish = $pub.IndexOf('Publish = $draft')
        Yes 'D1 it stops on a record behind or ahead of Nexus before anything is drafted' ($pub -match 'NexusPublished\.ps1' -and $pub.IndexOf('NexusPublished.ps1') -lt $iDraft)
        Yes 'D2 it drafts, lays the draft out, then holds it to the record' ($iDraft -gt 0 -and $iLay -gt $iDraft -and $iCmp -gt $iLay)
        Yes 'D3 a draft that does not match is discarded, and only a match is published' ($iDiscard -gt $iCmp -and $iPublish -gt $iDiscard)
        Yes 'D4 nothing it ran prints to the public log but its STOP lines' ($pub -match 'STOP\.' -and $pub -notmatch 'Write-Host \$inner')
    }
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
