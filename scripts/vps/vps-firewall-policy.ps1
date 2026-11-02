<#
.SYNOPSIS
  Runs ON THE VPS, sent there by Set-InboundRules.ps1 -Own: moves every rule the box keeps into its own firewall policy and tells the firewall to ignore local rules, so no installer can open a port on the box (#3896).

.DESCRIPTION
  Do not run this by hand. Set-InboundRules.ps1 -Own sends this file's text
  on ssh's standard input with the list from records\prod-parity.json
  ("inboundRules"), and pwsh runs it from there, so nothing
  of it is ever written on the box (#3035).

  WHY. Issue #3896, measured 26 Oct 2026. Every rule on the box was a local
  rule, and the firewall took every local rule any installer made: Edge's
  setup adds an inbound "Microsoft Edge (mDNS-In)" rule with every version,
  and the WebView2 Runtime's (which the Visual Studio C++ workload requires)
  one per version, never taking the old ones away. No policy stops either.
  Patrick, 27 Oct 2026: the box's own policy holds every rule, and local
  rules are ignored. scripts\vps\BoxFirewall.ps1 is the rule every script
  follows from then on.

  In this order, each step saying what it found:

    the list      every entry a rule's Name or DisplayName, as
                  vps-inbound-rules.ps1 takes it. An empty list stops it.
    profiles      for each firewall profile, whether the firewall still takes
                  local rules and what it does with outbound traffic no rule
                  names. Outbound Block stops it: then the local outbound
                  Allow rules would matter too, and this moves none.
    the move      the rules that go into the policy store: every enabled
                  local inbound Allow rule on the list, and every enabled
                  local Block rule (inbound or outbound: the pull request
                  runners' fences, the Remote Desktop blocks), since a block
                  only ever takes away. Each is MOVE (not in the policy yet)
                  or HELD (already there).
    the required  every entry the list marks required is enabled in the
                  local store or the policy store. One missing stops it
                  before anything is changed.
    the probe     with -Apply, a rule named "Thornswood policy probe 3896",
                  turned off so it lets nothing in, is made in the policy
                  store, read back, taken away and read back gone. Any of
                  that failing stops it before anything else is changed.
    the copies    each MOVE rule copied into the policy store under its own
                  name, then Group Policy refreshed, then each read back from
                  what the firewall takes (the active store) as enabled and
                  from Group Policy. One that is not stops it: local rules
                  are still taken then, so nothing anybody uses changed.
    local off     AllowLocalFirewallRules False in the policy store for every
                  profile, Group Policy refreshed, each profile read back, and
                  every required rule read back as taken from Group Policy.
    ignored       every enabled local inbound Allow rule the policy does not
                  hold, which the firewall now ignores: Edge's and WebView2's
                  among them.

  -Check reads all of it and changes nothing, and exits 2 while a rule to
  move is not in the policy store, a required one is missing, or a profile
  still takes local rules.

  Every line of output starts with one word: LIST, PROFILE, MOVE, HELD,
  REQUIRED, PROBE, COPIED, ACTIVE, CHANGED, IGNORED, WOULD (with -DryRun),
  ALREADY, STOP or DONE. STOP means nothing after it was done, and the exit
  code is 1.

  THE WAY BACK, on the box (Remote.ps1, or the VNC console in the provider's
  panel), puts local rules back in force:
      Set-NetFirewallProfile -PolicyStore localhost -All -AllowLocalFirewallRules NotConfigured; gpupdate /target:computer /force
  ssh is never cut by any of this: the bridge reaches sshd on 127.0.0.1, which
  the firewall does not filter.

.PARAMETER Check
  Read all of it and change nothing.

.PARAMETER Apply
  Move the rules and turn local rules off.

.PARAMETER List
  The list, as base64 of UTF-8 JSON: an array of { "rule": ..., "required":
  true|false }. Set-InboundRules.ps1 makes it from records\prod-parity.json.

.PARAMETER DryRun
  With -Apply: read everything and say WOULD for each change.

.PARAMETER Layer
  A file that replaces the functions below that touch Windows. Only
  tests\test-3896-firewall-policy.ps1 passes it.
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Apply,
    [string]$List = '',
    [switch]$DryRun,
    [string]$Layer = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Probe = 'Thornswood policy probe 3896'
$script:changes = 0
$script:open = 0
$script:stopped = $false

function Say([string]$word, [string]$what) { Write-Output ($word + ' ' + $what) }

# ---------------------------------------------------------------- the layer ---
# Everything that touches Windows goes through these, so the harness can put
# stand-ins in their place with -Layer and run the rest of this for real.

# ---- BoxGuard.ps1 (copy) ----
function Get-ThornswoodBoxRefusal {
    # scripts\vps\BoxGuard.ps1 says why this asks Windows rather than looking
    # for the game, and why it refuses when it cannot tell (#3041).
    try { $type = [int](Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop).ProductType }
    catch { return ('Windows did not say whether this is a server (' + $_.Exception.Message + '), so it is not taken for the box') }
    if ($type -eq 2 -or $type -eq 3) { return '' }
    if ($type -eq 1) { return 'this is a Windows workstation, a gaming PC or a developer''s machine, not the box' }
    return ('Windows gives this machine product type ' + $type + ', which is not a server, so it is not taken for the box')
}
# ---- end BoxGuard.ps1 ----

# ---- BoxFirewall.ps1 (copy) ----
function Sync-ThornswoodFirewall {
    # scripts\vps\BoxFirewall.ps1 (#3896): the firewall takes the box's policy
    # store when Group Policy is refreshed, so every change to the store ends here.
    $was = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $said = @(& gpupdate.exe /target:computer /force 2>&1 | ForEach-Object { [string]$_ } | Where-Object { $_.Trim() })
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $was
    if ($rc -ne 0) { throw ('gpupdate did not refresh the box''s policy, so the firewall has not taken the change (exit ' + $rc + '): ' + ($said -join ' ')) }
}
# ---- end BoxFirewall.ps1 ----

function Get-RuleRows([string]$Store) {
    foreach ($r in @(Get-NetFirewallRule -PolicyStore $Store -ErrorAction SilentlyContinue)) {
        [pscustomobject]@{
            Name = [string]$r.Name; DisplayName = [string]$r.DisplayName
            Direction = [string]$r.Direction; Action = [string]$r.Action
            Enabled = ([string]$r.Enabled -eq 'True'); Source = [string]$r.PolicyStoreSourceType
        }
    }
}
# Every rule in the box's local store, which the firewall takes only while
# local rules are allowed.
function Get-LocalRules { return @(Get-RuleRows 'PersistentStore') }
# Every rule in the box's own policy store.
function Get-PolicyRules { return @(Get-RuleRows 'localhost') }
# Every rule the firewall takes now, with where it took it from (Source:
# Local or GroupPolicy).
function Get-ActiveRules { return @(Get-RuleRows 'ActiveStore') }
# Each profile as the firewall runs it: Name, AllowLocal (True, False or
# NotConfigured as the active store says it) and Outbound (the default for
# outbound traffic no rule names).
function Get-Profiles {
    foreach ($p in @(Get-NetFirewallProfile -PolicyStore ActiveStore)) {
        [pscustomobject]@{ Name = [string]$p.Name; AllowLocal = [string]$p.AllowLocalFirewallRules; Outbound = [string]$p.DefaultOutboundAction }
    }
}
function New-ProbeRule {
    New-NetFirewallRule -PolicyStore localhost -Name $Probe -DisplayName $Probe -Direction Inbound -Action Allow -Protocol UDP -LocalPort 59999 -Enabled False -ErrorAction Stop | Out-Null
}
function Remove-ProbeRule { Remove-NetFirewallRule -PolicyStore localhost -Name $Probe -ErrorAction Stop }
function Copy-ToPolicy([string]$Name) { Copy-NetFirewallRule -PolicyStore PersistentStore -Name $Name -NewPolicyStore localhost -ErrorAction Stop }
function Set-LocalRulesOff { Set-NetFirewallProfile -PolicyStore localhost -Profile Domain, Private, Public -AllowLocalFirewallRules False -ErrorAction Stop }

if ($Layer) { . $Layer }

# ------------------------------------------------------------------ helpers ---
function Read-List([string]$Text) {
    if (-not $Text) { return @() }
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Text))
    return @(ConvertFrom-Json $json | ForEach-Object { $_ })
}
function Test-Named($Rule, [string]$Name) { return ($Rule.Name -eq $Name -or $Rule.DisplayName -eq $Name) }
function Test-Listed($Entries, $Rule) {
    foreach ($e in $Entries) { if (Test-Named $Rule ([string]$e.rule)) { return $true } }
    return $false
}
function Show-Rule($Rule) { return ("'" + $Rule.DisplayName + "' (" + $Rule.Name + '), ' + $Rule.Direction + ' ' + $Rule.Action) }
function Test-AllOff($Profiles) { return (@($Profiles | Where-Object { $_.AllowLocal -ne 'False' }).Count -eq 0) }

function Invoke-FirewallPolicy {
    if (-not $Layer) {
        $notBox = Get-ThornswoodBoxRefusal
        if ($notBox) { $script:stopped = $true; Say 'STOP' ($notBox + '. Run Set-InboundRules.ps1 -Own on your machine; it sends this to the box.'); return }
    }
    if ((@($Check, $Apply) | Where-Object { $_ }).Count -ne 1) { $script:stopped = $true; Say 'STOP' 'say one of -Check or -Apply. Nothing was changed.'; return }

    # ---------------------------------------------------------- the list ---
    $entries = @()
    try { $entries = @(Read-List $List) } catch { $script:stopped = $true; Say 'STOP' ('the list does not read (' + $_.Exception.Message + '). Nothing was changed.'); return }
    if (-not $entries.Count) { $script:stopped = $true; Say 'STOP' 'the list is empty, so the policy would hold no rule the box keeps. Nothing was changed.'; return }
    Say 'LIST' ([string]$entries.Count + ' rules the box keeps, ' + @($entries | Where-Object { $_.required }).Count + ' of them required')

    # ---------------------------------------------------------- profiles ---
    $profiles = @(Get-Profiles)
    foreach ($p in $profiles) { Say 'PROFILE' ($p.Name + ': local rules ' + $(if ($p.AllowLocal -eq 'False') { 'ignored' } else { 'taken (' + $p.AllowLocal + ')' }) + ', outbound ' + $p.Outbound + ' unless a rule says otherwise') }
    $blockOut = @($profiles | Where-Object { $_.Outbound -eq 'Block' })
    if ($blockOut.Count) { $script:stopped = $true; Say 'STOP' ('the ' + (($blockOut | ForEach-Object { $_.Name }) -join ', ') + ' profile blocks outbound traffic no rule names, so the local outbound Allow rules matter too, and this moves none. Nothing was changed.'); return }

    # ---------------------------------------------------------- the move ---
    $local = @(Get-LocalRules)
    $policy = @(Get-PolicyRules)
    $move = @($local | Where-Object { $_.Enabled -and (($_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and (Test-Listed $entries $_)) -or $_.Action -eq 'Block') } | Sort-Object Direction, DisplayName)
    $toCopy = @()
    foreach ($r in $move) {
        if (@($policy | Where-Object { $_.Name -eq $r.Name }).Count) { Say 'HELD' (Show-Rule $r) }
        else { $toCopy += $r; Say 'MOVE' (Show-Rule $r) }
    }
    $script:open = $toCopy.Count

    # ------------------------------------------------------ the required ---
    $missing = 0
    foreach ($e in @($entries | Where-Object { $_.required })) {
        $n = [string]$e.rule
        if (-not @(@($local) + @($policy) | Where-Object { $_.Enabled -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and (Test-Named $_ $n) }).Count) { $missing++; Say 'REQUIRED' ("'" + $n + "' is not on the box, or is off") }
    }
    $script:open += $missing
    if (-not (Test-AllOff $profiles)) { $script:open++ }

    if ($Check) { return }

    if ($missing) { $script:stopped = $true; Say 'STOP' 'a required rule is missing or off (the REQUIRED lines above), so the policy would not hold it and the game or the site would shut once local rules are ignored. Run the script that owns it first. Nothing was changed.'; return }

    # --------------------------------------------------------- the probe ---
    if ($DryRun) { Say 'WOULD' ("make '" + $Probe + "' (off) in the policy store, read it back and take it away, before anything else") }
    else {
        try { New-ProbeRule } catch { $script:stopped = $true; Say 'STOP' ('the policy store refused a rule: ' + $_.Exception.Message + '. Nothing else was changed.'); return }
        if (-not @(Get-PolicyRules | Where-Object { $_.Name -eq $Probe }).Count) { $script:stopped = $true; Say 'STOP' ("'" + $Probe + "' was made without an error but does not read back from the policy store. Nothing else was changed; it may still be there, off."); return }
        Say 'PROBE' ("'" + $Probe + "' made in the policy store and read back")
        try { Remove-ProbeRule } catch { $script:stopped = $true; Say 'STOP' ("'" + $Probe + "' could not be taken away: " + $_.Exception.Message + '. It is off, so it lets nothing in. Nothing else was changed.'); return }
        if (@(Get-PolicyRules | Where-Object { $_.Name -eq $Probe }).Count) { $script:stopped = $true; Say 'STOP' ("'" + $Probe + "' still reads back after it was taken away. It is off. Nothing else was changed."); return }
        Say 'PROBE' ("'" + $Probe + "' taken away and read back gone: the policy store takes rules")
    }

    # -------------------------------------------------------- the copies ---
    foreach ($r in $toCopy) {
        $script:changes++
        if ($DryRun) { Say 'WOULD' ('copy ' + (Show-Rule $r) + ' into the policy store'); continue }
        Copy-ToPolicy $r.Name
        Say 'COPIED' (Show-Rule $r)
    }
    if (-not $DryRun -and $toCopy.Count) { Sync-ThornswoodFirewall }
    if (-not $DryRun) {
        $active = @(Get-ActiveRules)
        foreach ($r in $move) {
            if (-not @($active | Where-Object { $_.Name -eq $r.Name -and $_.Source -eq 'GroupPolicy' -and $_.Enabled }).Count) {
                $script:stopped = $true
                Say 'STOP' ((Show-Rule $r) + ' is in the policy store, but the firewall does not take it from there after a refresh. Local rules are still taken, so nothing anybody uses changed.')
                return
            }
            Say 'ACTIVE' ((Show-Rule $r) + ', from Group Policy')
        }
    }

    # --------------------------------------------------------- local off ---
    if (Test-AllOff $profiles) { Say 'ALREADY' 'every profile ignores local rules' }
    else {
        $script:changes++
        if ($DryRun) { Say 'WOULD' 'set AllowLocalFirewallRules False in the policy store for every profile, so the firewall ignores local rules' }
        else {
            Set-LocalRulesOff
            Sync-ThornswoodFirewall
            $now = @(Get-Profiles)
            if (-not (Test-AllOff $now)) {
                $script:stopped = $true
                Say 'STOP' ('AllowLocalFirewallRules False is in the policy store, but the firewall still says ' + (($now | ForEach-Object { $_.Name + ' ' + $_.AllowLocal }) -join ', ') + ' after a refresh.')
                return
            }
            Say 'CHANGED' 'the firewall ignores local rules: every profile has AllowLocalFirewallRules False from the policy store'
            $active = @(Get-ActiveRules)
            foreach ($e in @($entries | Where-Object { $_.required })) {
                $n = [string]$e.rule
                if (-not @($active | Where-Object { (Test-Named $_ $n) -and $_.Source -eq 'GroupPolicy' -and $_.Enabled -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }).Count) {
                    $script:stopped = $true
                    Say 'STOP' ("'" + $n + "' is not taken from the policy store now that local rules are ignored. Put local rules back with the way back in this script's header, then find why.")
                    return
                }
            }
            Say 'ACTIVE' 'every required rule is taken from the policy store'
        }
    }

    # ----------------------------------------------------------- ignored ---
    $held = @{}
    foreach ($r in @(@($policy) + @($toCopy))) { $held[$r.Name] = $true }
    $ignored = @($local | Where-Object { $_.Enabled -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and -not $held.ContainsKey($_.Name) } | Sort-Object DisplayName)
    foreach ($r in $ignored) { Say 'IGNORED' (Show-Rule $r) }
    $script:open = 0
}

try { Invoke-FirewallPolicy }
catch {
    $script:stopped = $true
    Say 'STOP' ('it failed partway, at: ' + $_.Exception.Message)
}
finally {
    if ($Check -and -not $script:stopped) { Say 'DONE' ('read only, ' + $script:open + ' thing(s) left before the box''s policy holds every rule. Nothing was changed.') }
    elseif ($DryRun) { Say 'DONE' ([string]$script:changes + ' change(s) would be made. Nothing was changed.') }
    elseif ($script:stopped) { Say 'DONE' ([string]$script:changes + ' change(s) made before it stopped.') }
    else { Say 'DONE' ([string]$script:changes + ' change(s) made.') }
}
if ($script:stopped) { exit 1 }
if ($Check -and $script:open) { exit 2 }
exit 0
