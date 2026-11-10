<#
.SYNOPSIS
  Fails when a NuGet package Dependabot watches is named at another version in THIRD-PARTY.md, the credits page or installer\licences than its project gives it.

.DESCRIPTION
  Issue #4161, Patrick's A on the NuGet card (9 Nov 2026): Dependabot watches
  the launcher's and the deploy agent's C# packages, and each bump is held
  until THIRD-PARTY.md, site\data\site\credits.md and installer\licences
  match it. A bump that moves only the project would otherwise ship a
  library whose notices name the old version.

  What it reads: the directories of the nuget entry in .github\dependabot.yml,
  so the projects held here are always the ones Dependabot moves, and every
  PackageReference of each .csproj in them. Then:
    - a package has one version across those projects (the launcher, the
      ship root and the window harness move together);
    - wherever one of the three places names a package beside a version
      ("Velopack 1.2.161", "| SharpSRTP | 0.5.8 |", "`NLayer` 3.0.0"), that
      version is the project's;
    - THIRD-PARTY.md names every package of launcher\app\Thornswood.csproj
      at its version, because the launcher hands each of them out.
  A package none of the three names (the deploy agent's, which runs on the
  box and is handed to nobody) has nothing to match.

  Each fault is a line starting FAULT, and the exit is 1. Read only.
  tests\test-4161-package-notices.ps1 runs it on the tree and on planted
  copies.

.PARAMETER Root
  The repository to read. The one this script is in, unless a test points
  it at a copy.
#>
[CmdletBinding()]
param([string]$Root = '')

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }

# The directories of the nuget entry, as dependabot.yml lists them.
function Get-NuGetDirectories([string]$Root) { return @(Read-NuGetEntry $Root 'directories') }

# The packages the entry's ignore list keeps Dependabot from moving.
function Get-NuGetIgnored([string]$Root) { return @(Read-NuGetEntry $Root 'ignore') }

function Read-NuGetEntry([string]$Root, [string]$Want) {
    $lines = [IO.File]::ReadAllLines((Join-Path $Root '.github/dependabot.yml'))
    $out = @()
    $inEntry = $false
    $in = ''
    foreach ($l in $lines) {
        if ($l -match '^\s*-\s+package-ecosystem:\s*(\S+)') { $inEntry = ($Matches[1].Trim('"') -eq 'nuget'); $in = ''; continue }
        if (-not $inEntry -or $l -match '^\s*#' -or -not $l.Trim()) { continue }
        if ($l -match '^    ([a-z-]+):\s*$') { $in = $Matches[1]; continue }
        if ($l -match '^    [a-z-]+:') { $in = ''; continue }
        if ($in -eq 'directories' -and $Want -eq 'directories' -and $l -match '^\s+-\s+"?(/[^"\s]*)"?\s*$') { $out += $Matches[1] }
        if ($in -eq 'ignore' -and $Want -eq 'ignore' -and $l -match '^\s+-\s+dependency-name:\s*"?([^"\s]+)"?\s*$') { $out += $Matches[1] }
    }
    return $out
}

# Every PackageReference with a written version, of every .csproj in $Dirs,
# but for the ones the entry ignores: Dependabot never moves those.
function Get-PackageReferences([string]$Root, [string[]]$Dirs, [string[]]$Ignored = @()) {
    $refs = @()
    foreach ($d in $Dirs) {
        $full = Join-Path $Root ($d.TrimStart('/'))
        foreach ($p in @(Get-ChildItem -LiteralPath $full -Filter '*.csproj' -File)) {
            $x = [xml][IO.File]::ReadAllText($p.FullName)
            foreach ($n in @($x.SelectNodes('//PackageReference'))) {
                $v = [string]$n.GetAttribute('Version')
                if (-not $v -or $v.Contains('$(')) { continue }
                if ($Ignored -contains [string]$n.GetAttribute('Include')) { continue }
                $rel = $p.FullName.Substring($Root.TrimEnd('\', '/').Length + 1).Replace('\', '/')
                $refs += [pscustomobject]@{ Name = [string]$n.GetAttribute('Include'); Version = $v; Project = $rel }
            }
        }
    }
    return $refs
}

# The versions a text names right beside a package's name.
function Get-NamedVersions([string]$Text, [string]$Name) {
    $pat = '(?<![\w.-])' + [regex]::Escape($Name) + '(?![\w-]|\.\w)[`''\s|]*(?:package\s+|version\s+)?(\d+(?:\.\d+)+)(?![\w-]|\.\d)'
    return @([regex]::Matches($Text, $pat) | ForEach-Object { $_.Groups[1].Value })
}

function Find-PackageNoticeFaults([string]$Root) {
    $faults = @()
    $dirs = @(Get-NuGetDirectories $Root)
    if (-not $dirs.Count) { return @('FAULT .github/dependabot.yml has no nuget entry with directories to read') }
    $refs = @(Get-PackageReferences $Root $dirs @(Get-NuGetIgnored $Root))
    $byName = [ordered]@{}
    foreach ($r in $refs) {
        if (-not $byName.Contains($r.Name)) { $byName[$r.Name] = @() }
        $byName[$r.Name] += $r
    }
    $places = [ordered]@{}
    $places['THIRD-PARTY.md'] = [IO.File]::ReadAllText((Join-Path $Root 'THIRD-PARTY.md'))
    $places['site/data/site/credits.md'] = [IO.File]::ReadAllText((Join-Path $Root 'site/data/site/credits.md'))
    foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $Root 'installer/licences') -File | Sort-Object Name)) {
        $places['installer/licences/' + $f.Name] = [IO.File]::ReadAllText($f.FullName)
    }
    foreach ($name in $byName.Keys) {
        $vs = @($byName[$name] | ForEach-Object { $_.Version } | Select-Object -Unique)
        if ($vs.Count -gt 1) {
            $faults += ('FAULT {0} is at {1} in the projects Dependabot moves together; one version for all of them' -f $name, (($byName[$name] | ForEach-Object { $_.Project + ' ' + $_.Version }) -join ', '))
            continue
        }
        $v = $vs[0]
        foreach ($place in $places.Keys) {
            $other = @(Get-NamedVersions $places[$place] $name | Where-Object { $_ -ne $v } | Select-Object -Unique)
            if ($other.Count) { $faults += ('FAULT {0} names {1} {2}, but the project is at {3}' -f $place, $name, ($other -join ' and '), $v) }
        }
        $shipped = @($byName[$name] | Where-Object { $_.Project -eq 'launcher/app/Thornswood.csproj' }).Count -gt 0
        if ($shipped -and @(Get-NamedVersions $places['THIRD-PARTY.md'] $name | Where-Object { $_ -eq $v }).Count -eq 0) {
            $faults += ('FAULT THIRD-PARTY.md does not name {0} {1}, which the launcher hands out' -f $name, $v)
        }
    }
    return $faults
}

if ($MyInvocation.InvocationName -ne '.') {
    $faults = @(Find-PackageNoticeFaults $Root)
    foreach ($f in $faults) { Write-Host $f }
    if ($faults.Count) {
        Write-Host ('{0} fault(s): bring THIRD-PARTY.md, site/data/site/credits.md and installer/licences to the versions the projects give' -f $faults.Count)
        exit 1
    }
    Write-Host 'every package Dependabot moves is named at its own version'
    exit 0
}
