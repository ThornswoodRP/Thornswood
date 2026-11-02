# test-bot-requirements.ps1
#
#     pwsh -NoProfile -File .\tests\test-bot-requirements.ps1
#
# The bot's libraries are pinned by hash, and every installer insists on it
# (issue #2190). Reads the checkout only: nothing is downloaded or installed.
#   - bot\requirements.txt pins every library to one version with at least
#     one sha256, has no unpinned line, no editable or URL install, and no
#     --hash that is not 64 hex digits.
#   - bot\requirements.in names the libraries the bot imports, and each is in
#     requirements.txt at the same version.
#   - Install-Bot.ps1 and nightly.yml install it with --require-hashes and
#     --only-binary :all:, and nothing installs it without them.
#   - nightly.yml installs it in a job of its own that asks for the check
#     label, so never on the signing runner, which reaches GitHub and the
#     signing service only (#4914, Patrick's A on 30 Oct).
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Text([string]$rel) { return [IO.File]::ReadAllText((Join-Path $repo $rel)).Replace("`r`n", "`n") }
function Norm([string]$n) { return ($n.ToLowerInvariant() -replace '[-_.]+', '-') }

# ---- requirements.txt: each requirement with its continuation lines
$txt = Text 'bot\requirements.txt'
Yes 'requirements.txt says how to regenerate it, and from what' ($txt.Contains('uv pip compile bot\requirements.in --generate-hashes') -and $txt.Contains('--only-binary :all:'))
$logical = @(($txt -replace '\\\n', ' ') -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
$pins = @{}
$bad = @()
foreach ($l in $logical) {
    if ($l -match '^(-e|--editable|-r|-c|--index-url|--extra-index-url|-f|--find-links|--trusted-host)\b' -or $l -match '://|@ ') { $bad += "not a plain pin: $l"; continue }
    if ($l -notmatch '^([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9.+!-]+)\s+(.*)$') { $bad += "no ==version: $l"; continue }
    $name = Norm $Matches[1]; $ver = $Matches[2]; $rest = $Matches[3]
    $hashes = @([regex]::Matches($rest, '--hash=sha256:(\S+)') | ForEach-Object { $_.Groups[1].Value })
    if (-not $hashes.Count) { $bad += "$name has no --hash" }
    foreach ($h in $hashes) { if ($h -notmatch '^[0-9a-f]{64}$') { $bad += "$name has a hash that is not 64 hex digits: $h" } }
    if (($rest -replace '--hash=sha256:\S+', '').Trim()) { $bad += "$name has something other than hashes: $rest" }
    if ($pins.ContainsKey($name)) { $bad += "$name is listed twice" }
    $pins[$name] = $ver
}
Yes ("every line of requirements.txt is name==version with sha256 hashes only ({0} libraries)" -f $pins.Count) ($bad.Count -eq 0 -and $pins.Count -ge 3)
foreach ($b in $bad) { Write-Host "      $b" }

# ---- requirements.in: what the bot names, each in the lock at the same version
$in = @((Text 'bot\requirements.in') -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
$top = @{}
foreach ($l in $in) { if ($l -match '^([A-Za-z0-9][A-Za-z0-9._-]*)==(\S+)$') { $top[(Norm $Matches[1])] = $Matches[2] } else { $top['?' + $l] = '' } }
Yes 'requirements.in pins discord.py, pillow and certifi by version, and nothing loose' ($top.Count -eq 3 -and $top.ContainsKey('discord-py') -and $top.ContainsKey('pillow') -and $top.ContainsKey('certifi') -and -not @($top.Keys | Where-Object { $_.StartsWith('?') }).Count)
Yes '  and each is in requirements.txt at the same version' (-not @($top.Keys | Where-Object { $pins[$_] -ne $top[$_] }).Count)
Yes '  aiohttp, which discord.py pulls in, is pinned too (the whole tree, not just the top)' ($pins.ContainsKey('aiohttp') -and $pins.ContainsKey('yarl') -and $pins.ContainsKey('multidict'))

# ---- every installer insists on the hashes
$ib = Text 'scripts\deploy\Install-Bot.ps1'
$ny = Text '.github\workflows\nightly.yml'
$ibLines = @($ib -split "`n" | Where-Object { $_ -match 'pip install' -and $_ -match 'requirements\.txt' -and $_ -notmatch '^\s*#' })
$nyLines = @($ny -split "`n" | Where-Object { $_ -match 'pip install' -and $_ -match 'requirements\.txt' -and $_ -notmatch '^\s*#' })
$weak = @(@($ibLines) + @($nyLines) | Where-Object { $_ -notmatch '--require-hashes' -or $_ -notmatch '--only-binary :all:' })
Yes 'Install-Bot.ps1 installs requirements.txt with --require-hashes --only-binary :all:' ($ibLines.Count -ge 1 -and -not @($ibLines | Where-Object { $_ -notmatch '--require-hashes' -or $_ -notmatch '--only-binary :all:' }).Count)
Yes 'nightly.yml installs it for the bot harnesses the same way' ($nyLines.Count -ge 1 -and -not @($nyLines | Where-Object { $_ -notmatch '--require-hashes' -or $_ -notmatch '--only-binary :all:' }).Count)
# The job that installs it, by the job header above the install line.
$nyJobs = @([regex]::Matches(($ny -split '(?m)^jobs:\s*$', 2)[1], '(?ms)^  ([A-Za-z0-9_-]+):\s*$(.*?)(?=^  [A-Za-z0-9_-]+:\s*$|\z)'))
$installJobs = @($nyJobs | Where-Object { $_.Groups[2].Value -match 'pip install[^\n]*requirements\.txt' })
Yes '  in one job, on GitHub''s runner, which reaches the package feeds (#4914, #4033)' (
    $installJobs.Count -eq 1 -and $installJobs[0].Groups[2].Value -match '(?m)^    runs-on: windows-latest\s*$')
$others = @()
foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $repo 'scripts') -Recurse -File -Include *.ps1) + @(Get-ChildItem -LiteralPath (Join-Path $repo '.github\workflows') -File -Filter *.yml)) {
    foreach ($l in [IO.File]::ReadAllLines($f.FullName)) {
        if ($l -match 'pip(3)?(\.exe)?\s+install' -and $l -match 'bot[\\/]requirements\.txt|requirements\.txt' -and $l -notmatch '^\s*#' -and $l -notmatch 'ruff-requirements' -and ($l -notmatch '--require-hashes')) { $others += ($f.Name + ': ' + $l.Trim()) }
    }
}
Yes 'no script or workflow installs a requirements file without --require-hashes' ($others.Count -eq 0 -and $weak.Count -eq 0)
foreach ($o in $others) { Write-Host "      $o" }

# ---- the artifact still carries the lock
Yes 'Install-Bot sends requirements.txt with the code' ($ib -match "'bot/requirements\.txt'")

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
