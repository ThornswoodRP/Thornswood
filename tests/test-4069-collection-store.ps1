<#
  test-4069-collection-store.ps1

      pwsh -NoProfile -File .\tests\test-4069-collection-store.ps1

  A server moves to a new collection revision with nothing of One's (#4069).
  This holds:
    1. CollectionStore.ps1: the box's store of the record's revision is made
       only from plugins that are records\collection-plugins.json's bytes,
       of the revision and collection it names; one that is not stops it and
       nothing goes in; a whole store is used again with no fetch; a store
       that is no longer the record's is fetched again. What SkyUI's menu
       check reads goes in with them, each at the bytes the layout's
       files.txt names for its path, and a store without it, or made before
       it held it, is fetched again.
    2. Invoke-ThornswoodCollectionFetch runs Nexus-Run's
       Install-NexusRevision -KeepPlugins for the record's revision with the
       box admin App's token in GH_TOKEN for that run alone, and takes the
       one record the run left; a run that does not end 0 stops it.
    3. Install-NexusRevision -KeepPlugins goes with -Record alone, and keeps
       the copy each plugin's place is won by, held to files.txt's sha256,
       and the same of what SkyUI's menu check reads, with node saying which
       archives hold any of it (Check-SkyUIMenus.js --holding).
    4. The verbs: Nexus-Run lets Install-NexusRevision take -KeepPlugins, and
       the deploy gate lets Deploy-DevGamemode take -LoadOrder -FromRecord.
    5. Deploy-DevGamemode -FromRecord: the order is last-plugin.json's, the
       plugins come from the store, it goes with -LoadOrder and never with
       -Dist, it writes the order over the dev server's, and what it may
       drop is records\collection-dropped.json's, never the gate line's.
  Nothing outside the temp folder is touched, and nothing is reached.
#>
[CmdletBinding()]
param()
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
function Text([string]$rel) { return [IO.File]::ReadAllText((Join-Path $Repo $rel)) }
function Sha-Bytes([byte[]]$b) { return ([BitConverter]::ToString([Security.Cryptography.SHA256]::HashData($b))).Replace('-', '').ToLowerInvariant() }
function Sha([string]$p) { return ([BitConverter]::ToString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($p)))).Replace('-', '').ToLowerInvariant() }
$utf8 = New-Object Text.UTF8Encoding($false)

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4069-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
    . (Join-Path $Repo 'scripts\deploy\CollectionStore.ps1')

    # ---- 1. the store ------------------------------------------------------
    # Two plugins of the collection and a record that names them at their
    # bytes, as New-CollectionPluginRecord.ps1 writes one.
    $src = Join-Path $tmp 'src'
    New-Item -ItemType Directory -Path $src -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $src 'Alpha.esp'), [byte[]](1..200 | ForEach-Object { $_ % 256 }))
    [IO.File]::WriteAllBytes((Join-Path $src 'beta.esl'), [byte[]](1..90 | ForEach-Object { ($_ * 7) % 256 }))
    function Write-Record([string]$path, [int]$rev, $rows) {
        $doc = [ordered]@{ version = 1; builtBy = 'scripts/mods/New-CollectionPluginRecord.ps1'; collection = '7essxf'; revision = $rev; plugins = @($rows) }
        [IO.File]::WriteAllText($path, ($doc | ConvertTo-Json -Depth 5), $utf8)
    }
    $rows = @(
        [ordered]@{ name = 'Alpha.esp'; size = 200; sha256 = (Sha (Join-Path $src 'Alpha.esp')) },
        [ordered]@{ name = 'beta.esl'; size = 90; sha256 = (Sha (Join-Path $src 'beta.esl')) },
        [ordered]@{ name = 'Skyrim.esm'; size = 5; sha256 = ('0' * 64) }
    )
    $record = Join-Path $tmp 'collection-plugins.json'
    Write-Record $record 6 $rows
    $root = Join-Path $tmp 'store'
    $count = @{ n = 0 }
    # What SkyUI's menu check reads, as the layout places it.
    $menuBytes = [ordered]@{
        'Data\SkyUI_SE.bsa'                  = [byte[]](1..64 | ForEach-Object { ($_ * 3) % 256 })
        'Data\Interface\skyui\itemcard.swf' = [byte[]](1..32 | ForEach-Object { ($_ * 5) % 256 })
    }
    # A fetch as the box's brings it back: a layout record with its plugins,
    # its menus and its files.txt. $swapMenu writes other bytes at a path
    # after files.txt is written; $noMenus leaves the menus folder out.
    function New-Fetch([int]$rev, [string]$slug, [hashtable]$swap, [hashtable]$swapMenu = @{}, [bool]$noMenus = $false) {
        return {
            param($w, $h)
            $count.n++
            $rec = Join-Path $w 'record'
            $pd = Join-Path $rec 'plugins'
            New-Item -ItemType Directory -Path $pd -Force | Out-Null
            foreach ($f in Get-ChildItem -LiteralPath $src -File) { [IO.File]::Copy($f.FullName, (Join-Path $pd $f.Name), $true) }
            [IO.File]::WriteAllBytes((Join-Path $pd 'Thornswood-Content.esp'), [byte[]](7, 7, 7))
            foreach ($k in $swap.Keys) { [IO.File]::WriteAllBytes((Join-Path $pd $k), [byte[]]$swap[$k]) }
            $ft = @('# Install-NexusRevision.ps1: collection ' + $slug + ' revision ' + $rev + '. sha256, size, Nexus file id, path in the game folder.')
            foreach ($k in $menuBytes.Keys) {
                $b = [byte[]]$menuBytes[$k]
                $ft += ((Sha-Bytes $b) + "`t" + $b.Length + "`t" + '1000' + "`t" + $k)
                if ($noMenus) { continue }
                $to = Join-Path (Join-Path $rec 'menus') ($k.Replace('\', [string][IO.Path]::DirectorySeparatorChar))
                New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
                [IO.File]::WriteAllBytes($to, $(if ($swapMenu.ContainsKey($k)) { [byte[]]$swapMenu[$k] } else { $b }))
            }
            [IO.File]::WriteAllLines((Join-Path $rec 'files.txt'), [string[]]$ft)
            $lay = [ordered]@{ schema = 1; made = '2026-10-31T18:00:00Z'; collection = [ordered]@{ slug = $slug; revision = $rev } }
            [IO.File]::WriteAllText((Join-Path $rec 'layout.json'), ($lay | ConvertTo-Json -Depth 4), $utf8)
            return $rec
        }.GetNewClosure()
    }
    $quiet = { param($m) }

    $threw = ''
    try { $null = Get-ThornswoodCollectionStore -RecordPath $record -Root $root -Fetch (New-Fetch 6 '7essxf' @{ 'beta.esl' = [byte[]](1..90) }) -Say $quiet } catch { $threw = $_.Exception.Message }
    Yes 'a fetched plugin at other bytes than the record''s stops the store, naming it' ($threw -match 'beta\.esl' -and $threw -match 'nothing went into the store')
    Yes 'and nothing goes into the store' (-not (Test-Path -LiteralPath (Join-Path $root '7essxf-6')))
    Yes 'and the fetch''s folder is gone' (@(Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue).Count -eq 0)

    $threw = ''
    try { $null = Get-ThornswoodCollectionStore -RecordPath $record -Root $root -Fetch (New-Fetch 6 '7essxf' @{ 'Gamma.esp' = [byte[]](1, 2, 3) }) -Say $quiet } catch { $threw = $_.Exception.Message }
    Yes 'a fetched plugin the record does not name stops the store' ($threw -match 'Gamma\.esp' -and -not (Test-Path -LiteralPath (Join-Path $root '7essxf-6')))

    $threw = ''
    try { $null = Get-ThornswoodCollectionStore -RecordPath $record -Root $root -Fetch (New-Fetch 5 '7essxf' @{}) -Say $quiet } catch { $threw = $_.Exception.Message }
    Yes 'a layout of another revision than the record''s stops the store' ($threw -match 'revision 5' -and $threw -match 'revision 6')

    $threw = ''
    try { $null = Get-ThornswoodCollectionStore -RecordPath $record -Root $root -Fetch (New-Fetch 6 'other' @{}) -Say $quiet } catch { $threw = $_.Exception.Message }
    Yes 'a layout of another collection stops the store' ($threw -match 'collection other')

    $threw = ''
    try { $null = Get-ThornswoodCollectionStore -RecordPath $record -Root $root -Fetch (New-Fetch 6 '7essxf' @{} @{ 'Data\SkyUI_SE.bsa' = [byte[]](9, 9) }) -Say $quiet } catch { $threw = $_.Exception.Message }
    Yes 'a fetched menu file at other bytes than the layout''s stops the store, naming it' ($threw -match 'SkyUI_SE\.bsa' -and $threw -match 'nothing went into the store' -and -not (Test-Path -LiteralPath (Join-Path $root '7essxf-6')))

    $threw = ''
    try { $null = Get-ThornswoodCollectionStore -RecordPath $record -Root $root -Fetch (New-Fetch 6 '7essxf' @{} @{} $true) -Say $quiet } catch { $threw = $_.Exception.Message }
    Yes 'a fetch with no menus folder stops the store (one made before -KeepPlugins kept them)' ($threw -match 'no menus folder' -and -not (Test-Path -LiteralPath (Join-Path $root '7essxf-6')))

    $count.n = 0
    $s = Get-ThornswoodCollectionStore -RecordPath $record -Root $root -Fetch (New-Fetch 6 '7essxf' @{}) -Say $quiet
    $dir = Join-Path $root '7essxf-6'
    Yes 'the record''s plugins make the store, in <slug>-<revision>' ($s.Dir -eq $dir -and $s.Revision -eq 6 -and $s.Count -eq 2 -and $count.n -eq 1)
    Yes 'each one at the record''s bytes' ((Sha (Join-Path $dir 'Alpha.esp')) -eq $rows[0].sha256 -and (Sha (Join-Path $dir 'beta.esl')) -eq $rows[1].sha256)
    $sj = [IO.File]::ReadAllText((Join-Path $dir 'store.json')) | ConvertFrom-Json
    Yes 'store.json says the collection, the revision and each plugin''s sha256' ($sj.collection -eq '7essxf' -and $sj.revision -eq 6 -and @($sj.plugins).Count -eq 2 -and $sj.issue -eq 4069)
    Yes 'what SkyUI''s menu check reads is in the store''s menus folder, at its path in the game folder' ((Test-Path -LiteralPath (Join-Path $dir 'menus/Data/SkyUI_SE.bsa')) -and (Test-Path -LiteralPath (Join-Path $dir 'menus/Data/Interface/skyui/itemcard.swf')) -and $s.Menus -eq (Join-Path $dir 'menus'))
    Yes '  and store.json, version 2, lists each with its sha256' ([int]$sj.version -eq 2 -and @($sj.menus).Count -eq 2 -and @($sj.menus | Where-Object { $_.path -eq 'Data\SkyUI_SE.bsa' -and $_.sha256 -eq (Sha-Bytes $menuBytes['Data\SkyUI_SE.bsa']) }).Count -eq 1)
    Yes 'nor is ours, which every deploy sends from the repository' (-not (Test-Path -LiteralPath (Join-Path $dir 'Thornswood-Content.esp')))
    Yes 'the game''s own masters the record names are not the store''s to hold' (-not (Test-Path -LiteralPath (Join-Path $dir 'Skyrim.esm')))
    Yes 'nothing of the fetch is left beside the store' (@(Get-ChildItem -LiteralPath $root -Force | Where-Object { $_.Name -ne '7essxf-6' }).Count -eq 0)

    $s2 = Get-ThornswoodCollectionStore -RecordPath $record -Root $root -Fetch (New-Fetch 6 '7essxf' @{}) -Say $quiet
    Yes 'a whole store is used again with no fetch' ($count.n -eq 1 -and $s2.Dir -eq $dir -and $s2.Count -eq 2)

    [IO.File]::WriteAllBytes((Join-Path $dir 'beta.esl'), [byte[]](9, 9, 9))
    $s3 = Get-ThornswoodCollectionStore -RecordPath $record -Root $root -Fetch (New-Fetch 6 '7essxf' @{}) -Say $quiet
    Yes 'a store that is no longer the record''s bytes is fetched again' ($count.n -eq 2 -and (Sha (Join-Path $dir 'beta.esl')) -eq $rows[1].sha256)

    Remove-Item -LiteralPath (Join-Path $dir 'menus/Data/Interface/skyui/itemcard.swf') -Force
    $null = Get-ThornswoodCollectionStore -RecordPath $record -Root $root -Fetch (New-Fetch 6 '7essxf' @{}) -Say $quiet
    Yes 'a store missing a menu file it lists is fetched again' ($count.n -eq 3 -and (Test-Path -LiteralPath (Join-Path $dir 'menus/Data/Interface/skyui/itemcard.swf')))

    $sjp = Join-Path $dir 'store.json'
    $old = [IO.File]::ReadAllText($sjp) | ConvertFrom-Json
    $old.version = 1
    $old.PSObject.Properties.Remove('menus')
    [IO.File]::WriteAllText($sjp, ($old | ConvertTo-Json -Depth 5), $utf8)
    $said = New-Object System.Collections.Generic.List[string]
    $null = Get-ThornswoodCollectionStore -RecordPath $record -Root $root -Fetch (New-Fetch 6 '7essxf' @{}) -Say { param($m) $said.Add($m) }.GetNewClosure()
    Yes 'a store made before it held the menus (version 1) is fetched again, saying so' ($count.n -eq 4 -and (($said -join ' ') -match 'made before the store held'))
    $count.n = 2

    $record7 = Join-Path $tmp 'collection-plugins-7.json'
    Write-Record $record7 7 $rows
    $s4 = Get-ThornswoodCollectionStore -RecordPath $record7 -Root $root -Fetch (New-Fetch 7 '7essxf' @{}) -Say $quiet
    Yes 'a new revision in the record gets a store of its own' ($count.n -eq 3 -and $s4.Dir -eq (Join-Path $root '7essxf-7') -and (Test-Path -LiteralPath $dir))

    # ---- 2. the fetch on the box, against a stand-in repository ------------
    $fake = Join-Path $tmp 'fakerepo'
    foreach ($d in 'scripts\vps\admin', 'scripts\release') { New-Item -ItemType Directory -Path (Join-Path $fake $d) -Force | Out-Null }
    [IO.File]::WriteAllText((Join-Path $fake 'scripts\vps\admin\ShipAccess.ps1'), "function Get-ThornswoodShipAccess { param(`$Repo, `$AdminState) return 'token-for-this-run' }", $utf8)
    $standin = @'
param([string]$Line)
$said = Join-Path $env:THORNSWOOD_SCRATCH_ROOT 'asked.txt'
[IO.File]::WriteAllText($said, ($Line + "`n" + $env:GH_TOKEN))
if ($env:STANDIN_END -and $env:STANDIN_END -ne '0') { Write-Host 'STOP. the stand-in was asked to fail'; exit [int]$env:STANDIN_END }
$rec = Join-Path $env:THORNSWOOD_SCRATCH_ROOT 'nexus-run\4242\files\record'
New-Item -ItemType Directory -Path $rec -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $rec 'layout.json'), '{"collection":{"slug":"7essxf","revision":6}}')
Write-Host '  ENDED 0 Install-NexusRevision main 0000'
exit 0
'@
    [IO.File]::WriteAllText((Join-Path $fake 'scripts\release\Nexus-Run.ps1'), $standin, $utf8)
    $w = Join-Path $tmp 'fetchwork'
    New-Item -ItemType Directory -Path $w -Force | Out-Null
    $env:GH_TOKEN = $null
    $got = Invoke-ThornswoodCollectionFetch -Work $w -Head ([pscustomobject]@{ Slug = '7essxf'; Revision = 6 }) -Repo $fake 6>$null
    $asked = [IO.File]::ReadAllText((Join-Path $w 'asked.txt')) -split "`n"
    Yes 'the fetch asks Nexus-Run for Install-NexusRevision -KeepPlugins of the record''s revision' ($asked[0] -eq 'Install-NexusRevision -Revision 6 -Slug 7essxf -KeepPlugins')
    Yes 'with the box admin App''s token in GH_TOKEN for that run' ($asked[1] -eq 'token-for-this-run')
    Yes 'and the token is gone after it' (-not $env:GH_TOKEN)
    Yes 'and it takes the one record the run left' ($got -eq (Join-Path $w 'nexus-run\4242\files\record'))
    $env:STANDIN_END = '3'
    $threw = ''
    $w2 = Join-Path $tmp 'fetchwork2'
    New-Item -ItemType Directory -Path $w2 -Force | Out-Null
    try { $null = Invoke-ThornswoodCollectionFetch -Work $w2 -Head ([pscustomobject]@{ Slug = '7essxf'; Revision = 6 }) -Repo $fake 6>$null } catch { $threw = $_.Exception.Message }
    $env:STANDIN_END = $null
    Yes 'a Nexus-Run that does not end 0 stops the fetch, with what it said' ($threw -match 'ended 3' -and $threw -match 'asked to fail')

    # ---- 3. Install-NexusRevision -KeepPlugins -----------------------------
    $inr = Text 'scripts\release\Install-NexusRevision.ps1'
    $pwsh = (Get-Process -Id $PID).Path
    $out = @(& $pwsh -NoProfile -NonInteractive -File (Join-Path $Repo 'scripts\release\Install-NexusRevision.ps1') -Revision 6 -KeepPlugins -Game (Join-Path $tmp 'game') -NoPause 2>&1 | ForEach-Object { "$_" })
    Yes 'Install-NexusRevision -KeepPlugins without -Record is refused before anything is read' ($LASTEXITCODE -eq 1 -and (($out -join ' ') -match '-KeepPlugins keeps the plugins beside a record'))
    $ki = $inr.IndexOf('$script:Kept[$s.Full] = $kf')
    $ri = if ($ki -ge 0) { $inr.IndexOf('Remove-Unpacked $e $u', $ki) } else { -1 }
    Yes 'it keeps a copy of each plugin before the unpacked mod goes' ($ki -gt 0 -and $ri -gt $ki -and ($ri - $ki) -lt 2000)
    Yes 'the copy kept is the one that wins the plugin''s place, held to files.txt''s sha256' ($inr -match '\$src = \$script:Kept\[\$x\.Full\]' -and $inr -match 'if \(\$got -ne \$x\.Sha256\)')
    Yes 'a -Record folder may hold its plugins and menus folders and nothing else besides' ($inr -match "'loadorder\.txt', 'plugins', 'menus'\) -notcontains")
    $km = $inr.IndexOf('$script:KeptMenus[$s.Full] = $kf')
    $rm = if ($km -ge 0) { $inr.IndexOf('Remove-Unpacked $e $u', $km) } else { -1 }
    Yes 'it keeps what SkyUI''s menu check reads before the unpacked mod goes' ($km -gt 0 -and $rm -gt $km -and ($rm - $km) -lt 400)
    Yes '  an archive only when node says it holds SkyUI''s script or a menu' ($inr.Contains('& node $script:MenuCheck --holding @bsas') -and $inr.Contains('$holding -notcontains $s.Full'))
    Yes '  the copy the layout places, held to files.txt''s sha256, at its path under menus' ($inr -match '\$src = \$script:KeptMenus\[\$x\.Full\]' -and $inr -match "Join-Path \`$Record 'menus'" -and $inr.Contains('$to = Join-Path $md $x.Rel'))
    Yes '  and without node -KeepPlugins is refused up front' ($inr -match 'if \(\$KeepPlugins -and -not \(Get-Command node')
    # Check-SkyUIMenus.js --holding, on two stand-in archives: one with a
    # menu under interface, one with only a texture.
    $bsaDir = Join-Path $tmp 'bsa'
    New-Item -ItemType Directory -Path $bsaDir -Force | Out-Null
    function New-Bsa([string]$path, [string]$folder, [string]$leaf) {
        # A version 105 archive with one folder of one file, as archiveIndex reads it.
        $fn = [Text.Encoding]::ASCII.GetBytes($folder + [char]0)
        $ln = [Text.Encoding]::ASCII.GetBytes($leaf + [char]0)
        $ms = New-Object IO.MemoryStream
        $bw = New-Object IO.BinaryWriter($ms)
        $bw.Write([Text.Encoding]::ASCII.GetBytes("BSA`0")); $bw.Write([uint32]105); $bw.Write([uint32]36); $bw.Write([uint32]3)
        $bw.Write([uint32]1); $bw.Write([uint32]1); $bw.Write([uint32]$fn.Length); $bw.Write([uint32]$ln.Length); $bw.Write([uint32]0)
        $blockAt = 36 + 24
        # folder record: hash, count, pad, offset (to the folder's name, plus the file names' length)
        $bw.Write([uint64]0); $bw.Write([uint32]1); $bw.Write([uint32]0); $bw.Write([uint64]($blockAt + $ln.Length))
        $bw.Write([byte]$fn.Length); $bw.Write($fn)
        $bw.Write([uint64]0); $bw.Write([uint32]4); $bw.Write([uint32]0)
        $bw.Write($ln)
        $bw.Flush()
        [IO.File]::WriteAllBytes($path, $ms.ToArray())
    }
    $withMenu = Join-Path $bsaDir 'Menus.bsa'
    $without = Join-Path $bsaDir 'Textures.bsa'
    New-Bsa $withMenu 'interface\skyui' 'itemcard.swf'
    New-Bsa $without 'textures\armor' 'plate.dds'
    if (Get-Command node -ErrorAction SilentlyContinue) {
        $held = @(& node (Join-Path $Repo 'scripts/mods/Check-SkyUIMenus.js') --holding $withMenu $without)
        Yes 'Check-SkyUIMenus.js --holding names the archive with a menu and not the one without' ($LASTEXITCODE -eq 0 -and $held.Count -eq 1 -and $held[0] -eq $withMenu)
    } else { Write-Host 'SKIP  node is not on this machine, so --holding is not run' }

    # ---- 4. the verbs ------------------------------------------------------
    $nv = (Text 'scripts\release\nexus-verbs.json') | ConvertFrom-Json
    Yes 'Nexus-Run lets Install-NexusRevision take -KeepPlugins' ($nv.verbs.'Install-NexusRevision'.params.KeepPlugins -eq 'switch')
    $gv = (Text 'scripts\vps\gate\verbs.json') | ConvertFrom-Json
    $dd = $gv.verbs.'Deploy-DevGamemode'
    Yes 'the deploy gate lets Deploy-DevGamemode take -FromRecord' ($dd.params.FromRecord -eq 'switch' -and $dd.params.LoadOrder -eq 'switch')
    Yes 'what a move drops is never the gate line''s to say' (-not $dd.params.PSObject.Properties['DropPlugins'])
    Yes 'the verb keeps within the time box-run.yml''s job allows' ([int]$dd.timeoutMinutes -gt 0 -and [int]$dd.timeoutMinutes -le 45)

    # ---- 5. Deploy-DevGamemode -FromRecord ---------------------------------
    $dg = Text 'scripts\deploy\Deploy-DevGamemode.ps1'
    $err = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput($dg, [ref]$null, [ref]$err)
    Yes 'Deploy-DevGamemode.ps1 parses' (@($err).Count -eq 0)
    $names = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
    Yes 'it takes -FromRecord and -DropPlugins' ($names -contains 'FromRecord' -and $names -contains 'DropPlugins')
    Yes '-FromRecord goes with -LoadOrder and never with -Dist' ($dg -match "if \(\`$FromRecord -and -not \`$LoadOrder\) \{ throw" -and $dg -match "if \(\`$FromRecord\) \{\s+if \(\`$Dist\) \{ throw")
    Yes 'the order is last-plugin.json''s and the plugins the store''s' ($dg -match "game\\data\\last-plugin\.json" -and $dg -match '\$Data = \$store\.Dir' -and $dg -match 'Get-ThornswoodCollectionStore -RecordPath \$recordPath')
    Yes 'the record''s order has the Last plugin on the end before it is held to the running one' ($dg -match 'Where-Object \{ \$_ -and \$_ -ine \$ThornswoodLastPlugin \}\) \+ \$ThornswoodLastPlugin\)' -and
        $dg.IndexOf('-ine $ThornswoodLastPlugin }) + $ThornswoodLastPlugin)') -lt $dg.IndexOf('Test-ThornswoodLoadOrderDrop ([pscustomobject]@{ loadOrder = @($boxContent.Order) }) ([pscustomobject]@{ loadOrder = $pluginNames }) $mayDrop') -and
        $dg.IndexOf('-ine $ThornswoodLastPlugin }) + $ThornswoodLastPlugin)') -gt 0)
    Yes 'an order that drops a plugin the dev server loads is held as -Dist''s is'(([regex]::Matches($dg, 'Test-ThornswoodLoadOrderDrop')).Count -ge 2)
    Yes 'the order goes up over the dev server''s' ($dg -match 'if \(\$Dist -or \$FromRecord -or \$orderMoved\)')
    Yes 'what the move may drop is records\collection-dropped.json''s, for the record''s revision alone' ($dg -match "records\\collection-dropped\.json" -and $dg -match '\[string\]\$dd\.revision -eq \[string\]\$store\.Revision' -and $dg -match 'Test-ThornswoodLoadOrderDrop .+ \$mayDrop')
    $cd = (Text 'records\collection-dropped.json') | ConvertFrom-Json
    $cp = (Text 'records\collection-plugins.json') | ConvertFrom-Json
    Yes 'collection-dropped.json is for the collection and revision collection-plugins.json names' ($cd.collection -eq $cp.collection -and [int]$cd.revision -eq [int]$cp.revision)
    # A revision that takes nothing out lets nothing go (revision 7 only adds).
    Yes 'each plugin it lets go says why, and is not in the revision any more' ($null -ne $cd.PSObject.Properties['dropped'] -and -not @(@($cd.dropped) | Where-Object { -not $_.why -or -not $_.name -or (@($cp.plugins | ForEach-Object { $_.name.ToLowerInvariant() }) -contains $_.name.ToLowerInvariant()) }).Count)
    Yes 'and none of them is in the order last-plugin.json was built against' (-not @(@($cd.dropped) | Where-Object { @((Text 'game\data\last-plugin.json' | ConvertFrom-Json).loadOrder | ForEach-Object { $_.ToLowerInvariant() }) -contains $_.name.ToLowerInvariant() }).Count)
    $lp = (Text 'game\data\last-plugin.json') | ConvertFrom-Json
    Yes 'last-plugin.json has the order to write, without the Last plugin itself' (@($lp.loadOrder).Count -gt 5 -and @($lp.loadOrder) -notcontains 'Thornswood-Last.esp')
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
