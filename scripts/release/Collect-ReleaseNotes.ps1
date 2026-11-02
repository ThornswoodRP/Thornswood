<#
  Collect-ReleaseNotes.ps1

      pwsh -NoProfile -File scripts/release/Collect-ReleaseNotes.ps1 [-Since <tag or commit>] [-Until main] [-OutFile <file>]

  The note for the next release, joined from the "Release note:" lines of the
  pull requests merged since the last one (#5179), so nobody writes a note at
  release time from titles meant for the team.

  WHAT IT DOES. Since defaults to the newest release/dev/* tag. It asks GitHub
  for the commits between Since and Until on main, takes each squash merge's
  pull request number from the "(#N)" its subject ends with, reads that pull
  request's body, and joins the notes in merge order with Join-PrReleaseNotes
  (Note-Rules.ps1). The joined note is checked with the same rules Ship.ps1
  holds a note to before it is printed or written to OutFile.

  WHAT IT SAYS. Exit 0: the note is printed (and written to OutFile), ready
  for Ship's -Notes. Exit 3: every change since says none, so there is no
  note and nothing people would notice to release. Exit 2: a merged pull
  request has no Release note line (merged before #5179, or its body was
  changed after); each is named with its title, and its note is written into
  its body on GitHub so the next run reads it. Exit 1: GitHub could not be
  read, or the joined note breaks a rule. It changes nothing anywhere.

  PullsFile (for tests\test-pr-release-note.ps1) reads the pull requests from
  a JSON array of { number, title, body, author } instead of GitHub.
#>
[CmdletBinding()]
param(
    [string]$Since,
    [string]$Until = 'main',
    [string]$Repo = 'ThornswoodRP/Thornswood',
    [string]$OutFile,
    [string]$PullsFile
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Note-Rules.ps1')

function Read-Api([string]$path) {
    $raw = & gh api $path 2>&1
    if ($LASTEXITCODE -ne 0) { throw "GitHub would not answer $path ($(@($raw) -join ' '))" }
    return (@($raw) -join "`n") | ConvertFrom-Json
}

$pulls = New-Object System.Collections.Generic.List[object]
try {
    if ($PullsFile) {
        foreach ($p in @(Get-Content -LiteralPath $PullsFile -Raw | ConvertFrom-Json)) { $pulls.Add($p) }
    } else {
        if (-not $Since) {
            $refs = @(Read-Api "repos/$Repo/git/matching-refs/tags/release/dev/" | ForEach-Object { $_.ref -replace '^refs/tags/', '' } | Sort-Object)
            if (-not $refs.Count) { throw 'there is no release/dev/* tag to start from; pass -Since' }
            $Since = $refs[-1]
        }
        $cmp = Read-Api "repos/$Repo/compare/$([uri]::EscapeDataString($Since))...$([uri]::EscapeDataString($Until))"
        if ($cmp.total_commits -gt @($cmp.commits).Count) { throw "$Since to $Until is $($cmp.total_commits) commits, more than GitHub gives in one answer ($(@($cmp.commits).Count)); pass a later -Since" }
        Write-Host ("Since {0}: {1} commit(s) to {2}" -f $Since, $cmp.total_commits, $Until)
        foreach ($c in @($cmp.commits)) {
            $subject = ([string]$c.commit.message -split "`n")[0]
            if ($subject -notmatch '\(#(\d+)\)\s*$') { Write-Host "  not a pull request merge, left out: $subject"; continue }
            $pr = Read-Api "repos/$Repo/pulls/$($Matches[1])"
            $pulls.Add([pscustomobject]@{ number = $pr.number; title = $pr.title; body = [string]$pr.body; author = $pr.user.login })
        }
    }
} catch {
    Write-Host "STOP  $($_.Exception.Message)"
    exit 1
}

$missing = @()
$items = @()
foreach ($p in $pulls) {
    $n = Get-PrReleaseNote ([string]$p.body)
    $label = "#$($p.number) $($p.title)"
    if ($p.author -eq 'dependabot[bot]') { Write-Host "  none (Dependabot): $label"; continue }
    if (-not $n.Found) { $missing += $label; continue }
    if ($n.None) { Write-Host "  none: $label"; continue }
    Write-Host "  note: $label"
    $items += [pscustomobject]@{ Number = $p.number; Body = [string]$p.body }
}

if ($missing.Count) {
    Write-Host 'STOP  these merged pull requests have no Release note line; write one into each body on GitHub, then run this again:'
    foreach ($m in $missing) { Write-Host "      $m" }
    exit 2
}

$note = Join-PrReleaseNotes $items
if (-not $note) { Write-Host 'NONE  every change since says none: nothing people would notice to release.'; exit 3 }

$problems = @(Get-NoteShapeProblems $note) + @(Get-NoteProblems $note)
if ($problems.Count) {
    foreach ($p in $problems) { Write-Host "STOP  the joined note: $p" }
    exit 1
}

if ($OutFile) { [IO.File]::WriteAllText($OutFile, $note + "`n", (New-Object Text.UTF8Encoding($false))) }
Write-Host '----- release note -----'
Write-Host $note
exit 0
