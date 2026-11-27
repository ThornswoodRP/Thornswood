<#
  Set-DiscordOnboarding.ps1

  Sets Discord's onboarding (Server Settings, Onboarding) with the bot, from
  bot\Build-Onboarding.py: the default channels, the questions and what each
  answer gives, every role and channel looked up by name on the server when it
  runs. Issue #427.

    .\Set-DiscordOnboarding.ps1 -Check     reads the server, says what it would
                                           set and what Discord would refuse,
                                           changes nothing. Always run this first.
    .\Set-DiscordOnboarding.ps1 -Off       writes it but leaves onboarding off,
                                           so Preview can be walked first
    .\Set-DiscordOnboarding.ps1            writes it and switches it on

  Choices, all off unless given:
    -GrantMember   the hold question from the board, which gives everybody who
                   answers Member and a Citizen role. Off keeps the application
                   gate: Member stays something staff give.
    -Rules         a required "have you read the rules" question
    -Age           a required "are you 18 or over" question

  The bot needs Manage Server and Manage Roles for this. Its role keeps
  Administrator (#3317, Patrick, 22 Oct 2026), which covers both.

  It asks for the token rather than taking it on the command line, so it stays
  out of your history. Nothing writes it to disk.
#>
[CmdletBinding()]
param(
  [string]$Guild,
  [switch]$Check,
  [switch]$Off,
  [switch]$GrantMember,
  [switch]$Rules,
  [switch]$Age,
  # Also prints the exact body it would send to Discord.
  [switch]$Body
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
# Read-ThornswoodSecret, which also takes the value piped in with no keyboard (#4346).
. (Join-Path $Here '..\vps\Send-Secret.ps1')
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$app = Join-Path $Here '..\..\bot\Build-Onboarding.py'
if (-not (Test-Path -LiteralPath $app)) { throw "not found: $app" }

# The bot's Python is 3.12. Plain python is whichever is first on PATH, which
# on a PC with more than one can be too old (on One it is 3.9, #2276), so the
# py launcher's 3.12 comes first, then python if it is 3.10 or newer.
$py = $null
$pyArgs = @()
$launcher = (Get-Command py -EA SilentlyContinue).Source
if ($launcher) {
  & $launcher -3.12 -c 'import sys' 2>$null
  if ($LASTEXITCODE -eq 0) { $py = $launcher; $pyArgs = @('-3.12') }
}
if (-not $py) {
  $plain = (Get-Command python -EA SilentlyContinue).Source
  if ($plain) {
    & $plain -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>$null
    if ($LASTEXITCODE -eq 0) { $py = $plain }
  }
}
if (-not $py) { throw 'No Python 3.10 or newer found. Install Python 3.12 (py -3.12 should run it).' }

$pass = @()
if ($Check) { $pass += '--check' }
if ($Off) { $pass += '--off' }
if ($GrantMember) { $pass += '--grant-member' }
if ($Rules) { $pass += '--rules' }
if ($Age) { $pass += '--age' }
if ($Body) { $pass += '--body' }
if ($Guild) { $pass += @('--guild', $Guild) }

$tok = Read-ThornswoodSecret 'Bot token (paste it, it will not be shown)'
if (-not $tok) { throw 'No token given.' }

# Only for this process. Nothing is written down and nothing outlives the run.
$env:DISCORD_TOKEN = $tok
$env:PYTHONIOENCODING = 'utf-8'
$tok = $null
try {
  & $py @pyArgs $app @pass
  $code = $LASTEXITCODE
} finally {
  $env:DISCORD_TOKEN = $null
}
exit $code
