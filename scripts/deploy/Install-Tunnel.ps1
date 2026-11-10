<#
  Install-Tunnel.ps1

  Puts the site behind a Cloudflare Tunnel (#5334): cloudflared runs on the
  box as the task "Thornswood Tunnel" and keeps an outbound connection open to
  Cloudflare, and Cloudflare sends thornswood.net and www down it to Caddy on
  127.0.0.1:443. Caddy stays the one door (scripts\deploy\Caddyfile), so every
  route, header and log is the same whichever way a request came in.

      pwsh scripts/deploy/Install-Tunnel.ps1            make the tunnel, write its routes, install
                                                        cloudflared and start it; DNS is not touched
      pwsh scripts/deploy/Install-Tunnel.ps1 -Switch    move thornswood.net and www onto the tunnel
      pwsh scripts/deploy/Install-Tunnel.ps1 -Back      put both names back on the box's address
      pwsh scripts/deploy/Install-Tunnel.ps1 -Status    what runs on the box; only reads
      pwsh scripts/deploy/Install-Tunnel.ps1 -Remove    take cloudflared off the box again

  From a cloud thread or the Desk, where box work goes only through the
  deploy gate (#2841), add -ThroughGate to any of them but -Remove:

      pwsh scripts/deploy/Install-Tunnel.ps1 -ThroughGate
      pwsh scripts/deploy/Install-Tunnel.ps1 -ThroughGate -Switch

  -Status is one gate line. The rest is one run of ThornswoodRP/Thornswood-
  Ops's tunnel.yml, with the mode, and takes no key from whoever starts it:
  its first job asks the gate for the box's public seal key (the verb's
  -SealKey), its second seals the API token to it, and its last hands the
  gate the sealed form (-Sealed) with the mode, so the gate runs this same
  script on the box, which opens it. Without -ThroughGate it runs -Status,
  -Remove and a -Sealed run from a machine with the box's ssh.

  Run it from anywhere with gh and the box's ssh: a cloud thread, the Desk, a
  developer's PC. Everything it does is written down in
  records\cloudflare-tunnel.json: the account, the zone, the tunnel's name,
  the cloudflared release by SHA-256, its routes and the two DNS names. The
  box's address is written nowhere (#3690): -Back reads it at Cloudflare
  from the DNS-only A record of vps.json's name.

  FREE. Every Cloudflare account includes 1,000 tunnels at no cost, Tunnel is
  on every plan, and publishing a hostname needs only a domain on Cloudflare,
  which thornswood.net is (checked 1 Nov 2026, #5190:
  https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/#pricing,
  https://developers.cloudflare.com/tunnel/get-started/). No Cloudflare
  Access and no Zero Trust organization is used: those ask for card details.

  THE TOKENS. Two, and neither is ever typed into a session, printed, put in
  a file of this repository or put on a command line:
    - The API token. Patrick makes it once in the Cloudflare dashboard, with
      Account > Cloudflare Tunnel > Edit and Zone > DNS > Edit for
      thornswood.net only, the two permissions Cloudflare's own guide names
      (https://developers.cloudflare.com/tunnel/get-started/), and pastes it
      into the Actions secrets of ThornswoodRP/Thornswood-Ops as
      CLOUDFLARE_TUNNEL_API_TOKEN, a page only he signs in to. Each run that
      needs it is one run of that repository's tunnel.yml: the box prints
      the public half of its seal key (scripts\vps\Seal.ps1) to the run,
      the run's next job seals the token to it with this script's
      -SealOnGitHub, and its last job hands the sealed form to the box,
      which alone can open it. The key never comes from whoever starts the
      run, so nobody can have the token sealed to a key of their own. The box uses it for the calls below and keeps
      it nowhere: Set-Turnstile.ps1 -FromCloudflare does the same (#3216).
    - The tunnel's own token, which lets whoever holds it run the tunnel.
      The box asks Cloudflare for it with the API token and writes it to
      token.txt in the tunnel's folder, which only SYSTEM, Administrators,
      the account running this and the task's own SID can read. cloudflared
      reads it from there (--token-file, cloudflared 2025.4.0 and later,
      https://developers.cloudflare.com/tunnel/reference/run-parameters/#token-file),
      so it is not on cloudflared's command line either, where the process
      list would show it (#451).

  WHAT A PLAIN RUN DOES, on the box, stopping at the first thing that is
  not right:
    1. finds the tunnel by its name, or makes it (config_src cloudflare, so
       its routes live at Cloudflare and change without a restart);
    2. writes the routes from the record and reads them back;
    3. asks for the tunnel's token and writes token.txt when it differs;
    4. downloads the recorded cloudflared when the one there is not it, and
       checks its SHA-256 before it is used;
    5. registers the task as LOCAL SERVICE, Limited, with a SID of its own
       (ServiceAccount.ps1, #2578), the way Caddy and the bridge run, and
       starts it;
    6. waits for cloudflared's /ready on 127.0.0.1:20241, which answers 200
       only while it holds a connection to Cloudflare, and asks Cloudflare
       whether the tunnel is healthy.
  When nothing differs and it is ready, nothing is stopped. DNS is not
  touched, so until -Switch nobody's request goes through the tunnel.

  -SWITCH moves the two names. Each must be one proxied A record at the
  box's address, or already the tunnel's CNAME; anything else stops it with
  what it found. Each A record is changed in place to a proxied CNAME at
  <tunnel id>.cfargotunnel.com, which the box's own requests to both names
  must then reach: cloudflared's request counter has to rise within -Wait
  seconds. When it does not, both records are put back as they were.
  -BACK changes them back to proxied A records at the box's address.
  Caddy's public 443 stays open behind Cloudflare's ranges
  (Set-WebFirewall.ps1) through all of this, so -Back is only DNS; closing
  80 and 443 is a later step of its own.

  WHY A RESTART WAITS FOR -BACK. Every ssh to the box goes through the
  bridge on thornswood.net/box/ (#2753), so once the names are on the
  tunnel, restarting cloudflared cuts the session that asked for it, as
  stopping the bridge did (#3214). A run that would restart it while the
  names are on the tunnel stops instead and says to run -Back first; a run
  that changes only the routes needs no restart and goes ahead.

  NOT HERE. The tunnel itself stays in the Cloudflare account after
  -Remove: deleting it is a step in the dashboard (Networking > Tunnels).
#>
[CmdletBinding()]
param(
    [switch]$Switch,
    [switch]$Back,
    [switch]$Status,
    [switch]$Remove,
    # The workflow's half; nothing else runs it.
    [switch]$SealOnGitHub,
    # From a cloud thread or the Desk: every box half goes through the deploy
    # gate (Box-Run.ps1), which runs this script on the box itself.
    [switch]$ThroughGate,
    # The gate's halves: print the box's public seal key, and run with the
    # API token sealed to it, as tunnel.yml's seal job left it.
    [switch]$SealKey,
    [ValidatePattern('^$|^[A-Za-z0-9+/]{400,560}={0,2}$')][string]$Sealed = '',
    # Register the task as SYSTEM, Highest: the way back if cloudflared will
    # not run as LOCAL SERVICE.
    [switch]$AsSystem,
    [string]$Vps  = '',
    [string]$User = '',
    [string]$Root = 'C:\Thornswood-Tunnel',
    [string]$TaskName = 'Thornswood Tunnel',
    [string]$RecordPath = '',
    # Where tunnel.yml and the VPS runners are (#4013).
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood-Ops',
    # How long cloudflared has to say it is connected, and the names to
    # reach it after -Switch.
    [int]$Wait = 90,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Seal.ps1')

# ------------------------------------------------- the workflow's half ----
if ($SealOnGitHub) {
    . (Join-Path $Here '..\ops\WorkflowRun.ps1')
    $token = [string]$env:CLOUDFLARE_TUNNEL_API_TOKEN
    $env:CLOUDFLARE_TUNNEL_API_TOKEN = $null
    $key = [string]$env:SEAL_KEY
    if (-not $token) {
        Write-ThornswoodAnnotation 'error' 'Tunnel' 'CLOUDFLARE_TUNNEL_API_TOKEN is not among the repository''s Actions secrets, so there is nothing to seal. Patrick makes it on the report page (Account > Cloudflare Tunnel > Edit, Zone > DNS > Edit for thornswood.net). Nothing was sealed.'
        exit 1
    }
    # Its own name: this half's value never reaches the box halves below, so
    # test-secrets-off-command-lines follows the token here and no further.
    try { $sealedHere = ConvertTo-ThornswoodSealed -PublicKeyXml $key -Value $token }
    catch { Write-ThornswoodAnnotation 'error' 'Tunnel' $_.Exception.Message; exit 1 }
    finally { $token = $null }
    # To the run's last job, which hands it to the gate; it never leaves
    # the run. Only the box can open it.
    if (-not $env:GITHUB_OUTPUT) { Write-ThornswoodAnnotation 'error' 'Tunnel' 'there is no step output to hand the sealed token to the next job. Nothing was sealed.'; exit 1 }
    [IO.File]::AppendAllText($env:GITHUB_OUTPUT, 'sealed=' + $sealedHere + "`n")
    $sealedHere = $null
    Write-Host 'sealed the token to the box''s key; only the box can open it'
    exit 0
}

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

if (@($Switch, $Back, $Status, $Remove, $SealKey | Where-Object { $_ }).Count -gt 1) { Die 'One of -Switch, -Back, -Status, -Remove or -SealKey, not more. Nothing was sent.' }

# ------------------------------------------------------------- the record --
# Read whole and checked here, before the box is asked anything.
function Read-ThornswoodTunnelRecord([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "not found: $Path" }
    $r = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
    foreach ($k in 'account', 'zone', 'tunnel', 'metrics') { if (-not [string]$r.$k) { throw "the record names no $k" } }
    if ([string]$r.account -notmatch '^[0-9a-f]{32}$') { throw 'the record''s account is not a Cloudflare account id' }
    if ([string]$r.zone -notmatch '^[0-9a-f]{32}$') { throw 'the record''s zone is not a Cloudflare zone id' }
    if ([string]$r.tunnel -notmatch '^[a-z0-9-]{1,64}$') { throw 'the record''s tunnel name is not lower case letters, digits and dashes' }
    if ([string]$r.metrics -notmatch '^127\.0\.0\.1:\d{2,5}$') { throw 'cloudflared''s metrics must listen on loopback only' }
    $c = $r.cloudflared
    if (-not $c -or [string]$c.version -notmatch '^\d{4}\.\d{1,2}\.\d{1,3}$') { throw 'the record names no cloudflared version' }
    if ([string]$c.sha256 -notmatch '^[0-9a-f]{64}$') { throw 'the record''s cloudflared has no SHA-256' }
    $want = 'https://github.com/cloudflare/cloudflared/releases/download/' + $c.version + '/cloudflared-windows-amd64.exe'
    if ([string]$c.url -ne $want) { throw ('the record''s cloudflared does not come from its own release: ' + $c.url) }
    $ing = @($r.ingress)
    if ($ing.Count -lt 2 -or [string]$ing[-1].service -ne 'http_status:404' -or $ing[-1].PSObject.Properties['hostname']) { throw 'the record''s routes must end in a catch-all http_status:404' }
    foreach ($i in $ing[0..($ing.Count - 2)]) {
        if ([string]$i.hostname -notmatch '^([a-z0-9-]+\.)*thornswood\.net$') { throw ('a route is for a name that is not thornswood.net''s: ' + $i.hostname) }
        if ([string]$i.service -ne 'https://127.0.0.1:443') { throw ('a route goes somewhere but Caddy on 127.0.0.1:443: ' + $i.service) }
        if ([string]$i.originRequest.originServerName -ne [string]$i.hostname) { throw ('the route for ' + $i.hostname + ' does not ask Caddy for that name''s certificate') }
    }
    $names = @($r.dns | ForEach-Object { [string]$_.name })
    $routed = @($ing | Where-Object { $_.PSObject.Properties['hostname'] } | ForEach-Object { [string]$_.hostname })
    if (($names -join ',') -ne ($routed -join ',')) { throw 'the DNS names and the routed names are not the same list' }
    if ($r.PSObject.Properties['box']) { throw 'the record names the box; its name is vps.json''s alone (test-vps-defaults)' }
    return $r
}
if (-not $RecordPath) { $RecordPath = Join-Path $Here '..\..\records\cloudflare-tunnel.json' }
try { $rec = Read-ThornswoodTunnelRecord $RecordPath } catch { Die ($_.Exception.Message + '. Nothing was sent.') }
# The box's address is written nowhere in this repository (#3690): it is what
# the DNS-only record of vps.json's name holds, read at Cloudflare on the box.
. (Join-Path $Here '..\vps\Vps.ps1')
$boxName = [string](Get-ThornswoodVpsAddress)
if ($boxName -notmatch '^([a-z0-9-]+\.)*thornswood\.net$' -or @($rec.dns | ForEach-Object { [string]$_.name }) -contains $boxName) { Die ('vps.json''s address, ' + $boxName + ', is not a thornswood.net name apart from the two the tunnel takes, so the box''s address cannot be read from it. Nothing was sent.') }
$rec | Add-Member -NotePropertyName box -NotePropertyValue $boxName
$recB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($rec | ConvertTo-Json -Depth 10 -Compress)))

# ---------------------------------------------------- through the gate ---
# Box work from the cloud goes only through the gate's verbs (#2841), so
# this side runs none of the box halves itself. -Status is one gate line.
# Everything that needs the API token is one run of the Ops tunnel.yml,
# which takes no key from whoever starts it: its first job asks the gate for
# the box's seal key, its second seals the token to that key on GitHub's
# runner, and its last hands the gate the sealed form with the mode, so
# neither the key nor the sealed token passes through this side, and a run
# started by anyone can only ever hand the token to the box (#5334).
if ($ThroughGate) {
    . (Join-Path $Here '..\ops\WorkflowRun.ps1')
    . (Join-Path $Here '..\ops\Sealed.ps1')
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die 'there is no gh here to start the gate and the tunnel workflow with. Nothing was sent.' }
    # The gate never takes -Remove or -AsSystem (test-2841 holds the words a
    # verb may not have): taking cloudflared off, or running it as SYSTEM,
    # is done from a machine with the box's ssh.
    if ($Remove -or $AsSystem) { Die '-Remove and -AsSystem are not gate words; run them from a machine with the box''s ssh, without -ThroughGate. Nothing was sent.' }
    if ($Status) {
        $boxRun = Join-Path $Here '..\vps\Box-Run.ps1'
        $pwsh = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
        & $pwsh -NoProfile -File $boxRun -Line 'Install-Tunnel -Status' 2>&1 | ForEach-Object { Say "  $_" }
        exit $LASTEXITCODE
    }
    $mode = if ($Switch) { 'switch' } elseif ($Back) { 'back' } else { 'install' }
    $waitIn = if ($PSBoundParameters.ContainsKey('Wait')) { [string]$Wait } else { '' }
    if ($waitIn -notmatch '^$|^[0-9]{1,3}$') { Die '-Wait through the gate is 0 to 999 seconds. Nothing was sent.' }
    Head ('The tunnel workflow: ' + $mode)
    # A key for this run alone, as Box-Run.ps1 makes one: the run seals what
    # the box printed to its public half, and only this side can open it.
    $scratch = & (Join-Path (Join-Path $Here '..\release') 'Get-ScratchDir.ps1') 'box-run'
    $k = New-ThornswoodSealKey
    try { $s = Start-ThornswoodWorkflow -Repo $GitHubRepo -Workflow 'tunnel.yml' -Inputs ([ordered]@{ mode = $mode; wait = $waitIn; recipient = $k.Public }) }
    catch { Die ($_.Exception.Message + '. Nothing was sent.') }
    if (-not $s.Run) { Die ('GitHub started tunnel.yml but named no run, so its answer cannot be read here: ' + $s.Url) }
    $keyPath = Join-Path $scratch ([string]$s.Run + '.key')
    Write-ThornswoodPrivateFile -Path $keyPath -Text $k.Private
    $k = $null
    Say ('  ' + $s.Url) 'DarkGray'
    $a = Read-ThornswoodRunAnswer -Repo $GitHubRepo -Workflow 'tunnel.yml' -Run $s.Run -Title 'Box-Run' -WaitMinutes 60 -Started -Say { param($m) Say $m 'DarkGray' }
    if ($a.State -eq 'waiting' -or $a.State -eq 'unread') { Die ('run ' + $s.Run + ' has no answer yet (' + $a.Text + '): ' + $s.Url) }
    $dir = Join-Path $scratch ([string]$s.Run)
    $o = Open-ThornswoodSealedRun -Repo $GitHubRepo -Run $s.Run -Artifact 'box-run-sealed' -File 'box-run.sealed' -KeyPath $keyPath -Into $dir -FromLog
    if ($o.Ok) {
        $txt = Join-Path $dir 'output.txt'
        if (Test-Path -LiteralPath $txt) { Get-Content -LiteralPath $txt | ForEach-Object { Say "  $_" } }
    } else { Say ('  the run''s output from the box could not be read (' + $o.Why + ')') 'Red' }
    # Never 0 when what the box said was not read (#3399).
    $code = Get-ThornswoodRunExit $a ([bool]$o.Ok)
    if ($code -eq 0 -and $a.Text -match '^ENDED 0 ') { Say ('  ' + $a.Text) 'Green'; exit 0 }
    if ($code -gt 0 -and $a.State -eq 'answer' -and $a.Text -match '^ENDED 0 ') { Die ('the run ended 0, but what the box said was not read, so whether the tunnel is in cannot be told here: ' + $s.Url) }
    Die ('the run ended ' + $a.State + ': ' + $a.Text + ' ' + $s.Url)
}

$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here 'ServiceAccount.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$target = "$User@$Vps"
foreach ($t in 'ssh', 'scp') { if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Die "$t is not on PATH. Nothing was sent." } }
function Remote($script) { return Invoke-ThornswoodRemote -Target $target -SshArgs $ssh -Script $script }

$RootQ = $Root.Replace("'", "''")
$TaskQ = $TaskName.Replace("'", "''")

# ------------------------------------------------- what every box run has --
# The record, the folder's files, and how to read cloudflared's own answers.
# Nothing here prints a token: token.txt is only ever written and compared.
$common = @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
`$rec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$recB64')) | ConvertFrom-Json
`$root = '$RootQ'
`$task = '$TaskQ'
`$exe = Join-Path `$root 'cloudflared.exe'
`$tokenFile = Join-Path `$root 'token.txt'
`$stateFile = Join-Path `$root 'state.txt'
`$log = Join-Path `$root 'data\cloudflared.log'
`$metrics = 'http://' + `$rec.metrics
# What a plain GET answered: the status code, 0 when nothing did, and the body.
function Get-Plain([string]`$Url, [int]`$Seconds = 5) {
    `$q = [Net.WebRequest]::Create(`$Url); `$q.Timeout = `$Seconds * 1000; `$q.ReadWriteTimeout = `$Seconds * 1000
    `$r = `$null
    try { `$r = `$q.GetResponse() } catch {
        `$e = `$_.Exception
        while (`$e -and -not (`$e -is [Net.WebException])) { `$e = `$e.InnerException }
        if (`$e -and `$e.Response) { `$r = `$e.Response }
    }
    if (-not `$r) { return @{ Code = 0; Body = '' } }
    try { return @{ Code = [int]`$r.StatusCode; Body = (New-Object IO.StreamReader(`$r.GetResponseStream())).ReadToEnd() } } finally { `$r.Close() }
}
# One of cloudflared's counters or gauges, summed over its labels; -1 when
# the metrics endpoint did not answer.
function Get-Metric([string]`$Name) {
    `$a = Get-Plain (`$metrics + '/metrics') 5
    if (`$a.Code -ne 200) { return -1 }
    `$sum = 0.0
    foreach (`$l in (`$a.Body -split "``n")) {
        if (`$l -match ('^' + [regex]::Escape(`$Name) + '(\{[^}]*\})?\s+([0-9.eE+-]+)\s*$')) { `$sum += [double]`$Matches[2] }
    }
    return `$sum
}
function Get-State { if (Test-Path -LiteralPath `$stateFile) { return ([IO.File]::ReadAllText(`$stateFile)).Trim() } else { return 'back' } }
# Nothing from C:\: only SYSTEM, Administrators and whoever runs this; the
# task's own SID is added once it is registered.
function Lock-TunnelFolder([string]`$dir) {
    `$acl = Get-Acl -LiteralPath `$dir
    `$acl.SetAccessRuleProtection(`$true, `$false)
    foreach (`$r in @(`$acl.GetAccessRules(`$true, `$false, [Security.Principal.SecurityIdentifier]))) { if (@('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-5-19') -contains `$r.IdentityReference.Value) { [void]`$acl.RemoveAccessRuleSpecific(`$r) } }
    foreach (`$s in @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) {
        `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier(`$s)), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
    }
    # Only the access rules are written back (issue #1120).
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo](Get-Item -LiteralPath `$dir -Force), `$acl)
}
"@

# Cloudflare's API, for the runs that hold the API token in `$cfToken. A
# failure says the method, the path and the status or Cloudflare's error
# codes, never a header and never what came back.
$cfApi = @'
function Cf([string]$Method, [string]$Path, $Body = $null) {
    $p = @{ Method = $Method; Uri = ('https://api.cloudflare.com/client/v4/' + $Path); Headers = @{ Authorization = ('Bearer ' + $cfToken) }; UseBasicParsing = $true; TimeoutSec = 30 }
    if ($null -ne $Body) { $p.ContentType = 'application/json'; $p.Body = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 10 -Compress)) }
    $r = $null
    try { $r = Invoke-RestMethod @p }
    catch {
        $code = ''
        try { $code = [string][int]$_.Exception.Response.StatusCode } catch {
            # No answer at all, so no status: the line says so with an empty code.
            $code = ''
        }
        throw ('Cloudflare answered ' + $Method + ' ' + ($Path -replace '\?.*$', '') + ' with HTTP ' + $code + '. A 403 is an API token without Account > Cloudflare Tunnel > Edit or Zone > DNS > Edit')
    }
    if (-not $r -or -not $r.success) { throw ('Cloudflare said no to ' + $Method + ' ' + ($Path -replace '\?.*$', '') + ': ' + ((@($r.errors) | ForEach-Object { [string]$_.code + ' ' + [string]$_.message }) -join '; ')) }
    return $r.result
}
# The tunnel by the record's name: its object, or $null when there is none.
function Find-Tunnel {
    $found = @(Cf 'GET' ('accounts/' + $rec.account + '/cfd_tunnel?is_deleted=false&name=' + [uri]::EscapeDataString($rec.tunnel)))
    $found = @($found | Where-Object { $_ -and [string]$_.name -eq [string]$rec.tunnel })
    if ($found.Count -gt 1) { throw ('the account has ' + $found.Count + ' tunnels named ' + $rec.tunnel + '; one is kept and the rest deleted in the dashboard first') }
    if ($found.Count -eq 1) { return $found[0] }
    return $null
}
# Each of the record's names as Cloudflare holds it: @{ Name; Id; Type; Content; Proxied; Count }.
function Get-Names {
    # The box's address: the one A record of the record's box name, which
    # Cloudflare only answers for (DNS only), so it is the box itself.
    $b = @(@(Cf 'GET' ('zones/' + $rec.zone + '/dns_records?name=' + [uri]::EscapeDataString($rec.box))) | Where-Object { $_ -and @('A', 'AAAA', 'CNAME') -contains [string]$_.type })
    if ($b.Count -ne 1 -or [string]$b[0].type -ne 'A' -or [bool]$b[0].proxied -or [string]$b[0].content -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw ($rec.box + ' is not one DNS-only A record, so the box''s address is not known; nothing was changed') }
    $boxAddress = [string]$b[0].content
    foreach ($d in @($rec.dns)) {
        $all = @(Cf 'GET' ('zones/' + $rec.zone + '/dns_records?name=' + [uri]::EscapeDataString($d.name)))
        $all = @($all | Where-Object { $_ -and @('A', 'AAAA', 'CNAME') -contains [string]$_.type })
        $one = $all | Select-Object -First 1
        [pscustomobject]@{ Name = [string]$d.name; Box = $boxAddress; Count = $all.Count; Id = [string]$one.id; Type = [string]$one.type; Content = [string]$one.content; Proxied = [bool]$one.proxied }
    }
}
'@

# ---------------------------------------------------------------- status ---
if ($Status) {
    Head 'On the box'
    Remote ($common + @"

`$t = Get-ScheduledTask -TaskName `$task -EA SilentlyContinue
if (`$t) { `$i = Get-ScheduledTaskInfo -TaskName `$task; 'task         ' + `$t.State + ' as ' + `$t.Principal.UserId + ', last ran ' + `$i.LastRunTime + ' result ' + `$i.LastTaskResult } else { 'task         NOT REGISTERED' }
if (Test-Path -LiteralPath `$exe) {
    `$h = (Get-FileHash -LiteralPath `$exe -Algorithm SHA256).Hash.ToLowerInvariant()
    'cloudflared  ' + `$(if (`$h -eq `$rec.cloudflared.sha256) { `$rec.cloudflared.version + ', the recorded build' } else { 'NOT the recorded build (' + `$h + ')' })
} else { 'cloudflared  NOT THERE' }
'token        ' + `$(if (Test-Path -LiteralPath `$tokenFile) { 'there (never shown)' } else { 'NOT THERE' })
`$ready = Get-Plain (`$metrics + '/ready') 5
'ready        ' + `$(if (`$ready.Code -eq 200) { 'yes, connected to Cloudflare' } elseif (`$ready.Code) { 'NO (' + `$ready.Code + ')' } else { 'NO ANSWER on ' + `$rec.metrics })
'connections  ' + (Get-Metric 'cloudflared_tunnel_ha_connections')
'requests     ' + (Get-Metric 'cloudflared_tunnel_total_requests') + ' since it started'
'names        ' + `$(if ((Get-State) -eq 'switched') { 'on the tunnel (-Switch ran last)' } else { 'on the box''s address (-Switch has not run, or -Back ran last)' })
if (Test-Path -LiteralPath `$log) { ''; '--- cloudflared.log, last 15 ---'; Get-Content -LiteralPath `$log -Tail 15 }
"@) | ForEach-Object { Say "  $_" }
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ---------------------------------------------------------------- remove ---
if ($Remove) {
    Head 'Removing'
    $out = @(Remote ($common + @"

if ((Get-State) -eq 'switched') { 'the names are on the tunnel, so taking it off would take the site and every ssh through the bridge with it. Run -Back first.'; 'NOT REMOVED'; exit 1 }
Stop-ScheduledTask -TaskName `$task -EA SilentlyContinue
Get-Process cloudflared -EA SilentlyContinue | Where-Object { `$_.Path -eq `$exe } | Stop-Process -Force -EA SilentlyContinue
Unregister-ScheduledTask -TaskName `$task -Confirm:`$false -EA SilentlyContinue
Remove-Item -LiteralPath `$root -Recurse -Force -EA SilentlyContinue
if (Get-ScheduledTask -TaskName `$task -EA SilentlyContinue) { 'STILL THERE' } elseif (Test-Path -LiteralPath `$root) { 'FOLDER STILL THERE' } else { 'REMOVED' }
"@) | ForEach-Object { Say "  $_"; "$_".Trim() })
    if ($out -notcontains 'REMOVED') { Die 'it was not all taken off. The lines above say what is left.' }
    Say '  Gone from the box, token and all. The tunnel itself stays in the Cloudflare account until it is deleted in the dashboard (Networking > Tunnels).' 'Green'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# --------------------------------------------------- the box's seal key ---
function Get-BoxSealKey {
    $lines = @(Remote ("`$ErrorActionPreference = 'Stop'`r`n" + (Get-ThornswoodSealLockFunction) + "`r`n" + (Get-ThornswoodSealKeyBlock)) | ForEach-Object { "$_".Trim() })
    return (@($lines | Where-Object { $_ -like 'SEAL KEY <RSAKeyValue>*' }) | Select-Object -Last 1), ($lines -join ' ')
}
if ($SealKey) {
    $k, $said = Get-BoxSealKey
    if (-not $k) { Die ('the box gave no seal key: ' + $said) }
    # Public: only the box holds the private half.
    Write-Host $k
    exit 0
}

# ------------------------------------------------- the API token, sealed ---
if ($Sealed) {
    Head 'The API token'
    Say '  sealed to the box''s key, as tunnel.yml''s seal job left it'
    $sealed = $Sealed
} else {
    # The API token reaches the box only inside one run of the Ops
    # tunnel.yml, which asks the box for its key itself (#5334), so a run
    # with the box's ssh that needs the token goes the same way.
    Die 'the API token reaches the box only through the tunnel workflow: run this again with -ThroughGate. Nothing was sent.'
}

$opened = @"
`$sealed = '$sealed'
$(Get-ThornswoodUnsealBlock)
`$cfToken = `$ThornswoodSecret; `$ThornswoodSecret = `$null
if (-not `$cfToken) { 'THE API TOKEN DID NOT ARRIVE. Nothing was changed.'; exit 1 }
"@

# ----------------------------------------------------- -Switch and -Back ---
if ($Switch -or $Back) {
    $want = if ($Switch) { 'switch' } else { 'back' }
    Head $(if ($Switch) { 'Moving thornswood.net and www onto the tunnel' } else { 'Putting thornswood.net and www back on the box''s address' })
    $out = @(Remote ($common + $opened + $cfApi + @"

`$want = '$want'
`$wait = $Wait
try {
    `$t = Find-Tunnel
    if (-not `$t) { 'there is no tunnel named ' + `$rec.tunnel + ' yet; a plain run makes it'; 'DNS NOT CHANGED'; exit 1 }
    `$cname = [string]`$t.id + '.cfargotunnel.com'
    `$names = @(Get-Names)
    `$plan = @()
    foreach (`$n in `$names) {
        `$onTunnel = (`$n.Count -eq 1 -and `$n.Type -eq 'CNAME' -and `$n.Content -eq `$cname -and `$n.Proxied)
        `$onBox = (`$n.Count -eq 1 -and `$n.Type -eq 'A' -and `$n.Content -eq `$n.Box -and `$n.Proxied)
        if (`$want -eq 'switch' -and `$onTunnel) { `$n.Name + ' is already on the tunnel'; continue }
        if (`$want -eq 'back' -and `$onBox) { `$n.Name + ' is already on the box''s address'; continue }
        if ((`$want -eq 'switch' -and -not `$onBox) -or (`$want -eq 'back' -and -not `$onTunnel)) {
            `$n.Name + ' is ' + `$n.Count + ' record(s), the first ' + `$n.Type + ' ' + `$n.Content + ' proxied ' + `$n.Proxied + ', which is neither the box''s proxied A record nor the tunnel''s proxied CNAME'
            'DNS NOT CHANGED'; exit 1
        }
        `$plan += `$n
    }
    if (`$want -eq 'switch') {
        `$ready = Get-Plain (`$metrics + '/ready') 5
        if (`$ready.Code -ne 200) { 'cloudflared on the box is not connected to Cloudflare (/ready answered ' + `$ready.Code + '), so nothing would answer on the tunnel'; 'DNS NOT CHANGED'; exit 1 }
        `$health = [string](Cf 'GET' ('accounts/' + `$rec.account + '/cfd_tunnel/' + `$t.id)).status
        if (`$health -ne 'healthy') { 'Cloudflare says the tunnel is ' + `$health + ', not healthy'; 'DNS NOT CHANGED'; exit 1 }
    }
    if (-not `$plan.Count) { if (`$want -eq 'switch') { [IO.File]::WriteAllText(`$stateFile, 'switched') } else { [IO.File]::WriteAllText(`$stateFile, 'back') }; 'DNS ALREADY'; exit 0 }

    `$before = Get-Metric 'cloudflared_tunnel_total_requests'
    `$done = @()
    try {
        foreach (`$n in `$plan) {
            if (`$want -eq 'switch') { `$body = @{ type = 'CNAME'; content = `$cname; proxied = `$true } } else { `$body = @{ type = 'A'; content = `$n.Box; proxied = `$true } }
            `$null = Cf 'PATCH' ('zones/' + `$rec.zone + '/dns_records/' + `$n.Id) `$body
            `$done += `$n
            `$n.Name + ' is now ' + `$body.type + ' ' + `$body.content + ', proxied'
        }
    } catch {
        'COULD NOT CHANGE ' + `$n.Name + ': ' + `$_.Exception.Message
        foreach (`$d in `$done) { try { `$null = Cf 'PATCH' ('zones/' + `$rec.zone + '/dns_records/' + `$d.Id) @{ type = `$d.Type; content = `$d.Content; proxied = `$d.Proxied }; `$d.Name + ' put back as it was' } catch { 'COULD NOT PUT ' + `$d.Name + ' BACK: ' + `$_.Exception.Message } }
        'DNS NOT CHANGED'; exit 1
    }
    if (`$want -eq 'back') {
        [IO.File]::WriteAllText(`$stateFile, 'back')
        foreach (`$n in `$plan) { `$a = Get-Plain ('https://' + `$n.Name + '/') 20; `$n.Name + ' answers ' + `$a.Code }
        'DNS BACK'; exit 0
    }
    # The names reach the tunnel once Cloudflare's edge has the new records,
    # which takes seconds: the box asks for each name until cloudflared has
    # carried both, and stops at -Wait.
    `$until = (Get-Date).AddSeconds(`$wait)
    `$carried = 0
    while ((Get-Date) -lt `$until) {
        foreach (`$n in `$plan) { `$null = Get-Plain ('https://' + `$n.Name + '/?tunnel-check=' + [Guid]::NewGuid().ToString('N')) 15 }
        `$carried = (Get-Metric 'cloudflared_tunnel_total_requests') - `$before
        if (`$before -ge 0 -and `$carried -ge `$plan.Count) { break }
        Start-Sleep -Seconds 3
    }
    if (`$before -ge 0 -and `$carried -ge `$plan.Count) {
        [IO.File]::WriteAllText(`$stateFile, 'switched')
        'cloudflared carried ' + `$carried + ' request(s) to the names since the change'
        'DNS SWITCHED'; exit 0
    }
    'cloudflared carried no request to the names within ' + `$wait + ' seconds, so both go back'
    foreach (`$d in `$done) { try { `$null = Cf 'PATCH' ('zones/' + `$rec.zone + '/dns_records/' + `$d.Id) @{ type = `$d.Type; content = `$d.Content; proxied = `$d.Proxied }; `$d.Name + ' put back as it was' } catch { 'COULD NOT PUT ' + `$d.Name + ' BACK: ' + `$_.Exception.Message } }
    'DNS NOT CHANGED'; exit 1
} catch { 'STOPPED: ' + `$_.Exception.Message; 'DNS NOT CHANGED'; exit 1 }
finally { `$cfToken = `$null }
"@) | ForEach-Object { Say "  $_"; "$_".Trim() })
    $sealed = $null
    if ($Switch -and ($out -contains 'DNS SWITCHED' -or $out -contains 'DNS ALREADY')) { Say '  Both names are on the tunnel. -Back puts them on the box''s address again.' 'Green' }
    elseif ($Back -and ($out -contains 'DNS BACK' -or $out -contains 'DNS ALREADY')) { Say '  Both names are on the box''s address. Caddy answers them there as before.' 'Green' }
    else { Die 'DNS was not changed, or was put back. The lines above say why.' }
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ---------------------------------------------------------------- install --
Head 'Installing the tunnel'
$asSystemInt = [int][bool]$AsSystem
$install = $common + $opened + $cfApi + "`r`n" + (Get-ThornswoodServiceAccountScript) + @"

`$AsSystem = [bool]$asSystemInt
`$wait = $Wait
try {
    # 1. The tunnel.
    `$t = Find-Tunnel
    if (-not `$t) {
        `$t = Cf 'POST' ('accounts/' + `$rec.account + '/cfd_tunnel') @{ name = [string]`$rec.tunnel; config_src = 'cloudflare' }
        'made the tunnel ' + `$rec.tunnel + ' (' + `$t.id + ')'
    } else { 'the tunnel ' + `$rec.tunnel + ' is there (' + `$t.id + ')' }
    if (`$t.PSObject.Properties['remote_config'] -and -not `$t.remote_config) { 'the tunnel ' + `$rec.tunnel + ' is managed by a file on some machine, not at Cloudflare, so its routes cannot be written here'; 'TUNNEL REFUSED'; exit 1 }
    `$id = [string]`$t.id

    # 2. Its routes, written and read back. A live cloudflared takes them
    # without a restart.
    `$null = Cf 'PUT' ('accounts/' + `$rec.account + '/cfd_tunnel/' + `$id + '/configurations') @{ config = @{ ingress = @(`$rec.ingress) } }
    `$got = Cf 'GET' ('accounts/' + `$rec.account + '/cfd_tunnel/' + `$id + '/configurations')
    `$line = { param(`$i) [string]`$i.hostname + ' > ' + [string]`$i.service + ' as ' + [string]`$i.originRequest.originServerName }
    `$wantLines = @(`$rec.ingress | ForEach-Object { & `$line `$_ }) -join ' | '
    `$gotLines = @(`$got.config.ingress | ForEach-Object { & `$line `$_ }) -join ' | '
    if (`$gotLines -ne `$wantLines) { 'the routes read back as ' + `$gotLines + ', not ' + `$wantLines; 'TUNNEL REFUSED'; exit 1 }
    'routes: ' + `$wantLines

    # 3. The folder, locked: nothing from C:\, only SYSTEM, Administrators
    # and whoever runs this, plus the task's SID below.
    foreach (`$d in @(`$root, (Join-Path `$root 'data'))) { if (-not (Test-Path -LiteralPath `$d)) { New-Item -ItemType Directory -Path `$d -Force | Out-Null } }
    Lock-TunnelFolder `$root

    # 4. The tunnel's token, written only when it differs.
    `$runToken = [string](Cf 'GET' ('accounts/' + `$rec.account + '/cfd_tunnel/' + `$id + '/token'))
    if (-not `$runToken) { 'Cloudflare gave no token for the tunnel'; 'TUNNEL REFUSED'; exit 1 }
    `$tokenNew = `$true
    if (Test-Path -LiteralPath `$tokenFile) { `$tokenNew = (([IO.File]::ReadAllText(`$tokenFile)).Trim() -ne `$runToken) }
    `$utf8 = New-Object Text.UTF8Encoding(`$false)

    # 5. cloudflared, the recorded build or nothing.
    `$exeNew = -not ((Test-Path -LiteralPath `$exe) -and ((Get-FileHash -LiteralPath `$exe -Algorithm SHA256).Hash.ToLowerInvariant() -eq `$rec.cloudflared.sha256))
    `$stage = Join-Path `$root ('.stage-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    if (`$exeNew) {
        New-Item -ItemType Directory -Path `$stage -Force | Out-Null
        `$dl = Join-Path `$stage 'cloudflared.exe'
        Invoke-WebRequest -Uri `$rec.cloudflared.url -OutFile `$dl -UseBasicParsing -TimeoutSec 300
        `$h = (Get-FileHash -LiteralPath `$dl -Algorithm SHA256).Hash.ToLowerInvariant()
        if (`$h -ne `$rec.cloudflared.sha256) { Remove-Item -LiteralPath `$stage -Recurse -Force -EA SilentlyContinue; 'cloudflared ' + `$rec.cloudflared.version + ' came down as ' + `$h + ', not the recorded ' + `$rec.cloudflared.sha256 + ', so it was not used'; 'TUNNEL REFUSED'; exit 1 }
        'downloaded cloudflared ' + `$rec.cloudflared.version + ', SHA-256 matched'
    } else { 'cloudflared ' + `$rec.cloudflared.version + ' is already the recorded build' }

    # 6. The task.
    `$arg = 'tunnel --no-autoupdate --metrics ' + `$rec.metrics + ' --loglevel info --logfile "' + `$log + '" run --token-file "' + `$tokenFile + '"'
    `$have = Get-ScheduledTask -TaskName `$task -EA SilentlyContinue
    `$ready = Get-Plain (`$metrics + '/ready') 5
    `$sameTask = (`$have -and ([string]@(`$have.Actions)[0].Arguments).Contains(`$arg) -and ([bool](`$have.Principal.UserId -match 'SYSTEM') -eq `$AsSystem))
    if (-not `$tokenNew -and -not `$exeNew -and `$sameTask -and `$ready.Code -eq 200) {
        'the task runs this build with this token and is connected, so nothing was restarted'
        'TUNNEL OK'; exit 0
    }
    if ((Get-State) -eq 'switched') {
        if (Test-Path -LiteralPath `$stage) { Remove-Item -LiteralPath `$stage -Recurse -Force -EA SilentlyContinue }
        'cloudflared would have to restart, and the names are on the tunnel, so the restart would cut the site and this session. Run -Back, run this again, then -Switch. The routes above were written; nothing else changed.'
        'TUNNEL REFUSED'; exit 1
    }
    if (-not `$AsSystem) {
        `$cannot = @(Test-ThornswoodServiceCannotReach (@(Get-ThornswoodServiceNeverReach -Own `$root -Box (Split-Path -Parent `$root)) + `$root))
        if (`$cannot.Count) { 'LOCAL SERVICE could read what no service may, so cloudflared is not put on it:'; `$cannot; 'Lock those (scripts\vps\Lock-VpsFolders.ps1), or pass -AsSystem. Nothing was started.'; 'TUNNEL REFUSED'; exit 1 }
    }
    Stop-ScheduledTask -TaskName `$task -EA SilentlyContinue
    Get-Process cloudflared -EA SilentlyContinue | Where-Object { `$_.Path -eq `$exe } | ForEach-Object { `$_ | Stop-Process -Force; `$_.WaitForExit(15000) | Out-Null }
    if (`$exeNew) { Move-Item -LiteralPath (Join-Path `$stage 'cloudflared.exe') -Destination `$exe -Force; Remove-Item -LiteralPath `$stage -Recurse -Force -EA SilentlyContinue }
    if (`$tokenNew) { [IO.File]::WriteAllText(`$tokenFile, `$runToken, `$utf8); 'wrote the tunnel''s token (not shown)' }
    `$runToken = `$null
    # A new log for each start; the one before is kept beside it.
    if (Test-Path -LiteralPath `$log) { Move-Item -LiteralPath `$log -Destination (`$log + '.1') -Force }

    function Register([bool]`$system) {
        `$action = New-ScheduledTaskAction -Execute `$exe -Argument `$arg -WorkingDirectory `$root
        # Priority 4, normal, not Task Scheduler's default of 7 (#1968).
        `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -Priority 4
        if (Get-ScheduledTask -TaskName `$task -EA SilentlyContinue) { Unregister-ScheduledTask -TaskName `$task -Confirm:`$false }
        Register-ScheduledTask -TaskName `$task -Action `$action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings `$settings -Principal (New-ThornswoodServicePrincipal -AsSystem:`$system) | Out-Null
    }
    Register `$AsSystem
    if (-not `$AsSystem) {
        `$why = ''
        `$sid = Get-ThornswoodTaskSid `$task
        if (-not `$sid) { `$why = 'the task SID NT TASK\' + `$task + ' could not be looked up' }
        else {
            try {
                `$null = Grant-ThornswoodServiceFolder -Root `$root -Sid `$sid -Writable 'data'
                Set-ThornswoodTaskOwner -TaskName `$task -Sid `$sid -Roots `$root | Out-Null
            } catch { `$why = 'its folder could not be granted to it: ' + `$_.Exception.Message }
        }
        if (`$why) { `$why + ', so the task goes on SYSTEM'; Register `$true }
        else { 'the task runs as LOCAL SERVICE, Limited, as NT TASK\' + `$task }
    }
    Start-ScheduledTask -TaskName `$task

    # 7. Connected. cloudflared opens its connections after it starts; /ready
    # answers 200 once one is up. -Wait seconds, then it says so and stops.
    `$until = (Get-Date).AddSeconds(`$wait)
    while ((Get-Date) -lt `$until) { if ((Get-Plain (`$metrics + '/ready') 3).Code -eq 200) { break }; Start-Sleep -Seconds 2 }
    if ((Get-Plain (`$metrics + '/ready') 3).Code -ne 200) {
        'cloudflared did not connect within ' + `$wait + ' seconds. cloudflared.log says:'
        if (Test-Path -LiteralPath `$log) { Get-Content -LiteralPath `$log -Tail 15 } else { 'nothing was written' }
        Stop-ScheduledTask -TaskName `$task -EA SilentlyContinue
        'the task is stopped; DNS was never moved, so the site is as it was'
        'TUNNEL NOT READY'; exit 1
    }
    'cloudflared is connected: ' + (Get-Metric 'cloudflared_tunnel_ha_connections') + ' connection(s)'
    `$health = [string](Cf 'GET' ('accounts/' + `$rec.account + '/cfd_tunnel/' + `$id)).status
    'Cloudflare says the tunnel is ' + `$health
    'TUNNEL OK'; exit 0
} catch { 'STOPPED: ' + `$_.Exception.Message; 'TUNNEL REFUSED'; exit 1 }
finally { `$cfToken = `$null; `$runToken = `$null }
"@
$out = @(Remote $install | ForEach-Object { Say "  $_"; "$_".Trim() })
$sealed = $null
if ($out -notcontains 'TUNNEL OK') { Die 'the tunnel is not running as it should. The lines above say why; DNS was not touched.' }
Say '  The tunnel runs and is connected. Nothing goes through it until -Switch moves the names.' 'Green'
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
