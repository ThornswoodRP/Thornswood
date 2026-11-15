<#
  test-5857-signing-paths.ps1

      pwsh -NoProfile -File .\tests\test-5857-signing-paths.ps1

  The signing docs name what is on disk, and say where release signing
  happens (#5857).

  WHY. Three of them named things that had gone. Sign-Artifact.ps1 sent its
  reader to installer\setup\Bootstrap.cs, deleted with the old setup program
  (#4824, #5381). docs\SIGNED-RELEASES.md's "where things stand today" table
  cited .github/workflows/release.yml, removed by #5385. And
  records\signing\README.md said the launcher and the setup program are signed
  on every Ship from a machine whose signing.json is enabled, when since
  #4825 they are signed in merge-release.yml on GitHub's runner. Nothing tied
  what these docs name to the repository, so each move left them behind.

  WHAT IT READS.
    - scripts\release\Sign-Artifact.ps1, whole;
    - records\signing\README.md, whole;
    - docs\SIGNED-RELEASES.md up to its section 2: the status at the top and
      section 1, "Where things stand today". Its own status says sections 1
      to 9 are the design and its history as written, and that where they
      name the files #5385 removed they describe that earlier path; section
      1's table is the part that claims today, so that is what is held.

  WHAT IT HOLDS.
    1. Every repository path these name (a path that starts with one of the
       repository's top folders) is on disk. Two are machine-local on
       purpose and git ignores them: records\signing\signing.json and
       records\signing\client, which hold one machine's setup and Microsoft's
       client. A path with a <placeholder> in it is not a file.
    2. records\signing\README.md says where release signing happens:
       merge-release.yml, through Sign-OnRunner.ps1, and not "on every Ship".

  Read only.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent $Here }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond, [string]$why = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host ("FAIL  $what" + $(if ($why) { ' | ' + $why } else { '' })) }
}

$sep = [IO.Path]::DirectorySeparatorChar
function Under([string]$rel) { return [IO.Path]::Combine($Repo, $rel.Replace('\', [string]$sep).Replace('/', [string]$sep)) }
function Lines([string]$rel) { return [IO.File]::ReadAllLines((Under $rel)) }

# What is read: a file and the lines of it that are held.
$read = @(
    @{ File = 'scripts/release/Sign-Artifact.ps1'; Lines = (Lines 'scripts/release/Sign-Artifact.ps1') }
    @{ File = 'records/signing/README.md';         Lines = (Lines 'records/signing/README.md') }
)
$doc = Lines 'docs/SIGNED-RELEASES.md'
$end = 0
for ($i = 0; $i -lt $doc.Count; $i++) { if ($doc[$i] -match '^## 2\.') { $end = $i; break } }
Yes 'docs/SIGNED-RELEASES.md has its section 2, where the part that claims today ends' ($end -gt 0)
if ($end -gt 0) { $read += @{ File = 'docs/SIGNED-RELEASES.md'; Lines = $doc[0..($end - 1)] } }

# A repository path: one of the top folders, then at least one more part.
$top = '\.github|scripts|launcher|installer|records|docs|tests|site|game|deploy|tools|bot|engine'
$rx = [regex]('(?<![A-Za-z0-9_.\-\\/:])(?:' + $top + ')[\\/][A-Za-z0-9_.\-\\/<>]*[A-Za-z0-9_>]')
# Machine-local on purpose, ignored by git (records\signing\README.md).
$local = @('records/signing/signing.json', 'records/signing/client')

# ---- 1. every path they name is there ---------------------------------------
foreach ($r in $read) {
    $gone = @()
    $seen = 0
    for ($n = 0; $n -lt $r.Lines.Count; $n++) {
        foreach ($m in $rx.Matches($r.Lines[$n])) {
            # A JSON example writes each backslash twice.
            $p = ($m.Value.TrimEnd('.', ',', ')').Replace('\', '/')) -replace '/+', '/'
            if ($p.Contains('<')) { continue }
            $seen++
            $isLocal = @($local | Where-Object { $p -eq $_ -or $p.StartsWith($_ + '/') }).Count -gt 0
            if ($isLocal) { continue }
            if (-not (Test-Path -LiteralPath (Under $p))) { $gone += ($r.File + ':' + ($n + 1) + ' names ' + $p) }
        }
    }
    Yes ($r.File + ' names repository paths to hold (' + $seen + ')') ($seen -gt 0)
    Yes ('1. every repository path ' + $r.File + ' names is on disk') ($gone.Count -eq 0) ($gone -join ' ; ')
}

# ---- 2. where release signing happens -----------------------------------------
$readme = (Lines 'records/signing/README.md') -join ' '
$readme = $readme -replace '\s+', ' '
Yes '2. records/signing/README.md does not say releases are signed on every Ship from a machine' (
    $readme -notmatch '(?i)signed on every Ship from a machine') (([regex]::Match($readme, '(?i)[^.]*signed on every Ship[^.]*\.')).Value)
Yes '2. it says release signing happens in merge-release.yml, through Sign-OnRunner.ps1' (
    $readme -match 'merge-release\.yml' -and $readme -match 'Sign-OnRunner\.ps1')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
