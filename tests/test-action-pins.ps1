<#
  test-action-pins.ps1

  Every GitHub Action the workflows run is named by a full length commit SHA,
  with the tag it was on in a comment on the same line.

  WHY THIS EXISTS. Part of issue #437, which moved the checks onto a runner on
  the VPS, and of #578. A tag on an action is a moving pointer: whoever owns
  the action can repoint v7 at any commit, and nothing in this repository
  changes when they do. These jobs run on the VPS, in a local account beside
  the live server, so a repointed tag is somebody else's code on that box with
  no commit here to read. release.yml was written pinned and says so
  ("a moved tag on an action cannot change what runs"); build.yml and
  nightly.yml were not, and ran actions/checkout@v7 and
  actions/upload-artifact@v7 until this.

  So this reads .github\workflows and fails on any `uses:` that is not a
  40 character SHA, on a pin with no tag in its comment, and on the same action
  pinned to two different SHAs in two files, which is how one workflow quietly
  stays behind. The same reader is then driven over workflows written out in
  its own temp folder, so a reader that finds nothing wrong anywhere cannot
  pass by accident.

  It never reaches GitHub, so it says nothing about whether a SHA still exists.
  Moving a pin is looking the tag up and replacing both halves:
      gh api repos/actions/checkout/git/matching-refs/tags/v7

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$WorkflowDir)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
if (-not $WorkflowDir) { $WorkflowDir = Join-Path (Join-Path $Repo '.github') 'workflows' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

# Every `uses:` in one workflow's text, as it is written. A step's uses may be
# the first line of the step (- uses:) or a later one, so both shapes are read.
# An action in this repository (./.github/actions/...) has no tag to pin and is
# whatever the commit under test holds, so it is not one of these.
function Read-Uses([string]$text, [string]$file) {
    $out = New-Object System.Collections.ArrayList
    $lines = $text -split "`r?`n"
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $m = [regex]::Match($lines[$i], '^\s*(?:-\s+)?uses:\s*(?<ref>[^\s#]+)\s*(?<note>#.*)?$')
        if (-not $m.Success) { continue }
        $ref = $m.Groups['ref'].Value.Trim("'", '"')
        if ($ref.StartsWith('./')) { continue }
        $at = $ref.LastIndexOf('@')
        [void]$out.Add([pscustomobject]@{
            File   = $file
            Line   = $i + 1
            Ref    = $ref
            Action = $(if ($at -gt 0) { $ref.Substring(0, $at) } else { $ref })
            Pin    = $(if ($at -gt 0) { $ref.Substring($at + 1) } else { '' })
            Note   = $m.Groups['note'].Value.Trim()
        })
    }
    return @($out.ToArray())
}

# What is wrong with a set of uses, as one line each, or nothing when they are
# all pinned. This is the whole rule, and it is driven over the real workflows
# and over made up ones below. Every call is wrapped in @(): PowerShell unrolls
# a collection on the way out of a function, and under strict mode an empty
# result is $null, which has no Count.
function Get-PinFaults($uses) {
    $bad = New-Object System.Collections.ArrayList
    foreach ($u in @($uses)) {
        $where = "{0}:{1}  {2}" -f $u.File, $u.Line, $u.Ref
        if (-not $u.Pin) {
            [void]$bad.Add("$where is not pinned to anything")
            continue
        }
        if ($u.Pin -notmatch '^[0-9a-f]{40}$') {
            [void]$bad.Add("$where is a tag or a branch, not a full length commit SHA")
            continue
        }
        if ($u.Note -notmatch '^#\s*\S') {
            [void]$bad.Add("$where has no comment saying which tag that SHA is")
        }
    }
    # The same action pinned two ways is one workflow left behind, which is
    # exactly what happened to build.yml while release.yml was pinned.
    foreach ($g in @($uses | Group-Object Action)) {
        $pins = @($g.Group | ForEach-Object { $_.Pin } | Sort-Object -Unique)
        if ($pins.Count -gt 1) {
            [void]$bad.Add(("{0} is pinned {1} different ways: {2}" -f $g.Name, $pins.Count,
                            (($g.Group | ForEach-Object { '{0}:{1}' -f $_.File, $_.Pin }) -join ', ')))
        }
    }
    return @($bad.ToArray())
}

# ---- the real workflows -----------------------------------------------------
Yes ".github\workflows is there" (Test-Path -LiteralPath $WorkflowDir)
if (-not (Test-Path -LiteralPath $WorkflowDir)) { Done }

$files = @(Get-ChildItem -LiteralPath $WorkflowDir -File | Where-Object { $_.Extension -in '.yml', '.yaml' } | Sort-Object Name)
Yes ("it holds workflows to read ({0}: {1})" -f $files.Count, (($files | ForEach-Object { $_.Name }) -join ', ')) ($files.Count -ge 1)

# The ones that exist today. Named rather than counted, so a renamed or
# deleted workflow says so here instead of this harness reading two files and
# reporting that everything is fine.
foreach ($want in 'build.yml', 'nightly.yml', 'release.yml', 'drop-claims.yml', 'board.yml', 'duplicate-check.yml', 'board-read.yml', 'expire-claims.yml', 'done-on-merge.yml', 'area-label.yml', 'git-ref.yml', 'engine-prune.yml') {
    Yes "$want is one of them" (@($files | Where-Object { $_.Name -eq $want }).Count -eq 1)
}
# drop-claims.yml (#1863) runs no action on purpose: it checks out nothing and
# makes its label calls from its own script, so there is nothing in it to pin.
# tests\test-1863-drop-claims.ps1 holds it to that. So are expire-claims.yml,
# done-on-merge.yml and area-label.yml (#3192), held by
# tests\test-3192-board-hygiene.ps1. engine-prune.yml (#3410) is too, held by
# tests\test-3410-artifact-room.ps1. clone-report.yml (#3534) checks nothing
# out and only prints the report it is given, held by
# tests\test-3534-clone-report.ps1, and pr-events.yml (#5185) only prints
# which pull request changed, with no token, held by
# tests\test-5185-board-sync.js. board-read.yml runs one action since #5185,
# the board App's token. promote-main.yml (#5181) runs one since #4825, the
# checkout, for MergeRelease.ps1, which finds main's launcher package.
$noActions = @('drop-claims.yml', 'expire-claims.yml', 'done-on-merge.yml', 'area-label.yml', 'release-tag.yml', 'engine-prune.yml', 'clone-report.yml', 'pr-events.yml', 'engine-pin-aside.yml')

$all = @()
foreach ($f in $files) {
    $all += Read-Uses ([IO.File]::ReadAllText($f.FullName)) $f.Name
}
# Every workflow here runs an action. If this ever reads none, the reader above
# has stopped matching the file rather than the files having become clean.
Yes ("the reader finds the actions the workflows run ({0} found)" -f $all.Count) ($all.Count -ge 4)
foreach ($f in $files) {
    $n = @($all | Where-Object { $_.File -eq $f.Name }).Count
    if ($noActions -contains $f.Name) { Yes ("{0} runs no action, as it is meant to" -f $f.Name) ($n -eq 0); continue }
    Yes ("{0} has at least one action in it" -f $f.Name) ($n -ge 1)
}

$faults = @(Get-PinFaults $all)
Yes 'every action in every workflow is pinned to a full length SHA with its tag in the comment' ($faults.Count -eq 0)
foreach ($b in $faults) { Write-Host "      $b" }

# Said out loud, so the run shows what is pinned to what rather than only that
# it passed.
foreach ($g in @($all | Group-Object Action | Sort-Object Name)) {
    Write-Host ("      {0}  {1}  {2}" -f $g.Name, $g.Group[0].Pin, $g.Group[0].Note)
}

# ---- the reader catches what it is for --------------------------------------
$sha = '3d3c42e5aac5ba805825da76410c181273ba90b1'
$other = '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-action-pins-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    function Fake([string]$name, [string[]]$lines) {
        [IO.File]::WriteAllText((Join-Path $work $name), ($lines -join "`n"))
        return Read-Uses ([IO.File]::ReadAllText((Join-Path $work $name))) $name
    }

    $ok = @(Fake 'good.yml' @(
        'jobs:', '  one:', '    steps:',
        "      - uses: actions/checkout@$sha # v7",
        '      - name: keep it',
        "        uses: actions/upload-artifact@$other # v7"))
    Yes 'the reader finds both shapes of uses, on the step line and under a name' ($ok.Count -eq 2)
    Yes 'and a pinned pair is clean' (@(Get-PinFaults $ok).Count -eq 0)

    $tag = @(Fake 'tag.yml' @('jobs:', '  one:', '    steps:', '      - uses: actions/checkout@v7'))
    $f = @(Get-PinFaults $tag)
    Yes 'a floating tag is caught' ($f.Count -eq 1 -and $f[0] -match 'not a full length commit SHA')

    $branch = @(Fake 'branch.yml' @('jobs:', '  one:', '    steps:', '      - uses: actions/checkout@main'))
    Yes 'a branch name is caught' (@(Get-PinFaults $branch).Count -eq 1)

    $short = @(Fake 'short.yml' @('jobs:', '  one:', '    steps:', ('      - uses: actions/checkout@' + $sha.Substring(0, 8) + ' # v7')))
    Yes 'a short SHA is caught' (@(Get-PinFaults $short).Count -eq 1)

    $bare = @(Fake 'bare.yml' @('jobs:', '  one:', '    steps:', '      - uses: actions/checkout'))
    $f = @(Get-PinFaults $bare)
    Yes 'an action with no ref at all is caught' ($f.Count -eq 1 -and $f[0] -match 'not pinned to anything')

    $noNote = @(Fake 'nonote.yml' @('jobs:', '  one:', '    steps:', "      - uses: actions/checkout@$sha"))
    $f = @(Get-PinFaults $noNote)
    Yes 'a SHA with no tag in a comment is caught' ($f.Count -eq 1 -and $f[0] -match 'no comment saying which tag')

    $local = @(Fake 'local.yml' @('jobs:', '  one:', '    steps:', '      - uses: ./.github/actions/ours'))
    Yes 'an action in this repository is not asked for a pin' ($local.Count -eq 0)

    # Two files, one action, two SHAs: the drift this is really for.
    $drift = @()
    $drift += @(Fake 'a.yml' @('jobs:', '  one:', '    steps:', "      - uses: actions/checkout@$sha # v7"))
    $drift += @(Fake 'b.yml' @('jobs:', '  one:', '    steps:', "      - uses: actions/checkout@$other # v7"))
    $f = @(Get-PinFaults $drift)
    Yes 'the same action pinned two ways in two workflows is caught' ($f.Count -eq 1 -and $f[0] -match 'pinned 2 different ways')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
