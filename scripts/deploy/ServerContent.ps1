<#
  ServerContent.ps1

  Which Thornswood-Content.esp a game server holds, read off the box, and
  whether a release may send clients a content plugin that server does not
  hold (#2308). Dot-sourced by Publish-Update.ps1 (the release),
  Deploy-DevGamemode.ps1 and Deploy-Server.ps1 (the server half); defines
  functions and nothing else. Works on Windows PowerShell 5.1 and
  PowerShell 7.

  WHY, issue #2308. On 11 Oct the dev Ship 20261011-221215-dev sent clients a
  new Data\Thornswood-Content.esp (146,381 bytes), posted to
  #staff-news, told the dev server to restart and pushed its tag, while the dev
  server still had the old one (146,446 bytes). Ship and the server deploy
  are two runs, and nothing in the release asked what the server held. For
  eight minutes every dev client that updated held a content plugin the
  server it joined did not.

  THE RULE. The server gets the content plugin first, then the Ship. A
  release whose Data\Thornswood-Content.esp is not the one the channel's last
  release carried (the baseline Publish-Update already diffs against) is
  refused, before anything is packed, sent, posted or told to a server,
  unless that channel's server already holds the same plugin: the same size
  and the same sha256, read from the box. The refusal names the command that
  sends it there (Get-ThornswoodContentCommand).

  READ OVER SSH, NOT THE MANIFEST. Each server also lists its plugins over
  plain HTTP (the resources port's manifest.json, 7788 for dev and 3000 for
  live), and that answers from machines where ssh is refused. It is not used
  here, for three measured reasons. It gives a size and a crc32 for each
  plugin and no sha256, so two plugins of one size and a colliding crc32
  pass. It is what the running process loaded at its last start, not the
  file on disk the next start loads and a deploy has just written. And it
  does not answer at all while the server is down or restarting, which is
  exactly when a deploy has just put a plugin there. The plugins folder on
  the box is what the server will load, and every Ship already needs ssh to
  the same box: Feed-Store.ps1 receives the feed and the baseline over it,
  so a machine that can Ship can make this read.

  A READ THAT GETS NO ANSWER IS A REFUSAL. No answer is not "the server has
  it": a release is refused when the box does not say which plugin it holds.

  The far side's text ($ThornswoodServerContentText) runs on the box under
  Windows PowerShell 5.1, so it is ASCII and uses .NET for the sha256 rather
  than Get-FileHash, which a 5.1 started from PowerShell 7 cannot always
  load.

  THE HARNESS STAND-IN. tests\test-2308-content-before-ship.ps1 and
  tests\test-2309-loadorder-fresh.ps1 run the same far side text in place on
  a folder standing in for the server root. That folder is used only when
  THORNSWOOD_HARNESS is 1, THORNSWOOD_TEST_SERVER_DIR names it, and the box
  the read would go to is one that can never be a real server (the hosts
  Fresh-Checkout.ps1 lets the harness use), so a stray variable can never
  make a real release read a local folder as the box.
#>

$ThornswoodContentPlugin = 'Thornswood-Content.esp'
$ThornswoodContentRel = 'Data\Thornswood-Content.esp'
# Our other plugins are read off the box the same way (#2486).
. (Join-Path $PSScriptRoot '..\release\RepoPlugins.ps1')

# What the box says, in lines, for $root (set in front of it):
#   CONTENT <bytes> <sha256>   or   CONTENT none
#   ORDER <plugin file name>   one a line, in the server's own load order
#   ORDER unreadable           when server-settings.json does not read
#   OURS <name> <bytes> <sha256>   or   OURS <name> none
#                              each other plugin of ours ($ours, RepoPlugins.ps1)
#   DONE                       the end, so a cut off answer is never taken whole
$ThornswoodServerContentText = @'
$ep = Join-Path $root 'plugins\Thornswood-Content.esp'
if (Test-Path -LiteralPath $ep -PathType Leaf) {
  $h = [Security.Cryptography.SHA256]::Create()
  $fs = [IO.File]::Open($ep, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try { $sum = -join ($h.ComputeHash($fs) | ForEach-Object { $_.ToString('x2') }); $len = $fs.Length } finally { $fs.Dispose(); $h.Dispose() }
  'CONTENT ' + $len + ' ' + $sum
} else { 'CONTENT none' }
$sp = Join-Path $root 'server-settings.json'
$s = $null
try { $s = ([IO.File]::ReadAllText($sp)) | ConvertFrom-Json } catch { $s = $null }
$lo = $null
if ($null -ne $s -and $null -ne $s.PSObject.Properties['loadOrder']) { $lo = $s.PSObject.Properties['loadOrder'].Value }
if ($null -eq $lo) { 'ORDER unreadable' }
else { foreach ($o in @($lo)) { 'ORDER ' + @(([string]$o) -split '[\\/]')[-1] } }
foreach ($n in @($ours)) {
  $op = Join-Path $root ('plugins\' + $n)
  if (Test-Path -LiteralPath $op -PathType Leaf) {
    $h = [Security.Cryptography.SHA256]::Create()
    $fs = [IO.File]::Open($op, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try { $sum = -join ($h.ComputeHash($fs) | ForEach-Object { $_.ToString('x2') }); $len = $fs.Length } finally { $fs.Dispose(); $h.Dispose() }
    'OURS ' + $n + ' ' + $len + ' ' + $sum
  } else { 'OURS ' + $n + ' none' }
}
'DONE'
'@

# The server root on the box for a channel, the defaults Deploy-Server.ps1 and
# Deploy-DevGamemode.ps1 deploy to.
function Get-ThornswoodServerContentRoot([string]$Channel) {
    if ($Channel -eq 'dev') { return 'C:\Thornswood-Server-Dev' }
    if ($Channel -eq 'main' -or -not $Channel) { return 'C:\Thornswood-Server' }
    throw "ServerContent.ps1 knows the channels main and dev, not '$Channel'."
}

# The command that puts this checkout's content plugin on the channel's server.
function Get-ThornswoodContentCommand([string]$Channel) {
    if ($Channel -eq 'dev') {
        return '.\scripts\deploy\Deploy-DevGamemode.ps1 -LoadOrder -Note "<a title, then a - line for each thing somebody will notice>"'
    }
    return '.\scripts\deploy\Deploy-Server.ps1 -GamemodeOnly'
}

# The stand-in folder, or '' when this read goes to the real box.
function Get-ThornswoodServerContentStandIn([string]$Target) {
    if ($env:THORNSWOOD_HARNESS -ne '1') { return '' }
    $dir = [string]$env:THORNSWOOD_TEST_SERVER_DIR
    if (-not $dir) { return '' }
    $hostPart = ([string]$Target -split '@')[-1].Trim().ToLowerInvariant()
    if (@('harness.invalid', '127.0.0.1', '::1', 'localhost') -notcontains $hostPart) { return '' }
    return $dir
}

# Reads the lines the far side text answered into an object:
#   Answered  the answer ended with DONE
#   Bytes     the plugin's size, -1 when the box has none
#   Sha       its sha256, lower case, '' when none
#   Order     the server's own load order, file names
#   OrderRead whether server-settings.json gave one
#   Said      every line, for a refusal to show
function ConvertFrom-ThornswoodServerContentLines($Lines) {
    $o = [pscustomobject]@{ Answered = $false; Bytes = [int64]-1; Sha = ''; Order = @(); OrderRead = $false; Ours = @{}; Said = @() }
    $order = New-Object System.Collections.Generic.List[string]
    $sawContent = $false
    $unreadable = $false
    foreach ($l in @($Lines)) {
        $t = ([string]$l).Trim()
        $o.Said += $t
        if ($t -eq 'DONE') { $o.Answered = $true }
        elseif ($t -match '^CONTENT none$') { $sawContent = $true }
        elseif ($t -match '^CONTENT (\d+) ([0-9a-fA-F]{64})$') { $sawContent = $true; $o.Bytes = [int64]$Matches[1]; $o.Sha = $Matches[2].ToLowerInvariant() }
        elseif ($t -match '^OURS (\S+) none$') { $o.Ours[$Matches[1]] = [pscustomobject]@{ Bytes = [int64]-1; Sha = '' } }
        elseif ($t -match '^OURS (\S+) (\d+) ([0-9a-fA-F]{64})$') { $o.Ours[$Matches[1]] = [pscustomobject]@{ Bytes = [int64]$Matches[2]; Sha = $Matches[3].ToLowerInvariant() } }
        elseif ($t -eq 'ORDER unreadable') { $unreadable = $true }
        elseif ($t -match '^ORDER (.+)$') { $order.Add($Matches[1].Trim()) }
    }
    if (-not $sawContent) { $o.Answered = $false }
    $o.Order = $order.ToArray()
    $o.OrderRead = ($o.Answered -and -not $unreadable -and $order.Count -gt 0)
    return $o
}

# What the channel's server holds. -Root is the server folder on the box
# (Get-ThornswoodServerContentRoot when left out), -Target user@host and
# -SshArgs the caller's ssh options. Left out, the VPS from scripts\vps\vps.json.
function Read-ThornswoodServerContent {
    param(
        [string]$Channel = 'main',
        [string]$Root = '',
        [string]$Target = '',
        [string[]]$SshArgs = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
    )
    if (-not $Root) { $Root = Get-ThornswoodServerContentRoot $Channel }
    $Root = $Root.Replace('/', '\')
    $vpsDir = Join-Path $PSScriptRoot '..\vps'
    if (-not $Target) {
        . (Join-Path $vpsDir 'Vps.ps1')
        $Target = (Get-ThornswoodVpsUser) + '@' + (Get-ThornswoodVpsAddress)
    }
    $standIn = Get-ThornswoodServerContentStandIn $Target
    $others = @($ThornswoodRepoPlugins | Where-Object { $_ -ine $ThornswoodContentPlugin } | ForEach-Object { "'" + $_.Replace("'", "''") + "'" })
    $text = "`$root = '" + $(if ($standIn) { $standIn } else { $Root }).Replace("'", "''") + "'`r`n" +
            "`$ours = @(" + ($others -join ', ') + ")`r`n" + $ThornswoodServerContentText
    $lines = @()
    if ($standIn) {
        $lines = @(& ([scriptblock]::Create($text)) | ForEach-Object { [string]$_ })
    } else {
        if (-not (Get-Command Invoke-ThornswoodRemote -ErrorAction SilentlyContinue)) { . (Join-Path $vpsDir 'Send-Script.ps1') }
        if (-not (Get-Command Invoke-ThornswoodNative -ErrorAction SilentlyContinue)) { . (Join-Path $vpsDir 'Vps.ps1') }
        $lines = @(Invoke-ThornswoodRemote -Target $Target -SshArgs $SshArgs -Script $text | ForEach-Object { [string]$_ })
    }
    return (ConvertFrom-ThornswoodServerContentLines $lines)
}

# The size and sha256 of a plugin on this machine, the same way the box reads it.
function Get-ThornswoodLocalContent([string]$Path) {
    $Path = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    $h = [Security.Cryptography.SHA256]::Create()
    $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try { $sum = -join ($h.ComputeHash($fs) | ForEach-Object { $_.ToString('x2') }); $len = [int64]$fs.Length } finally { $fs.Dispose(); $h.Dispose() }
    return [pscustomobject]@{ Bytes = $len; Sha = $sum }
}

# What the box said about one plugin of ours (RepoPlugins.ps1, #2486), in the
# shape Test-ThornswoodContentSame and Get-ThornswoodContentShipProblem read.
# The content plugin is the box answer itself. Another that the answer does
# not name counts as not on the box, so it is sent, never taken as there.
function Get-ThornswoodServerPlugin($Box, [string]$Name) {
    if ($null -eq $Box) { return $null }
    if (-not $Name -or $Name -ieq $ThornswoodContentPlugin) { return $Box }
    $bytes = [int64]-1; $sha = ''
    $ours = if ($Box.PSObject.Properties['Ours']) { $Box.Ours } else { $null }
    if ($null -ne $ours -and $ours.ContainsKey($Name)) { $bytes = [int64]$ours[$Name].Bytes; $sha = [string]$ours[$Name].Sha }
    return [pscustomobject]@{ Answered = [bool]$Box.Answered; Bytes = $bytes; Sha = $sha; Said = @($Box.Said) }
}

# Whether the box holds exactly these bytes.
function Test-ThornswoodContentSame($Box, [int64]$Bytes, [string]$Sha) {
    if ($null -eq $Box -or -not $Box.Answered) { return $false }
    return ($Box.Bytes -eq $Bytes -and $Box.Sha -eq ([string]$Sha).ToLowerInvariant())
}

# Why a release may not send clients this plugin of ours (-Plugin, the content
# plugin when left out), or '' when it may.
# -Entry is the release's own record of the file, '<bytes>:<sha256>', the
# form published.json keeps (Get-BaselineEntry); -Box what the server said.
function Get-ThornswoodContentShipProblem([string]$Channel, [string]$Entry, $Box, [string]$Plugin = $ThornswoodContentPlugin) {
    $m = [regex]::Match([string]$Entry, '^(\d+):([0-9a-fA-F]{64})$')
    if (-not $m.Success) { return "this release's record of Data\$Plugin ('$Entry') is not a size and a sha256, so it cannot be compared with the server's." }
    $bytes = [int64]$m.Groups[1].Value
    $sha = $m.Groups[2].Value.ToLowerInvariant()
    $what = if ($Channel -eq 'dev') { 'the dev server' } else { 'the live server' }
    $fix = Get-ThornswoodContentCommand $Channel
    if ($null -eq $Box -or -not $Box.Answered) {
        $heard = if ($null -ne $Box -and @($Box.Said).Count) { (@($Box.Said | Where-Object { $_ }) | Select-Object -Last 3) -join ' | ' } else { 'nothing' }
        return ("$what did not say which content plugin it holds (it answered: $heard), so there is no telling whether it has the one this release sends. " +
                "Check the ssh key with .\scripts\vps\Setup-SshKey.ps1 -Test, then Ship again.")
    }
    if ($Box.Bytes -lt 0) {
        return ("this release sends clients $Plugin ({0:N0} bytes, sha256 {1}) and $what has none. " -f $bytes, $sha.Substring(0, 12)) +
               "The server gets the content plugin first, then the Ship: $fix"
    }
    if ($Box.Bytes -ne $bytes -or $Box.Sha -ne $sha) {
        return ("this release sends clients $Plugin ({0:N0} bytes, sha256 {1}) and $what holds another ({2:N0} bytes, sha256 {3}). " -f $bytes, $sha.Substring(0, 12), $Box.Bytes, $Box.Sha.Substring(0, 12)) +
               "The server gets the content plugin first, then the Ship: $fix"
    }
    return ''
}
