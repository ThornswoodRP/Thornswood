<#
  test-action-pins.ps1

  Every GitHub Action the workflows run is named by a full length commit SHA,
  with the tag it was on in a comment on the same line.

  WHY THIS EXISTS. Part of issue #437, which moved the checks onto a runner on
  the VPS, and of #578. A tag on an action is a moving pointer: whoever owns
  the action can repoint v7 at any commit, and nothing in this repository
  changes when they do. These jobs run on the VPS, in a local account beside
  the live server, so a repointed tag is somebody else's code on that box with
  no commit here to read. release.yml (gone since #5385) was written pinned
  and said so ("a moved tag on an action cannot change what runs"); build.yml and
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
#
# Step is whether the uses belongs to a step (a job that calls a reusable
# workflow has a uses of its own, and is named by its job), and Named whether
# that step has a name: of its own (#4166).
function Read-Uses([string]$text, [string]$file) {
    $out = New-Object System.Collections.ArrayList
    $lines = $text -split "`r?`n"
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $m = [regex]::Match($lines[$i], '^(?<lead>\s*(?:-\s+)?)uses:\s*(?<ref>[^\s#]+)\s*(?<note>#.*)?$')
        if (-not $m.Success) { continue }
        $ref = $m.Groups['ref'].Value.Trim("'", '"')
        if ($ref.StartsWith('./')) { continue }
        $at = $ref.LastIndexOf('@')
        # The step's keys sit at the column uses: starts at. Its first line is
        # the nearest line at or above this one whose dash sits two columns
        # before that, and it runs to the next line indented no further than
        # the dash.
        $key = $m.Groups['lead'].Value.Length
        $start = -1
        for ($j = $i; $j -ge 0; $j--) {
            $d = [regex]::Match($lines[$j], '^(\s*)-\s')
            if ($d.Success -and $d.Groups[1].Value.Length + 2 -eq $key) { $start = $j; break }
            if ($j -lt $i -and $lines[$j].Trim() -and ($lines[$j].Length - $lines[$j].TrimStart().Length) -lt $key) { break }
        }
        $named = $false
        if ($start -ge 0) {
            for ($j = $start; $j -lt $lines.Count; $j++) {
                $l = $lines[$j]
                if ($j -gt $start -and $l.Trim() -and ($l.Length - $l.TrimStart().Length) -lt $key) { break }
                if ($j -eq $start) { $l = ' ' * $key + $l.Substring($key) }
                if ($l -match ('^\s{' + $key + '}name:\s*\S')) { $named = $true; break }
            }
        }
        [void]$out.Add([pscustomobject]@{
            File   = $file
            Line   = $i + 1
            Ref    = $ref
            Action = $(if ($at -gt 0) { $ref.Substring(0, $at) } else { $ref })
            Pin    = $(if ($at -gt 0) { $ref.Substring($at + 1) } else { '' })
            Note   = $m.Groups['note'].Value.Trim()
            Step   = $start -ge 0
            Named  = $named
        })
    }
    return @($out.ToArray())
}

# Every step that runs an action and has no name of its own (#4166). GitHub
# names such a step from its uses: line, so the checks page and the job log
# list it as "Run actions/checkout@" and the 40 character SHA, which a
# screen reader reads one character at a time.
function Get-NameFaults($uses) {
    @(foreach ($u in @($uses)) {
        if ($u.Step -and -not $u.Named) { "{0}:{1}  {2} has no name, so it shows as its pin" -f $u.File, $u.Line, $u.Action }
    })
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
            continue
        }
        # The comment names the release the SHA is, in full (#4165). A major
        # tag like v7 moves to each new release, so "# v7" stops saying which
        # commit this is the day the action ships v7.0.2: upload-artifact's
        # pin said v7 while its commit was v7.0.1 and v7 had moved on. The
        # nightly holds each pin to the commit its tag names
        # (scripts\dev\Check-ActionPins.ps1), which only a full tag can be.
        if ($u.Note -notmatch '^#\s*v\d+\.\d+\.\d+(\s|$)') {
            [void]$bad.Add(("$where says {0}, not the full release tag (vX.Y.Z) that SHA is" -f $u.Note))
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
foreach ($want in 'build.yml', 'nightly.yml', 'merge-release.yml', 'drop-claims.yml', 'board.yml', 'duplicate-check.yml', 'board-read.yml', 'expire-claims.yml', 'done-on-merge.yml', 'area-label.yml', 'git-ref.yml') {
    Yes "$want is one of them" (@($files | Where-Object { $_.Name -eq $want }).Count -eq 1)
}
# drop-claims.yml (#1863) runs no action on purpose: it checks out nothing and
# makes its label calls from its own script, so there is nothing in it to pin.
# tests\test-1863-drop-claims.ps1 holds it to that. So are expire-claims.yml,
# done-on-merge.yml and area-label.yml (#3192), held by
# tests\test-3192-board-hygiene.ps1. clone-report.yml (#3534) checks nothing
# out and only prints the report it is given, held by
# tests\test-3534-clone-report.ps1, and pr-events.yml (#5185) only prints
# which pull request changed, with no token, held by
# tests\test-5185-board-sync.js. board-read.yml runs one action since #5185,
# the board App's token. promote-main.yml (#5181) runs one since #4825, the
# checkout, for MergeRelease.ps1, which finds main's launcher package.
$noActions = @('drop-claims.yml', 'expire-claims.yml', 'done-on-merge.yml', 'area-label.yml', 'clone-report.yml', 'pr-events.yml', 'engine-pin-aside.yml')

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

$unnamed = @(Get-NameFaults $all)
Yes ('every step that runs an action has a name of its own, so none shows as its pin (' + $unnamed.Count + ' without)') ($unnamed.Count -eq 0)
foreach ($b in $unnamed) { Write-Host "      $b" }

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
        "      - uses: actions/checkout@$sha # v7.0.1",
        '      - name: keep it',
        "        uses: actions/upload-artifact@$other # v7.0.1"))
    Yes 'the reader finds both shapes of uses, on the step line and under a name' ($ok.Count -eq 2)
    Yes 'and a pinned pair is clean' (@(Get-PinFaults $ok).Count -eq 0)

    # A step with no name shows as its pin (#4166); one named before or after
    # its uses does not, and a job calling a reusable workflow is no step.
    $f = @(Get-NameFaults $ok)
    Yes ('a step whose uses is its first line and has no name is caught (' + ($f -join '; ') + ')') ($f.Count -eq 1 -and $f[0] -match 'good\.yml:4  actions/checkout has no name')
    $named = @(Fake 'named.yml' @(
        'jobs:', '  one:', '    steps:',
        "      - uses: actions/checkout@$sha # v7.0.1",
        '        name: Check out the code',
        '        with:',
        '          fetch-depth: 0',
        '      - name: Keep the report',
        '        if: always()',
        "        uses: actions/upload-artifact@$other # v7.0.1",
        '  two:',
        "    uses: ThornswoodRP/Thornswood/.github/workflows/x.yml@$sha # v7.0.1"))
    Yes 'a name after the uses or before it counts, and a reusable workflow job is no step' ($named.Count -eq 3 -and @(Get-NameFaults $named).Count -eq 0)
    $nested = @(Fake 'nested.yml' @(
        'jobs:', '  one:', '    steps:',
        '      - name: First',
        '        run: echo hi',
        "      - uses: actions/checkout@$sha # v7.0.1",
        '        with:',
        '          name: not the step''s name'))
    Yes 'a name: under with: is not the step''s name' (@(Get-NameFaults $nested).Count -eq 1)

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

    # The comment is the full release, never a tag that moves (#4165).
    $major = @(Fake 'major.yml' @('jobs:', '  one:', '    steps:', "      - uses: actions/upload-artifact@$sha # v7"))
    $f = @(Get-PinFaults $major)
    Yes ('a comment naming only the major tag, which moves, is caught (' + ($f -join '; ') + ')') ($f.Count -eq 1 -and $f[0] -match 'says # v7, not the full release tag')
    $minor = @(Fake 'minor.yml' @('jobs:', '  one:', '    steps:', "      - uses: actions/upload-artifact@$sha # v7.0"))
    Yes 'so is one naming a major and minor only' (@(Get-PinFaults $minor).Count -eq 1)
    $words = @(Fake 'words.yml' @('jobs:', '  one:', '    steps:', "      - uses: actions/upload-artifact@$sha # latest"))
    Yes 'so is one that is not a version at all' (@(Get-PinFaults $words).Count -eq 1)
    $after = @(Fake 'after.yml' @('jobs:', '  one:', '    steps:', "      - uses: actions/upload-artifact@$sha # v7.0.1 (the share's report)"))
    Yes 'and a full release with words after it is clean' (@(Get-PinFaults $after).Count -eq 0)

    # Two files, one action, two SHAs: the drift this is really for.
    $drift = @()
    $drift += @(Fake 'a.yml' @('jobs:', '  one:', '    steps:', "      - uses: actions/checkout@$sha # v7.0.1"))
    $drift += @(Fake 'b.yml' @('jobs:', '  one:', '    steps:', "      - uses: actions/checkout@$other # v7.0.1"))
    $f = @(Get-PinFaults $drift)
    Yes 'the same action pinned two ways in two workflows is caught' ($f.Count -eq 1 -and $f[0] -match 'pinned 2 different ways')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
