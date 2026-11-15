<#
  test-install-runner.ps1

      pwsh -NoProfile -File .\tests\test-install-runner.ps1

  The box's runners stay safe, and no workflow of this repository asks for
  one.

  WHY. The box's runners run on the same box as the live game server, the
  site, voice and the bot (issue #437). Since the flip they are registered
  to Thornswood-Ops alone (#4013), and this repository's workflows run on
  GitHub's runners (#4983). Install-Runner.ps1 makes the account the jobs
  run as. This holds the parts that matter: the label, an account with no
  admin rights that
  is shut out of the live folders, a download checked against GitHub's own
  SHA-256, a registration token that is never printed, no priority set above
  the normal a service starts at (tests\test-runner-priority.ps1 holds the
  rest of priority, #1969), and a bot step that never installs into the
  machine's Python.

  HOW. Reads both files as text, and parses the script.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $Repo) { $Repo = $Here }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$path = Join-Path $Repo 'scripts\deploy\Install-Runner.ps1'
$text = [IO.File]::ReadAllText($path)
$yml = [IO.File]::ReadAllText((Join-Path $repo '.github\workflows\build.yml'))
# The bot harnesses run in the nightly checks since 25 September.
$night = [IO.File]::ReadAllText((Join-Path $repo '.github\workflows\nightly.yml'))

$t = $null; $e = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$t, [ref]$e)
Yes 'Install-Runner.ps1 parses' (-not $e -or $e.Count -eq 0)

# ---- the label ------------------------------------------------------------------
$label = [regex]::Match($text, "\[string\]\`$Label\s*=\s*'([^']+)'").Groups[1].Value
Yes "Install-Runner gives the runner a label ($label)" ($label.Length -gt 0)
# The box's runners serve Thornswood-Ops alone since the flip (#4013), so
# no workflow here asks for one (#4983). A runner is asked for by runs-on,
# on its line or as an item of the list under it; self-hosted anywhere else
# is not an ask (engine.yml's gh attestation verify --deny-self-hosted-runners
# refuses a build made on one, #5201). The box's label is never written here.
$wfDir = Join-Path $Repo '.github\workflows'
$asks = @(Get-ChildItem -LiteralPath $wfDir -Filter '*.yml' | Where-Object { [IO.File]::ReadAllText($_.FullName) -match ('(?m)^[^#\n]*runs-on:[^#\n]*self-hosted|^\s*-\s*self-hosted\b|^[^#\n]*' + [regex]::Escape($label)) } | ForEach-Object { $_.Name })
Yes ("no workflow here asks for a runner of the box or its label (" + ($asks -join ', ') + ")") ([bool]$label -and $asks.Count -eq 0)
Yes '  build.yml and nightly.yml run on GitHub''s hosted runner (#1306, #4983)' ($yml -match '(?m)^\s+runs-on: windows-latest\s*$' -and $night -match '(?m)^\s+runs-on: windows-latest\s*$')
Yes '  while a pull request builds on GitHub''s hosted runner in build-pr.yml, never the VPS (#1306)' ([IO.File]::ReadAllText((Join-Path (Split-Path $PSScriptRoot) '.github\workflows\build-pr.yml')) -match '(?m)^\s+runs-on: windows-latest\s*$')
Yes '  with a timeout' ($yml -match '(?m)^\s*timeout-minutes:\s*\d+')
Yes '  one run per branch at a time, main''s newer push waiting for the one in progress (#3874)' ($yml -match '(?m)^  group: build-\$\{\{ github\.ref \}\}\s*$' -and $yml -match '(?m)^  cancel-in-progress: false\s*$')
Yes '  and a token that can only read' ($yml -match '(?m)^permissions:\s*\r?\n\s+contents:\s*read')

# ---- the bot step never touches the machine's Python ----------------------------
Yes 'the bot harnesses install into a venv of their own' ($night -match 'python -m venv' -and $night -match "Scripts\\python\.exe")
Yes '  and nothing runs pip with the machine''s python' ($yml -notmatch '(?m)^\s*python -m pip install')

# ---- the account ------------------------------------------------------------------
Yes 'the account is made as a plain local user' ($text -match 'New-LocalUser')
Yes '  in Users' ($text -match "Add-LocalGroupMember -Group 'Users'")
Yes '  and never in Administrators' ($text -notmatch "Add-LocalGroupMember -Group 'Administrators'")
Yes '  its password is made on the box, not sent from here' ($text -match 'RNGCryptoServiceProvider' -and $text -notmatch '(?m)^\s*\$pw\s*=')
$descs = @([regex]::Matches($text, "-Description '([^']*)'") | ForEach-Object { $_.Groups[1].Value })
Yes '  its description fits the 48 characters New-LocalUser allows' ($descs.Count -ge 1 -and @($descs | Where-Object { $_.Length -gt 48 }).Count -eq 0)
$acctDefault = [regex]::Match($text, "\[string\]\`$Account\s*=\s*'([^']*)'").Groups[1].Value
Yes "  its name fits the 20 characters a local account may have (found '$acctDefault')" ($acctDefault.Length -ge 1 -and $acctDefault.Length -le 20)
Yes '  its password is letters and digits, which cmd.exe passes to config.cmd untouched' ($text -notmatch 'GeneratePassword' -and $text.Contains('Pick (`$up + `$lo + `$dg) 37'))
Yes 'the service runs as that account' ($text -match '--windowslogonaccount')
Yes 'every live Thornswood folder is denied to it, by the Close-RunnerAccount -Lock runs' ($text.Contains("Close-RunnerAccount ```$acct ```$root 'C:\' '`$liveFilter' `$alsoDenyList `$leaveList"))
Yes '  except its own' ($text.Contains('if ($d.FullName -eq $own) { continue }'))
Yes '  and Dumps on the VPS, which Lock-VpsFolders.ps1 gives it write on (#2127, #2488; scripts\tests\test-runner-lock.ps1 holds the rest)' ($text.Contains("`$leaveList = `$(if (`$OffBox) { '@()' } else { `"@('Thornswood-Dumps')`" })"))

# ---- the download ------------------------------------------------------------------
Yes 'the runner zip is checked against the SHA-256 in the release notes' ($text -match 'BEGIN SHA win-x64' -and $text -match 'Get-FileHash -LiteralPath `\$zip -Algorithm SHA256')
Yes '  and a zip that does not match is deleted, not unpacked' ($text.Contains("if (```$got -ne '`$sha')"))

# ---- the token -------------------------------------------------------------------
$sayToken = @([regex]::Matches($text, '(?m)^.*(Say|Write-Host)[^\r\n]*\$token.*$'))
Yes 'the registration token is never printed' ($sayToken.Count -eq 0)
Yes '  and is dropped once used' ($text -match '(?m)^\$token = \$null')

# ---- priority ----------------------------------------------------------------------
# The runner runs at the Normal its service starts it at, and nothing raises
# it above the game server, the site, voice and the bot (#1969).
Yes 'nothing sets the runner''s priority class, above normal or otherwise' ($text -notmatch 'PriorityClass\s*=' -and $text -match '--runasservice')
Yes 'Defender skips the runner''s own folder and nothing else' ($text -match 'Add-MpPreference -ExclusionPath `\$root' -and ([regex]::Matches($text, 'Add-MpPreference')).Count -eq 1)

# ---- ssh ---------------------------------------------------------------------------
Yes 'it checks the VPS host key' ($text -match 'StrictHostKeyChecking=yes')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
