<#
  Collect-ReleaseNotes.ps1

      pwsh -NoProfile -File scripts/release/Collect-ReleaseNotes.ps1 [-Since <tag or commit>] [-Until main] [-OutFile <file>]

  The note for the next release, joined from the "Release note:" lines of the
  pull requests merged since the last one (#5179), so nobody writes a note at
  release time from titles meant for the team.

  WHAT IT DOES. Since defaults to the newest release/dev/* tag. It asks GitHub
  for the commits between Since and Until on main, takes each squash merge's
  pull request number from the "(#N)" its subject ends with, reads that pull
  request's body, and joins the notes in merge order with PrNote.Join
  (tools\ReleaseNotes\NoteRules.cs). The joined note is checked with the same rules Ship.ps1
  holds a note to before it is printed or written to OutFile.

  WHAT IT SAYS. Exit 0: the note is printed (and written to OutFile), ready
  for Ship's -Notes. Exit 3: every change since says none, so there is no
  note and nothing people would notice to release. Exit 2: a merged pull
  request has no Release note line (merged before #5179, or its body was
  changed after); each is named with its title, and its note is written into
  its body on GitHub so the next run reads it. Exit 1: GitHub could not be
  read, or the joined note breaks a rule. It changes nothing anywhere.

  MAIN SERVER CHANGES. A pull request that changed only what goes live on the
  merge, the Discord bot and the site (main-server-paths.json beside this),
  is not in the build: its note is left out here, and the bot posts it in
  #news as a Main Server change (Patrick, 12 Nov 2026). Its files are read
  from GitHub.

  PullsFile (for tests\test-pr-release-note.ps1) reads the pull requests from
  a JSON array of { number, title, body, author, files } instead of GitHub;
  files is the list of paths the pull request changed.
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
# The release note rules, tools\ReleaseNotes\NoteRules.cs, which pwsh compiles
# here (#5354): the one copy, which the Release note check builds too.
Add-Type -Path (Join-Path $Here '../../tools/ReleaseNotes/NoteRules.cs')
$MainServer = Get-Content -LiteralPath (Join-Path $Here 'main-server-paths.json') -Raw | ConvertFrom-Json

# A Main Server change: every file under live or neutral, one at least under live.
function Test-MainServerChange($files) {
    $files = @($files | Where-Object { $_ })
    if (-not $files.Count) { return $false }
    $live = $false
    foreach ($f in $files) {
        $f = ([string]$f).Replace('\', '/')
        if (@($MainServer.live | Where-Object { $f.StartsWith($_) }).Count) { $live = $true; continue }
        if (@($MainServer.neutral | Where-Object { $f.StartsWith($_) }).Count) { continue }
        return $false
    }
    return $live
}

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
            $files = @()
            for ($page = 1; $page -le 30; $page++) {
                $got = @(Read-Api "repos/$Repo/pulls/$($pr.number)/files?per_page=100&page=$page")
                foreach ($x in $got) { $files += [string]$x.filename; if ($x.previous_filename) { $files += [string]$x.previous_filename } }
                if ($got.Count -lt 100) { break }
            }
            $pulls.Add([pscustomobject]@{ number = $pr.number; title = $pr.title; body = [string]$pr.body; author = $pr.user.login; files = $files })
        }
    }
} catch {
    Write-Host "STOP  $($_.Exception.Message)"
    exit 1
}

$missing = @()
$bodies = @()
foreach ($p in $pulls) {
    $n = [Thornswood.ReleaseNotes.PrNote]::Read([string]$p.body)
    $label = "#$($p.number) $($p.title)"
    if ($p.author -eq 'dependabot[bot]') { Write-Host "  none (Dependabot): $label"; continue }
    if (-not $n.Found) { $missing += $label; continue }
    if ($n.None) { Write-Host "  none: $label"; continue }
    if (Test-MainServerChange $p.files) { Write-Host "  main server, posted in #news by the bot: $label"; continue }
    Write-Host "  note: $label"
    $bodies += [string]$p.body
}

if ($missing.Count) {
    Write-Host 'STOP  these merged pull requests have no Release note line; write one into each body on GitHub, then run this again:'
    foreach ($m in $missing) { Write-Host "      $m" }
    exit 2
}

$note = [Thornswood.ReleaseNotes.PrNote]::Join([string[]]$bodies)
if (-not $note) { Write-Host 'NONE  every change since says none or is a Main Server change: nothing in the build people would notice.'; exit 3 }

$problems = @([Thornswood.ReleaseNotes.NoteRules]::AllProblems($note))
if ($problems.Count) {
    foreach ($p in $problems) { Write-Host "STOP  the joined note: $p" }
    exit 1
}

if ($OutFile) { [IO.File]::WriteAllText($OutFile, $note + "`n", (New-Object Text.UTF8Encoding($false))) }
Write-Host '----- release note -----'
Write-Host $note
exit 0
