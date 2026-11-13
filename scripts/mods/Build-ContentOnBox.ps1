<#
  Build-ContentOnBox.ps1

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
  machine but One's Vortex game could move the recorded order (#5648). When
  the order moves, the catalogue is built from it first, as content-tables.json's
  notInChain says it is when the collection's order moves:
  scripts\dev\Build-NpcPopulation.py, then scripts\dev\Build-ResourceLocations.py
  (game\data\resource-locations.json; the docs' CSV lists it also writes are
  not brought back). The chain then reads that order.

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
    [string]$Store = ''
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
function Stop-Build([string]$Why) { Write-Host ('STOP. ' + $Why) -ForegroundColor Red; exit 1 }
function Get-Sha256([string]$Path) {
    $s = [IO.File]::OpenRead($Path)
    try { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($s)).ToLowerInvariant() } finally { $s.Dispose() }
}

$commit = (Invoke-BuildGit @('rev-parse', '--verify', 'HEAD^{commit}')).Out -join ''
if ($commit -cnotmatch '^[0-9a-f]{40}$') { Stop-Build 'this checkout has no commit to build. Nothing was built.' }
$dirty = Invoke-BuildGit @('status', '--porcelain', '--untracked-files=no')
if ($dirty.Code -ne 0 -or $dirty.Out.Count) { Stop-Build ('this checkout has uncommitted changes, so its commit is not what would be built: ' + ($dirty.Out | Select-Object -First 3) -join ' ') }

# THE KEY. The server, then every input file's mode, blob id and path in the
# commit, in git's order, one a line.
$content = Get-ThornswoodContentPaths -Repo $repo -Tool 'scripts/mods/Add-ContentRecords.py'
$tree = Invoke-BuildGit (@('ls-tree', '-r', '--full-tree', $commit, '--') + $content.Paths)
if ($tree.Code -ne 0) { Stop-Build ('the inputs could not be listed: ' + ($tree.Out -join ' ')) }
$keyText = "server $Server`n" + (($tree.Out | Sort-Object -CaseSensitive) -join "`n") + "`n"
$key = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($keyText))).ToLowerInvariant()
Write-Host ("inputs: $($tree.Out.Count) files at $commit, against the $Server server's plugins; key $key")

$home_ = Join-Path $Cache $Server
New-Item -ItemType Directory -Force -Path $home_ | Out-Null
$done = Join-Path $home_ $key

# A finished build is used again only when every file is what it names.
function Test-Build([string]$Dir) {
    $rec = Join-Path $Dir 'build.json'
    if (-not (Test-Path -LiteralPath $rec -PathType Leaf)) { return $null }
    try { $b = [IO.File]::ReadAllText($rec) | ConvertFrom-Json } catch { return $null }
    if ($b.key -cne $key -or $b.server -cne $Server) { return $null }
    foreach ($f in $b.files.PSObject.Properties) {
        $p = Join-Path (Join-Path $Dir 'files') $f.Name
        if (-not (Test-Path -LiteralPath $p -PathType Leaf) -or (Get-Sha256 $p) -cne $f.Value) { return $null }
    }
    return $b
}

$built = Test-Build $done
if ($built) {
    # Used again, so it is the newest to keep.
    (Get-Item -LiteralPath $done).LastWriteTimeUtc = [DateTime]::UtcNow
    Write-Host ("REUSED $key")
    Write-Host ("FROM $($built.commit)")
    Write-Host ("the build of $($built.commit) on $($built.built) has the same inputs; $(@($built.files.PSObject.Properties).Count) files")
} else {
    if (Test-Path -LiteralPath $done) {
        Write-Host "the build kept as $key is not whole or not what its build.json says, so it is built again" -ForegroundColor Yellow
        Remove-Item -LiteralPath $done -Recurse -Force
    }
    # What each tool wrote came back into this checkout. Run-OnBox.ps1 sends
    # a commit, never the tree, so it is committed here, in a commit the
    # gate's next run throws away.
    function Save-Step([string]$Tool) {
        $c = Invoke-BuildGit @('add', '--all')
        if ($c.Code -eq 0) { $c = Invoke-BuildGit @('-c', 'user.name=Thornswood Gate', '-c', 'user.email=gate@thornswood.invalid', 'commit', '--quiet', '--allow-empty', '-m', "what $Tool wrote") }
        if ($c.Code -ne 0) { Stop-Build ("what $Tool wrote could not be committed in the checkout: " + ($c.Out -join ' ') + ' Nothing was kept.') }
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
        $(if ($order.Moved) { ', moved from the ' + $order.Recorded.Count + ' the catalogue records' + $(if ($order.Added.Count) { ', adding ' + ($order.Added -join ', ') } else { '' }) + $(if ($order.Dropped.Count) { ', taking out ' + ($order.Dropped -join ', ') } else { '' }) } else { ', as the catalogue records it' }) +
        "; the collection's plugins from $Store")
    # Quoted, so each goes to the runner as one of the tool's words and never
    # as a parameter of its own.
    function Invoke-Step([string]$Tool, [string[]]$Words, [string]$Then) {
        & $Runner $Tool @Words -Server $Server -Collection $Store
        if ($LASTEXITCODE -ne 0) { Stop-Build ("$(Split-Path -Leaf $Tool) ended with exit $LASTEXITCODE. $Then") }
        Save-Step (Split-Path -Leaf $Tool)
    }
    Invoke-Step 'scripts/mods/Add-ContentRecords.py' @('--masters', '{data}') 'The chain did not run and nothing was kept.'
    $moves = @()
    if ($order.Moved) {
        # The catalogue first, in the order it moves to; the chain holds its
        # plugin list to the catalogue's order (Rebuild-ContentTables.ps1).
        Invoke-Step 'scripts/dev/Build-NpcPopulation.py' @('--settings', '{settings}') 'The order did not move, the chain did not run and nothing was kept.'
        Invoke-Step 'scripts/dev/Build-ResourceLocations.py' @('--settings', '{settings}', '--strings-dir', '{data}') 'The chain did not run and nothing was kept.'
        $moves = @('game/data/npc-population.json', 'game/data/resource-locations.json')
    }
    Invoke-Step 'scripts/mods/Rebuild-ContentTables.ps1' @('-Data', '{data}', '-PluginsTxt', '{plugins}') 'Nothing was kept.'

    # The build: the plugin and every file the chain writes, a folder it
    # writes taken whole.
    $part = $done + '.part'
    if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Recurse -Force }
    $files = [ordered]@{}
    foreach ($w in @($Plugin) + @($moves) + @($content.Writes)) {
        $full = Join-Path $repo $w
        $each = @()
        if (Test-Path -LiteralPath $full -PathType Leaf) { $each = @($w) }
        elseif (Test-Path -LiteralPath $full -PathType Container) {
            $each = @(Get-ChildItem -LiteralPath $full -Recurse -File | ForEach-Object {
                    $w + '/' + [IO.Path]::GetRelativePath($full, $_.FullName).Replace('\', '/') })
        } else { Stop-Build "the chain says it writes $w, and there is no such file after it ran. Nothing was kept." }
        foreach ($f in $each) {
            if ($files.Contains($f)) { continue }
            $to = Join-Path (Join-Path $part 'files') $f
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
            Copy-Item -LiteralPath (Join-Path $repo $f) -Destination $to
            $files[$f] = Get-Sha256 $to
        }
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
