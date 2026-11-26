<#
  Apply-Discord.ps1

  Applies the plan's changes to the Thornswood Discord: what the repository
  changed in the plan (roles, categories, channels, permissions, topics and
  the words of the read only posts) since the last run, and nothing else
  (#6961). The Discord is already set up; this is how a change to the plan
  reaches it.

  The box keeps a record of the plan it last applied
  (C:\Thornswood-Bot\data\discord-applied.json). A run compares the plan with that
  record and asks Discord only for what differs: one role's overwrite on one
  channel, one topic, one post. Whatever the plan did not change is left as
  the live server has it, hand edits included, and the run lists where the
  live server differs from the plan there, so a hand edit worth keeping can be
  written into the plan. When the plan has not changed, Discord is asked
  nothing. The record moves on only when the whole run went through. Until
  26 Nov 2026 every run made the live server the whole plan, and undid hand
  edits each time (Patrick: "why it resets up the whole fucking server every
  time we make a slight change").

    .\Apply-Discord.ps1 -OnBox     applies the plan's changes, on the VPS with
                                    the token the bot holds there, and asks
                                    for nothing
    .\Apply-Discord.ps1 -OnBox -Check
                                   changes nothing, says what it would
    .\Apply-Discord.ps1 -OnBox -Audit
                                   changes nothing, reads the live server and
                                    says where it differs from the plan: the
                                    bot's permissions, each role's, who holds
                                    each staff rank and every double rank,
                                    every channel's overwrites (#3317), and
                                    who changed channels, permissions and
                                    roles in the last week (#6961)
    .\Apply-Discord.ps1 -OnBox -Record
                                   writes this plan as the record and asks
                                    Discord nothing. Once, when there is no
                                    record and -Audit says the live server is
                                    this plan; it never writes over a record
    .\Apply-Discord.ps1 -OnBox -Prune
                                   also deletes the channels the plan dropped
                                    since the record, when nothing is open in
                                    them
    .\Apply-Discord.ps1 -OnBox -Give 'Co-Owner=WiccanDjinn','Lead Dev=Patrick Thornwood'
                                   gives each staff rank to the one member
                                    named exactly, and does nothing else. Never
                                    a second rank of one category, never to a
                                    seat holder; with -Check only says it (#3317)

  -Whole is the build as it was: it makes the live server the whole plan,
  hand edits undone, for a server made from nothing. -Posts, -Only and the
  news webhook go with it. The gate never runs it.

  First time only, before running it:

    1. https://discord.com/developers/applications
       The same application the website login uses is fine, or make a new one.
    2. Bot in the sidebar, then Reset Token, and copy what it gives you.
    3. Still under Bot, turn ON "Server Members Intent". Leave the rest off.
    4. OAuth2, URL Generator, tick "bot" and then "Administrator". Open the URL
       it builds and add the bot to your server. The bot keeps Administrator,
       for a build and the rest of the time (#3317, Patrick, 22 Oct 2026: "the
       bot will keep admin"). A build makes the Owner and Co-Owner roles, which
       carry Administrator, and Discord refuses that from a bot without it.

  To see the invite link without building anything, from the repository
  folder, with the id from the developer portal's General Information page:

    python bot\Apply-Discord.py --invite <application id>
    5. Server Settings, Roles: drag the bot's own role to the TOP. It cannot
       make roles above itself.
    6. Server Settings, Enable Community, so forums, the announcement channel
       and the rules screen exist at all.

  It asks for the token rather than taking it on the command line, so it stays
  out of your history. Nothing writes it to disk.

  -OnBox asks for nothing (#2519, #2341). The token is the bot's own, in
  C:\Thornswood-Bot\bot.env.json on the VPS, so a machine with the VPS key
  and no token, or a run with nobody at a prompt, can still build, and the
  token never leaves the box. Apply-Discord.py, content.py,
  staff-channel.txt and factions.json go up inside the run's script as the
  commit holds them,
  with the two site pages content.py reads its words from (join.md and
  rules.md), each at its place in the repository, because content.py finds
  them by its own folder (..\site\data\site). An uncommitted change to any
  of them stops the run before the box is asked anything. They go into a
  folder of the run's own under C:\Windows\Temp.
  There the box's Python runs the build with the bot's own libraries
  (py-libs), the token is read from bot.env.json into that one process's
  environment, and the folder is removed when the build ends. The build may
  write the news webhook into that folder; it goes with the folder, because
  the box already keeps the webhook (Discord-Hook.ps1). The running bot holds
  the smaller permission set, not Administrator, so anything that needs
  Administrator is named under "did not manage".
#>
[CmdletBinding()]
param(
  [string]$Guild,
  [switch]$SkipInstall,
  # Removes channels this no longer wants. Without it they are only listed.
  # Scoped to the categories this script made, so anything you added yourself
  # is never touched.
  [switch]$Prune,
  # With -Whole: rewrites the read only posts from content.py. A run without
  # -Whole writes the posts whose words the plan changed, and no other.
  [switch]$Posts,
  # The whole plan, made on the live server whatever it has, hand edits
  # undone (#6961). For a server made from nothing.
  [switch]$Whole,
  # Writes this plan as the record of what was applied, and asks Discord
  # nothing (#6961). Never over a record already there.
  [switch]$Record,
  # Touches nothing. Says what it would make, remove and rewrite, then stops.
  [switch]$Check,
  # Touches nothing. Reads the live server and says where it differs from the
  # plan (#3317). Nothing else in the run happens.
  [switch]$Audit,
  # Builds on the VPS with the token the bot holds there. Asks for nothing.
  [switch]$OnBox,
  # Only these categories and channels of the plan, and nothing else in the
  # Discord (#2519). Apply-Discord.py's ONLY says what that leaves out, and
  # refuses a name its plan does not have before Discord is asked anything.
  [string[]]$Only = @(),
  # Staff ranks to give, each 'rank=member' (#3317). Apply-Discord.py's GIVE
  # says which ranks and how a member is matched. Nothing else in the run
  # happens.
  [string[]]$Give = @()
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$app = Join-Path $Here '..\..\bot\Apply-Discord.py'
if (-not (Test-Path -LiteralPath $app)) { throw "not found: $app" }
# One 'rank=member' each. A quote, a semicolon or anything else that could
# leave the line it is written into stops here, before anything is sent.
$gives = @($Give | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
foreach ($g in $gives) {
  if ($g -notmatch '^[A-Za-z -]+=[\p{L}\p{N} _.-]+$') { throw ("-Give takes 'staff rank=member', not: " + $g) }
}
# A run writes the posts the plan changed by itself (#6961); -Posts and -Only
# are the whole build's.
if (($Posts -or $Only.Count) -and -not $Whole) { throw '-Posts and -Only go with -Whole. A run without it writes the posts whose words the plan changed, and nothing else. Nothing was sent.' }
if ($Record -and ($Whole -or $Audit -or $gives.Count -or $Prune)) { throw '-Record writes the record and does nothing else. Nothing was sent.' }
# The record of what was applied is the box's, so a run that applies the
# plan's changes, or starts the record, goes there.
if (-not $OnBox -and -not ($Audit -or $gives.Count -or $Whole)) { throw 'The record of what was last applied is on the box, so this runs with -OnBox. Nothing was sent.' }

# The one switch (#428): the site's "open", read off its public page so the
# posts say the same as the site. Anything that goes wrong is the alpha
# wording, which is what is true until somebody flips it.
$open = $false
try {
  $pub = Invoke-RestMethod -Uri 'https://thornswood.net/api/public' -TimeoutSec 15
  $open = ($pub.open -eq $true)
} catch {
  Write-Host ('  Could not ask the site whether the world is open (' + $_.Exception.Message + '), so the posts use the alpha wording.') -ForegroundColor Yellow
}
if ($Posts) {
  if ($open) { Write-Host '  The site says the world is open to everybody, so the posts say so.' }
  else { Write-Host '  The site says the world is in alpha, open by application, so the posts say so.' }
}

if ($OnBox) {
  . (Join-Path $Here '..\vps\Vps.ps1')
  . (Join-Path $Here '..\vps\Send-Script.ps1')
  $Repo = Split-Path -Parent (Split-Path -Parent $Here)
  # Every file the build reads, at its place in the repository: content.py
  # reads join.md and rules.md through ..\site\data\site from its own folder,
  # and a run that sent only the bot's files stopped on the box with
  # FileNotFoundError for join.md (22 Oct 2026). tests\test-2519-setup-discord-onbox.ps1
  # imports content.py from a folder holding only these. Apply-Discord.py
  # reads factions.json from its own folder when it loads (#3317), and the
  # first -OnBox run after that stopped with FileNotFoundError for it; the
  # same test imports Apply-Discord.py there too, where a python with
  # discord.py is. content.py reads #factions out of lore\factions.md (#3317).
  # Apply-Discord.py logs in through trust.py, the bot's roots (#3604).
  $send = @('bot/Apply-Discord.py', 'bot/content.py', 'bot/trust.py', 'bot/staff-channel.txt',
    'bot/factions.json', 'site/data/site/join.md', 'site/data/site/rules.md',
    'lore/factions.md')
  # The commit, never the working tree, so what ran is a commit anyone can name.
  $dirty = @(& git -C $Repo status --porcelain -- @send 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'git could not say whether the build''s files are committed. Nothing was sent.' }
  if ($dirty.Count) { throw ('Commit these first, nothing was sent: ' + (($dirty | ForEach-Object { "$_".Trim() }) -join ', ')) }
  $commit = "$(& git -C $Repo rev-parse --short=12 HEAD)".Trim()
  $files = ''
  foreach ($rel in $send) {
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $Repo $rel)))
    $files += "  '" + $rel + "' = '" + $b64 + "'`r`n"
  }
  $flags = "`$env:THORNSWOOD_OPEN = '" + $(if ($open) { '1' } else { '0' }) + "'`r`n"
  if ($Guild) { $flags += "`$env:DISCORD_GUILD = '" + ($Guild -replace '[^0-9]', '') + "'`r`n" }
  # The record of the plan last applied (#6961), beside the bot, and the
  # commit this run's plan is from.
  $flags += "`$env:DISCORD_RECORD = 'C:\Thornswood-Bot\data\discord-applied.json'`r`n"
  $flags += "`$env:DISCORD_COMMIT = '" + $commit + "'`r`n"
  if ($Whole) { $flags += "`$env:DISCORD_WHOLE = '1'`r`n" }
  if ($Record) { $flags += "`$env:DISCORD_RECORD_NOW = '1'`r`n" }
  if ($Prune) { $flags += "`$env:DISCORD_PRUNE = '1'`r`n" }
  if ($Posts) { $flags += "`$env:DISCORD_POSTS = '1'`r`n" }
  if ($Check) { $flags += "`$env:DISCORD_CHECK = '1'`r`n" }
  if ($Audit) { $flags += "`$env:DISCORD_AUDIT = '1'`r`n" }
  if ($Only.Count) {
    $names = @($Only | ForEach-Object { "$_" -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    foreach ($n in $names) { if ($n -notmatch '^[A-Za-z0-9 _-]+$') { throw ('-Only takes category and channel names from the plan, not: ' + $n) } }
    $flags += "`$env:DISCORD_ONLY = '" + ($names -join ',') + "'`r`n"
  }
  if ($gives.Count) {
    $flags += "`$env:DISCORD_GIVE = '" + ($gives -join ';') + "'`r`n"
  }
  # What runs on the box. The token is read there and set for the one Python
  # process; the folder goes when the build ends, however it ends.
  $far = @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
# sshd's sessions carry the PATH from before Python was installed (Install-Bot.ps1).
`$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')
`$botRoot = 'C:\Thornswood-Bot'
# The box's own temp folder, where OnBox.ps1 keeps its runs too.
`$top = 'C:\Windows\Temp'
`$dir = Join-Path `$top ('thornswood-discord-' + [Guid]::NewGuid().ToString('N'))
`$code = 1
New-Item -ItemType Directory -Force -Path `$dir | Out-Null
try {
  `$files = @{
$files  }
  # Each at its place in the repository, so content.py finds the site pages.
  foreach (`$k in `$files.Keys) {
    `$p = Join-Path `$dir `$k
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent `$p) | Out-Null
    [IO.File]::WriteAllBytes(`$p, [Convert]::FromBase64String(`$files[`$k]))
  }
  `$cfg = Get-Content -LiteralPath (Join-Path `$botRoot 'bot.env.json') -Raw | ConvertFrom-Json
  if (-not `$cfg.DISCORD_TOKEN) { 'NO TOKEN: C:\Thornswood-Bot\bot.env.json holds no DISCORD_TOKEN. Nothing was built.'; exit 3 }
  `$env:DISCORD_TOKEN = [string]`$cfg.DISCORD_TOKEN
  `$cfg = `$null
  `$env:PYTHONPATH = Join-Path `$botRoot 'py-libs'
  `$env:PYTHONIOENCODING = 'utf-8'
$flags  `$ErrorActionPreference = 'Continue'
  & python (Join-Path `$dir 'bot/Apply-Discord.py') 2>&1 | ForEach-Object { "`$_" }
  `$code = `$LASTEXITCODE
} finally {
  `$env:DISCORD_TOKEN = `$null
  Remove-Item -LiteralPath `$dir -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath `$dir) { 'LEFT BEHIND: ' + `$dir + ' could not be removed' }
}
exit `$code
"@
  $User = Get-ThornswoodVpsUser
  $Vps = Get-ThornswoodVpsAddress
  $ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
  Write-Host ("On the VPS from commit {0}, with the token the bot holds there..." -f $commit)
  $out = Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $far
  $code = $LASTEXITCODE
  foreach ($l in @($out)) { Write-Host "$l" }
  if ($code -ne 0) {
    Write-Host ''
    Write-Host ("  The build on the VPS ended with exit {0}. Fix what it said above and run it again." -f $code) -ForegroundColor Yellow
  }
  exit $code
}

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

if (-not $SkipInstall) {
  Write-Host 'Making sure discord.py is here...'
  # Apply-Discord.py logs in through bot\trust.py, which reads its roots out
  # of the certifi the bot pins, so that one comes too (#3604).
  $certifi = [regex]::Match((Get-Content -LiteralPath (Join-Path $Here '..\..\bot\requirements.in') -Raw), '(?m)^certifi==(\S+)').Groups[1].Value
  if (-not $certifi) { throw 'bot\requirements.in names no certifi version, so the roots Apply-Discord.py trusts cannot be installed.' }
  & $py @pyArgs -m pip install -q -U discord.py ('certifi==' + $certifi)
  if ($LASTEXITCODE -ne 0) { throw 'pip could not install discord.py and certifi' }
  Write-Host '  ready'
}

$ss = Read-Host 'Bot token (paste it, it will not be shown)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
try { $tok = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$ss = $null
if (-not $tok) { throw 'No token given.' }

# Only for this process. Nothing is written down and nothing outlives the run.
$env:DISCORD_TOKEN = $tok
if ($Guild) { $env:DISCORD_GUILD = $Guild }
if ($Whole) { $env:DISCORD_WHOLE = '1' }
if ($Prune) { $env:DISCORD_PRUNE = '1' }
if ($Posts) { $env:DISCORD_POSTS = '1' }
if ($Check) { $env:DISCORD_CHECK = '1' }
if ($Audit) { $env:DISCORD_AUDIT = '1' }
if ($Only.Count) { $env:DISCORD_ONLY = (@($Only | ForEach-Object { "$_" -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join ',') }
if ($gives.Count) { $env:DISCORD_GIVE = ($gives -join ';') }
$tok = $null
$env:THORNSWOOD_OPEN = $(if ($open) { '1' } else { '0' })

try {
  & $py @pyArgs $app
  $code = $LASTEXITCODE
} finally {
  $env:DISCORD_TOKEN = $null
  $env:DISCORD_PRUNE = $null
  $env:DISCORD_WHOLE = $null
  $env:DISCORD_POSTS = $null
  $env:DISCORD_CHECK = $null
  $env:DISCORD_AUDIT = $null
  $env:DISCORD_ONLY = $null
  $env:DISCORD_GIVE = $null
  $env:THORNSWOOD_OPEN = $null
}
if ($code -ne 0) {
  Write-Host ''
  Write-Host ("  Discord setup ended with exit {0}. No webhook was handed over. See the details above." -f $code) -ForegroundColor Yellow
  exit $code
}

# Only the whole build makes the news webhook; an audit, a rank grant and a
# run of the plan's changes have none to hand over.
if ($Audit -or $gives.Count -or -not $Whole) { exit $code }

$hook = Join-Path $Here '..\..\bot\news-webhook.txt'

# -Check changes nothing and never hands a webhook on. If a leftover file is
# there, it only notes that it is there, without reading it (#4226).
if ($Check) {
  if (Test-Path -LiteralPath $hook) {
    Write-Host ''
    Write-Host '  bot\news-webhook.txt is there'
  }
  exit $code
}

# -Only touches no webhook (#2519, #4226).
if ($Only.Count) { exit $code }

Write-Host ''
# An empty bot\news-webhook.txt reads back as $null, and .Trim() on that threw
# before anything was said. Wrapped in a string it is '', which is refused here:
# ConvertTo-SecureString cannot take an empty string, so Discord-Hook.ps1's own
# address check never gets the chance.
$hookText = ''
if (Test-Path -LiteralPath $hook) { $hookText = "$(Get-Content -LiteralPath $hook -Raw)".Trim() }
if ((Test-Path -LiteralPath $hook) -and -not $hookText) {
  Write-Host '  bot\news-webhook.txt is empty, so nothing was sent to the VPS and releases will not' -ForegroundColor Yellow
  Write-Host '  post themselves into #news yet. Run this again once #news exists.' -ForegroundColor Yellow
} elseif ($hookText) {
  # Onto the VPS, where every machine that ships reads it (Discord-Hook.ps1); the
  # copy here is removed once the VPS has it.
  # Handed over as a SecureString (issue #1069), read from the file here.
  & (Join-Path $Here '..\ops\Discord-Hook.ps1') -Name news -Save -Url (ConvertTo-SecureString $hookText -AsPlainText -Force)
  $hookText = $null
  if ($LASTEXITCODE -eq 0) {
    Write-Host '  Release notes will post themselves into #news from now on.' -ForegroundColor Green
  } else {
    Write-Host '  The webhook is in bot\news-webhook.txt here but not on the VPS, so only this machine posts to #news.' -ForegroundColor Yellow
  }
} else {
  Write-Host '  Built, but no webhook was made, so releases will not post' -ForegroundColor Yellow
  Write-Host '  themselves into #news yet. Run this again once #news exists.' -ForegroundColor Yellow
}
