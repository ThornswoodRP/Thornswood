<#
  test-setup-domain-taskonly.ps1

      pwsh -NoProfile -File .\scripts\tests\test-setup-domain-taskonly.ps1

  Setup-Domain.ps1 -TaskOnly reaches the box and sends only the Caddy task.

  WHY. -TaskOnly (#1968) skips the one time setup, and the shared Remote and
  the box's address and account were loaded inside that setup, so on 5 Oct
  the first run of it stopped at "Invoke-ThornswoodRemote is not recognized"
  with nothing sent, and the site's server kept its old priority.

  HOW. Runs the script with -TaskOnly against a made-up box (-Vps 192.0.2.1,
  a documentation address, and -User tester), with ssh and scp replaced by
  functions that record what they are asked and answer as the box would.
  Nothing leaves this machine. -SetupDomain runs another copy, so the same
  test runs on the one from before this change:

      git show a4cc1fd3:scripts/deploy/Setup-Domain.ps1 > .\temp\domain-before.ps1
      pwsh -NoProfile -File .\scripts\tests\test-setup-domain-taskonly.ps1 -SetupDomain .\temp\domain-before.ps1

  A copy outside scripts\deploy needs its neighbours, so the copy is put in a
  scratch scripts\deploy beside a copy of scripts\vps.
#>
[CmdletBinding()]
param([string]$SetupDomain)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in scripts\tests\, the repository is two folders up.
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $SetupDomain) { $SetupDomain = [IO.Path]::Combine($Repo, 'scripts', 'deploy', 'Setup-Domain.ps1') }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-domain-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$global:TsDomainCalls = New-Object System.Collections.ArrayList
try {
    $deploy = Join-Path $scratch 'scripts\deploy'
    New-Item -ItemType Directory -Force -Path $deploy | Out-Null
    Copy-Item -LiteralPath ([IO.Path]::Combine($Repo, 'scripts', 'vps')) -Destination (Join-Path $scratch 'scripts\vps') -Recurse
    Copy-Item -LiteralPath $SetupDomain -Destination (Join-Path $deploy 'Setup-Domain.ps1')
    Copy-Item -LiteralPath ([IO.Path]::Combine($Repo, 'scripts', 'deploy', 'Caddyfile')) -Destination (Join-Path $deploy 'Caddyfile')
    # Setup-Domain.ps1 dot-sources the service account functions (#2578).
    Copy-Item -LiteralPath ([IO.Path]::Combine($Repo, 'scripts', 'deploy', 'ServiceAccount.ps1')) -Destination (Join-Path $deploy 'ServiceAccount.ps1')
    Copy-Item -LiteralPath ([IO.Path]::Combine($Repo, 'scripts', 'deploy', 'CloudflareRanges.ps1')) -Destination (Join-Path $deploy 'CloudflareRanges.ps1')
    Copy-Item -LiteralPath ([IO.Path]::Combine($Repo, 'scripts', 'deploy', 'cloudflare-ranges.txt')) -Destination (Join-Path $deploy 'cloudflare-ranges.txt')

    # The box, as far as the script can tell: ssh runs what it is given, scp
    # takes the file. A long script goes by scp (Send-Script.ps1, #3059), so
    # what scp copies is read here, and what ssh runs is decoded. Caddy's run
    # goes on the box on its own and reports to a file (#3193): the start
    # says STARTED, and each read of the report answers with what
    # $global:TsDomainReads holds next (the last one again once they run
    # out), a line '255' standing for a box that cannot be reached.
    function global:TsDomainPlain([string]$t) {
        # The script itself and every base64 payload in it, decoded, so the
        # checks below read what the box would run.
        $all = @($t)
        foreach ($m in [regex]::Matches($t, "FromBase64String\('([A-Za-z0-9+/=]+)'\)")) {
            try { $all += [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($m.Groups[1].Value)) } catch { $all += '' }
        }
        return ($all -join "`n")
    }
    function global:ssh {
        $text = ($args | ForEach-Object { "$_" }) -join ' '
        $ran = ''
        $m = [regex]::Match($text, '-EncodedCommand ([A-Za-z0-9+/=]+)')
        if ($m.Success) { $ran = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value)) }
        if ($ran -and (Get-ThornswoodRemoteRunnerPath $ran)) { $ran = $global:TsDomainLastScp }
        [void]$global:TsDomainCalls.Add([pscustomobject]@{ Tool = 'ssh'; Text = $text; Sent = (TsDomainPlain $ran) })
        $global:LASTEXITCODE = 0
        if ($ran -match 'Win32_Process') { return 'STARTED 4242' }
        if ($ran -match 'REPORT NONE') {
            $next = $global:TsDomainReads[0]
            if ($global:TsDomainReads.Count -gt 1) { $global:TsDomainReads = @($global:TsDomainReads | Select-Object -Skip 1) }
            if ($next -eq '255') { $global:LASTEXITCODE = 255; return }
            return @($next -split "`n")
        }
        return 'done'
    }
    function global:scp {
        $sent = ''
        foreach ($a in $args) { if (Test-Path -LiteralPath "$a" -PathType Leaf -ErrorAction SilentlyContinue) { $sent = [IO.File]::ReadAllText("$a") } }
        $global:TsDomainLastScp = $sent
        [void]$global:TsDomainCalls.Add([pscustomobject]@{ Tool = 'scp'; Text = (($args | ForEach-Object { "$_" }) -join ' '); Sent = (TsDomainPlain $sent) })
        $global:LASTEXITCODE = 0
    }
    . ([IO.Path]::Combine($Repo, 'scripts', 'vps', 'Send-Script.ps1'))

    function Invoke-TaskOnly([string[]]$reads) {
        $global:TsDomainCalls.Clear()
        $global:TsDomainReads = $reads
        # Into a list as it comes, so what was said before a stop is kept.
        $o = New-Object System.Collections.Generic.List[string]
        $e = $null
        try {
            & (Join-Path $deploy 'Setup-Domain.ps1') -TaskOnly -Vps '192.0.2.1' -User 'tester' 6>&1 2>&1 | ForEach-Object { $o.Add("$_") }
        } catch { $e = $_.Exception.Message }
        $o | ForEach-Object { Write-Host ('      ' + $_) }
        if ($e) { Write-Host ('      threw: ' + $e) }
        return [pscustomobject]@{ Out = @($o); Err = $e; Calls = @($global:TsDomainCalls) }
    }

    Write-Host 'A run that ends well, read once Caddy is back:'
    $r = Invoke-TaskOnly @("REPORT 3`nscheduled task updated`ncaddy up, pid 1`nEND 0")
    Yes '-TaskOnly runs to the end' (-not $r.Err)
    $calls = $r.Calls
    Yes ('  it talks to the box it was given, tester@192.0.2.1 (' + $calls.Count + ' call(s))') (
        $calls.Count -gt 0 -and @($calls | Where-Object { $_.Text -match 'tester@192\.0\.2\.1' }).Count -eq $calls.Count)
    $all = (@($calls | ForEach-Object { $_.Text; $_.Sent }) -join "`n")
    Yes '  what it sends registers the Caddy task' ($all -match "Thornswood Web" -and $all -match 'New-ScheduledTaskSettingsSet')
    Yes '  and sends no Caddyfile and opens no port, the one time setup it skips' ($all -notmatch 'New-NetFirewallRule' -and $all -notmatch 'caddy_[0-9.]+_windows')
    # #3193: what stops Caddy is not run inside the ssh session that sends it.
    $starts = @($calls | Where-Object { $_.Tool -eq 'ssh' -and $_.Sent -match 'Win32_Process' })
    Yes '  the Caddy run is started on the box on its own, through WMI, in one call' ($starts.Count -eq 1)
    Yes '  and that call stops nothing itself: Stop-ScheduledTask is only in the run it starts' (
        $starts.Count -eq 1 -and ($starts[0].Sent -split "`n" | Where-Object { $_ -match "^Stop-ScheduledTask -TaskName 'Thornswood Web'" }).Count -eq 1 -and
        $starts[0].Sent.Substring(0, $starts[0].Sent.IndexOf('Win32_Process')) -notmatch "(?m)^Stop-ScheduledTask")
    Yes '  what the run said is shown' ($r.Out -contains '  caddy up, pid 1' -and $r.Out -contains '  scheduled task updated')
    Yes '  and its END line is not' (-not @($r.Out | Where-Object { $_ -match 'END 0' }).Count)

    Write-Host ''
    Write-Host 'The box cannot be reached at first, the way One cannot while Caddy is down:'
    $r = Invoke-TaskOnly @('255', "REPORT 0", "REPORT 2`ncaddy up, pid 1`nEND 0")
    Yes '  it waits that out and runs to the end' (-not $r.Err -and $r.Out -contains '  caddy up, pid 1')

    Write-Host ''
    Write-Host 'A run that ends badly:'
    $r = Invoke-TaskOnly @("REPORT 2`nCADDY DID NOT START`nEND 1")
    Yes '  it says what the box said and stops on the run''s exit code' ($r.Out -contains '  CADDY DID NOT START' -and $r.Err -match 'ended with exit 1')
}
finally {
    Remove-Item function:\global:ssh -ErrorAction SilentlyContinue
    Remove-Item function:\global:scp -ErrorAction SilentlyContinue
    Remove-Item function:\global:TsDomainPlain -ErrorAction SilentlyContinue
    Remove-Variable -Name TsDomainReads, TsDomainLastScp -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable -Name TsDomainCalls -Scope Global -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

# A full run compares where the name points with the box's address, so the
# address is read from vps.json before that check. On 19 Oct it was read after,
# and a full run without -Vps stopped on "resolves to <the box> and not .".
$text = [IO.File]::ReadAllText($SetupDomain)
$loads = $text.IndexOf('if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }')
$dns = $text.IndexOf('Write-Host "Checking where $Domain points..."')
Yes 'the box''s address is read from vps.json before the DNS check that compares with it' ($loads -ge 0 -and $dns -ge 0 -and $loads -lt $dns)
Done
