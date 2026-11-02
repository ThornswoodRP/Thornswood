<#
  Check-Site.ps1

  Asks whether thornswood.net is actually working: from the outside first, the
  way a visitor or an uptime monitor sees it, and then from the box, the way
  the site sees Discord. Reads nothing secret back and prints no secrets.

      .\Check-Site.ps1
      .\Check-Site.ps1 -Who 615236910243119104     one person's standing
      .\Check-Site.ps1 -NoSsh                      the outside checks only

  From the outside, over plain HTTP: GET and HEAD of the front page and every
  public page (the list is read out of site\server.js so it cannot go
  stale here), the public feed and what it carries, the /discord redirect, the
  two old download addresses, robots.txt, the security header, and whether
  the Discord invite the site hands out ever expires. Discord's public invite
  endpoint answers that without a token.

  From the box, over ssh: the Discord configuration the site holds, whether
  the bot can read the server, and whether every role the config names
  exists. Same check as before.

  Nothing here names a machine. The site address comes from the launcher's
  own config (launcher\app\Config.cs). The ssh half reaches the box the way
  every box script does, at scripts\vps\vps.json's address and user
  (Vps.ps1), which each machine's own ssh config carries the rest of the
  way: the bridge on a PC, loopback in the deploy gate. Until 1 Nov it took
  the game's name from Config.cs and the user from a Host entry for that
  name, which the gate's ssh config does not hold, so the gate's Check-Site
  verb skipped the box and still ended 0 (#2862).

  Run it when somebody says they cannot get in. It tells you in ten seconds
  which of the possible reasons it is, rather than guessing from what the
  person in front of you can see.
#>
[CmdletBinding()]
param(
  # https://thornswood.net unless Config.cs says otherwise.
  [string]$Site,
  # The box. vps.json's address (Vps.ps1) when not given.
  [string]$Vps,
  # The ssh user. vps.json's (Vps.ps1) when not given.
  [string]$User,
  [string]$Root = 'C:/Thornswood-Docs',
  # Check one person: their Discord id. Right click them, Copy User ID.
  [string]$Who,
  # Skip the ssh half entirely.
  [switch]$NoSsh,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host "  $m" -ForegroundColor Cyan }

if ($Who -and $Who -notmatch '^[0-9]{17,20}$') {
  Write-Host ''
  Write-Host "  -Who has to be a Discord id: 17 to 20 digits. You gave: $Who" -ForegroundColor Red
  exit 1
}

# ------------------------------------------------------------ where it is
# The launcher's config is what every installed copy uses, so it is the one
# place the site's address is true.
$configCs = Join-Path $Here '..\..\launcher\app\Config.cs'
$cs = ''
if (Test-Path -LiteralPath $configCs) { $cs = [IO.File]::ReadAllText($configCs) }
if (-not $Site) {
  $m = [regex]::Match($cs, 'public\s+string\s+SiteUrl\s*=\s*"([^"]+)"')
  $Site = if ($m.Success) { $m.Groups[1].Value } else { 'https://thornswood.net' }
}
$Site = $Site.TrimEnd('/')
# The box, as every box script reaches it (Vps.ps1 reads vps.json and this
# machine's own override of it).
. (Join-Path $Here 'Vps.ps1')
if (-not $Vps) { try { $Vps = Get-ThornswoodVpsAddress } catch { $Vps = '' } }
if (-not $User -and $Vps) { try { $User = Get-ThornswoodVpsUser } catch { $User = '' } }

Write-Host ''
Write-Host '  THORNSWOOD  -  is the site actually working' -ForegroundColor White
Say "  site  $Site" 'DarkGray'
if ($Vps) { Say "  box   $Vps$(if ($User) { " as $User" })" 'DarkGray' }

# ------------------------------------------------------------ the outside
# Plain HttpWebRequest rather than Invoke-WebRequest, because the answer to
# "what status did it give" must not depend on which PowerShell this is, and
# a 404 or a 301 is an answer here, not an error.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

function Probe([string]$method, [string]$url) {
  $out = @{ code = 0; body = ''; headers = @{}; location = ''; error = '' }
  try {
    $r = [Net.HttpWebRequest]::Create($url)
    $r.Method = $method
    $r.AllowAutoRedirect = $false
    $r.Timeout = 20000
    $r.UserAgent = 'Thornswood Check-Site'
    $resp = $null
    try { $resp = $r.GetResponse() }
    catch [Net.WebException] {
      $resp = $_.Exception.Response
      if (-not $resp) { $out.error = $_.Exception.Message; return $out }
    }
    $out.code = [int]$resp.StatusCode
    foreach ($k in $resp.Headers.AllKeys) { $out.headers[$k] = $resp.Headers[$k] }
    $out.location = [string]$resp.Headers['Location']
    if ($method -eq 'GET') {
      $s = $resp.GetResponseStream()
      $rd = New-Object IO.StreamReader($s, [Text.Encoding]::UTF8)
      $out.body = $rd.ReadToEnd()
      $rd.Close()
    }
    $resp.Close()
  } catch { $out.error = $_.Exception.Message }
  return $out
}

$problems = 0
function Bad($m) { $script:problems++; Write-Host "  $m" -ForegroundColor Red }
function Ok($m)  { Write-Host "  $m" -ForegroundColor Green }
function Line($m) { Write-Host "  $m" -ForegroundColor Gray }

# The public pages, as the site itself lists them, so a page added there is
# checked here without anybody remembering to add it twice. The list is in
# the site's pages module since server.js was split (#5357).
$serverJs = Join-Path $Here '..\..\site\lib\pages.js'
$pages = @('/')
if (Test-Path -LiteralPath $serverJs) {
  $js = [IO.File]::ReadAllText($serverJs)
  $m = [regex]::Match($js, 'const\s+PUBLIC_PAGES\s*=\s*\[(.*?)\];', 'Singleline')
  if ($m.Success) {
    $pages = @([regex]::Matches($m.Groups[1].Value, "'(/[^']*)'") | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
  }
}
if ($pages.Count -le 1) { Bad "could not read PUBLIC_PAGES out of $serverJs, checking the front page only" }

Head 'Pages, GET and HEAD'
foreach ($p in $pages) {
  $g = Probe 'GET' ($Site + $p)
  $h = Probe 'HEAD' ($Site + $p)
  $gs = if ($g.code) { $g.code } else { 'no answer' }
  $hs = if ($h.code) { $h.code } else { 'no answer' }
  $text = ('GET {0,-9} HEAD {1,-9} {2}' -f $gs, $hs, $p)
  if ($g.code -eq 200 -and $h.code -eq 200) { Ok $text }
  else {
    Bad $text
    if ($g.error) { Line "    $($g.error)" }
  }
}

Head 'The public feed'
$feed = Probe 'GET' "$Site/api/public"
$pub = $null
if ($feed.code -ne 200) { Bad "/api/public answered $($feed.code) $($feed.error)" }
else {
  try { $pub = $feed.body | ConvertFrom-Json } catch { Bad "/api/public is not JSON: $($_.Exception.Message)" }
}
if ($pub) {
  $status = $pub.PSObject.Properties['status']
  if ($status -and $pub.status.up) { Ok "game server up, $($pub.status.online) in the world" }
  else { Line 'game server reported down (the site probes the resources port on the box)' }
  $launcher = if ($pub.PSObject.Properties['launcher']) { [string]$pub.launcher } else { '' }
  Line "launcher $(if ($launcher) { $launcher } else { 'not named' })"
  $patreon = if ($pub.PSObject.Properties['patreon']) { [string]$pub.patreon } else { '' }
  Line "patreon $(if ($patreon) { $patreon } else { 'not set' })"
  $files = @()
  if ($pub.PSObject.Properties['files']) { $files = @($pub.files) }
  foreach ($f in $files) {
    $hidden = $false
    if ($f.PSObject.Properties['hidden']) { $hidden = [bool]$f.hidden }
    $name = [string]$f.name
    if ($hidden) { Line "file  $name  (hidden)" }
    elseif ($name -match '\.exe$') { Ok "file  $name  offered on Downloads" }
    else { Bad "file  $name  is offered on Downloads and is not the installer" }
  }
  if (-not $files.Count) { Bad 'no files in the feed, the Downloads page has nothing to offer' }
}

Head 'Redirects and extras'
$d = Probe 'GET' "$Site/discord"
if ($d.code -eq 302 -and $d.location) { Ok "/discord sends people to the invite" }
elseif ($d.code -eq 404) { Bad '/discord answers 404: no invite set on the site' }
else { Bad "/discord answered $($d.code) $($d.error)" }
foreach ($old in '/download', '/install') {
  $r = Probe 'GET' ($Site + $old)
  if (($r.code -eq 301 -or $r.code -eq 302) -and $r.location -match '/downloads$') { Ok "$old sends people to /downloads" }
  else { Bad "$old answered $($r.code)$(if ($r.location) { ' to ' + $r.location })" }
}
$robots = Probe 'GET' "$Site/robots.txt"
if ($robots.code -eq 200 -and $robots.body -match 'User-agent') { Ok 'robots.txt is there' }
else { Bad "robots.txt answered $($robots.code)" }
$front = Probe 'GET' "$Site/"
if ($front.headers['Strict-Transport-Security']) { Ok "Strict-Transport-Security: $($front.headers['Strict-Transport-Security'])" }
elseif ($Site -like 'https://*') { Bad 'no Strict-Transport-Security header on the front page' }
if ($front.body -match 'property="og:title"') { Ok 'og tags are in the page' } else { Bad 'no og:title in the front page' }

Head 'The Discord invite'
$invite = ''
if ($pub -and $pub.PSObject.Properties['invite']) { $invite = [string]$pub.invite }
if (-not $invite) { Bad 'the public feed carries no invite, so every Discord door on the site is dead' }
else {
  Line "invite  $invite"
  if ($d.location -and $d.location -ne $invite) { Bad "/discord sends people to $($d.location), which is not the invite in the feed" }
  $code = ($invite.TrimEnd('/') -split '/')[-1]
  # ${code} in braces: a question mark straight after a variable name is part
  # of the name in PowerShell 7, and the code silently went missing from the
  # address, which Discord answered with the same 404 a dead invite gets.
  $inv = Probe 'GET' "https://discord.com/api/v10/invites/${code}?with_expiration=true"
  if ($inv.code -ne 200) { Bad "Discord answered $($inv.code) for that invite, so it is not a working invite$(if ($inv.code -eq 404) { ' (revoked or expired)' })" }
  else {
    $o = $null
    try { $o = $inv.body | ConvertFrom-Json } catch { }
    if (-not $o) { Bad 'Discord answered but not with JSON' }
    else {
      $guild = if ($o.PSObject.Properties['guild'] -and $o.guild) { [string]$o.guild.name } else { '?' }
      $exp = if ($o.PSObject.Properties['expires_at']) { $o.expires_at } else { $null }
      if ($null -eq $exp -or "$exp" -eq '') { Ok "invite to `"$guild`" never expires" }
      else { Bad "INVITE TO `"$guild`" EXPIRES $exp. Replace it: .\scripts\deploy\Set-DiscordLogin.ps1 -NewInvite" }
    }
  }
}

Write-Host ''
if ($problems) { Write-Host "  $problems problem$(if ($problems -ne 1) { 's' }) from the outside." -ForegroundColor Yellow }
else { Write-Host '  Nothing wrong from the outside.' -ForegroundColor Green }

# --------------------------------------------------------------- the box
if ($NoSsh) { Say '  -NoSsh, the box was not asked.' 'DarkGray' }
elseif (-not $Vps -or -not $User) { Bad 'scripts\vps\vps.json gives no box address or user, so the box was not asked.' }
else {
  Head 'What the site holds, asked on the box'
  $ssh = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')
  $rootWin = $Root.Replace('/','\')

  . (Join-Path $PSScriptRoot 'Send-Script.ps1')
  function Remote($script) {
    # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
    # it off the box before it runs, and the far side's exit code comes back. A copy
    # that did not arrive is said here rather than stopping the whole check.
    try { return (Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script) }
    catch { $script:problems++; return "  could not send the check to $Vps" }
  }

  # All of this runs up there in node, because node is what the site uses and a
  # thing that works in PowerShell but not in node is not an answer.
  $js = @'
const https=require('https'),fs=require('fs');
const cfg=JSON.parse(fs.readFileSync('ROOTWIN\\config.json','utf8').replace(/^\uFEFF/,''));
const who=process.argv[2]||'';
const get=(p)=>new Promise(r=>{
  const q=https.get({hostname:'discord.com',path:'/api/v10'+p,
    headers:{Authorization:'Bot '+cfg.discord.botToken}},(s)=>{
    let o='';s.on('data',d=>o+=d);
    s.on('end',()=>{let b=null;try{b=JSON.parse(o)}catch(e){}r({c:s.statusCode,b})});
  });
  q.setTimeout(10000,()=>{try{q.destroy()}catch(e){}});
  q.on('error',e=>r({c:0,b:null,e:e.message}));
});
// A bot token is three parts with dots between them and the first part is the
// application id in base64. A client secret is 32 characters with no dots. The
// two get pasted into each other's box, and afterwards Discord only ever says
// 401, which does not tell you which one is wrong. This does. It prints no
// secret, only a length and an application id.
const appIdIn=(v)=>{
  const p=String(v||'').split('.');
  if(p.length!==3)return '';
  let id='';
  try{id=Buffer.from(p[0].replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')}catch(e){}
  return /^[0-9]{17,20}$/.test(id)?id:'';
};
const secretLooks=(v)=>{
  if(!v)return 'MISSING';
  if(appIdIn(v))return 'THIS IS A BOT TOKEN, NOT A CLIENT SECRET. Sign in is broken.';
  if(String(v).length<25||String(v).length>45)
    return 'set, but it is '+String(v).length+' characters and a client secret is 32';
  return 'set';
};
const tokenLooks=(v,cid)=>{
  if(!v)return 'MISSING';
  const a=appIdIn(v);
  if(!a)return 'NOT A BOT TOKEN. It is '+String(v).length+' characters in '+
    String(v).split('.').length+' part(s); a bot token is 3 parts.';
  if(cid&&a!==cid)return 'set, but it belongs to application '+a+', NOT '+cid;
  return 'set, and it belongs to this application';
};
(async()=>{
  console.log('client id     ' + (cfg.discord.clientId||'MISSING'));
  console.log('client secret ' + secretLooks(cfg.discord.clientSecret));
  console.log('bot token     ' + tokenLooks(cfg.discord.botToken, cfg.discord.clientId));
  console.log('guild id      ' + (cfg.discord.guildId||'MISSING'));
  console.log('invite        ' + (cfg.discord.invite||'not set'));
  console.log('patreon       ' + (cfg.patreon||'not set'));
  console.log('admin ids     ' + (cfg.admins||[]).join(', '));
  console.log('lets into the game: ' + ((cfg.access&&cfg.access.play)||[]).join(', '));
  console.log('');
  if(!cfg.discord.botToken||!cfg.discord.guildId){
    console.log('NO BOT. Only the admin ids above can get in.');return;}
  const g=await get('/guilds/'+cfg.discord.guildId);
  if(g.c!==200){
    console.log('THE BOT CANNOT READ THE SERVER. Discord answered '+g.c+
      (g.c===401?(appIdIn(cfg.discord.botToken)
        ?'  (this IS a real bot token for the right application, so it has been '+
         'reset since. Get a fresh one: developer portal, Bot, Reset Token.)'
        :'  (what is stored is not a bot token at all, see the line above)'):
       g.c===403?'  (the bot is not allowed to read this server)':
       g.c===404?'  (wrong guild id, or the bot is not in that server)':''));
    console.log('While this is true, everybody except the admin ids is turned away.');
    return;}
  console.log('bot reads "'+g.b.name+'"');
  const r=await get('/guilds/'+cfg.discord.guildId+'/roles');
  if(r.c!==200){console.log('but it cannot read the roles: '+r.c);return;}
  console.log(r.b.length+' roles visible');
  const want=((cfg.access&&cfg.access.play)||[]).concat((cfg.access&&cfg.access.admin)||[]);
  const have=r.b.map(x=>x.name);
  const missing=want.filter(n=>have.indexOf(n)<0);
  if(missing.length)console.log('NAMED IN config BUT NOT IN THE SERVER: '+missing.join(', '));
  else console.log('every role the config names exists in the server');
  if(who){
    console.log('');
    const m=await get('/guilds/'+cfg.discord.guildId+'/members/'+who);
    if(m.c===404){console.log(who+' is NOT in the server.');return;}
    if(m.c!==200){console.log('could not look '+who+' up: '+m.c);return;}
    const byId={};r.b.forEach(x=>byId[x.id]=x.name);
    const mine=(m.b.roles||[]).map(i=>byId[i]).filter(Boolean);
    const name=m.b.nick||(m.b.user&&(m.b.user.global_name||m.b.user.username))||who;
    console.log(name+' is in the server');
    console.log('  roles:  '+(mine.join(', ')||'none'));
    const hit=(l)=>(l||[]).filter(n=>mine.indexOf(n)>=0);
    const banned=hit((cfg.access||{}).banned);
    console.log('  banned: '+(banned.length?'YES, '+banned.join(', '):'no'));
    console.log('  game:   '+(hit((cfg.access||{}).play).join(', ')||'NO, none of the play roles'));
    console.log('  admin:  '+(hit((cfg.access||{}).admin).join(', ')||'no'));
    if((cfg.admins||[]).indexOf(String(who))>=0)console.log('  also on the hand written admin list');
  }
})();
'@
  $js = $js.Replace('ROOTWIN', $rootWin.Replace('\','\\'))
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($js))

  Write-Host ''
  Remote @"
`$ErrorActionPreference = 'Continue'
`$f = Join-Path `$env:TEMP 'tw-check.js'
[IO.File]::WriteAllText(`$f, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$b64')))
& node `$f '$Who'
Remove-Item `$f -Force -EA SilentlyContinue
"@ | ForEach-Object { "  $_" }
}

Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
# A problem found, outside or on the way to the box, ends it 1, so the gate's
# Check-Site verb and anything else that runs it can tell (#2862).
if ($problems) { exit 1 }
exit 0
