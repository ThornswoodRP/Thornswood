<#
  ReleaseNotes-Copy.ps1

      . (Join-Path $PSScriptRoot 'ReleaseNotes-Copy.ps1')

  The release note rules' two projects, tools\ReleaseNotes and
  tools\ReleaseNotes.Tests, copied out of the checkout for a harness to
  restore, build and test in a folder of its own (#5740).

  WHY. tests\test-pr-release-note.ps1 built tools\ReleaseNotes and
  tests\test-note-rules-cases.ps1 restored and tested tools\ReleaseNotes.Tests,
  both in the checkout, so both wrote tools\ReleaseNotes\obj. The gate runs
  harnesses side by side, and on Linux share 1 for #5715 one restored that
  folder while the other's dotnet test read it: "Assets file
  tools/ReleaseNotes/obj/project.assets.json not found". From a copy each, the
  checkout is only read.

    Copy-NotesProjects <repo> <to>   the sources, lock files and the fixture
                                     the tests read, laid out as in the repo
                                     under <to>; never obj or bin
    Get-NotesTreeState <repo>        every file under the two project folders
                                     with its length and write time, one
                                     line each, to compare before and after
    Compare-NotesTreeState <a> <b>   what was added or changed between two
                                     states, or 'no change'
#>
$NotesProjects = @('tools/ReleaseNotes', 'tools/ReleaseNotes.Tests')
# What dotnet reads from the folders above a project, which a build in the
# checkout would take and a copy has to carry: the SDK pin, where restore
# looks, and shared build settings. None is in the repository on 10 Nov
# 2026; any added later is copied with the projects, from where it sits.
$NotesAbove = @('global.json', 'nuget.config', 'NuGet.Config', 'Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props')

function Copy-NotesProjects([string]$Repo, [string]$To) {
    foreach ($p in $NotesProjects) {
        $from = Join-Path $Repo $p
        $into = Join-Path $To $p
        $null = New-Item -ItemType Directory -Path $into -Force
        # Every source in the project, at any depth, but never its own obj or bin.
        foreach ($f in @(Get-ChildItem -LiteralPath $from -File -Recurse | Where-Object {
                ($_.Extension -in '.cs', '.csproj' -or $_.Name -eq 'packages.lock.json') -and
                $_.FullName.Substring($from.Length) -notmatch '^[\\/](obj|bin)[\\/]' })) {
            $rel = $f.FullName.Substring($from.Length + 1)
            $at = Join-Path $into $rel
            $null = New-Item -ItemType Directory -Path (Split-Path -Parent $at) -Force
            Copy-Item -LiteralPath $f.FullName -Destination $at
        }
    }
    foreach ($dir in '', 'tools') {
        foreach ($n in $NotesAbove) {
            $f = Join-Path (Join-Path $Repo $dir) $n
            if (Test-Path -LiteralPath $f -PathType Leaf) { Copy-Item -LiteralPath $f -Destination (Join-Path (Join-Path $To $dir) $n) }
        }
    }
    # ReleaseNotes.Tests.csproj takes the fixture from ..\..\tests\fixtures.
    $fx = Join-Path $To 'tests/fixtures'
    $null = New-Item -ItemType Directory -Path $fx -Force
    Copy-Item -LiteralPath (Join-Path $Repo 'tests/fixtures/note-rules-cases.json') -Destination $fx
}

# What a build of the two projects reads, as paths from <root>: every source
# and lock file at any depth outside obj and bin, and each file dotnet reads
# from the folders above that is there. A copy holds what the checkout does
# when the two lists are the same.
function Get-NotesInputs([string]$Root) {
    $base = $Root.TrimEnd('\', '/')
    $list = foreach ($p in $NotesProjects) {
        $dir = Join-Path $Root $p
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        foreach ($f in @(Get-ChildItem -LiteralPath $dir -File -Recurse -Force)) {
            $rel = $f.FullName.Substring($base.Length + 1).Replace('\', '/')
            if ($rel.Substring($p.Length) -match '^/(obj|bin)/') { continue }
            if ($f.Extension -in '.cs', '.csproj' -or $f.Name -eq 'packages.lock.json') { $rel }
        }
    }
    $list += foreach ($dir in '', 'tools') {
        foreach ($n in $NotesAbove) {
            if (Test-Path -LiteralPath (Join-Path (Join-Path $Root $dir) $n) -PathType Leaf) { (($dir + '/' + $n).TrimStart('/')) }
        }
    }
    return (@($list | Sort-Object -Unique) -join "`n")
}

function Get-NotesTreeState([string]$Repo) {
    $lines = foreach ($p in $NotesProjects) {
        $dir = Join-Path $Repo $p
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        foreach ($f in @(Get-ChildItem -LiteralPath $dir -File -Recurse -Force)) {
            $rel = $f.FullName.Substring($Repo.TrimEnd('\', '/').Length + 1).Replace('\', '/')
            $rel + ' ' + $f.Length + ' ' + $f.LastWriteTimeUtc.Ticks
        }
    }
    return (@($lines | Sort-Object) -join "`n")
}

function Compare-NotesTreeState([string]$Before, [string]$After) {
    $b = @($Before -split "`n" | Where-Object { $_ })
    $moved = @($After -split "`n" | Where-Object { $_ -and $b -notcontains $_ } | ForEach-Object { ($_ -split ' ')[0] })
    if (-not $moved.Count) { return 'no change' }
    $say = @($moved | Select-Object -First 3) -join ', '
    if ($moved.Count -gt 3) { $say += (' and ' + ($moved.Count - 3) + ' more') }
    return ('written: ' + $say)
}
