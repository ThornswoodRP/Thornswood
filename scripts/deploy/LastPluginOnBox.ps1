<#
  LastPluginOnBox.ps1

  Thornswood-Last.esp on a game server, made on the box from its recipe
  (#2791 step 2, Patrick's A of 26 Oct 2026 on #3721). The plugin copies the
  winning record of each cell, world, quest and placed actor it changes out of
  about 31 other authors' plugins, so it is never sent from anywhere: no
  repository holds it, and no deploy carries it. The box makes it from the
  plugins its servers already load, which the collection installed, and the
  string tables of its game archive store (C:\Thornswood-GameData, OnBox.ps1
  says what is there and why), by scripts\mods\Make-LastPlugin.py, the same
  apply() the builder checks every recipe with and the launcher runs in C#.

  WHERE IT GOES. Into the deploy's stage, beside the plugins the deploy sent,
  and nowhere else: the stage check (Swap.ps1 $checkBlock) holds it to the
  sha256 game\data\last-plugin.json names, with every file the deploy sent,
  and the swap puts it in with them. A refusal leaves the server as it was.

  WHAT IT READS, in order: the stage's plugins folder first, so the content
  plugin this deploy sends is the one read, then the server's own. A plugin
  of another revision, or another content plugin than the one the recipe was
  written for, makes nothing, and the deploy stops naming it.

  HOW. One run's folder on the box, held by its keeper (Open-ThornswoodOnBoxFolder
  in OnBox.ps1), takes a zip of the four files the make needs, as this commit
  holds them (New-ThornswoodArtifact): Make-LastPlugin.py, last_recipe.py,
  bsa.py and the recipe. Its script finds Python the way a box run does and
  runs the make; the keeper removes the folder after.

  Defines variables and functions and nothing else. Needs Artifact.ps1 and
  ..\vps\Send-Script.ps1 loaded. LastPluginRecipe.ps1, which it loads, reads
  the recipe and manifest with no box. tests\test-2791-last-on-box.ps1 holds it.
#>

. (Join-Path $PSScriptRoot '..\mods\OnBox.ps1')
. (Join-Path $PSScriptRoot 'LastPluginRecipe.ps1')   # the plugin's name, and what the recipe says of it

# What the make needs on the box, as repository paths.
$ThornswoodLastTools = @('scripts/mods/Make-LastPlugin.py', 'scripts/mods/last_recipe.py', 'scripts/dev/bsa.py', 'game/data/last-plugin.recipe')

# Text for the box: makes the plugin into $Into from the folders $Reads, with
# the tables of $ArchiveStore, out of tools.zip in the run's folder $Run.
# Lines out: what Python said, then MADE <bytes> <sha256> when it was made,
# and EXIT <code>. PowerShell 7 on the far side: ASCII, .NET only.
function Get-ThornswoodLastMakeScript {
    param(
        [Parameter(Mandatory = $true)][string]$Run,
        [Parameter(Mandatory = $true)][string[]]$Reads,
        [Parameter(Mandatory = $true)][string]$Into,
        [string]$ArchiveStore = $ThornswoodGameArchiveStore
    )
    foreach ($p in @($Reads) + $Into + $ArchiveStore) {
        if ($p -notmatch '^[A-Za-z]:\\[A-Za-z0-9_ .\\-]+$') { throw "$p is not a folder on the box this can name." }
    }
    $readText = (@($Reads | ForEach-Object { "'" + $_ + "'" }) -join ', ')
    return @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
$(Get-ThornswoodOnBoxHoldScript -Run $Run)
`$tools = Join-Path `$run 'tools'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory((Join-Path `$run 'tools.zip'), `$tools)
`$launcher = Get-Command py -CommandType Application -EA SilentlyContinue | Select-Object -First 1
if (-not `$launcher) { 'STOP. there is no Python launcher (py) on the box.'; 'EXIT 2'; exit 2 }
`$python = (& `$launcher.Source -3 -c 'import sys; print(sys.executable)' | Select-Object -First 1)
if (-not `$python -or -not (Test-Path -LiteralPath `$python)) { 'STOP. py -3 named no Python on the box.'; 'EXIT 2'; exit 2 }
if (-not (Test-Path -LiteralPath '$Into')) { 'STOP. there is no $Into on the box.'; 'EXIT 2'; exit 2 }
`$words = @('-I', '-B', (Join-Path `$tools 'scripts\mods\Make-LastPlugin.py'), '--recipe', (Join-Path `$tools 'game\data\last-plugin.recipe'), '--out', '$Into\$ThornswoodLastPlugin', '--tables', '$ArchiveStore')
foreach (`$d in @($readText)) { if (Test-Path -LiteralPath `$d) { `$words += '--data', `$d } }
`$said = @(& `$python @words 2>&1 | ForEach-Object { "`$_".Trim() } | Where-Object { `$_ })
`$code = `$LASTEXITCODE
`$said
'EXIT ' + `$code
"@
}

# Makes the plugin on the box into $Into (a stage's plugins folder, Windows
# form) from $Reads, with this commit's tools and recipe. $RepoDir is the
# checkout the artifact is built from. Returns Bytes, Sha and Said (what the
# make said). Throws, with what the box said, when it was not made or is not
# the plugin $Want names; nothing outside the run's folder and $Into is touched.
function Invoke-ThornswoodLastPluginMake {
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [string[]]$SshArgs = @(),
        [Parameter(Mandatory = $true)][string]$RepoDir,
        [Parameter(Mandatory = $true)][string[]]$Reads,
        [Parameter(Mandatory = $true)][string]$Into,
        [Parameter(Mandatory = $true)]$Want
    )
    # Host key checking on (#450) for every ssh and scp this makes, whatever the
    # caller passed. ssh takes the first value it is given for an option, so the
    # strict one goes first, and a caller's weaker one is refused before
    # anything is sent rather than quietly overridden.
    $weak = @($SshArgs | Where-Object { $_ -match '(?i)StrictHostKeyChecking\s*=\s*(?!yes\b)' })
    if ($weak.Count) { throw ('ssh options with host key checking turned down (' + ($weak -join ', ') + '). The plugin is made only on the box whose key is pinned. Nothing was sent.') }
    $strict = @('-o', 'StrictHostKeyChecking=yes') + @($SshArgs)
    $artifact = New-ThornswoodArtifact -Component lastplugin -RepoDir $RepoDir -Paths $ThornswoodLastTools
    $local = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-lastplugin-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
    New-Item -ItemType Directory -Force -Path $local | Out-Null
    $box = $null
    $lines = @()
    try {
        $box = Open-ThornswoodOnBoxFolder -Target $Target -SshArgs $strict
        if (-not $box.Made) { throw ('could not make a folder on the box to make ' + $ThornswoodLastPlugin + ' in: ' + (($box.Said | Select-Object -Last 3) -join ' | ')) }
        $farFile = Join-Path $local 'make.ps1'
        [IO.File]::WriteAllText($farFile, (Get-ThornswoodLastMakeScript -Run $box.Run -Reads $Reads -Into $Into), (New-Object Text.UTF8Encoding($true)))
        Send-ThornswoodArtifactFile $artifact.Zip $Target $strict ($box.Far + '/tools.zip')
        Send-ThornswoodArtifactFile $farFile $Target $strict ($box.Far + '/make.ps1')
        $eap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { $lines = @(Invoke-ThornswoodRemote -Target $Target -SshArgs $strict -Bypass -Script ("& '" + $box.Run + "\make.ps1'") | Where-Object { $_ -is [string] } | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
        finally { $ErrorActionPreference = $eap }
    } finally {
        if ($box) { $null = Close-ThornswoodOnBoxFolder $box }
        Remove-Item -LiteralPath $local -Recurse -Force -ErrorAction SilentlyContinue
    }
    return (Read-ThornswoodLastMade $lines $Want)
}

# What the make said, read: Bytes, Sha and Said, or a throw naming why it is
# not the plugin $Want names. Apart so tests\test-2791-last-on-box.ps1 can
# drive it with no box.
function Read-ThornswoodLastMade([string[]]$Lines, $Want) {
    $exit = $null
    $made = $null
    $said = @()
    foreach ($l in @($Lines)) {
        if ($l -cmatch '^EXIT (-?\d+)$') { $exit = [int]$Matches[1]; continue }
        if ($l -cmatch '^MADE (\d+) ([0-9a-f]{64}) ') { $made = [pscustomobject]@{ Bytes = [int64]$Matches[1]; Sha = $Matches[2] } }
        $said += $l
    }
    $why = (@($said | Select-Object -Last 3) -join ' | ')
    if ($null -eq $exit) { throw ("the box did not say how the make of $ThornswoodLastPlugin ended: " + $why) }
    if ($exit -ne 0 -or -not $made) { throw ("$ThornswoodLastPlugin could not be made on the box from this commit's recipe: " + $why) }
    if ($made.Bytes -ne $Want.Bytes -or $made.Sha -ne $Want.Sha) {
        throw ("the box made a $ThornswoodLastPlugin of {0:N0} bytes, sha256 {1}, and game\data\last-plugin.json names {2:N0} bytes, sha256 {3}" -f $made.Bytes, $made.Sha.Substring(0, 12), $Want.Bytes, $Want.Sha.Substring(0, 12))
    }
    return [pscustomobject]@{ Bytes = $made.Bytes; Sha = $made.Sha; Said = $said }
}
