<#
  Set-DevNews.ps1

  Points dev releases at the Discord channel for dev build updates, so they
  stop being something only the dev launcher ever mentions and stay out of
  #news, where everybody reads about the build they actually play.

      .\scripts\ops\Set-DevNews.ps1

  It asks for a webhook URL and nothing else. Make one first:

    Discord, #staff-news, Edit Channel, Integrations, Webhooks,
    New Webhook, then Copy Webhook URL.

  The URL is a credential: anyone holding it can post in that channel as the
  bot. It is pasted at a prompt rather than taken on the command line, it is
  never printed back, and it is stored on the VPS (Discord-Hook.ps1), never in
  git, so every machine that ships reads it from there. Only
  Publish-Discord.ps1 reads it, on a dev release.

  Before it saves anything it asks Discord what that webhook points at. A
  webhook URL carries its own authority, so this needs no bot token. If it
  points at a channel other than the one in bot\dev-channel.txt,
  it says so and saves nothing: posting dev notes into #news by accident is
  the one thing this is here to prevent.

      .\scripts\ops\Set-DevNews.ps1 -Check     says what is set up now, changes
                                         nothing, prints no secret
      .\scripts\ops\Set-DevNews.ps1 -Clear     forgets the webhook. Dev releases go
                                         back to telling nobody.
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Clear,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
# Read-ThornswoodSecret, which also takes the value piped in with no keyboard (#4346).
. (Join-Path $Here '..\vps\Send-Secret.ps1')
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

function Say($m, $c = 'Gray') { Write-Host "  $m" -ForegroundColor $c }
function Done {
  Write-Host ''
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
}

$hookFile    = Join-Path $Here '..\..\bot\dev-webhook.txt'
$channelFile = Join-Path $Here '..\..\bot\dev-channel.txt'

$wantChannel = ''
if (Test-Path -LiteralPath $channelFile) {
  # "$()": an empty file reads as $null (even through [string](...)), and a method on $null throws.
  $wantChannel = ("$(Get-Content -LiteralPath $channelFile -Raw)").Trim()
}

Write-Host ''
Write-Host '  THORNSWOOD  -  where dev releases are announced' -ForegroundColor White
Write-Host ''
if ($wantChannel) { Say "#staff-news is $wantChannel" 'DarkGray' }
else { Say 'no channel id in bot\dev-channel.txt, so the channel cannot be checked' 'Yellow' }

# What a webhook points at, asked of Discord. The URL is its own authority, so
# no token is involved and nothing secret is printed: only the channel it
# names and the name of the webhook.
function Ask($url) {
  $out = @{ ok = $false; channel = ''; name = ''; guild = ''; why = '' }
  try {
    $r = [Net.HttpWebRequest]::Create($url)
    $r.Method = 'GET'
    $r.Timeout = 20000
    $r.UserAgent = 'Thornswood Set-DevNews'
    $resp = $null
    try { $resp = $r.GetResponse() }
    catch [Net.WebException] {
      $resp = $_.Exception.Response
      if (-not $resp) { $out.why = 'Discord request failed (' + $_.Exception.Status + ')'; return $out }
      $code = [int]$resp.StatusCode
      $out.why = "Discord answered $code" + $(if ($code -eq 401 -or $code -eq 404) {
        ' (that webhook does not exist any more, or the URL is not complete)' } else { '' })
      $resp.Close()
      return $out
    }
    $rd = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    $body = $rd.ReadToEnd(); $rd.Close(); $resp.Close()
    $o = $body | ConvertFrom-Json
    $out.ok = $true
    if ($o.PSObject.Properties['channel_id']) { $out.channel = [string]$o.channel_id }
    if ($o.PSObject.Properties['name'])       { $out.name    = [string]$o.name }
    if ($o.PSObject.Properties['guild_id'])   { $out.guild   = [string]$o.guild_id }
  } catch { $out.why = 'Discord request failed (' + $_.Exception.GetType().Name + ')' }
  return $out
}

# ------------------------------------------------------------------- check
if ($Check) {
  try {
    $hookLines = @(& (Join-Path $Here 'Discord-Hook.ps1') -Name dev 2>&1)
    $readHook = $?
    if ($hookLines | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }) { $readHook = $false }
  } catch {
    # Transport diagnostics can contain the webhook address.
    $readHook = $false
  }
  if (-not $readHook) {
    Say 'Could not reach the server for the dev webhook.' 'Red'
    Done; exit 1
  }
  $url = [string]($hookLines | Where-Object { $_ -is [string] } | Select-Object -First 1)
  if (-not $url) {
    Say 'No dev webhook set, on the VPS or here. A dev release tells nobody in Discord.' 'Yellow'
    Say 'Run .\scripts\ops\Set-DevNews.ps1 to point it at #staff-news.' 'DarkGray'
    Done; exit 0
  }
  $got = Ask $url
  if (-not $got.ok) { Say "The stored webhook does not work: $($got.why)" 'Red'; Done; exit 1 }
  Say "webhook `"$($got.name)`" posts into channel $($got.channel)" 'Green'
  if ($wantChannel -and $got.channel -ne $wantChannel) {
    Say "THAT IS NOT THE DEV UPDATES CHANNEL ($wantChannel)." 'Red'
    Done; exit 1
  }
  if ($wantChannel) { Say 'which is #staff-news' 'Green' }
  Done; exit 0
}

# ------------------------------------------------------------------- clear
if ($Clear) {
  if (Test-Path -LiteralPath $hookFile) {
    Remove-Item -LiteralPath $hookFile -Force
    Say 'The copy on this machine is gone.' 'Yellow'
  }
  Say 'The one on the VPS stays: delete the webhook in Discord to stop it posting.' 'DarkGray'
  Done; exit 0
}

# --------------------------------------------------------------------- set
Write-Host ''
Say 'Discord, #staff-news, Edit Channel, Integrations, Webhooks,' 'DarkGray'
Say 'New Webhook, then Copy Webhook URL.' 'DarkGray'
Say 'It is not printed back and it does not go into the repository.' 'DarkGray'
Write-Host ''

# Hidden, so it is not left in the console buffer or the history.
$url = (Read-ThornswoodSecret '  Paste it here').Trim()
if (-not $url) { Write-Host ''; Say 'Nothing pasted, nothing saved.' 'Yellow'; Done; exit 1 }

if ($url -notmatch '^https://(discord|discordapp)\.com/api/webhooks/[0-9]{17,20}/[A-Za-z0-9._-]{40,}$') {
  Write-Host ''
  Say 'That is not a Discord webhook URL.' 'Red'
  Say 'It looks like https://discord.com/api/webhooks/ then a long number,' 'DarkGray'
  Say 'a slash, and a long token. Copy Webhook URL gives you the whole thing.' 'DarkGray'
  Say 'Nothing was saved.' 'Yellow'
  Done; exit 1
}

Write-Host ''
Say 'Asking Discord what that webhook points at...' 'DarkGray'
$got = Ask $url
if (-not $got.ok) {
  Write-Host ''
  Say "Discord would not confirm it: $($got.why)" 'Red'
  Say 'Nothing was saved.' 'Yellow'
  Done; exit 1
}
Say "webhook `"$($got.name)`" posts into channel $($got.channel)" 'Green'

if ($wantChannel -and $got.channel -ne $wantChannel) {
  Write-Host ''
  Say "That is NOT #staff-news, which is $wantChannel." 'Red'
  Say 'Dev notes in the wrong channel is the one thing this is here to stop,' 'DarkGray'
  Say 'so nothing was saved. Make the webhook in #staff-news.' 'DarkGray'
  Done; exit 1
}

# On the VPS since 25 September, where every machine that ships reads it
# (Discord-Hook.ps1), rather than in bot\dev-webhook.txt on this machine only.
& (Join-Path $Here 'Discord-Hook.ps1') -Name dev -Save -Url $ss
$saved = $LASTEXITCODE
$url = $null
if ($saved -ne 0) { Done; exit 1 }

Write-Host ''
Say "Saved on the VPS, where every machine that ships reads it." 'Green'
Say 'From now on .\scripts\release\Ship.ps1 -Channel dev posts the release there.' 'Green'
Say 'It still goes nowhere near #news, the website or the main launcher.' 'DarkGray'
Done
