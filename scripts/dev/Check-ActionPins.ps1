<#
  Check-ActionPins.ps1

      .\scripts\dev\Check-ActionPins.ps1 -Run

  Holds every action pin in .github\workflows to the commit its tag names
  in the action's own repository, read from GitHub each night (#4165).

  Each `uses:` is a full commit SHA with its release tag in a comment
  (tests\test-action-pins.ps1 holds that shape on every pull request, with
  nothing fetched). That harness cannot say whether the comment is true:
  upload-artifact's pin said v7 while its commit was v7.0.1, and v7 had
  moved on. So this asks GitHub for refs/tags/<tag> in the action's
  repository and follows an annotated tag to its commit. A tag that names
  another commit, or a tag that is not there, is named with the files and
  lines that carry it, and the night is red until the pin or its comment is
  put right. Run by .github\workflows\nightly.yml in its step "Each action
  pin is the commit its tag names", with GH_TOKEN set; every action
  repository it reads is public.

  Read only. tests\test-4165-pin-tags.ps1 runs it against a stand-in GitHub.
#>
[CmdletBinding()]
param(
    # Read GitHub and say what does not match. Without it the script only
    # defines its functions, which is how the harness loads it.
    [switch]$Run,
    [string]$WorkflowDir
)

$ErrorActionPreference = 'Stop'
if (-not $WorkflowDir) { $WorkflowDir = Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.github') 'workflows' }

# Every pinned action in the workflows, one entry per action, SHA and tag,
# with every place it is written. An action in this repository (./...) has
# no pin. The repository is the first two parts of the action's name, so
# github/codeql-action/init is read from github/codeql-action.
function Get-ActionPins {
    param([string]$Dir = $WorkflowDir)
    $seen = @{}
    foreach ($f in @(Get-ChildItem -LiteralPath $Dir -File | Where-Object { $_.Extension -in '.yml', '.yaml' } | Sort-Object Name)) {
        $lines = [IO.File]::ReadAllText($f.FullName) -split "`r?`n"
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $m = [regex]::Match($lines[$i], '^\s*(?:-\s+)?uses:\s*(?<action>[^\s#@]+)@(?<sha>[0-9a-f]{40})\s*#\s*(?<tag>v\d+\.\d+\.\d+)(\s|$)')
            if (-not $m.Success) { continue }
            $action = $m.Groups['action'].Value
            $parts = $action.Split('/')
            $key = $action + '@' + $m.Groups['sha'].Value + '#' + $m.Groups['tag'].Value
            if (-not $seen.ContainsKey($key)) {
                $seen[$key] = [pscustomobject]@{
                    Action = $action; Repo = ($parts[0] + '/' + $parts[1])
                    Sha = $m.Groups['sha'].Value; Tag = $m.Groups['tag'].Value
                    Where = New-Object System.Collections.ArrayList
                }
            }
            [void]$seen[$key].Where.Add(('{0}:{1}' -f $f.Name, ($i + 1)))
        }
    }
    return @($seen.Values | Sort-Object Action, Tag)
}

# One call to the GitHub API. The harness replaces Invoke-RestMethod under it.
function Invoke-PinApi {
    param([string]$Path)
    $h = @{ Authorization = "Bearer $env:GH_TOKEN"; 'User-Agent' = 'thornswood-nightly'; Accept = 'application/vnd.github+json' }
    return Invoke-RestMethod -Method GET -Headers $h -Uri ('https://api.github.com/' + $Path)
}

# The commit a tag names in a repository, an annotated tag followed to its
# commit, or $null when the repository has no such tag (GitHub answers 404).
# Any other failure stops the night: a pin that was not read is not a pass.
function Get-TagCommit {
    param([string]$Repo, [string]$Tag)
    try { $ref = Invoke-PinApi "repos/$Repo/git/ref/tags/$Tag" }
    catch {
        $code = 0
        if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        if ($code -eq 404) { return $null }
        throw
    }
    $o = $ref.object
    $hops = 0
    while ([string]$o.type -eq 'tag') {
        if (++$hops -gt 5) { throw "$Repo $Tag is a tag of a tag more than 5 deep" }
        $o = (Invoke-PinApi ("repos/$Repo/git/tags/" + [string]$o.sha)).object
    }
    if ([string]$o.type -ne 'commit') { throw ("$Repo $Tag names a " + [string]$o.type + ', not a commit') }
    return ([string]$o.sha).ToLowerInvariant()
}

# What is wrong with the pins, one line each, or nothing when every tag names
# its pin's commit.
function Find-PinMismatch {
    param($Pins)
    $bad = New-Object System.Collections.ArrayList
    foreach ($p in @($Pins)) {
        $at = Get-TagCommit $p.Repo $p.Tag
        $where = $p.Where -join ', '
        if (-not $at) { [void]$bad.Add(('{0}@{1} says {2}, and {3} has no tag {2} ({4})' -f $p.Action, $p.Sha, $p.Tag, $p.Repo, $where)) }
        elseif ($at -ne $p.Sha) { [void]$bad.Add(('{0}@{1} says {2}, and {2} is {3} ({4})' -f $p.Action, $p.Sha, $p.Tag, $at, $where)) }
    }
    return @($bad.ToArray())
}

if ($Run) {
    $pins = @(Get-ActionPins)
    if (-not $pins.Count) { Write-Host '::error::no pinned action was read from .github\workflows, so nothing was checked'; exit 1 }
    $bad = @(Find-PinMismatch $pins)
    foreach ($b in $bad) { Write-Host ('::error::' + $b) }
    foreach ($p in $pins) { Write-Host ('{0}  {1}  {2}  ({3} place(s))' -f $p.Action, $p.Sha, $p.Tag, $p.Where.Count) }
    if ($bad.Count) { Write-Host ("{0} of {1} pin(s) are not the commit their tag names" -f $bad.Count, $pins.Count); exit 1 }
    Write-Host ("every one of {0} pin(s) is the commit its tag names" -f $pins.Count)
    exit 0
}
