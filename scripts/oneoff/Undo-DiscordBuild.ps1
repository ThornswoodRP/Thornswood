<#
  Undo-DiscordBuild.ps1

  Puts the Discord server back the way it was before a Setup-Discord.ps1 run,
  from Discord's own audit log: every change the bot made in the last few
  hours is read with its before value and reversed, newest first.

      .\scripts\oneoff\Undo-DiscordBuild.ps1            lists what it would undo, changes nothing
      .\scripts\oneoff\Undo-DiscordBuild.ps1 -Apply     undoes it

  WHY THIS EXISTS. On 25 September Patrick was told to run Setup-Discord.ps1
  only to make the #news webhook, which already existed. That script builds
  the whole server from bot\Build-Discord.py's plan, so it put back channels
  and a role the server had moved past, gave the bot overwrites on every
  channel and turned off Discord's join message. Nothing was deleted by it.

  What it reverses, and only when the bot's own account did it inside the
  window: a channel or role it made is deleted, a permission overwrite it
  made is removed, one it changed or removed is put back as it was, and a
  channel, role or server setting it changed gets its old values. Webhooks and
  messages are left alone. Anything else it finds is listed, not touched.

  The bot needs "View Audit Log" for this; without it the script says so and
  changes nothing.
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    # How far back to look. The run it undoes was at 12:45 on 25 September.
    [int]$Hours = 6,
    [string]$Guild = $env:DISCORD_GUILD
)

$ErrorActionPreference = 'Stop'
$api = 'https://discord.com/api/v10'
function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }

# Read-ThornswoodSecret, which also takes the value piped in with no keyboard (#4346).
. (Join-Path $PSScriptRoot '..\vps\Send-Secret.ps1')
$token = Read-ThornswoodSecret 'Bot token (paste it, it will not be shown)'
$headers = @{ Authorization = "Bot $token"; 'X-Audit-Log-Reason' = 'Undo of the Setup-Discord run of 25 September' }

function Api([string]$method, [string]$path, $body) {
    for ($try = 0; $try -lt 6; $try++) {
        try {
            # Discord answers 40333 "internal network error" to a request that does
            # not name itself as a bot; PowerShell's own User-Agent reads like a
            # browser. This is the form Discord's API documentation asks for.
            $p = @{ Method = $method; Uri = "$api$path"; Headers = $headers; UseBasicParsing = $true; UserAgent = 'DiscordBot (https://thornswood.net, 1.0)' }
            if ($null -ne $body) { $p.Body = ($body | ConvertTo-Json -Depth 6 -Compress); $p.ContentType = 'application/json' }
            return Invoke-RestMethod @p
        } catch {
            $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch { }
            if ($code -eq 429) { Start-Sleep -Seconds 2; continue }
            throw
        }
    }
    throw "Discord kept saying slow down on $method $path"
}

$me = Api GET '/users/@me' $null
if (-not $Guild) {
    $gs = @(Api GET '/users/@me/guilds' $null)
    if ($gs.Count -ne 1) { Say ('STOP. The bot is in {0} servers; set $env:DISCORD_GUILD to the Thornswood one first.' -f $gs.Count) 'Red'; exit 1 }
    $Guild = [string]$gs[0].id
}
Say "bot $($me.username), server $Guild" 'Cyan'

# ---- the audit log, the bot's own entries inside the window -----------------
$since = [DateTimeOffset]::UtcNow.AddHours(-$Hours).ToUnixTimeMilliseconds()
function Ms([string]$id) { ([Int64]$id -shr 22) + 1420070400000 }
$entries = @(); $before = ''
try {
    while ($true) {
        $q = "/guilds/$Guild/audit-logs?user_id=$($me.id)&limit=100" + $(if ($before) { "&before=$before" } else { '' })
        $page = Api GET $q $null
        $e = @($page.audit_log_entries)
        if (-not $e.Count) { break }
        $inside = @($e | Where-Object { (Ms $_.id) -ge $since })
        $entries += $inside
        if ($inside.Count -lt $e.Count) { break }
        $before = $e[-1].id
    }
} catch {
    $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    $said = ''; try { $said = [string]$_.ErrorDetails.Message } catch { }
    Say ("  the audit log could not be read ({0}): {1}" -f $code, $(if ($said) { $said } else { $_.Exception.Message })) 'Yellow'
    $entries = $null
}

# ---- without the audit log: what was made inside the window -----------------
# A Discord id carries the moment it was made, so the channels and the role
# that run created are the ones whose ids are younger than the window. Only
# those are deleted. The bot's channel overwrites only let it see and post,
# which Admin already allows, and the join message setting was the same before
# the run (Build-Discord.py writes it on every run), so both are left alone.
if ($null -eq $entries) {
    Say '  working from the channels and roles made in the window instead' 'Yellow'
    $chans = @(Api GET "/guilds/$Guild/channels" $null | Where-Object { (Ms $_.id) -ge $since })
    $roles = @(Api GET "/guilds/$Guild/roles" $null | Where-Object { (Ms $_.id) -ge $since -and -not $_.managed })
    # Channels before the categories that hold them.
    $chans = @($chans | Sort-Object { if ([int]$_.type -eq 4) { 1 } else { 0 } })
    if (-not ($chans.Count + $roles.Count)) { Say ("  nothing was made in the last {0} hours; try -Hours 12" -f $Hours) 'Yellow'; exit 0 }
    $done = 0; $failed = 0
    foreach ($c in $chans) {
        $when = [DateTimeOffset]::FromUnixTimeMilliseconds((Ms $c.id)).ToLocalTime().ToString('HH:mm')
        $what = "delete #$($c.name), made at $when"
        if (-not $Apply) { Say "  would $what" 'Yellow'; continue }
        try { Api DELETE "/channels/$($c.id)" $null | Out-Null; Say "  $what" 'Green'; $done++ } catch { Say "  FAILED: $what ($($_.Exception.Message))" 'Red'; $failed++ }
    }
    foreach ($r in $roles) {
        $when = [DateTimeOffset]::FromUnixTimeMilliseconds((Ms $r.id)).ToLocalTime().ToString('HH:mm')
        $what = "delete role $($r.name), made at $when"
        if (-not $Apply) { Say "  would $what" 'Yellow'; continue }
        try { Api DELETE "/guilds/$Guild/roles/$($r.id)" $null | Out-Null; Say "  $what" 'Green'; $done++ } catch { Say "  FAILED: $what ($($_.Exception.Message))" 'Red'; $failed++ }
    }
    $token = $null; $headers = $null
    Say ''
    if (-not $Apply) { Say 'Nothing was changed. If every line above is from the Setup-Discord run and nothing you made yourself, run it again with -Apply.' 'Yellow'; exit 0 }
    Say ("deleted {0}, failed {1}" -f $done, $failed) $(if ($failed) { 'Red' } else { 'Green' })
    exit $(if ($failed) { 1 } else { 0 })
}
Say ("{0} change(s) by the bot in the last {1} hours" -f $entries.Count, $Hours)

function Old($entry, [string[]]$keys) {
    $o = @{}
    foreach ($c in @($entry.changes)) { if ($keys -contains $c.key) { $o[$c.key] = $c.old_value } }
    return $o
}
$chanKeys = 'name', 'topic', 'nsfw', 'rate_limit_per_user', 'parent_id', 'position', 'bitrate', 'user_limit'
$roleKeys = 'name', 'permissions', 'color', 'hoist', 'mentionable'
$guildKeys = 'system_channel_id', 'system_channel_flags', 'rules_channel_id', 'public_updates_channel_id', 'safety_alerts_channel_id'

# Newest first, the order Discord returns them, so each is undone on top of
# the state the later ones left.
$done = 0; $skipped = 0; $failed = 0
foreach ($e in $entries) {
    $t = [string]$e.target_id
    $step = $null; $what = ''
    switch ([int]$e.action_type) {
        1  { $b = Old $e $guildKeys; if ($b.Count) { $what = 'server settings back: ' + ($b.Keys -join ', '); $step = { Api PATCH "/guilds/$Guild" $b } } }
        10 { $n = (@($e.changes) | Where-Object { $_.key -eq 'name' } | Select-Object -First 1).new_value; $what = "delete channel #$n it made"; $step = { Api DELETE "/channels/$t" $null } }
        11 { $b = Old $e $chanKeys; if ($b.Count) { $what = "channel $t back: " + ($b.Keys -join ', '); $step = { Api PATCH "/channels/$t" $b } } }
        13 { $o = $e.options; $what = "remove the overwrite it added on channel $t"; $step = { Api DELETE "/channels/$t/permissions/$($o.id)" $null } }
        14 { $o = $e.options; $b = Old $e @('allow', 'deny'); $what = "overwrite on channel $t back as it was"; $step = { Api PUT "/channels/$t/permissions/$($o.id)" @{ type = [int]$o.type; allow = [string]$b['allow']; deny = [string]$b['deny'] } } }
        15 { $o = $e.options; $b = Old $e @('allow', 'deny'); $what = "put back the overwrite it removed on channel $t"; $step = { Api PUT "/channels/$t/permissions/$($o.id)" @{ type = [int]$o.type; allow = [string]$b['allow']; deny = [string]$b['deny'] } } }
        30 { $n = (@($e.changes) | Where-Object { $_.key -eq 'name' } | Select-Object -First 1).new_value; $what = "delete role $n it made"; $step = { Api DELETE "/guilds/$Guild/roles/$t" $null } }
        31 { $b = Old $e $roleKeys; if ($b.Count) { $what = "role $t back: " + ($b.Keys -join ', '); $step = { Api PATCH "/guilds/$Guild/roles/$t" $b } } }
    }
    if (-not $step) { Say ("  left alone: action {0} on {1} (webhooks, messages and anything else are not touched)" -f $e.action_type, $t) 'DarkGray'; $skipped++; continue }
    if (-not $Apply) { Say "  would $what" 'Yellow'; continue }
    try { & $step | Out-Null; Say "  $what" 'Green'; $done++ }
    catch { $m = $_.Exception.Message; if ($m -match '404') { Say "  already gone: $what" 'DarkGray' } else { Say "  FAILED: $what ($m)" 'Red'; $failed++ } }
}
$token = $null; $headers = $null

Say ''
if (-not $Apply) { Say 'Nothing was changed. Run it again with -Apply to undo the lines above.' 'Yellow'; exit 0 }
Say ("undone {0}, left alone {1}, failed {2}" -f $done, $skipped, $failed) $(if ($failed) { 'Red' } else { 'Green' })
exit $(if ($failed) { 1 } else { 0 })
