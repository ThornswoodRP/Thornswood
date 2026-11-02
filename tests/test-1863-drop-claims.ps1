<#
  test-1863-drop-claims.ps1

  When an issue closes, every claimed: label comes off it, and nothing else.

  WHY THIS EXISTS. Issue #1863. A pull request's Closes #N closes the issue
  without touching its labels, and only the Claude agents' tw-unclaim took
  its own lane's label off. On 5 Oct five closed issues still carried one and
  were cleared by hand (#1123). Patrick, 5 Oct: yes, a workflow that removes
  them. .github\workflows\drop-claims.yml is that workflow.

  What it checks:
    1. the workflow is there, runs on an issue closing and on nothing else,
       with a token that can only edit issues, on GitHub's runner (#4983),
       with a timeout, and only when the issue carries
       a claimed label;
    2. it checks out nothing and runs no action, and the label names reach
       the script through the environment: no ${{ }} inside the script, so a
       label's name can never be read as code;
    3. the script itself, lifted out of the workflow and run in a child
       PowerShell with a stand-in Invoke-RestMethod that writes down each call
       instead of making it: every claimed label (any spelling GitHub allows,
       "claimed: Claude", "claimed:GitHub", each Hermes Bot's "claimed:
       Bramble" and the rest, #4715) is one DELETE on that issue with
       the name escaped into the address, every other label is left alone, no
       claimed label is no call at all, a label already off (404) is said and
       passed over, and any other answer fails the run.

  It never reaches GitHub. Read only apart from files under its own temp
  folder.
#>
[CmdletBinding()]
param([string]$Workflow)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
if (-not $Workflow) { $Workflow = Join-Path $Repo '.github\workflows\drop-claims.yml' }

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

# ---- 1. the workflow --------------------------------------------------------
Yes '.github\workflows\drop-claims.yml is there' (Test-Path -LiteralPath $Workflow)
if (-not (Test-Path -LiteralPath $Workflow)) { Done }
$text = [IO.File]::ReadAllText($Workflow) -replace "`r`n", "`n"

$on = [regex]::Match($text, '(?ms)^on:\n(.*?)^\S').Groups[1].Value
Yes 'it runs when an issue closes' ($on -match '(?m)^\s+issues:\s*$' -and $on -match 'types:\s*\[\s*closed\s*\]')
Yes '  and on nothing else' (@([regex]::Matches($on, '(?m)^  [a-z_]+:') ).Count -eq 1)

$perm = [regex]::Match($text, '(?ms)^permissions:\n(.*?)^\S').Groups[1].Value
$grants = @([regex]::Matches($perm, '(?m)^\s+([a-z-]+):\s*(\S+)') | ForEach-Object { $_.Groups[1].Value + ': ' + $_.Groups[2].Value })
Yes ("its token can edit issues and nothing else ({0})" -f ($grants -join ', ')) ($grants.Count -eq 1 -and $grants[0] -eq 'issues: write')
Yes '  and no job widens it' (@([regex]::Matches($text, '(?m)^\s+permissions:')).Count -eq 0)

$runsOn = [regex]::Match($text, '(?m)^\s*runs-on:\s*(.+)$').Groups[1].Value.Trim()
Yes ("it runs on GitHub's Windows runner, never the box, since anyone can close their own issue (#3685, #4983) ({0})" -f $runsOn) ($runsOn -eq 'windows-latest')
Yes '  with a timeout' ($text -match '(?m)^\s+timeout-minutes:\s*\d+\s*$')
Yes '  and only when the closed issue carries a claimed label, so a close with none takes no runner' (
    $text -match [regex]::Escape("if: `${{ contains(join(github.event.issue.labels.*.name, '|'), 'claimed') }}"))

# ---- 2. nothing from the repository, nothing pasted into the script ---------
Yes 'it checks out nothing and runs no action' ($text -notmatch '(?m)^\s*(-\s+)?uses:')
$run = [regex]::Match($text, '(?ms)^(\s+)run: \|\n(.*)$')
Yes 'it has one script' ($run.Success -and @([regex]::Matches($text, '(?m)^\s+run:')).Count -eq 1)
$indent = ''
$script = ''
if ($run.Success) {
    $lines = $run.Groups[2].Value -split "`n"
    $indent = [regex]::Match($lines[0], '^\s*').Value
    $body = @()
    foreach ($l in $lines) {
        if ($l.Trim().Length -and -not $l.StartsWith($indent)) { break }
        $body += $(if ($l.Length -ge $indent.Length) { $l.Substring($indent.Length) } else { '' })
    }
    $script = ($body -join "`n").TrimEnd() + "`n"
}
Yes 'the script has no ${{ }} in it: the label names come in through the environment' ($script.Length -gt 0 -and $script -notmatch '\$\{\{')
Yes '  as LABELS, the names out of the event as JSON' ($text -match [regex]::Escape('LABELS: ${{ toJSON(github.event.issue.labels.*.name) }}'))
Yes '  with the issue number and the run''s own token beside them' (
    $text -match [regex]::Escape('ISSUE: ${{ github.event.issue.number }}') -and $text -match [regex]::Escape('GH_TOKEN: ${{ github.token }}'))
Yes 'the script runs under pwsh' ($text -match '(?m)^\s+shell:\s*pwsh\s*$')

# ---- 3. the script, run against a stand-in for GitHub -----------------------
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue)
Yes 'pwsh is on this machine to run the script with' ($null -ne $pwsh)
if (-not $pwsh -or -not $script) { Done }

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-drop-claims-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$calls = Join-Path $work 'calls.txt'
# Defined before the script, so the script's Invoke-RestMethod is this one.
# It writes down the method and the address and answers as GitHub would: 404
# for a label named in TS_GONE, 500 for one named in TS_BROKEN.
$standIn = @'
function Invoke-RestMethod {
    param([string]$Method, [string]$Uri, [hashtable]$Headers)
    [IO.File]::AppendAllText($env:TS_CALLS, ($Method + ' ' + $Uri + ' ' + $Headers['Authorization']) + "`n")
    $name = [Uri]::UnescapeDataString(($Uri -split '/labels/')[1])
    foreach ($pair in @(@($env:TS_GONE, 'NotFound'), @($env:TS_BROKEN, 'InternalServerError'))) {
        if ($pair[0] -and $name -eq $pair[0]) {
            $res = [System.Net.Http.HttpResponseMessage]::new([System.Net.HttpStatusCode]$pair[1])
            throw [Microsoft.PowerShell.Commands.HttpResponseException]::new('Response status code does not indicate success.', $res)
        }
    }
    return [pscustomobject]@{}
}

'@
$runner = Join-Path $work 'drop.ps1'
[IO.File]::WriteAllText($runner, $standIn + $script)

function Invoke-Drop([string[]]$labels, [string]$gone = '', [string]$broken = '') {
    if (Test-Path -LiteralPath $calls) { Remove-Item -LiteralPath $calls -Force }
    $keep = @{}
    foreach ($k in 'GH_TOKEN', 'ISSUE', 'LABELS', 'GITHUB_REPOSITORY', 'TS_CALLS', 'TS_GONE', 'TS_BROKEN') { $keep[$k] = [Environment]::GetEnvironmentVariable($k) }
    try {
        $env:GH_TOKEN = 'stand-in-token'
        $env:ISSUE = '1863'
        $env:GITHUB_REPOSITORY = 'ThornswoodRP/Thornswood'
        # What toJSON hands the step: a JSON array of the names, [] for none.
        $env:LABELS = ConvertTo-Json -InputObject @($labels) -Compress
        $env:TS_CALLS = $calls
        $env:TS_GONE = $gone
        $env:TS_BROKEN = $broken
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $out = & $pwsh.Source -NoProfile -NonInteractive -File $runner 2>&1 | Out-String; $code = $LASTEXITCODE }
        finally { $ErrorActionPreference = $old }
    } finally {
        foreach ($k in $keep.Keys) { [Environment]::SetEnvironmentVariable($k, $keep[$k]) }
    }
    $made = @()
    if (Test-Path -LiteralPath $calls) { $made = @(Get-Content -LiteralPath $calls | Where-Object { $_ }) }
    return [pscustomobject]@{ Code = $code; Out = $out; Calls = $made }
}
$base = 'https://api.github.com/repos/ThornswoodRP/Thornswood/issues/1863/labels/'

try {
    $r = Invoke-Drop @('claimed: Claude', 'area: Release', 'claimed:GitHub', 'anyone can start', 'needs: Patrick')
    Yes ("two claimed labels among five: the run passes (exit {0})" -f $r.Code) ($r.Code -eq 0)
    Yes ("  and makes exactly two calls ({0})" -f $r.Calls.Count) ($r.Calls.Count -eq 2)
    Yes '  a DELETE of claimed: Claude, its name escaped into the address' (@($r.Calls | Where-Object { $_ -eq ('DELETE ' + $base + 'claimed%3A%20Claude Bearer stand-in-token') }).Count -eq 1)
    Yes '  a DELETE of claimed:GitHub' (@($r.Calls | Where-Object { $_ -eq ('DELETE ' + $base + 'claimed%3AGitHub Bearer stand-in-token') }).Count -eq 1)
    Yes '  and no call for area:, needs: or anyone can start' (@($r.Calls | Where-Object { $_ -match 'area|needs|anyone' }).Count -eq 0)
    Yes '  and it says what it removed' ($r.Out -match 'removed claimed: Claude from #1863' -and $r.Out -match 'removed claimed:GitHub from #1863')

    $r = Invoke-Drop @('claimed: Codex')
    Yes ("one claimed label, the only label: one DELETE (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Calls.Count -eq 1 -and $r.Calls[0] -like ('DELETE ' + $base + 'claimed%3A%20Codex *'))

    # The six Hermes Bots claim with labels of their own (#4715), made after
    # this test, so it holds them by name: a change to the prefix match that
    # left them on a closed issue fails here.
    $bots = @('Bramble', 'Rift', 'Sprocket', 'Echo', 'Magpie', 'Wisp')
    $r = Invoke-Drop (@($bots | ForEach-Object { "claimed: $_" }) + 'area: Launcher')
    Yes ("each Bot's claimed label is one DELETE, and the area label stays (exit {0})" -f $r.Code) (
        $r.Code -eq 0 -and $r.Calls.Count -eq 6 -and
        @($bots | Where-Object { $b = $_; @($r.Calls | Where-Object { $_ -like ('DELETE ' + $base + 'claimed%3A%20' + $b + ' *') }).Count -eq 1 }).Count -eq 6)

    $r = Invoke-Drop @('area: Release', 'wave: 2')
    Yes ("no claimed label: no call at all (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Calls.Count -eq 0)

    $r = Invoke-Drop @()
    Yes ("no labels at all: no call, and the run passes (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Calls.Count -eq 0)

    $r = Invoke-Drop @('claimed: Claude/Two #1', 'area: Release')
    Yes 'a name with a slash and a hash stays one label in the address' (
        $r.Code -eq 0 -and $r.Calls.Count -eq 1 -and $r.Calls[0] -like ('DELETE ' + $base + 'claimed%3A%20Claude%2FTwo%20%231 *'))

    $r = Invoke-Drop @('claimed: Claude', 'claimed: Installer') 'claimed: Claude'
    Yes ("a label already off (404) is said and passed over, and the next one still goes (exit {0})" -f $r.Code) (
        $r.Code -eq 0 -and $r.Calls.Count -eq 2 -and $r.Out -match 'claimed: Claude was already off #1863' -and $r.Out -match 'removed claimed: Installer from #1863')

    $r = Invoke-Drop @('claimed: Claude') '' 'claimed: Claude'
    Yes ("any other answer fails the run (exit {0})" -f $r.Code) ($r.Code -ne 0 -and $r.Out -notmatch 'removed claimed: Claude')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
