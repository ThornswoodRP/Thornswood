<#
  Set-Turnstile.ps1

  Puts Cloudflare Turnstile's two keys for the report form into the site's
  config.json on the VPS and restarts the site, so /report draws the check
  and the site asks Cloudflare about every pass (#3216, Patrick's answer on
  22 Oct 2026). Or takes both out again with -Off.

    pwsh scripts/deploy/Set-Turnstile.ps1 -FromCloudflare                 the usual way, from anywhere with gh and the box's ssh
    pwsh scripts/deploy/Set-Turnstile.ps1 -PublicSiteKey 0x4AAAAAAA...     asks for the secret, not shown
    pwsh scripts/deploy/Set-Turnstile.ps1 -Off                             no widget and no check

  The site key is public: the page hands it to every browser, so it may go on
  the command line. The secret is never typed into a session, a chat or a
  file, whichever way it comes:

  -FromCloudflare (Patrick's A of 22 Oct, after the Desk refused to read the
  secret through the Cloudflare connector, because a live secret would then
  sit in its transcript). Patrick made a Cloudflare API token that can only
  read Turnstile widgets and pastes it into the Actions secrets of the
  private ops repository, ThornswoodRP/Thornswood-Ops (#4013), as
  CLOUDFLARE_TURNSTILE_TOKEN. This:
    1. has the box make its seal key if it has none, and print the public
       half (scripts\vps\Seal.ps1);
    2. starts the ops repository's turnstile-keys.yml on its main with that
       public key. The workflow, on GitHub's hosted Ubuntu runner, a fresh
       machine for each run, checks out this repository's main and runs
       this script with -SealOnGitHub, which seals the
       token to the key and leaves only the sealed form, as an annotation;
    3. hands the sealed form to the box, which opens it with its key, asks
       Cloudflare for the widget's secret with the token, and writes the keys.
  The token and the secret exist in plain form only inside the workflow's
  process and on the box.

  -PublicSiteKey alone: the secret is asked for hidden, or read from one line
  of standard input when there is no keyboard (#3359), and goes to the box
  on ssh's standard input (Send-Secret.ps1, #451).

  Only the two keys change in config.json, through SiteConfigSet.ps1, the
  block Deploy-Docs -Password and Rotate-ServerPassword use (#2317): every
  other setting is kept, and a file that is there and will not parse is left
  exactly as it is, with nothing written and the site not restarted. The
  site key is written first, so a run that stops between the two leaves the
  site key alone, which the site reads as off (turnstileOn() wants both).

  Afterwards it asks the restarted site what the report form is told
  (/api/report/form on the box itself) and says whether the check is on.
#>
[CmdletBinding()]
param(
  [ValidatePattern('^0x[0-9A-Za-z_-]{10,80}$')][string]$PublicSiteKey = '',
  [switch]$FromCloudflare,
  [switch]$Off,
  # The workflow's half of -FromCloudflare; nothing else runs it.
  [switch]$SealOnGitHub,
  [string]$Vps  = '',
  [string]$User = '',
  [string]$DocsRoot = 'C:/Thornswood-Docs',
  # Where turnstile-keys.yml and its secret are (#4013).
  [string]$GitHubRepo = 'ThornswoodRP/Thornswood-Ops'
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Seal.ps1')

# The widget the site uses, made through the Cloudflare connector on 22 Oct
# 2026 (thornswood.net, Managed), and the account it is in. Both are public.
$WidgetSiteKey = '0x4AAAAAAFhUyY9jKwKOoC8J'
$CloudflareAccount = 'c7738b46d6dea435f5228b00b6198706'

# ------------------------------------------------- the workflow's half ----
if ($SealOnGitHub) {
  . (Join-Path $Here '..\ops\WorkflowRun.ps1')
  $token = [string]$env:CLOUDFLARE_TURNSTILE_TOKEN
  $env:CLOUDFLARE_TURNSTILE_TOKEN = $null
  $key = [string]$env:SEAL_KEY
  if (-not $token) {
    Write-ThornswoodAnnotation 'error' 'Turnstile' 'CLOUDFLARE_TURNSTILE_TOKEN is not among the repository''s Actions secrets, so there is nothing to seal. Patrick makes it on the report page (Account > Turnstile > Read). Nothing was sealed.'
    exit 1
  }
  try { $sealed = ConvertTo-ThornswoodSealed -PublicKeyXml $key -Value $token }
  catch { Write-ThornswoodAnnotation 'error' 'Turnstile' $_.Exception.Message; exit 1 }
  finally { $token = $null }
  Write-ThornswoodAnnotation 'notice' 'Turnstile' $sealed
  Write-Host 'sealed the token to the box''s key; only the box can open it'
  exit 0
}

$ssh  = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here '..\vps\Send-Secret.ps1')
. (Join-Path $Here 'SiteConfigSet.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }

if (@([bool]$Off, [bool]$FromCloudflare, [bool]$PublicSiteKey | Where-Object { $_ }).Count -gt 1) { throw 'One of -FromCloudflare, -PublicSiteKey or -Off, not more. Nothing was sent.' }
if (-not $Off -and -not $FromCloudflare -and -not $PublicSiteKey) { throw 'Say -FromCloudflare (the usual way), name the widget''s site key with -PublicSiteKey 0x..., or take the check out with -Off. Nothing was sent.' }
if ($FromCloudflare) { $PublicSiteKey = $WidgetSiteKey }

$docsWin = $DocsRoot.Replace('/','\')
$want = if ($Off) { 'off' } else { 'on' }

# What the box does once $turnstileSecret holds the secret (empty for -Off).
$farTail = @"
if ('$want' -eq 'on' -and -not `$turnstileSecret) { 'NO SECRET ARRIVED. Nothing written, the check is as it was.'; return }
`$pw = '$PublicSiteKey'
$(Get-ThornswoodSiteConfigSet -ConfigPath "$docsWin\config.json" -Key 'turnstileSiteKey' -What 'turnstile keys')
`$pw = `$turnstileSecret; `$turnstileSecret = `$null
$(Get-ThornswoodSiteConfigSet -ConfigPath "$docsWin\config.json" -Key 'turnstileSecret' -What 'turnstile keys')
`$pw = `$null

Get-CimInstance Win32_Process |
  Where-Object { `$_.Name -eq 'node.exe' -and `$_.CommandLine -like '*Thornswood-Docs*' } |
  ForEach-Object { Stop-Process -Id `$_.ProcessId -Force -EA SilentlyContinue }
Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName 'Thornswood Docs' -EA SilentlyContinue
Start-Sleep -Seconds 3
if (-not (Get-NetTCPConnection -LocalPort 3001 -State Listen -EA SilentlyContinue)) { 'SITE DID NOT COME BACK'; return }
'site restarted'
`$told = ''
try { `$told = [string](Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/report/form' -UseBasicParsing -TimeoutSec 15).turnstile }
catch { 'THE SITE DID NOT ANSWER /api/report/form: ' + `$_.Exception.Message; return }
if (`$told -eq '$PublicSiteKey') { if ('$want' -eq 'on') { 'the report form is told the site key: the check is on' } else { 'the report form is told no key: the check is off' } }
else { 'THE REPORT FORM IS TOLD ' + (`$(if (`$told) { 'ANOTHER KEY' } else { 'NO KEY' })) + ', so the check is not ' + '$want' }
"@

if (-not $FromCloudflare) {
  $secret = ''
  if (-not $Off) {
    $secret = Read-ThornswoodSecret '  The Turnstile secret key for that widget (it is not shown)'
    if (-not $secret) { Write-Host '  nothing was typed, nothing changed'; return }
  }
  Write-Host ''
  Write-Host ('Turning the report form''s Turnstile check ' + $want + '...')
  Invoke-ThornswoodSecretRemote -Target "$User@$Vps" -SshArgs $ssh -Secret $secret -Script (@"
`$ErrorActionPreference = 'Stop'
`$pw = `$ThornswoodSecret; `$ThornswoodSecret = `$null
`$turnstileSecret = `$pw
"@ + "`r`n" + $farTail) | ForEach-Object { "  $_" }
  $secret = $null
  return
}

# ----------------------------------------------------- -FromCloudflare ----
. (Join-Path $Here '..\ops\WorkflowRun.ps1')
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die 'there is no gh here to start the turnstile-keys workflow with. Nothing was sent.' }

Say ''
Say '1. The box''s seal key'
$keyLines = @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script ("`$ErrorActionPreference = 'Stop'`r`n" + (Get-ThornswoodSealLockFunction) + "`r`n" + (Get-ThornswoodSealKeyBlock)) | ForEach-Object { "$_".Trim() })
$keyLine = @($keyLines | Where-Object { $_ -like 'SEAL KEY <RSAKeyValue>*' }) | Select-Object -Last 1
if (-not $keyLine) { Die ('the box gave no seal key: ' + ($keyLines -join ' ') + '. Nothing was sent.') }
if ($keyLines -contains 'seal key made') { Say '  made it (the first time)' } else { Say '  it has one' }
$publicKey = $keyLine.Substring('SEAL KEY '.Length)

Say '2. The workflow seals the token to it'
try { $s = Start-ThornswoodWorkflow -Repo $GitHubRepo -Workflow 'turnstile-keys.yml' -Inputs ([ordered]@{ seal_key = $publicKey }) }
catch { Die ($_.Exception.Message + '. Nothing was sent to the box.') }
if (-not $s.Run) { Die ('GitHub started the workflow but named no run, so its answer cannot be read here: ' + $s.Url + '. Nothing was sent to the box.') }
Say ('  ' + $s.Url) 'DarkGray'
$a = Read-ThornswoodRunAnswer -Repo $GitHubRepo -Workflow 'turnstile-keys.yml' -Run $s.Run -Title 'Turnstile' -WaitMinutes 15 -Started -Say { param($m) Say $m 'DarkGray' }
if ($a.State -ne 'answer') { Die ('the workflow gave no sealed token (' + $a.State + ': ' + $a.Text + '). Nothing was sent to the box.') }
$sealed = $a.Text
if ($sealed -notmatch '^[A-Za-z0-9+/]+={0,2}$') { Die 'the workflow''s answer is not a sealed value. Nothing was sent to the box.' }

Say '3. The box opens it, asks Cloudflare for the widget''s secret, and writes the keys'
Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script (@"
`$ErrorActionPreference = 'Stop'
`$sealed = '$sealed'
$(Get-ThornswoodUnsealBlock)
`$cfToken = `$ThornswoodSecret; `$ThornswoodSecret = `$null
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
`$w = `$null
try { `$w = Invoke-RestMethod -Uri 'https://api.cloudflare.com/client/v4/accounts/$CloudflareAccount/challenges/widgets/$PublicSiteKey' -Headers @{ Authorization = 'Bearer ' + `$cfToken } -UseBasicParsing -TimeoutSec 30 }
catch {
  `$code = ''
  try { `$code = [string][int]`$_.Exception.Response.StatusCode } catch {
    # No answer from Cloudflare at all, so no status: the line below says so with an empty code.
    `$code = ''
  }
  'CLOUDFLARE DID NOT HAND OVER THE WIDGET (HTTP ' + `$code + '). A 403 is a token without Account > Turnstile > Read. Nothing was changed.'
  return
} finally { `$cfToken = `$null }
if (-not `$w -or -not `$w.success -or -not `$w.result -or -not [string]`$w.result.secret) { 'CLOUDFLARE ANSWERED WITHOUT THE WIDGET''S SECRET. Nothing was changed.'; return }
if ([string]`$w.result.sitekey -ne '$PublicSiteKey') { 'CLOUDFLARE ANSWERED FOR ANOTHER WIDGET. Nothing was changed.'; return }
`$turnstileSecret = [string]`$w.result.secret; `$w = `$null
"@ + "`r`n" + $farTail) | ForEach-Object { "  $_" }
