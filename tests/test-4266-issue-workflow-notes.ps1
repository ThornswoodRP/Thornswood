# Issue #4266. A workflow an issue event starts can be started by anybody once
# the repository is public: anyone may open an issue, and its author may close
# it. So every such workflow runs on GitHub's hosted runners, never on a
# self-hosted one (the box runs the live game, the site and the bot), and its
# header says where it runs and why, so the next change to it keeps it there.
#
# For each workflow under .github/workflows whose on: names issues or
# issue_comment, this checks that:
#   - every runs-on names only GitHub-hosted images (ubuntu-*, windows-*,
#     macos-*), and nothing self-hosted or of the box's labels;
#   - its header has a WHERE IT RUNS note naming GitHub's runner, saying that
#     anyone can start it on a public repository, and that it never reaches
#     the box.
# It also checks that at least one such workflow is found, so a rename of the
# trigger cannot pass this by finding none.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$wfDir = Join-Path (Join-Path $root '.github') 'workflows'
$script:pass = 0; $script:fail = 0
function Yes([string]$name, [bool]$ok) {
    if ($ok) { Write-Host "PASS  $name"; $script:pass++ } else { Write-Host "FAIL  $name"; $script:fail++ }
}

# The on: block: from a line 'on:' at the left edge to the next top-level key.
function OnBlock([string]$text) {
    $m = [regex]::Match($text, '(?ms)^on:[ \t]*(.*?)(?=^[A-Za-z_][\w-]*:)')
    if ($m.Success) { return $m.Groups[1].Value }
    return ''
}
# The header: the comment lines before the first line that is not a comment.
function Header([string]$text) {
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($l in ($text -split "`n")) { if ($l -match '^#') { $lines.Add($l.Substring(1).Trim()) } else { break } }
    return (($lines -join ' ') -replace '\s+', ' ')
}

$found = @()
foreach ($f in @(Get-ChildItem -LiteralPath $wfDir -Filter '*.yml' | Sort-Object Name)) {
    $text = [IO.File]::ReadAllText($f.FullName) -replace "`r`n", "`n"
    $on = OnBlock $text
    if ($on -notmatch '(?m)^\s+(issues|issue_comment):' -and $on -notmatch '\b(issues|issue_comment)\b\s*[\],]') { continue }
    $found += $f.Name
    $runs = @([regex]::Matches($text, '(?m)^\s+runs-on:\s*(.+)$') | ForEach-Object { $_.Groups[1].Value.Trim() })
    $hosted = $runs.Count -gt 0 -and @($runs | Where-Object {
        $_ -match 'self-hosted|thornswood' -or
        ($_ -notmatch '\$\{\{' -and $_ -notmatch '^(ubuntu|windows|macos)-[\w.]+$')
    }).Count -eq 0
    Yes "$($f.Name) runs only on GitHub's hosted runners ($($runs -join '; '))" $hosted
    $h = Header $text
    $where = [regex]::Match($h, 'WHERE IT RUNS\.?(.*)$').Groups[1].Value
    Yes "  its header says WHERE IT RUNS, on GitHub's runner" ($where -match "GitHub's")
    Yes "  and why: anyone can start it on a public repository, so it never reaches the box" ($where -match '\banyone\b' -and $where -match '\bpublic\b' -and $where -match '\bbox\b')
}
Yes "the workflows an issue event starts are found ($($found -join ', '))" ($found.Count -ge 3)

Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
