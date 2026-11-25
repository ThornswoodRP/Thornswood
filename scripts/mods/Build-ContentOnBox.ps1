<#
.SYNOPSIS
  The deploy gate's Build-Content verb (#5191, stage 3): the content plugin and every table read out of the load order, built on the box from main as the gate reads it, and kept there by what they were built from, so a build whose inputs did not change is taken from the last one and not built again.

.DESCRIPTION
  The deploy gate's Build-Content verb (#5191, stage 3): the content plugin
  and every table read out of the load order, built on the box from main as
  the gate reads it, and kept there by what they were built from, so a build
  whose inputs did not change is taken from the last one and not built again.

      pwsh scripts/vps/Box-Run.ps1 -Line 'Build-Content'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Build-Content -Server main'

  WHY. Patrick's B on #5191 (1 Nov 2026): nothing generated is committed; the
  box builds the content plugin, Thornswood-Last.esp's recipe and the tables
  at deploy. Measured 12 Nov: the plugin cannot be built on GitHub's runner,
  whose masters (se-data) are an older game release with no string tables,
  and the fine dishes wear Gourmet.esp's looks. The box has the whole load
  order (C:\Thornswood-GameData and each server's plugins, Run-OnBox.ps1).

  WHAT IT BUILDS. scripts\mods\Add-ContentRecords.py writes the plugin from
  its sources with the load order's plugins as its masters, then
  scripts\mods\Rebuild-ContentTables.ps1 runs the whole chain of
  content-tables.json over that plugin: every table, last-plugin.recipe and
  last-plugin.json among them. Each runs by Run-OnBox.ps1 -Collection, in a
  run folder of its own; this checkout, which the gate throws away after the
  run, takes what each wrote.

  WHAT IT IS BUILT FROM. The commit's record, never what a server runs
  (13 Nov 2026): the collection's plugins from the box's store of the
  revision records\collection-plugins.json names (CollectionStore.ps1, which
  fetches them through Nexus-Run when the store is not whole), over the
  server's plugins folder for what no collection installs, and the load order
  the commit records moved to that revision (ContentPaths.ps1,
  Get-ThornswoodContentOrder). The first build on the box, 12 Nov, read the
  dev server's folder and order, which are revision 7's, so it stopped at
  Build-BuildingHolds.py naming revision 8's Improved Eyes Skyrim.esp: no
  machine but One's Vortex game could move the recorded order (#5648).

  ORDER. The order is records\load-order.json's, which the pull request that
  moves the records to a new revision moves too (Set-LoadOrder.ps1). Until
  16 Nov 2026 it was game\data\npc-population.json's, a table this build
  writes, so a build read its order back from the build before it. So the
  catalogue, scripts\dev\Build-NpcPopulation.py, is built from the order
  first in every build, and the chain then reads that order. It reads none of
  Thornswood-Last.esp's records (#5191), which its folder has from the
  server; the chain's own catalogue step, after Build-LastPlugin.py, holds
  the bytes of the plugin that step made. Until 16 Nov 2026
  scripts\dev\Build-ResourceLocations.py was built here too, out of the
  server's Last plugin and the tables of the build before; it is a step of
  the chain now, after the catalogue.

  WHAT A BUILD IS KEPT BY. Its inputs: the server it was built against and
  every file Run-OnBox.ps1 sends for the chain (ContentPaths.ps1), by the
  git blob id each has in the commit, so the key is the same wherever the
  commit is read. The game data a build reads is the record's
  (records\collection-plugins.json, with each plugin's sha256, is among the
  inputs), so the same inputs read the same plugins.

  WHERE. C:\Thornswood-ContentBuilds\<server>\<key>: files\ holds the plugin
  and every file the chain writes at its repository path, and build.json
  names the commit, the key and each file's sha256. A build is written to
  <key>.part and renamed whole, so a folder named by its key is a finished
  build; one is used again only when every file in it is the sha256
  build.json names. The newest $Keep builds of each server are kept.

  WHAT COMES BACK. Every file of the build into -Out, the gate's out folder
  for the run, at its repository path, and build.json beside them; and the
  lines BUILT <key> or REUSED <key>, and FROM <commit>.

  THE STATIONS, WHEN THE ORDER MOVES (-Stations, #6192). Where the content
  plugin's stations stand is a measurement, game\data\station-sites.json,
  which a pull request commits with the docs page that names each site
  (docs\systems\station-placement.md). Build-StationSites.py measures over
  the load order last-plugin.json names, the woodworking benches and the
  harvests, which this chain writes after the plugin, and the benches are
  measured with the plugin's stations in the way, so neither can come first
  in a build: the sites are measured on purpose, as a step a person asks
  for, and every build places them from the committed table. When the order
  moves, test-2553-station-sites.js says the table was measured against
  another order, and

      pwsh scripts/vps/Box-Run.ps1 -Line 'Build-Content -Stations'

  lays the newest build of this server kept here over the checkout (the
  tables of the order it builds against), measures the stations over the
  record's plugins, then builds the plugin from the new table and runs the
  chain over it, as a build does, so every table is checked against them.
  Nothing is kept: every file comes back in -Out, station-sites.json among
  them, for that pull request, and the line MEASURED <key> says which build
  it measured over.

  WITHOUT THE LAST PLUGIN BEFORE IT IS MADE (#5191). Patrick's B on
  q-5191-last-plugin-loop (15 Nov 2026): the steps of the chain before
  Build-LastPlugin.py never read Thornswood-Last.esp, which is made from
  their own tables, and each takes what the Last plugin changes from the data
  that decides it. Rebuild-ContentTables.ps1 gives them the order without it
  on every build. Until 16 Nov 2026 that was a measurement,
  'Build-Content -WithoutLast', which built the commit so and held every file
  to the build kept for its key; its run that day found the four tables that
  read the plugin of the build before (doors, cast, crime and recipes), and
  each was changed on its own before the measurement became the build.
#>
[CmdletBinding()]
param(
    # Whose plugins: the dev server's (the load order dev runs) or live's.
    [ValidateSet('dev', 'main')]
    [string]$Server = 'dev',

    # Where the build's files are copied, at their repository paths.
    [string]$Out = '',

    # Where builds are kept. A test gives a folder of its own.
    [string]$Cache = 'C:\Thornswood-ContentBuilds',

    # How many builds of each server are kept.
    [ValidateRange(1, 100)]
    [int]$Keep = 8,

    # The script each tool is run by. A test gives a stand-in; on the box it
    # is Run-OnBox.ps1.
    [string]$Runner = '',

    # The store of the collection's plugins at the record's revision. A test
    # gives a folder of its own; on the box it is CollectionStore.ps1's.
    [string]$Store = '',

    # Measure the stations over the newest build kept here, then build over
    # them and keep nothing (THE STATIONS, above).
    [switch]$Stations
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'ContentPaths.ps1')
if (-not $Runner) { $Runner = Join-Path $Here 'Run-OnBox.ps1' }
$repo = (Resolve-Path -LiteralPath (Join-Path $Here '..\..')).ProviderPath
$Plugin = 'game/content/Thornswood-Content.esp'

function Invoke-BuildGit([string[]]$Words) {
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& git -C $repo @Words 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $was }
    return [pscustomobject]@{ Out = $o; Code = $LASTEXITCODE }
}
function Stop-Build([string]$Why) { Write-Output ('STOP. ' + $Why); exit 1 }
# Every way this ends 1 says why on a STOP line, which the deploy agent puts
# in the Deployment's status (ContentBuild.cs). An error nothing here caught,
# such as a throw from Run-OnBox.ps1 before it reaches the box, ended the
# script with exit 1 and no line at all, so #6351's status said only "ended
# with exit 1:" and the reason had to be read off the box.
trap {
    $at = [IO.Path]::GetFileName([string]$_.InvocationInfo.ScriptName)
    Stop-Build ($_.Exception.Message + $(if ($at) { " ($at line $($_.InvocationInfo.ScriptLineNumber))" } else { '' }) + ' Nothing was kept.')
}
function Get-Sha256([string]$Path) {
    $s = [IO.File]::OpenRead($Path)
    try { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($s)).ToLowerInvariant() } finally { $s.Dispose() }
}

$commit = (Invoke-BuildGit @('rev-parse', '--verify', 'HEAD^{commit}')).Out -join ''
if ($commit -cnotmatch '^[0-9a-f]{40}$') { Stop-Build 'this checkout has no commit to build. Nothing was built.' }
$dirty = Invoke-BuildGit @('status', '--porcelain', '--untracked-files=no')
if ($dirty.Code -ne 0 -or $dirty.Out.Count) { Stop-Build ('this checkout has uncommitted changes, so its commit is not what would be built: ' + ($dirty.Out | Select-Object -First 3) -join ' ') }

# THE KEY. The server, then every input file's mode, blob id and path in the
# commit, in ordinal order, one a line (Get-ThornswoodContentKey).
$content = Get-ThornswoodContentPaths -Repo $repo -Tool 'scripts/mods/Add-ContentRecords.py'
try { $k = Get-ThornswoodContentKey -Repo $repo -Commit $commit -Server $Server -Paths $content.Paths } catch { Stop-Build $_.Exception.Message }
$key = $k.Key
Write-Host ("inputs: $($k.Files) files at $commit, against the $Server server's plugins; key $key")

$home_ = Join-Path $Cache $Server
New-Item -ItemType Directory -Force -Path $home_ | Out-Null
$done = Join-Path $home_ $key

# A finished build is used again only when every file is what it names.
function Test-Build([string]$Dir, [string]$Key = $key) {
    $rec = Join-Path $Dir 'build.json'
    if (-not (Test-Path -LiteralPath $rec -PathType Leaf)) { return $null }
    try { $b = [IO.File]::ReadAllText($rec) | ConvertFrom-Json } catch { return $null }
    if ($b.key -cne $Key -or $b.server -cne $Server) { return $null }
    foreach ($f in $b.files.PSObject.Properties) {
        $p = Join-Path (Join-Path $Dir 'files') $f.Name
        if (-not (Test-Path -LiteralPath $p -PathType Leaf) -or (Get-Sha256 $p) -cne $f.Value) { return $null }
    }
    return $b
}

$built = if ($Stations) { $null } else { Test-Build $done }
if ($built) {
    # Used again, so it is the newest to keep.
    (Get-Item -LiteralPath $done).LastWriteTimeUtc = [DateTime]::UtcNow
    Write-Host ("REUSED $key")
    Write-Host ("FROM $($built.commit)")
    Write-Host ("the build of $($built.commit) on $($built.built) has the same inputs; $(@($built.files.PSObject.Properties).Count) files")
} else {
    if (-not $Stations -and (Test-Path -LiteralPath $done)) {
        Write-Host "the build kept as $key is not whole or not what its build.json says, so it is built again" -ForegroundColor Yellow
        Remove-Item -LiteralPath $done -Recurse -Force
    }
    # What each tool wrote came back into this checkout. Run-OnBox.ps1 sends
    # a commit, never the tree, so it is committed here, in a commit the
    # gate's next run throws away. What a build writes is ignored by git
    # (#5191, stage 4e), so it is added by name, past the ignore.
    $builtHere = Get-ThornswoodBuiltPaths -Repo $repo
    function Save-Step([string]$Tool) {
        $c = Invoke-BuildGit @('add', '--all')
        $made = @($builtHere | Where-Object { Test-Path -LiteralPath (Join-Path $repo $_) })
        if ($c.Code -eq 0 -and $made.Count) { $c = Invoke-BuildGit (@('add', '--force', '--') + $made) }
        if ($c.Code -eq 0) { $c = Invoke-BuildGit @('-c', 'user.name=Thornswood Gate', '-c', 'user.email=gate@thornswood.invalid', 'commit', '--quiet', '--allow-empty', '-m', "what $Tool wrote") }
        if ($c.Code -ne 0) { Stop-Build ("what $Tool wrote could not be committed in the checkout: " + ($c.Out -join ' ') + ' Nothing was kept.') }
    }
    # The files -Names as the checkout's HEAD holds them, written under -Into
    # at their repository paths: the bytes of each blob, as Run-OnBox.ps1
    # sends a commit's (Artifact.ps1). Returns each name with its sha256.
    function Save-CommittedFiles([string[]]$Names, [string]$Into) {
        . (Join-Path $Here '..\deploy\Artifact.ps1')
        Initialize-ThornswoodArtifactType
        $ids = @{}
        $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $lines = @(& git -C $repo ls-tree -r --full-tree HEAD -- @Names 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $was }
        foreach ($l in $lines) { if ($l -match '^\d{6} blob ([0-9a-f]{40})\t(.+)$') { $ids[$Matches[2]] = $Matches[1] } }
        $lost = @($Names | Where-Object { -not $ids.ContainsKey($_) })
        if ($lost.Count) { throw ("the build's commit does not hold " + (@($lost | Select-Object -First 5) -join ', ') + ', which the chain wrote.') }
        $git = (Get-Command git -CommandType Application | Select-Object -First 1).Source
        $datas = [ThornswoodArtifactZip]::ReadBlobs($git, $repo, [string[]]@($Names | ForEach-Object { $ids[$_] }))
        for ($i = 0; $i -lt $Names.Count; $i++) {
            $to = Join-Path $Into $Names[$i]
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
            [IO.File]::WriteAllBytes($to, $datas[$i])
            [pscustomobject]@{ Name = $Names[$i]; Sha = Get-Sha256 $to }
        }
    }
    # The record's plugins (the header says why) and the order it moves to.
    try {
        $order = Get-ThornswoodContentOrder -Repo $repo
        if (-not $Store) {
            . (Join-Path $Here '..\deploy\CollectionStore.ps1')
            $Store = (Get-ThornswoodCollectionStore -RecordPath (Join-Path $repo 'records\collection-plugins.json') -Fetch { param($w, $h) Invoke-ThornswoodCollectionFetch -Work $w -Head $h -Repo $repo } -Say { param($m) Write-Host $m }).Dir
        }
    } catch { Stop-Build ('the record''s plugins are not on the box: ' + $_.Exception.Message + ' Nothing was built.') }
    Write-Host ("the load order: collection $($order.Slug) revision $($order.Revision), $($order.Names.Count) plugins" +
        $(if ($order.Moved) { ', moved from the ' + $order.Recorded.Count + ' records\load-order.json records' + $(if ($order.Added.Count) { ', adding ' + ($order.Added -join ', ') } else { '' }) + $(if ($order.Dropped.Count) { ', taking out ' + ($order.Dropped -join ', ') } else { '' }) } else { ', as records\load-order.json records it' }) +
        "; the collection's plugins from $Store")
    # Quoted, so each goes to the runner as one of the tool's words and never
    # as a parameter of its own.
    # A step that ends other than 0 stops the build with the step's own
    # reason: the runner's last STOP line (Run-OnBox.ps1 says the tool's
    # last, #6351). What the runner says is passed on as it is said.
    function Invoke-Step([string]$Tool, [string[]]$Words, [string]$Then) {
        $said = @(& $Runner $Tool @Words -Server $Server -Collection $Store 6>&1 | ForEach-Object { $t = [string]$_; Write-Host $t; $t })
        $code = $LASTEXITCODE
        if ($code -ne 0) {
            $why = @($said | Where-Object { $_ -cmatch '^STOP\. ' }) | Select-Object -Last 1
            Stop-Build ("$(Split-Path -Leaf $Tool) ended with exit $code" + $(if ($why) { ': ' + $why.Substring(6).TrimEnd('.') } else { '' }) + ". $Then")
        }
        Save-Step (Split-Path -Leaf $Tool)
    }
    if ($Stations) {
        # The newest whole build of this server, whatever its key: the tables
        # of the order it builds against, which the stations are measured over.
        $from = @(Get-ChildItem -LiteralPath $home_ -Directory | Where-Object { $_.Name -match '^[0-9a-f]{64}$' } |
                Sort-Object LastWriteTimeUtc -Descending | ForEach-Object { $b = Test-Build $_.FullName $_.Name; if ($b) { [pscustomobject]@{ Dir = $_.FullName; Build = $b } } } |
                Select-Object -First 1)
        if (-not $from.Count) { Stop-Build "no whole build of the $Server server is kept here, so there are no tables of its order to measure the stations over. Run Build-Content first. Nothing was measured." }
        foreach ($f in $from[0].Build.files.PSObject.Properties) {
            $to = Join-Path $repo $f.Name
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
            Copy-Item -LiteralPath (Join-Path (Join-Path $from[0].Dir 'files') $f.Name) -Destination $to -Force
        }
        Save-Step ('the build ' + $from[0].Build.key)
        Write-Host ("the stations are measured over the build $($from[0].Build.key) of $($from[0].Build.commit), $(@($from[0].Build.files.PSObject.Properties).Count) files")
        Invoke-Step 'scripts/dev/Build-StationSites.py' @('--data', '{data}') 'The plugin was not built and nothing was measured.'
    }
    # The plugin names its fine dishes from the load order (#6351), so it is
    # given the order's plugin list as well as its data folder.
    Invoke-Step 'scripts/mods/Add-ContentRecords.py' @('--masters', '{data}', '--plugins', '{plugins}') 'The chain did not run and nothing was kept.'
    # The catalogue first, in the build's order; the chain holds its plugin
    # list to the catalogue's order (Rebuild-ContentTables.ps1). Every build,
    # since the order is records\load-order.json's and not the last build's
    # catalogue (ORDER, above).
    Invoke-Step 'scripts/dev/Build-NpcPopulation.py' @('--settings', '{settings}') 'The chain did not run and nothing was kept.'
    $moves = @('game/data/npc-population.json')
    Invoke-Step 'scripts/mods/Rebuild-ContentTables.ps1' @('-Data', '{data}', '-PluginsTxt', '{plugins}') 'Nothing was kept.'

    # The build: the plugin and every file the chain writes, a folder it
    # writes taken whole.
    $part = $done + '.part'
    if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Recurse -Force }
    # Each file is taken from the commit the last step made, as git holds it,
    # never from this checkout's working tree. A file no step changed is
    # one the gate's checkout wrote, with whatever line endings that checkout
    # gave it when its blob last changed: a .gitattributes rule added later
    # does not rewrite it, so on the box (core.autocrlf true) the build of
    # 29e6a4c carried docs/FISHING-SPOTS.csv and HANGING-GAME-SPOTS.csv CRLF,
    # which git and their builder hold LF, and every merge release after it
    # stopped on test-3029-builder-eol.js (16 Nov 2026).
    $names = New-Object 'Collections.Generic.List[string]'
    foreach ($w in @($Plugin) + @($moves) + @($content.Writes)) {
        $full = Join-Path $repo $w
        $each = @()
        if (Test-Path -LiteralPath $full -PathType Leaf) { $each = @($w) }
        elseif (Test-Path -LiteralPath $full -PathType Container) {
            $each = @(Get-ChildItem -LiteralPath $full -Recurse -File | ForEach-Object {
                    $w + '/' + [IO.Path]::GetRelativePath($full, $_.FullName).Replace('\', '/') })
        } else { Stop-Build "the chain says it writes $w, and there is no such file after it ran. Nothing was kept." }
        foreach ($f in $each) { if (-not $names.Contains($f)) { $names.Add($f) } }
    }
    $files = [ordered]@{}
    try { Save-CommittedFiles $names.ToArray() (Join-Path $part 'files') | ForEach-Object { $files[$_.Name] = $_.Sha } }
    catch { Stop-Build ($_.Exception.Message + ' Nothing was kept.') }
    if ($Stations) {
        # Kept nowhere: the measurement goes back for a pull request.
        if ($Out) {
            try { $null = Save-CommittedFiles ([string[]]@(@($files.Keys) + @('game/data/station-sites.json'))) $Out }
            catch { Stop-Build ($_.Exception.Message + ' Nothing was handed back.') }
        }
        Remove-Item -LiteralPath $part -Recurse -Force
        Write-Host ("MEASURED $($from[0].Build.key)")
        Write-Host ("FROM $commit")
        Write-Host ("$($files.Count + 1) files, station-sites.json among them; nothing was kept")
        exit 0
    }
    $record = [ordered]@{
        issue  = 5191
        what   = 'A content build on the box (scripts/mods/Build-ContentOnBox.ps1): the content plugin and every file the chain of scripts/mods/content-tables.json writes, built from the commit against the collection''s plugins at the record''s revision, in the load order the commit records.'
        server = $Server
        collection = [ordered]@{ slug = $order.Slug; revision = $order.Revision; plugins = $order.Names.Count; moved = [bool]$order.Moved }
        key    = $key
        commit = $commit
        built  = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
        files  = $files
    }
    [IO.File]::WriteAllText((Join-Path $part 'build.json'), ($record | ConvertTo-Json -Depth 4) + "`n", (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $part -Destination $done
    $built = Test-Build $done
    if (-not $built) { Stop-Build "the build kept as $key does not read back as written." }
    Write-Host ("BUILT $key")
    Write-Host ("FROM $commit")
    Write-Host ("$($files.Count) files")

    # The newest $Keep builds of this server stay.
    $old = @(Get-ChildItem -LiteralPath $home_ -Directory | Where-Object { $_.Name -match '^[0-9a-f]{64}$' } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -Skip $Keep)
    foreach ($o in $old) { Remove-Item -LiteralPath $o.FullName -Recurse -Force; Write-Host ("removed the older build $($o.Name)") }
}

if ($Out) {
    foreach ($f in $built.files.PSObject.Properties) {
        $to = Join-Path $Out $f.Name
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
        Copy-Item -LiteralPath (Join-Path (Join-Path $done 'files') $f.Name) -Destination $to -Force
    }
    Copy-Item -LiteralPath (Join-Path $done 'build.json') -Destination (Join-Path $Out 'content-build.json') -Force
}
exit 0
