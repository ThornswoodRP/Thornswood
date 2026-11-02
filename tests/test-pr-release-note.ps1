<#
  test-pr-release-note.ps1

      pwsh -NoProfile -File .\tests\test-pr-release-note.ps1

  Each pull request carries its own release note, checked while it is open,
  and a release's note is joined from them (#5179). This drives the pieces:
  Get-PrReleaseNote, Get-PrReleaseNoteProblems and Join-PrReleaseNotes in
  scripts\release\Note-Rules.ps1, the check's own command (thornswood-notes
  in tools\ReleaseNotes, when the .NET SDK is here), and
  scripts\release\Collect-ReleaseNotes.ps1 through -PullsFile, and holds the
  template, the workflow and the guide to the same line.
  tests\test-note-rules-cases.ps1 holds the two copies of the rules to the
  same answers.

  Read only apart from its own temp folder, which it removes.
#>
[CmdletBinding()]
param()
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

. (Join-Path $Repo 'scripts/release/Note-Rules.ps1')
$pwsh = (Get-Process -Id $PID).Path
$temp = Join-Path ([IO.Path]::GetTempPath()) ("pr-note-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null

$good = @"
## What changed

The forge reads its prices from the table.

Release note: The forge shows the price before you pay
- The forge window lists each metal a piece takes and how much.

Refs #4242
"@
$none = "## What changed`n`nA harness.`n`nRelease note: none`n"
$template = [IO.File]::ReadAllText((Join-Path $Repo '.github/pull_request_template.md'))

try {
    # ---- reading the line -------------------------------------------------------
    $n = Get-PrReleaseNote $good
    Yes 'a note is found' ($n.Found -and -not $n.None)
    Yes 'its headline is the text after Release note:' ($n.Headline -eq 'The forge shows the price before you pay')
    Yes 'the "- " lines directly under it are its details' ($n.Details.Count -eq 1 -and $n.Details[0] -like '- The forge window*')
    Yes 'Refs below a blank line is not a detail' (-not ($n.Text -match 'Refs'))
    Yes 'none is read as none' ((Get-PrReleaseNote $none).None)
    Yes 'None. with a capital and a full stop is none' ((Get-PrReleaseNote "Release note: None.").None)
    Yes 'a bold label is read' ((Get-PrReleaseNote "**Release note:** none").None)
    Yes 'a line inside an HTML comment is not read' (-not (Get-PrReleaseNote "<!-- Release note: none -->").Found)

    # ---- what is refused --------------------------------------------------------
    function Problems([string]$body, [string]$author = '') { return @(Get-PrReleaseNoteProblems $body $author) }
    Yes 'a good note passes' ((Problems $good).Count -eq 0)
    Yes 'none passes' ((Problems $none).Count -eq 0)
    Yes 'a body with CRLF line ends, as GitHub''s editor sends it, passes the same' ((Problems ($good -replace "`r?`n", "`r`n")).Count -eq 0)
    Yes 'no line is refused' ((Problems "## What changed`n`nStuff.").Count -gt 0)
    Yes 'the template as it comes is refused (the line is empty)' ((Problems $template).Count -gt 0)
    Yes 'a headline with no detail line is refused' ((Problems "Release note: The forge shows the price").Count -gt 0)
    Yes 'a two word headline is refused' ((Problems "Release note: Forge prices`n- The forge window lists each metal.").Count -gt 0)
    Yes 'player is refused' ((Problems "Release note: Every player sees forge prices`n- The forge window lists each metal.").Count -gt 0)
    Yes 'an issue number is refused' ((Problems "Release note: The forge shows its prices`n- Fixed as asked in #4242 by the team.").Count -gt 0)
    Yes 'a code name is refused' ((Problems "Release note: The forge shows its prices`n- ForgePriceTable is read at start now.").Count -gt 0)
    Yes 'an em dash is refused' ((Problems ("Release note: The forge shows its prices`n- Every metal " + [char]0x2014 + " and its amount.")).Count -gt 0)
    Yes 'a version in the headline is refused' ((Problems "Release note: Launcher 1.2.16 is out now`n- The launcher starts faster than it did.").Count -gt 0)
    Yes 'two Release note lines are refused' ((Problems "Release note: none`n`nRelease note: none").Count -gt 0)
    Yes 'Dependabot passes with no line' ((Problems "Bumps discord.py from 2.4 to 2.5." 'dependabot[bot]').Count -eq 0)
    Yes 'anyone else with no line is refused' ((Problems "Bumps discord.py from 2.4 to 2.5." 'someone').Count -gt 0)

    # ---- the check's command -----------------------------------------------------
    $dotnet = Get-Command dotnet -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $dotnet) { Write-Host 'SKIP  the check''s command: the .NET SDK is not on this machine (the Release note rules workflow runs its tests)' }
    else {
        $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'; $env:DOTNET_NOLOGO = '1'
        $built = Join-Path $temp 'notes'
        $null = & $dotnet.Source build (Join-Path $Repo 'tools/ReleaseNotes') -c Release -o $built --verbosity quiet 2>&1
        Yes 'thornswood-notes builds' ($LASTEXITCODE -eq 0)
        function Run-Check([string]$body, [string]$author = '') {
            $f = Join-Path $temp 'body.md'
            [IO.File]::WriteAllText($f, $body)
            $with = @('pr', '--body-file', $f)
            if ($author) { $with += @('--author', $author) }
            $out = & $dotnet.Source (Join-Path $built 'thornswood-notes.dll') @with 2>&1
            return [pscustomobject]@{ Code = $LASTEXITCODE; Out = (@($out) -join "`n") }
        }
        $r = Run-Check $good
        Yes 'the check passes a good note and shows it' ($r.Code -eq 0 -and $r.Out -match 'The forge shows the price before you pay')
        $r = Run-Check $none
        Yes 'the check passes none' ($r.Code -eq 0 -and $r.Out -match 'PASS  release note: none')
        $r = Run-Check $template
        Yes 'the check stops the unfilled template and says why' ($r.Code -eq 1 -and $r.Out -match 'STOP  release note')
        $r = Run-Check "Bumps discord.py from 2.4 to 2.5." 'dependabot[bot]'
        Yes 'the check passes Dependabot with no line' ($r.Code -eq 0 -and $r.Out -match 'by rule for a Dependabot')
    }

    # ---- joining ----------------------------------------------------------------
    $b1 = "Release note: The forge shows the price before you pay`n- The forge window lists each metal a piece takes and how much."
    $b2 = "Release note: Hunters can skin rabbits again`n- Skinning a rabbit gives its pelt and meat."
    $b3 = "Release note: none"
    $j = Join-PrReleaseNotes @([pscustomobject]@{ Number = 1; Body = $b1 }, [pscustomobject]@{ Number = 2; Body = $b3 }, [pscustomobject]@{ Number = 3; Body = $b2 })
    $jl = @($j -split "`n")
    Yes 'the first note''s headline is the title' ($jl[0] -eq 'The forge shows the price before you pay')
    Yes 'a later note''s headline is a "- " line' ($jl -contains '- Hunters can skin rabbits again')
    Yes 'none is left out' ($jl.Count -eq 4)
    Yes 'the joined note passes the Ship rules' ((@(Get-NoteShapeProblems $j) + @(Get-NoteProblems $j)).Count -eq 0)
    $j2 = Join-PrReleaseNotes @([pscustomobject]@{ Number = 1; Body = $b1 }, [pscustomobject]@{ Number = 2; Body = $b1.Replace('The forge shows the price before you pay', 'Prices show at every forge now') })
    Yes 'a line already there is not written twice' (@($j2 -split "`n" | Where-Object { $_ -like '- The forge window*' }).Count -eq 1)
    Yes 'only none joins to nothing' ((Join-PrReleaseNotes @([pscustomobject]@{ Number = 1; Body = $b3 })) -eq '')

    # ---- the collector ----------------------------------------------------------
    function Run-Collect($pulls) {
        $f = Join-Path $temp 'pulls.json'
        [IO.File]::WriteAllText($f, (ConvertTo-Json -InputObject @($pulls) -Depth 4))
        $o = Join-Path $temp 'note.txt'
        if (Test-Path $o) { Remove-Item $o }
        $out = & $pwsh -NoProfile -File (Join-Path $Repo 'scripts/release/Collect-ReleaseNotes.ps1') -PullsFile $f -OutFile $o 2>&1
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = (@($out) -join "`n"); Note = $(if (Test-Path $o) { [IO.File]::ReadAllText($o) } else { '' }) }
    }
    $r = Run-Collect @(@{ number = 1; title = 'a'; body = $b1; author = 'x' }, @{ number = 2; title = 'b'; body = $b2; author = 'x' }, @{ number = 3; title = 'c'; body = 'no line'; author = 'dependabot[bot]' })
    Yes 'Collect writes the joined note and ends 0' ($r.Code -eq 0 -and $r.Note -match '^The forge shows the price' -and $r.Note -match '- Hunters can skin rabbits again')
    $r = Run-Collect @(@{ number = 1; title = 'a'; body = $b1; author = 'x' }, @{ number = 7; title = 'Old change'; body = 'no line here'; author = 'x' })
    Yes 'Collect ends 2 and names a merged pull request with no line' ($r.Code -eq 2 -and $r.Out -match '#7 Old change' -and -not $r.Note)
    $r = Run-Collect @(@{ number = 1; title = 'a'; body = $b3; author = 'x' })
    Yes 'Collect ends 3 when every change says none' ($r.Code -eq 3 -and $r.Out -match 'NONE')

    # ---- the template, the workflow and the guide say the same line -------------
    # A Windows checkout holds the template with CRLF, and .NET's $ stops only
    # before a LF, so the line may end in a CR here.
    Yes 'the template has an empty Release note line to fill in' ($template -match '(?m)^Release note: ?\r?$')
    $wf = [IO.File]::ReadAllText((Join-Path $Repo '.github/workflows/pr-body.yml'))
    Yes 'the workflow runs on an edited body' ($wf -match 'types: \[[^\]]*\bedited\b')
    Yes 'the workflow passes the body through the environment, not into the script' ($wf -match 'PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}' -and $wf -notmatch 'run:[^\n]*github\.event\.pull_request\.body')
    Yes 'the workflow runs thornswood-notes from the locked packages with a read-only token' ($wf -match 'thornswood-notes\.dll''\) @with' -and $wf -match 'dotnet restore tools/ReleaseNotes --locked-mode' -and $wf -match 'contents: read' -and $wf -notmatch '(?m)^\s+[a-z-]+: write\s*$')
    # The queue landed #5364 with this check red on 1 Nov 2026, and every
    # merge release after it stopped at its notes: the check is required on
    # main and runs on the queue's merge too.
    Yes 'the workflow runs in the merge queue' ($wf -match '(?m)^  merge_group:\s*$' -and $wf -match 'QUEUE_REF: \$\{\{ github\.event\.merge_group\.head_ref \}\}')
    $queueRule = [regex]::Match($wf, "-notmatch '([^']+)'").Groups[1].Value
    Yes '  and reads the pull request its queue branch names' ($queueRule -and ('refs/heads/gh-readonly-queue/main/pr-5364-' + ('a' * 40)) -match $queueRule -and $Matches[2] -eq '5364' -and
        -not ('refs/heads/main' -match $queueRule) -and $wf.Contains('"repos/$env:GITHUB_REPOSITORY/pulls/$num"'))
    $settings = [IO.File]::ReadAllText((Join-Path $Repo 'records/github-repo-settings.json')) | ConvertFrom-Json
    $mainSet = @(@($settings.repositories | Where-Object { $_.repository -eq 'ThornswoodRP/Thornswood' })[0].rulesets | Where-Object { $_.name -eq 'main' })
    $requiredChecks = @($mainSet | ForEach-Object { $_.rules } | Where-Object { $_.type -eq 'required_status_checks' } | ForEach-Object { $_.parameters.required_status_checks } | ForEach-Object { $_.context })
    $jobName = [regex]::Match($wf, '(?m)^    name: (.+?)\s*$').Groups[1].Value
    Yes ('main''s ruleset requires this check by its job''s name (' + $jobName + '; required: ' + ($requiredChecks -join ', ') + ')') ($jobName -eq 'Release note' -and $requiredChecks -contains $jobName)
    . (Join-Path $PSScriptRoot 'Guide-Text.ps1')
    $guide = Get-GuideText
    Yes 'the guide says how to write the line and how a release gathers it' ($guide -match 'Release note: none' -and $guide -match 'Collect-ReleaseNotes\.ps1')
} finally {
    Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
exit 0
