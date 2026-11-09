<#
  test-2841-deploy-gate.ps1

      pwsh -NoProfile -File .\tests\test-2841-deploy-gate.ps1

  The deploy gate (#2841): the restricted, non-admin account whose key runs
  one dispatcher with only the named Deploy, Install and Get-Logs verbs, held
  only in the "desk" GitHub environment. This holds:
    1. Every file of it parses, and the files the box runs under Windows
       PowerShell 5.1 are plain ASCII (5.1 reads a file with no byte order
       mark as the system code page).
    2. The rules (scripts\vps\gate\GateRules.ps1): lines the gate takes give
       exactly the words the broker starts the script with, and every line
       that names another verb, a parameter outside the verb's list, a value
       outside its rule or a character a shell or PowerShell would read is
       refused whole. Under Windows PowerShell 5.1 too, when there is one.
    3. verbs.json against the scripts: each verb's script is there, takes
       every parameter the gate lets through and every fixed word, and no
       verb lets a caller name a host, a user, a folder, a file or a task.
    4. Gate.ps1 holds no rule and runs nothing: it reads
       SSH_ORIGINAL_COMMAND, hands it over the pipe and prints the answer.
    5. GateBroker.ps1: the pipe takes only SYSTEM and the deploy account, and
       no other machine; every line goes through Test-ThornswoodGateRequest
       before anything runs; what runs is main's tip and nothing a caller
       names; the program is started with no shell.
    6. Install-Gate.ps1: the account goes in no group, its .ssh only SYSTEM
       and Administrators may change, it may read Gate.ps1 alone, and the
       files go up from HEAD.
    7. Grant-BoxAccess.ps1 -Deploy: the line it writes, and its reader.
    8. box-run.yml is not in this repository but in the private ops
       repository, with the VPS runners (#4013), and Box-Run.ps1 starts it
       there; the ops repository's tests\test-box-workflows.ps1 holds its
       shape.
    9. The seal (scripts\ops\Sealed.ps1) opens with its own key only, and a changed byte
       is refused; it comes back through the run's log as TWSEAL-LOG lines,
       held to their count and sha256 (a stand-in gh serves the log); the
       box half uses the signed ssh.exe by full path.
  Nothing connects anywhere and nothing outside the temp folder is touched.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Text([string]$rel) { return [IO.File]::ReadAllText((Join-Path $Repo $rel)) }
# The named functions of a script, defined here without running the script.
function Import-Functions([string]$rel, [string[]]$names) {
    $err = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo $rel), [ref]$null, [ref]$err)
    $out = @()
    foreach ($n in $names) {
        $f = $ast.Find({ param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $n }, $true)
        if ($f) { $out += $f.Extent.Text }
    }
    return ($out -join "`n")
}

$gateFiles = @('scripts/vps/gate/Gate.ps1', 'scripts/vps/gate/GateBroker.ps1', 'scripts/vps/gate/GateRules.ps1')
$all = $gateFiles + @('scripts/vps/gate/Update-Gate.ps1', 'scripts/deploy/Install-Gate.ps1', 'scripts/vps/Box-Run.ps1', 'scripts/vps/Grant-BoxAccess.ps1')

# ---- 1. parses, and plain ASCII where 5.1 reads it ---------------------------
foreach ($f in $all) {
    $err = $null
    [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo $f), [ref]$null, [ref]$err)
    Yes "$f parses" (-not $err -or $err.Count -eq 0)
}
foreach ($f in $gateFiles + @('scripts/vps/gate/verbs.json', 'scripts/deploy/Install-Gate.ps1')) {
    $bytes = [IO.File]::ReadAllBytes((Join-Path $Repo $f))
    Yes "$f is plain ASCII" (-not @($bytes | Where-Object { $_ -gt 126 -or ($_ -lt 32 -and $_ -ne 9 -and $_ -ne 10 -and $_ -ne 13) }).Count)
}
$verbsRaw = Text 'scripts/vps/gate/verbs.json'
$verbs = $verbsRaw | ConvertFrom-Json
Yes 'verbs.json is JSON with verbs' ($null -ne $verbs.verbs)

# ---- 2. the rules ------------------------------------------------------------
. (Join-Path $Repo 'scripts/vps/gate/GateRules.ps1')
function Words([string]$line) { $r = Test-ThornswoodGateRequest -Line $line -Verbs $verbs; if ($r.Ok) { return ($r.Args -join '|') } else { return 'REFUSED' } }
Yes 'ping is taken, with nothing after it' ((Test-ThornswoodGateRequest -Line 'ping' -Verbs $verbs).Verb -eq 'ping' -and (Words 'ping now') -eq 'REFUSED')
Yes 'a switch and a quoted text value become their words, in order' ((Words 'Deploy-DevGamemode -Restart -Why "a gamemode update"') -eq '-Restart|-Why|a gamemode update')
Yes 'a verb''s fixed words come first' ((Words 'Install-Bot -PutBack') -eq '-CodeOnly|-NoPause|-PutBack')
Yes 'Get-Logs takes -Dev and -Lines, and names its out parameter' ((Words 'Get-Logs -Dev -Lines 2000') -eq '-NoPause|-Dev|-Lines|2000' -and (Test-ThornswoodGateRequest -Line 'Get-Logs' -Verbs $verbs).Out -eq '-Out')
Yes 'an enum value outside its list is refused' ((Words 'Deploy-DevGamemode -Npcs maybe') -eq 'REFUSED')
# The weekly review's launcher start read (#3534): a number of days and
# nothing else, never the folder it reads.
Yes 'Read-LauncherStarts takes -Days, a number, and nothing else' ((Words 'Read-LauncherStarts -Days 7') -eq '-Days|7' -and (Words 'Read-LauncherStarts') -eq '' -and
    (Words 'Read-LauncherStarts -Days week') -eq 'REFUSED' -and (Words 'Read-LauncherStarts -Folder x') -eq 'REFUSED')
# The box's read only checks, which only One could run before (the cloud
# reaches neither game port nor the box's shell): each takes nothing a caller
# could steer, and Check-ProdParity sends its facts and report back.
foreach ($check in 'Read-Online', 'Check-LiveGamemode', 'Check-ServiceOwners', 'Check-ProdParity') {
    Yes "$check takes no parameter of the caller's" ((Words "$check -Vps x") -eq 'REFUSED' -and (Words "$check -User x") -eq 'REFUSED' -and (Words $check) -ne 'REFUSED')
}
Yes '  Check-LiveGamemode never waits for Enter, and Check-ProdParity collects into the run''s folder' ((Words 'Check-LiveGamemode') -eq '-NoPause' -and
    (Words 'Check-ProdParity') -eq '-Collect' -and (Test-ThornswoodGateRequest -Line 'Check-ProdParity' -Verbs $verbs).Out -eq '-Out' -and
    (Words 'Check-ProdParity -Facts x') -eq 'REFUSED' -and (Words 'Check-ProdParity -Record x') -eq 'REFUSED')
# The box installs and reads that only One could run before (#2862): each
# runs main's script with fixed words, and takes no host, user, folder,
# address or webhook from the caller.
Yes 'Install-Bridge takes -Status, -Record and -Wait, never -Remove or a site' ((Words 'Install-Bridge -Record') -eq '-NoPause|-Record' -and (Words 'Install-Bridge -Status') -eq '-NoPause|-Status' -and
    (Words 'Install-Bridge -Remove') -eq 'REFUSED' -and (Words 'Install-Bridge -Site x') -eq 'REFUSED' -and (Words 'Install-Bridge -AsSystem') -eq 'REFUSED')
Yes 'Setup-Domain takes -TaskOnly and -SkipDnsCheck, never a domain, an address or another Caddy' ((Words 'Setup-Domain -TaskOnly') -eq '-TaskOnly' -and
    (Words 'Setup-Domain -Domain x.net') -eq 'REFUSED' -and (Words 'Setup-Domain -Email a') -eq 'REFUSED' -and (Words 'Setup-Domain -CaddyVersion 1') -eq 'REFUSED' -and (Words 'Setup-Domain -AsSystem') -eq 'REFUSED')
Yes 'Read-Availability reads the box''s own alerts.jsonl over -Days, never a path' ((Words 'Read-Availability -Days 28') -eq '-NoPause|-Days|28' -and (Words 'Read-Availability -Path x') -eq 'REFUSED')
Yes 'Send-Backups installs with an IPv4 address only, reads its status, or sends; never another root, folder or user' ((Words 'Send-Backups -Install -VmHost 10.0.0.5') -eq '-NoPause|-Install|-VmHost|10.0.0.5' -and
    (Words 'Send-Backups') -eq '-NoPause' -and (Words 'Send-Backups -Status') -eq '-NoPause|-Status' -and
    (Words 'Send-Backups -Install -VmHost vm.example') -eq 'REFUSED' -and (Words 'Send-Backups -Root x') -eq 'REFUSED' -and
    (Words 'Send-Backups -WatchRoot x') -eq 'REFUSED' -and (Words 'Send-Backups -Days 400') -eq 'REFUSED')
Yes 'Start-Backup takes nothing: it starts the nightly''s own task' ((Words 'Start-Backup') -eq '-NoPause' -and (Words 'Start-Backup -TaskName x') -eq 'REFUSED' -and (Words 'Start-Backup -Minutes 1') -eq 'REFUSED')
Yes 'Rehearse-Restore takes -Which and a profile id in digits, never another backup, key, folder or port' ((Words 'Rehearse-Restore -Which dev -ProfileId 1909688825') -eq '-NoPause|-Which|dev|-ProfileId|1909688825' -and
    (Words 'Rehearse-Restore -ProfileId 12a') -eq 'REFUSED' -and (Words 'Rehearse-Restore -Which test -ProfileId 1') -eq 'REFUSED' -and
    (Words 'Rehearse-Restore -ProfileId 1 -Backup x') -eq 'REFUSED' -and (Words 'Rehearse-Restore -ProfileId 1 -KeyFile x') -eq 'REFUSED' -and
    (Words 'Rehearse-Restore -ProfileId 1 -Root x') -eq 'REFUSED' -and (Test-ThornswoodGateRequest -Line 'Rehearse-Restore -ProfileId 1' -Verbs $verbs).Out -eq '-Out')
Yes 'Set-InboundRules takes -Check and -Own, never another box, user, record or known_hosts' ((Words 'Set-InboundRules -Own -Check') -eq '-NoPause|-Own|-Check' -and
    (Words 'Set-InboundRules -Vps x') -eq 'REFUSED' -and (Words 'Set-InboundRules -Record x') -eq 'REFUSED' -and (Words 'Set-InboundRules -KnownHosts x') -eq 'REFUSED')
Yes 'Setup-Discord runs on the box and only audits or checks: -Prune, -Posts, -Give and another guild wait for Patrick' ((Words 'Setup-Discord -Audit') -eq '-OnBox|-Audit' -and
    (Words 'Setup-Discord -Prune') -eq 'REFUSED' -and (Words 'Setup-Discord -Posts') -eq 'REFUSED' -and (Words 'Setup-Discord -Give x') -eq 'REFUSED' -and (Words 'Setup-Discord -Guild 1') -eq 'REFUSED')
# The last box scripts a person ran from One with its ssh key (#2862, 1 Nov):
# the nightly backup's install (#5168 waited on it), a deletion request, and
# four reads. None takes a host, user, folder, task or passphrase file.
Yes 'Install-Backup installs, runs or reads through the gate, never -Remove, -AsSystem, a folder, a task or a passphrase file' ((Words 'Install-Backup') -eq '-FromGate|-NoPause' -and
    (Words 'Install-Backup -RunNow') -eq '-FromGate|-NoPause|-RunNow' -and (Words 'Install-Backup -Status') -eq '-FromGate|-NoPause|-Status' -and
    (Words 'Install-Backup -Remove') -eq 'REFUSED' -and (Words 'Install-Backup -AsSystem') -eq 'REFUSED' -and (Words 'Install-Backup -Root x') -eq 'REFUSED' -and
    (Words 'Install-Backup -KeyOut x') -eq 'REFUSED' -and (Words 'Install-Backup -TaskName x') -eq 'REFUSED' -and (Words 'Install-Backup -At 01:00Z') -eq 'REFUSED')
$ib = Text 'scripts\deploy\Install-Backup.ps1'
# A Windows checkout may hold it CRLF (core.autocrlf), and the checks below read line breaks.
$ib = $ib.Replace("`r`n", "`n")
Yes '  -FromGate runs only under the gate, refuses what the verb leaves out, and never copies, sends or makes the passphrase' (
    $ib.Contains("if (`$env:THORNSWOOD_GATE -ne '1') { Die '-FromGate is for the deploy gate") -and
    $ib.Contains("if (`$Remove -or `$AsSystem -or @(`$handPicked).Count) { Die 'through the gate") -and
    $ib.Contains("if (`$FromGate) {`n  # Neither copied down nor sent up") -and $ib.Contains("if (`"`$there`" -notmatch 'KEY THERE') { Die") -and
    $ib.IndexOf('if (-not $FromGate) {' + "`n" + '$made = Remote') -gt 0 -and $ib.IndexOf("Copying it down") -gt $ib.IndexOf('if (-not $FromGate) {' + "`n" + '$made = Remote'))
Yes '  and its last words send nobody to Fetch-Backups on One' (-not $ib.Contains('Fetch-Backups.ps1 -Schedule'))
Yes 'Delete-Person takes a Discord id in digits, -Delete with a name for the record, or -Reapply; never a folder, a merge list or -AllowGamingPc' (
    (Words 'Delete-Person -DiscordId 123456789012345678') -eq '-DiscordId|123456789012345678' -and
    (Words 'Delete-Person -DiscordId 123456789012345678 -Delete -By Patrick') -eq '-DiscordId|123456789012345678|-Delete|-By|Patrick' -and
    (Words 'Delete-Person -Reapply') -eq '-Reapply' -and (Words 'Delete-Person -DiscordId 12345') -eq 'REFUSED' -and (Words 'Delete-Person -DiscordId abc') -eq 'REFUSED' -and
    (Words 'Delete-Person -Reapply -Merge x') -eq 'REFUSED' -and (Words 'Delete-Person -DiscordId 123456789012345678 -SiteRoot C:/x') -eq 'REFUSED' -and
    (Words 'Delete-Person -DiscordId 123456789012345678 -AllowGamingPc') -eq 'REFUSED' -and (Words 'Delete-Person -DiscordId 123456789012345678 -RecordRoot x') -eq 'REFUSED')
foreach ($check in 'Check-Roster', 'Check-Load', 'Check-ServerPriority', 'Chargen-Log') {
    Yes "$check takes no host, user or folder of the caller's" ((Words "$check -Vps x") -eq 'REFUSED' -and (Words "$check -User x") -eq 'REFUSED' -and (Words "$check -Root x") -eq 'REFUSED' -and (Words $check) -ne 'REFUSED')
}
Yes 'Rotate-ServerPassword makes the site''s new password on the box after a ban, never one the caller types or names' ((Words 'Rotate-ServerPassword') -eq '-Yes' -and
    (Words 'Rotate-ServerPassword -Password') -eq 'REFUSED' -and (Words 'Rotate-ServerPassword -DocsRoot C:/x') -eq 'REFUSED' -and (Words 'Rotate-ServerPassword -Vps x') -eq 'REFUSED')
Yes '  Check-Load never waits for Enter or watches, and Chargen-Log takes a line count only' ((Words 'Check-Load') -eq '-NoPause' -and (Words 'Check-Load -Watch 10') -eq 'REFUSED' -and
    (Words 'Chargen-Log -Lines 200') -eq '-Lines|200' -and (Words 'Chargen-Log -Lines all') -eq 'REFUSED')
# What has a server's folder open, read on the box (#5211): live or dev, and
# a minute of Defender's log, never a folder, a file or a process of the caller's.
Yes 'Read-ServerHolders takes live or dev and a UTC minute of Defender''s log, never a folder, file or task' ((Words 'Read-ServerHolders') -eq '' -and
    (Words 'Read-ServerHolders -Server dev') -eq '-Server|dev' -and (Words 'Read-ServerHolders -Server main') -eq 'REFUSED' -and
    (Words 'Read-ServerHolders -DefenderFrom 2026-11-01T00:59 -DefenderMinutes 3') -eq '-DefenderFrom|2026-11-01T00:59|-DefenderMinutes|3' -and
    (Words 'Read-ServerHolders -DefenderFrom yesterday') -eq 'REFUSED' -and (Words 'Read-ServerHolders -DefenderMinutes 100') -eq 'REFUSED' -and (Words 'Read-ServerHolders -TraceSeconds 10') -eq '-TraceSeconds|10' -and (Words 'Read-ServerHolders -TraceSeconds 100') -eq 'REFUSED' -and
    (Words 'Read-ServerHolders -Root C:/x') -eq 'REFUSED' -and (Words 'Read-ServerHolders -Path x') -eq 'REFUSED' -and (Words 'Read-ServerHolders -TaskName x') -eq 'REFUSED')
$rh = Text 'scripts/vps/Read-ServerHolders.ps1'
Yes '  it finds the server''s processes by the installer''s own rule and reads only: no Stop-, no Remove-, no Set-, no Move' (
    $rh.Contains("`$p.CommandLine.IndexOf(`$mark, [StringComparison]::OrdinalIgnoreCase)") -and $rh.Contains('Get-ThornswoodPathOpeners $Root') -and
    (($rh -replace '(?s)<#.*?#>', '') -notmatch 'Stop-Process|Stop-ScheduledTask|Remove-Item|Set-Content|Set-MpPreference|Add-MpPreference|Move-ThornswoodPath|\.Kill\('))
Yes 'Check-Site takes nothing of the caller''s' ((Words 'Check-Site') -eq '-NoPause' -and (Words 'Check-Site -Who 1') -eq 'REFUSED' -and (Words 'Check-Site -Site x') -eq 'REFUSED')
# Box keys and runners, renewed from the cloud and never made new (#2862,
# Patrick's A on q-retire-box-keys, 31 Oct 2026).
Yes 'Renew-BoxKey takes desk or notices and nothing else: no name, environment, repository or file' ((Words 'Renew-BoxKey -Which desk') -eq '-NoPause|-Which|desk' -and
    (Words 'Renew-BoxKey -Which notices') -eq '-NoPause|-Which|notices' -and (Words 'Renew-BoxKey -Which cloud') -eq 'REFUSED' -and
    (Words 'Renew-BoxKey -Which desk -AdminState x') -eq 'REFUSED' -and (Words 'Renew-BoxKey -Name djinn') -eq 'REFUSED')
Yes 'Install-Runner runs from the gate with a number, -Status, -Lock or -NetworkOnly: never -Remove, -OffBox, another repository, name or folder' (
    (Words 'Install-Runner -Number 2') -eq '-FromGate|-AllowHost|pypi.org,files.pythonhosted.org,registry.npmjs.org|-NoPause|-Number|2' -and
    (Words 'Install-Runner -Number 2 -Status') -ne 'REFUSED' -and (Words 'Install-Runner -Remove') -eq 'REFUSED' -and (Words 'Install-Runner -OffBox') -eq 'REFUSED' -and
    (Words 'Install-Runner -Repo x/y') -eq 'REFUSED' -and (Words 'Install-Runner -RunnerName x') -eq 'REFUSED' -and (Words 'Install-Runner -Root C:/x') -eq 'REFUSED' -and
    (Words 'Install-Runner -Number 100') -eq 'REFUSED' -and (Words 'Install-Runner -AllowHost x') -eq 'REFUSED')
$rk = Text 'scripts/vps/Renew-BoxKey.ps1'
Yes '  Renew-BoxKey keeps the old line until the secret holds the new key, and puts the file back on any stop before that' (
    $rk.IndexOf('[IO.File]::WriteAllLines($KeysFile, [string[]](@($have) + $newLine)') -gt 0 -and
    $rk.IndexOf('[IO.File]::WriteAllLines($KeysFile, [string[]](@($have) + $newLine)') -lt $rk.IndexOf('& $ssh -n -F none -i $keyFile') -and
    $rk.IndexOf('& $ssh -n -F none -i $keyFile') -lt $rk.IndexOf('& gh secret set $K.Secret') -and
    $rk.IndexOf('& gh secret set $K.Secret') -lt $rk.IndexOf('Where-Object { $old -notcontains $_ }') -and
    $rk.Contains('if ($changed -and -not $done) { [IO.File]::WriteAllBytes($KeysFile, $before) }'))
Yes '  its key goes only to the two fixed secrets of the ops repository, with the old line''s options and the App''s environments token' (
    $rk.Contains("`$GitHubRepo = 'ThornswoodRP/Thornswood-Ops'") -and $rk.Contains("Secret = 'DESK_KEY_B64'") -and $rk.Contains("Secret = 'NOTICE_KEY_B64'") -and
    $rk.Contains('$newLine = $opts + '' '' + $bare + $tag') -and $rk.Contains('Get-ThornswoodOpsAccess -Repo $RepoRoot -For keys') -and
    $rk.Contains('does not let in main alone'))
$ir = Text 'scripts/deploy/Install-Runner.ps1'
Yes '  Install-Runner from the gate is the ops repository''s, with the App''s runners token, and puts back only a runner the records or GitHub already name' (
    $ir.Contains("`$Repo = 'ThornswoodRP/Thornswood-Ops'") -and $ir.Contains('Get-ThornswoodOpsAccess -Repo') -and $ir.Contains('-For runners') -and
    $ir.Contains('is in no runner record and not registered on') -and $ir.IndexOf('function Invoke-Gh') -lt $ir.IndexOf('is in no runner record and not registered on'))
# Publish-Server through the gate is the dev server's, from the box's store,
# and nothing else (#4987): main stays with a Main run Patrick approves.
Yes 'Publish-Server is held to -Channel dev' ((Words 'Publish-Server') -eq '-Channel|dev' -and
    (Words 'Publish-Server -RequirePass on -Wait 300') -eq '-Channel|dev|-RequirePass|on|-Wait|300' -and
    $verbs.verbs.'Publish-Server'.script -eq 'scripts/release/Publish-ServerOnBox.ps1')
Yes '  and a caller cannot name main, a build, a zip or a fresh world' ((Words 'Publish-Server -Channel main') -eq 'REFUSED' -and
    (Words 'Publish-Server -ServerBuild x') -eq 'REFUSED' -and (Words 'Publish-Server -Zip x') -eq 'REFUSED' -and (Words 'Publish-Server -FreshWorld') -eq 'REFUSED')
# The live verbs (Patrick, 30 Oct 2026: Ships and deploys run from the
# cloud, never One): each names the exact build of main it is for with
# -Build, which the broker holds to main's tip and never hands the script.
$sha = 'a' * 40
foreach ($live in 'Deploy-Server', 'Publish-Server-Main') { Yes "$live is a live verb, held to a build" ($verbs.verbs.$live.build -eq $true) }
Yes 'a live verb without -Build is refused, and says why' ((Words 'Deploy-Server -GamemodeOnly') -eq 'REFUSED' -and
    (Test-ThornswoodGateRequest -Line 'Deploy-Server -GamemodeOnly' -Verbs $verbs).Why -match 'exact build')
$req = Test-ThornswoodGateRequest -Line ("Deploy-Server -GamemodeOnly -Build $sha -Mode restart") -Verbs $verbs
Yes '  and with it, the build is the gate''s and never the script''s' ($req.Ok -and $req.Build -eq $sha -and ($req.Args -join '|') -eq '-GamemodeOnly|-Mode|restart')
Yes '  -Build is a full lower case commit, given once' ((Words "Deploy-Server -FromStore -Build abc123") -eq 'REFUSED' -and (Words ("Deploy-Server -FromStore -Build " + ('A' * 40))) -eq 'REFUSED' -and
    (Words "Deploy-Server -FromStore -Build $sha -Build $sha") -eq 'REFUSED' -and (Words 'Deploy-Server -FromStore -Build') -eq 'REFUSED')
Yes '  a verb that is not live takes no -Build' ((Words "Deploy-DevGamemode -Build $sha") -eq 'REFUSED' -and (Test-ThornswoodGateRequest -Line 'Deploy-DevGamemode' -Verbs $verbs).Build -eq '')
Yes 'Publish-Server-Main is held to -Channel main' ((Words "Publish-Server-Main -Build $sha -RequirePass on") -eq '-Channel|main|-RequirePass|on' -and
    $verbs.verbs.'Publish-Server-Main'.script -eq 'scripts/release/Publish-ServerOnBox.ps1' -and
    (Words "Publish-Server-Main -Build $sha -Channel dev") -eq 'REFUSED' -and (Words "Publish-Server-Main -Build $sha -ServerBuild x") -eq 'REFUSED')
$pubBox = Text 'scripts/release/Publish-ServerOnBox.ps1'
# A pin move's first publish (31 Oct 2026, a9970b43): the store lacked the
# new build, and only One's plain publish sent it there.
Yes '  Publish-ServerOnBox.ps1 fetches CI''s engine build with the App''s token and sends its zip to the store before publishing from it' (
    $pubBox.Contains("& (Join-Path `$Here 'Get-EngineArtifact.ps1') -NoPause") -and $pubBox.Contains("`$pub['FromStore'] = `$true") -and $pubBox.Contains("`$pub['ServerBuild'] = `$ciZip") -and
    $pubBox.Contains('$env:GH_TOKEN = $token') -and $pubBox.Contains('finally { Remove-Item -LiteralPath Env:\GH_TOKEN') -and
    $pubBox.IndexOf('Get-EngineArtifact.ps1') -lt $pubBox.IndexOf("& (Join-Path `$Here 'Publish-Server.ps1') @pub"))
Yes '  and -PutBack and -TaskOnly go without a fetch or -FromStore, which Publish-Server.ps1 refuses with them' ($pubBox.Contains('if (-not $PutBack -and -not $TaskOnly) {') -and
    (Text 'scripts/release/Publish-Server.ps1').Contains('if ($FromStore -and ($PutBack -or $TaskOnly))'))
Yes '  both box scripts mint the token through ShipAccess.ps1' ($pubBox.Contains('Get-ThornswoodShipAccess -Repo $repo -AdminState $AdminState') -and
    (Text 'scripts/release/Ship-OnBox.ps1').Contains('Get-ThornswoodShipAccess -Repo $repo -AdminState $AdminState'))
Yes 'Deploy-Server takes no host, folder, build folder or role list' ((Words "Deploy-Server -Build $sha -Vps x") -eq 'REFUSED' -and (Words "Deploy-Server -Build $sha -Root C:/x") -eq 'REFUSED' -and
    (Words "Deploy-Server -Build $sha -Dist x") -eq 'REFUSED' -and (Words "Deploy-Server -Build $sha -Devs 1") -eq 'REFUSED')
# Content rebuilds through the gate (Patrick's card, 30 Oct 2026): main's
# whole chain against a server's plugins, its files back through -Out.
Yes 'Rebuild-ContentTables takes -Server dev or main, and names its out parameter' ((Words 'Rebuild-ContentTables') -eq '' -and (Words 'Rebuild-ContentTables -Server main') -eq '-Server|main' -and
    (Words 'Rebuild-ContentTables -Server live') -eq 'REFUSED' -and (Test-ThornswoodGateRequest -Line 'Rebuild-ContentTables' -Verbs $verbs).Out -eq '-Out')
Yes '  and cannot name a branch, a tool or a build' ((Words "Rebuild-ContentTables -Build $sha") -eq 'REFUSED' -and (Words 'Rebuild-ContentTables -Script x') -eq 'REFUSED' -and (Words 'Rebuild-ContentTables -Branch x') -eq 'REFUSED')
$rebuild = Text 'scripts/mods/Rebuild-OnBox.ps1'
# A pull request's data, never its code (Patrick's B on the #4835 card).
Yes '  a pull request by number and its full head commit' ((Words "Rebuild-ContentTables -Pull 4835 -Head $sha") -eq "-Pull|4835|-Head|$sha" -and
    (Words 'Rebuild-ContentTables -Pull 0') -eq 'REFUSED' -and (Words 'Rebuild-ContentTables -Head abc') -eq 'REFUSED' -and (Words 'Rebuild-ContentTables -Pull x') -eq 'REFUSED')
Yes '  it takes only the listed data files from the pull request, held to its head, and commits them for Run-OnBox.ps1' (
    $rebuild.Contains("`$DataFromPull = @('game/content/Thornswood-Content.esp', 'records/recipe-owners.json', 'game/data/last-plugin-policy.json', 'scripts/mods/content-salvaged.json')") -and
    $rebuild.Contains("'checkout', `$Head, '--', `$p") -and $rebuild.Contains('if ($at -cne $Head)') -and $rebuild.Contains("'commit', '--quiet', '--allow-empty'") -and
    $rebuild.IndexOf("'commit', '--quiet'") -lt $rebuild.IndexOf("Run-OnBox.ps1')"))
Yes '  and no file of the list is a script' (@([regex]::Match($rebuild, '\$DataFromPull = @\(([^)]*)\)').Groups[1].Value -split ',' | Where-Object { $_ -match '\.(ps1|psm1|py|js|cmd|bat|exe|dll)''' }).Count -eq 0)
# The stations first (#1387): main's Build-StationSites.py measures them over
# the server's plugins, main's Add-ContentRecords.py writes the plugin from
# that table, each committed in the checkout, and then the chain.
Yes '  -Stations is a switch, with a pull request or without' ((Words "Rebuild-ContentTables -Stations -Pull 1387 -Head $sha") -eq "-Stations|-Pull|1387|-Head|$sha" -and
    (Words 'Rebuild-ContentTables -Stations') -eq '-Stations' -and (Words 'Rebuild-ContentTables -Stations yes') -eq 'REFUSED')
$sites = $rebuild.IndexOf("'scripts/dev/Build-StationSites.py' '--data' '{data}' -Server `$Server -Out `$Out")
$records = $rebuild.IndexOf("'scripts/mods/Add-ContentRecords.py' '--masters' '{data}' -Server `$Server -Out `$Out")
$chain = $rebuild.IndexOf("'scripts/mods/Rebuild-ContentTables.ps1' '-Data'")
Yes '  with it the stations are measured, then the plugin written, then the chain runs' ($rebuild.Contains('if ($Stations) {') -and $sites -gt 0 -and $records -gt $sites -and $chain -gt $records)
Yes '  each step is committed, new files and all, before the next is sent' (
    $rebuild.IndexOf("Save-Step 'Build-StationSites.py'") -gt $sites -and $rebuild.IndexOf("Save-Step 'Build-StationSites.py'") -lt $records -and
    $rebuild.IndexOf("Save-Step 'Add-ContentRecords.py'") -gt $records -and $rebuild.IndexOf("Save-Step 'Add-ContentRecords.py'") -lt $chain -and
    $rebuild.Contains("Invoke-PullGit @('add', '--all')"))
Yes '  and a step that fails stops the run before the chain' (([regex]::Matches($rebuild, 'if \(\$LASTEXITCODE -ne 0\) \{ Write-Host "STOP\. (Build-StationSites|Add-ContentRecords)\.py ended')).Count -eq 2)
Yes '  it runs the chain by Run-OnBox.ps1, its words quoted so none is read as a parameter' ($rebuild.Contains("'scripts/mods/Rebuild-ContentTables.ps1' '-Data' '{data}' '-PluginsTxt' '{plugins}' -Server `$Server -Out `$Out"))
Yes '  and Run-OnBox.ps1 copies what came back into -Out as well as the checkout' ((Text 'scripts/mods/Run-OnBox.ps1').Contains('foreach ($into in @($repo, $Out | Where-Object { $_ }))'))
# The Ship verbs (Patrick's A, 30 Oct 2026: the box admin App mints the
# token a Ship from the feed signs with, and the whole Ship runs on the box).
Yes 'Ship-Dev is a dev Ship from the feed, its note as a title and detail lines' ((Words 'Ship-Dev -Title "Market stalls take your prices" -Detail "Claim a stall"') -eq '-Channel|dev|-Title|Market stalls take your prices|-Detail|Claim a stall' -and
    (Words 'Ship-Dev -Title x -Detail y -ModsOnly') -eq 'REFUSED' -and
    (Words 'Ship-Dev -Channel main -Title x -Detail y') -eq 'REFUSED' -and (Words 'Ship-Dev -Title x -Detail y -Root C:/x') -eq 'REFUSED' -and (Words 'Ship-Dev -Title x -Detail y -Package') -eq 'REFUSED')
Yes 'Ship-Dev takes -Detail2 and -Detail3, whose names end in digits (#5144)' ((Words 'Ship-Dev -Title x -Detail y -Detail2 z -Detail3 w') -eq '-Channel|dev|-Title|x|-Detail|y|-Detail2|z|-Detail3|w' -and (Words 'Ship-Dev -Title x -2Detail y') -eq 'REFUSED')
Yes 'Ship-Main is held to a build and to -Channel main' ($verbs.verbs.'Ship-Main'.build -eq $true -and (Words 'Ship-Main -Title x -Detail y') -eq 'REFUSED' -and
    (Words "Ship-Main -Build $sha -Title x -Detail y -ModsOnly") -eq 'REFUSED' -and (Words "Ship-Main -Build $sha -Title x -Detail y -MoveServer") -eq 'REFUSED')
$shipBox = Text 'scripts/release/Ship-OnBox.ps1'
Yes '  Ship-OnBox.ps1 runs Ship.ps1 from the feed, with no switch about a launcher (Ship sends none, #4825), with the token in GH_TOKEN alone and gone after' (
    $shipBox.Contains("`$ship = @{ Notes = `$notes; FromFeed = `$true; NoPause = `$true }") -and $shipBox.Contains("if (`$Channel -eq 'dev') { `$ship['Channel'] = 'dev' }") -and
    -not $shipBox.Contains('ModsOnly') -and
    $shipBox.Contains('$env:GH_TOKEN = $token') -and $shipBox.Contains('finally { Remove-Item -LiteralPath Env:\GH_TOKEN'))
Yes '  a main Ship goes from the branch main at the fetched origin/main' ($shipBox.Contains("checkout --quiet -B main refs/remotes/origin/main"))
# The DEV marks and the shipped issues read main's history and the release
# tags, which the gate's one-commit checkout has not got (#5133).
Yes '  a Ship deepens the gate''s checkout to main''s history and tags as origin has them (a moved tag too, #5231) before it runs, and keeps origin/main at the commit the gate read' (
    $shipBox.Contains("'fetch', '--unshallow', 'origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/tags/*:refs/tags/*'") -and
    $shipBox.Contains("'fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/tags/*:refs/tags/*'") -and
    -not $shipBox.Contains("'--tags'") -and -not $shipBox.Contains("'fetch', '--quiet'") -and
    $shipBox.Contains('update-ref refs/remotes/origin/main $head') -and
    $shipBox.IndexOf('--unshallow') -gt $shipBox.IndexOf('checkout --quiet -B main') -and
    $shipBox.IndexOf('--unshallow') -lt $shipBox.IndexOf("& (Join-Path `$Here 'Ship.ps1') @ship"))
# The dev world started over for a load order change (#3649: a light plugin
# going out renumbers the ones after it): dev only, with nothing a caller
# can add, and the wipe's own -Yes because the gate has no console.
Yes 'Wipe-Dev wipes the dev server alone and takes nothing' ((Words 'Wipe-Dev') -eq '-Server|dev|-Yes|-NoPause' -and (Words 'Wipe-Dev -Server main') -eq 'REFUSED' -and
    (Words 'Wipe-Dev -Vps 1.2.3.4') -eq 'REFUSED' -and -not $verbs.verbs.'Wipe-Dev'.build -and $verbs.verbs.'Wipe-Dev'.script -eq 'scripts/ops/Wipe-Saves.ps1')
Yes '  and no verb wipes main or every server' (@($verbs.verbs.PSObject.Properties | Where-Object { $_.Value.script -eq 'scripts/ops/Wipe-Saves.ps1' -and (@($_.Value.fixed) -join ' ') -ne '-Server dev -Yes -NoPause' }).Count -eq 0)
# The installer for the site (#5109) went with the old installer pipeline
# (#4824): the download is Velopack's Setup.exe on the GitHub Release, which
# merge-release.yml makes, so the gate has no verb for it and no script of it
# is left to run.
Yes 'no verb publishes the old installer, and no Publish-Installer script is left (#4824)' (
    -not $verbs.verbs.PSObject.Properties['Publish-Installer'] -and
    @($verbs.verbs.PSObject.Properties | Where-Object { [string]$_.Value.script -match 'Publish-Installer' }).Count -eq 0 -and
    @(Get-ChildItem -LiteralPath (Join-Path $Repo 'scripts/release') -Filter 'Publish-Installer*' -File).Count -eq 0)
$gt = Text 'scripts/vps/admin/ship-access.js'
Yes '  the token is the App''s, for the fork and Thornswood only, Actions write and Contents read and nothing more' (
    $gt.Contains("const REPOS = ['skymp', 'Thornswood'];") -and $gt.Contains("const PERMISSIONS = { actions: 'write', contents: 'read' };") -and $gt.Contains('{ repositories: REPOS, permissions: PERMISSIONS }'))
$ig = Text 'scripts/deploy/Install-Gate.ps1'
Yes 'Install-Gate pins the GitHub CLI by version and SHA-256 and refuses one that does not match' ($ig -match "\`$GhVersion = '\d+\.\d+\.\d+'" -and $ig -match "\`$GhSha = '[0-9A-F]{64}'" -and
    $ig.Contains('if (`$got -ne ''$GhSha'')') -and $ig.Contains('gh = `$gh;'))
$refused = @(
    @('', 'an empty line'),
    @('Remove-Item C:\', 'a verb that is not on the list'),
    @('deploy-devgamemode', 'a verb in another case'),
    @('Deploy-DevGamemode -putback', 'a parameter in another case'),
    @('Deploy-DevGamemode -Vps 1.2.3.4', 'a host'),
    @('Deploy-DevGamemode -Root C:/x', 'a folder'),
    @('Deploy-DevGamemode -Data x', 'a data folder'),
    @('Deploy-DevGamemode -Dist x', 'a build folder'),
    @('Deploy-Docs -PasswordFile x', 'a file'),
    @('Get-Logs -Out x', 'the out folder, which the broker sets'),
    @('Install-Bot -RotateKey', 'a secret change'),
    @('Deploy-DevGamemode -Restart -Restart', 'a parameter twice'),
    @('Deploy-DevGamemode -Why', 'a parameter with no value'),
    @('Deploy-DevGamemode -Why -Restart', 'a value that starts with a hyphen'),
    @('Deploy-DevGamemode -Why "-Restart"', 'a quoted value that starts with a hyphen'),
    @('Deploy-DevGamemode -Why $(whoami)', 'a dollar sign'),
    @('Deploy-DevGamemode -Why a`b', 'a backtick'),
    @('Deploy-DevGamemode -Why a\b', 'a backslash'),
    @('Deploy-DevGamemode -Why a|b', 'a pipe'),
    @('Deploy-DevGamemode -Why a>b', 'an angle bracket'),
    @('Deploy-DevGamemode -Why "a"b', 'a quote followed by more'),
    @('Deploy-DevGamemode -Why "open', 'a quote that never closes'),
    @('Deploy-DevGamemode -Why a"b', 'a quote inside a word'),
    @('Deploy-DevGamemode -Why a&b', 'an ampersand'),
    @('Deploy-DevGamemode -Why a%PATH%', 'a percent sign'),
    @("Deploy-DevGamemode -Why caf`u{e9}", 'a character outside ASCII'),
    @("Deploy-DevGamemode -Restart`nGet-Logs", 'a second line'),
    @('Deploy-DevGamemode -Restart:$false', 'a switch with a value glued on'),
    @('Deploy-DevGamemode Restart', 'a word that is not a parameter'),
    @('Deploy-DevGamemode -Minutes 1e9', 'a number outside its pattern'),
    @(('Deploy-DevGamemode -Why "' + ('a' * 200) + '"'), 'text over its length'),
    @(('ping ' + ('a' * 700)), 'a line over 600 characters')
)
foreach ($r in $refused) { Yes ('refused: ' + $r[1]) ((Words $r[0]) -eq 'REFUSED') }
Yes 'a refusal says what the verb takes' ((Test-ThornswoodGateRequest -Line 'Deploy-DevGamemode -Vps x' -Verbs $verbs).Why -match '-Restart' )
Yes 'the command line quotes a word with a space and nothing else' ((Join-ThornswoodGateArgs @('-Why', 'a b', '-Restart', 'C:\Thornswood-Gate\repo')) -eq '-Why "a b" -Restart C:\Thornswood-Gate\repo')
$threw = $false; try { [void](Join-ThornswoodGateArgs @('a"b')) } catch { $threw = $true }
Yes 'the command line refuses a word with a double quote' $threw
$threw = $false; try { [void](Join-ThornswoodGateArgs @('x\y')) } catch { $threw = $true }
Yes '  and a backslash that is not a folder path of the broker''s' $threw
$threw = $false; try { [void](Join-ThornswoodGateArgs @('C:\x\')) } catch { $threw = $true }
Yes '  and a folder path that ends in a backslash' $threw

. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the rules under Windows PowerShell 5.1, which the box runs them with: this is not Windows'
} else {
    $ps51 = Get-WindowsPowerShell
    $probe = Join-Path ([IO.Path]::GetTempPath()) ('tw-2841-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.ps1')
    try {
        [IO.File]::WriteAllText($probe, @"
. '$((Join-Path $Repo 'scripts\vps\gate\GateRules.ps1').Replace("'", "''"))'
`$v = Read-ThornswoodGateVerbs '$((Join-Path $Repo 'scripts\vps\gate\verbs.json').Replace("'", "''"))'
foreach (`$l in 'Deploy-DevGamemode -Restart -Why "a gamemode update"', 'Install-Bot', 'Deploy-DevGamemode -Vps x', 'Deploy-DevGamemode -Why `$(x)', 'ping') {
  `$r = Test-ThornswoodGateRequest -Line `$l -Verbs `$v
  if (`$r.Ok) { 'OK ' + (`$r.Args -join '|') } else { 'NO' }
}
"@)
        $said = @(& $ps51 -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $probe 2>&1 | ForEach-Object { "$_" })
        Yes 'under Windows PowerShell 5.1 the rules give the same words and refusals' (
            ($said -join ';') -eq 'OK -Restart|-Why|a gamemode update;OK -CodeOnly|-NoPause;NO;NO;OK ')
        if (($said -join ';') -ne 'OK -Restart|-Why|a gamemode update;OK -CodeOnly|-NoPause;NO;NO;OK ') { $said | Write-Host }
    } finally { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue }
}

# ---- 3. verbs.json against the scripts ---------------------------------------
$never = @('Vps', 'VpsHost', 'User', 'VpsUser', 'Root', 'Task', 'TaskName', 'Data', 'Dist', 'Out', 'PasswordFile', 'Path', 'Script', 'Command', 'Site', 'Gamemode', 'ServerBuild', 'Note', 'DropPlugins', 'AsSystem', 'RunAs', 'Remove', 'RotateKey', 'Password')
# Deploy-Docs -Site is a switch (which part of the site to send), not an address.
foreach ($p in $verbs.verbs.PSObject.Properties) {
    $v = $p.Value
    $path = Join-Path $Repo $v.script
    Yes "$($p.Name): its script $($v.script) is there" (Test-Path -LiteralPath $path)
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
    $takes = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
    $isSwitch = @{}
    foreach ($pp in @($ast.ParamBlock.Parameters)) { $isSwitch[$pp.Name.VariablePath.UserPath] = ($pp.StaticType -eq [switch]) }
    foreach ($q in @($v.params.PSObject.Properties)) {
        Yes "$($p.Name) -$($q.Name): the script takes it" ($takes -contains $q.Name)
        if ($takes -contains $q.Name) { Yes "$($p.Name) -$($q.Name): a switch in the script is a switch at the gate, and a value a value" ($isSwitch[$q.Name] -eq ($q.Value -eq 'switch')) }
        $isSiteSwitch = ($p.Name -eq 'Deploy-Docs' -and $q.Name -eq 'Site')
        Yes "$($p.Name) -$($q.Name): not a host, user, folder, file, task or secret" ($isSiteSwitch -or $never -notcontains $q.Name)
    }
    # A fixed word with no hyphen is the value of the fixed parameter before it,
    # so that one is a value in the script, never a switch (Publish-Server is
    # held to -Channel dev this way, #4987).
    $fixedWords = @($v.fixed | Where-Object { $_ })
    for ($k = 0; $k -lt $fixedWords.Count; $k++) {
        $w = [string]$fixedWords[$k]
        if ($w.StartsWith('-')) { Yes "$($p.Name) fixed $w`: the script takes it" ($takes -contains $w.TrimStart('-')); continue }
        $before = if ($k -gt 0) { ([string]$fixedWords[$k - 1]).TrimStart('-') } else { '' }
        Yes "$($p.Name) fixed value $w`: it follows a fixed parameter that takes a value" ($k -gt 0 -and ([string]$fixedWords[$k - 1]).StartsWith('-') -and $takes -contains $before -and -not $isSwitch[$before])
        Yes "$($p.Name) fixed value $w`: a caller cannot give that parameter again" ($null -eq $v.params.$before)
    }
    if ($v.out) { Yes "$($p.Name) out $($v.out): the script takes it" ($takes -contains ([string]$v.out).TrimStart('-')) }
    Yes "$($p.Name): a timeout of an hour at most, which box-run.yml's job allows" ([int]$v.timeoutMinutes -gt 0 -and [int]$v.timeoutMinutes -le 45)
}

# ---- 4. Gate.ps1 holds no rule and runs nothing ------------------------------
$gate = Text 'scripts/vps/gate/Gate.ps1'
$gateCode = ($gate -replace '(?s)<#.*?#>', '')
Yes 'Gate.ps1 reads SSH_ORIGINAL_COMMAND and nothing else from the caller' ($gateCode.Contains('$env:SSH_ORIGINAL_COMMAND') -and $gateCode -notmatch '\$args|param\(')
Yes '  runs nothing: no Invoke-Expression, no call operator, no Start-Process, no Process' ($gateCode -notmatch 'Invoke-Expression|\biex\b|Start-Process|Diagnostics\.Process|(^|\s)&\s' )
Yes '  and talks to the broker''s pipe by its name' ($gateCode.Contains("'thornswood-gate'"))
Yes '  sends the line in base64, so no character in it ends the request' ($gateCode.Contains("'LINE ' + [Convert]::ToBase64String"))
Yes '  loads no module and writes through [Console] (#3059)' ($gateCode -notmatch 'ConvertTo-Json|Import-Module|Write-Host|Write-Output' -and $gateCode.Contains('[Console]::Out'))

# ---- 5. the broker -----------------------------------------------------------
$broker = Text 'scripts/vps/gate/GateBroker.ps1'
$brokerCode = ($broker -replace '(?s)<#.*?#>', '')
# The pipe keeps other machines out with PIPE_REJECT_REMOTE_CLIENTS and
# denies nothing: a NETWORK deny also shut out thornswood-deploy, whose ssh
# key login is a network logon (30 Oct, the first ping through the gate).
Yes 'the pipe refuses other machines itself (PIPE_REJECT_REMOTE_CLIENTS), takes one connection at a time, and nothing else may take its name first' ($brokerCode -match 'RejectRemote = 0x8' -and $brokerCode -match 'FirstInstance \| Overlapped, RejectRemote, 1,')
Yes '  and its access list denies nothing, NETWORK above all' ($brokerCode -notmatch 'AccessControlType\]::Deny' -and $brokerCode -notmatch "'S-1-5-2'")
Yes '  and allows SYSTEM and the deploy account alone' (
    $brokerCode.Contains("SecurityIdentifier('S-1-5-18')") -and $brokerCode.Contains('[string]$Cfg.deploySid') -and
    @([regex]::Matches($brokerCode, 'AccessControlType\]::Allow')).Count -eq 2)
$pipeBlock = [regex]::Match($broker, "(?s)\`$GatePipeCode = @'.*?\nfunction New-GatePipe.*?\n\}\r?\n").Value
Yes '  and the pipe is made in one block a harness can run' ($pipeBlock.Length -gt 0)
if (-not $OnWindows) {
    Write-Host 'SKIP  the pipe under Windows PowerShell 5.1, which the broker runs under: this is not Windows'
} else {
    # Under 5.1, as the broker runs it: the pipe made for this account, a
    # line through it, its access list read back, and its name refused to a
    # second maker while the first holds it.
    $pipeProbe = Join-Path ([IO.Path]::GetTempPath()) ('tw-2841-pipe-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.ps1')
    $pipeRun = @'
$name = 'tw-2841-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$server = New-GatePipe $name
try {
    $wait = $server.BeginWaitForConnection($null, $null)
    $client = New-Object IO.Pipes.NamedPipeClientStream('.', $name, [IO.Pipes.PipeDirection]::InOut)
    $client.Connect(5000)
    if (-not $wait.AsyncWaitHandle.WaitOne(5000)) { 'NO CONNECTION'; exit 1 }
    $server.EndWaitForConnection($wait)
    $w = New-Object IO.StreamWriter($client)
    $w.AutoFlush = $true
    $w.WriteLine('LINE x')
    'GOT ' + (New-Object IO.StreamReader($server)).ReadLine()
    $rules = @($server.GetAccessControl().GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
    'DENY ' + @($rules | Where-Object { $_.AccessControlType -eq 'Deny' }).Count
    'ALLOW ' + ((@($rules | ForEach-Object { $_.IdentityReference.Value }) | Sort-Object -Unique) -join ',')
    $second = $null
    try { $second = New-GatePipe $name; 'SECOND MADE' } catch { 'SECOND REFUSED' } finally { if ($second) { $second.Dispose() } }
    $client.Dispose()
} finally { $server.Dispose() }
'@
    try {
        $head = "`$ErrorActionPreference = 'Stop'`r`n`$Cfg = @{ deploySid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }`r`n"
        [IO.File]::WriteAllText($pipeProbe, $head + $pipeBlock + $pipeRun)
        $said = @(& (Get-WindowsPowerShell) -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $pipeProbe 2>&1 | ForEach-Object { "$_" })
        $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $want = @('GOT LINE x', 'DENY 0', ('ALLOW ' + ((@('S-1-5-18', $me) | Sort-Object -Unique) -join ',')), 'SECOND REFUSED')
        Yes 'under Windows PowerShell 5.1 the pipe takes its account''s line, denies nothing, allows SYSTEM and that account, and holds its name' (($said -join ';') -eq ($want -join ';'))
        if (($said -join ';') -ne ($want -join ';')) { $said | Write-Host }
    } finally { Remove-Item -LiteralPath $pipeProbe -Force -ErrorAction SilentlyContinue }
}
Yes 'the broker puts the pinned GitHub CLI first on the verbs'' PATH' ($brokerCode.Contains("`$env:PATH = (Split-Path -Parent ([string]`$Cfg.gh)) + ';' + `$env:PATH"))
# Patrick's A, 30 Oct 2026: the verbs are main's own verbs.json, read from
# the checkout the broker has just fetched, so a merged verb needs no install.
# The line's shape is still checked before git is asked anything.
$shaped = $brokerCode.IndexOf('Split-ThornswoodGateLine $line')
$tested = $brokerCode.IndexOf('Test-ThornswoodGateRequest -Line $line')
Yes 'a line''s shape is checked before git is asked anything' ($shaped -gt 0 -and $shaped -lt $brokerCode.IndexOf('$commit = Update-Checkout'))
Yes 'every line goes through the rules after the fetch and before anything runs' ($tested -gt $brokerCode.IndexOf('$commit = Update-Checkout') -and $tested -lt $brokerCode.IndexOf('Invoke-Child ([string]$Cfg.pwsh)'))
Yes '  and the rules are main''s verbs.json in the fetched checkout, never anything sent or installed' ($brokerCode.Contains("`$verbsAt = Join-Path `$Repo 'scripts\vps\gate\verbs.json'") -and
    $brokerCode.Contains('Read-ThornswoodGateVerbs $verbsAt') -and -not $brokerCode.Contains("Read-ThornswoodGateVerbs (Join-Path `$Root 'verbs.json')"))
Yes '  and the installer no longer puts a verbs.json beside the broker, and takes an old one away' (
    (Text 'scripts/deploy/Install-Gate.ps1') -notmatch "\$Files = @\([^)]*verbs\.json" -and (Text 'scripts/deploy/Install-Gate.ps1').Contains('Remove-Item -LiteralPath (Join-Path `$root ''verbs.json'') -Force'))
Yes 'what runs is the tip of main: fetched into origin/main and checked out from it' (
    $brokerCode.Contains("'+refs/heads/main:refs/remotes/origin/main'") -and $brokerCode.Contains("'--detach', 'refs/remotes/origin/main'") -and $brokerCode.Contains("'clean', '-ffdxq'"))
Yes '  with the checkout''s origin set to gate.json''s remote first, and each fetched submodule pointed at main''s .gitmodules before it moves (#5184)' (
    $brokerCode.Contains("'remote', 'set-url', 'origin', ([string]`$Cfg.remote)") -and
    $brokerCode.IndexOf("'remote', 'set-url', 'origin'") -lt $brokerCode.IndexOf("'fetch', '--quiet'") -and
    $brokerCode.Contains("'submodule', 'sync', '--quiet'") -and
    $brokerCode.IndexOf("'submodule', 'sync'") -gt $brokerCode.IndexOf("'--detach', 'refs/remotes/origin/main'") -and
    $brokerCode.IndexOf("'submodule', 'sync'") -lt $brokerCode.IndexOf("'submodule', 'update'"))
Yes '  and each fetched submodule is brought to main''s pin after the checkout, never left at the old one' (
    $brokerCode.Contains("'submodule', 'update', '--checkout', '--force', '--depth', '1'") -and -not $brokerCode.Contains("'submodule', 'update', '--init'") -and
    $brokerCode.IndexOf("'submodule', 'update'") -gt $brokerCode.IndexOf("'--detach', 'refs/remotes/origin/main'"))
# The same steps, run with git on a checkout whose submodule main moved
# (31 Oct: the gate's engine\skymp stayed at b21c4eb9 when main pinned
# befb8364, and every verb's freshness check refused the checkout).
$gitExe = (Get-Command git -ErrorAction SilentlyContinue)
if (-not $gitExe) { Write-Host 'SKIP: the submodule move needs git' -ForegroundColor Yellow } else {
    $sm = Join-Path ([IO.Path]::GetTempPath()) ('tw-2841-sub-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $sm -Force | Out-Null
    function SmGit([string]$dir) { $a = @('-c', 'protocol.file.allow=always', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-C', $dir) + $args; $o = & git @a 2>&1; return [pscustomobject]@{ Code = $LASTEXITCODE; Out = @($o | ForEach-Object { [string]$_ }) } }
    try {
        $fork = Join-Path $sm 'fork'; $up = Join-Path $sm 'up'
        New-Item -ItemType Directory -Path $fork, $up -Force | Out-Null
        [void](SmGit $fork init -q); [void](SmGit $fork config uploadpack.allowAnySHA1InWant true)
        Set-Content -LiteralPath (Join-Path $fork 'a.txt') -Value 'one'; [void](SmGit $fork add -A); [void](SmGit $fork commit -qm one)
        $pinA = ((SmGit $fork rev-parse HEAD).Out -join '').Trim()
        [void](SmGit $up init -q); [void](SmGit $up submodule add -q $fork engine/skymp); [void](SmGit $up commit -qm pinA)
        $gate = Join-Path $sm 'gate'
        [void](SmGit $sm clone -q --depth 1 --no-tags --branch main ('file://' + $up.Replace('\', '/')) $gate)
        [void](SmGit $gate submodule update --init --depth 1)
        Set-Content -LiteralPath (Join-Path $fork 'a.txt') -Value 'two'; [void](SmGit $fork commit -qam two)
        $pinB = ((SmGit $fork rev-parse HEAD).Out -join '').Trim()
        [void](SmGit (Join-Path $up 'engine/skymp') fetch -q origin); [void](SmGit (Join-Path $up 'engine/skymp') checkout -q $pinB)
        [void](SmGit $up add engine/skymp); [void](SmGit $up commit -qm pinB)
        $steps = @(
            @('fetch', '--quiet', '--depth', '1', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'),
            @('checkout', '--quiet', '--force', '--detach', 'refs/remotes/origin/main'),
            @('clean', '-ffdxq'))
        foreach ($st in $steps) { [void](SmGit $gate @st) }
        $before = ((SmGit (Join-Path $gate 'engine/skymp') rev-parse HEAD).Out -join '').Trim()
        Yes '  (without the move, the submodule stays at the old pin, as the gate''s did)' ($before -eq $pinA -and $pinA -ne $pinB)
        $r = SmGit $gate submodule update --checkout --force --depth 1
        $after = ((SmGit (Join-Path $gate 'engine/skymp') rev-parse HEAD).Out -join '').Trim()
        $status = (SmGit $gate status --porcelain).Out -join ' '
        Yes '  the move takes the fetched submodule to the new pin, and leaves no change behind' ($r.Code -eq 0 -and $after -eq $pinB -and -not $status.Trim())
        # The fork moves (#5184): main's .gitmodules names its new address, and
        # sync points the fetched submodule there before it is moved.
        $moved = Join-Path $sm 'moved-fork'
        Copy-Item -LiteralPath $fork -Destination $moved -Recurse
        Set-Content -LiteralPath (Join-Path $moved 'a.txt') -Value 'three'; [void](SmGit $moved commit -qam three)
        $pinC = ((SmGit $moved rev-parse HEAD).Out -join '').Trim()
        [void](SmGit $up config -f .gitmodules submodule.engine/skymp.url $moved)
        [void](SmGit $up submodule sync -q); [void](SmGit (Join-Path $up 'engine/skymp') fetch -q origin); [void](SmGit (Join-Path $up 'engine/skymp') checkout -q $pinC)
        [void](SmGit $up add .gitmodules engine/skymp); [void](SmGit $up commit -qm moved)
        foreach ($st in $steps) { [void](SmGit $gate @st) }
        $sync = SmGit $gate submodule sync --quiet
        $r3 = SmGit $gate submodule update --checkout --force --depth 1
        $url = ((SmGit (Join-Path $gate 'engine/skymp') remote get-url origin).Out -join '').Trim()
        $at = ((SmGit (Join-Path $gate 'engine/skymp') rev-parse HEAD).Out -join '').Trim()
        Yes '  a fork that moved is fetched from its new address, at the new pin' ($pinC -ne $pinB -and $sync.Code -eq 0 -and $r3.Code -eq 0 -and $url -eq $moved -and $at -eq $pinC)
        $bare = Join-Path $sm 'gate2'
        [void](SmGit $sm clone -q --depth 1 --no-tags --branch main ('file://' + $up.Replace('\', '/')) $bare)
        $r2 = SmGit $bare submodule update --checkout --force --depth 1
        Yes '  and a submodule never fetched stays unfetched' ($r2.Code -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $bare 'engine/skymp/a.txt')))
    } finally { Remove-Item -LiteralPath $sm -Recurse -Force -ErrorAction SilentlyContinue }
}
Yes 'a live verb runs only when main is at the build it named, checked after the fetch' ($brokerCode.Contains('if ($req.Build -and $req.Build -cne $commit)') -and
    $brokerCode.IndexOf('if ($req.Build -and $req.Build -cne $commit)') -gt $brokerCode.IndexOf('$commit = Update-Checkout') -and
    $brokerCode.IndexOf('if ($req.Build -and $req.Build -cne $commit)') -lt $brokerCode.IndexOf('Invoke-Child ([string]$Cfg.pwsh)'))
Yes 'the script is the verb''s from verbs.json, under the checkout' ($brokerCode.Contains('Join-Path $Repo ($req.Script.Replace(''/'', ''\'')'))
Yes 'the program starts with no shell, and nothing on its input' ($brokerCode.Contains('$si.UseShellExecute = $false') -and $brokerCode.Contains('$p.StandardInput.Close()') -and $brokerCode -notmatch 'Invoke-Expression|\biex\b|cmd(\.exe)? /c')
Yes 'a run past its time is ended with everything it started' ($brokerCode.Contains('taskkill.exe" @(''/T'', ''/F'', ''/PID'''))
Yes 'git reads with the deploy key and pinned host keys only' ($brokerCode.Contains('-F none -i') -and $brokerCode.Contains('StrictHostKeyChecking=yes') -and $brokerCode.Contains('github_known_hosts'))
Yes 'every request is logged, refusals too' ($brokerCode.Contains("Log ('REFUSED [") -and $brokerCode.Contains("Log ('START ") -and $brokerCode.Contains("Log ('END "))

# ---- 6. the installer ----------------------------------------------------------
$inst = Text 'scripts/deploy/Install-Gate.ps1'
$du = [regex]::Match($inst, "(?m)^\`$DeployUser\s*=\s*'([^']+)'").Groups[1].Value
Yes "the account's name fits the 20 characters a local account may have (found '$du')" ($du.Length -ge 1 -and $du.Length -le 20)
Yes 'the account is made in no group, and taken out of any it is in' ($inst.Contains('New-LocalUser -Name `$user') -and $inst.Contains('Remove-LocalGroupMember') -and $inst -notmatch 'Add-LocalGroupMember')
Yes 'its .ssh and authorized_keys: only SYSTEM and Administrators change them, it reads them' (
    $inst.Contains('foreach (`$s in ''S-1-5-18'', ''S-1-5-32-544'')') -and $inst.Contains('SecurityIdentifier(`$sid)), ''ReadAndExecute''') -and $inst.Contains('SetAccessRuleProtection(`$true, `$false)'))
Yes 'it may read Gate.ps1, and no other file of the gate is given to it' (@([regex]::Matches($inst, [regex]::Escape('SecurityIdentifier(`$sid)), ''ReadAndExecute'''))).Count -eq 2 -and $inst.Contains('`$gate = Join-Path `$root ''Gate.ps1'''))
Yes 'the gate''s folder is locked to SYSTEM and Administrators' ($inst.Contains('Lock-ThornswoodFolder -Path `$root -Only'))
Yes 'the files go up from HEAD, and uncommitted changes stop it' ($inst.Contains("'cat-file', 'blob', `"HEAD:`$f`"") -and $inst.Contains('status --porcelain -- $Files'))
Yes 'the GitHub key goes on read only' ($inst.Contains('read_only = $true') -and $inst -notmatch 'read_only = \$false')
Yes 'the gate''s admin key is taken only from 127.0.0.1' ($inst.Contains('`$want = ''from="127.0.0.1" '' + `$bare + '' thornswood-gate'''))
Yes 'the box''s host keys are held to vps.json''s pins' ($inst.Contains('Get-ThornswoodVpsHostKeys') -and $inst.Contains('`$pins -contains `$fp'))
Yes 'the task runs the installed broker, not anything in the checkout' ($inst.Contains('(Join-Path `$root ''GateBroker.ps1'')'))

# The box's host keys are fingerprinted in the script, never by ssh-keygen -l:
# on 29 Oct the box's OpenSSH refused its old DSA key file, and what it wrote
# to stderr stopped the install under 'Stop' in Windows PowerShell 5.1. The
# block runs here against a folder holding GitHub's published ed25519 host key
# (SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU), a DSA key and a file
# that is not a key.
Yes 'no ssh-keygen -l on the box' ($inst -notmatch 'keygen\s+-l')
Yes 'ssh-keygen''s stderr cannot stop the key making before the second way is tried' ([regex]::Match($inst, '(?s)function New-GateKey.*?\n\}').Value -match "ErrorActionPreference = 'Continue'")
$hostBlock = [regex]::Match($inst, "(?s)# ---- the box's own host keys.*?(?=\nif \(-not ``\`$lines\.Count\))").Value
Yes 'the host key block is found' ($hostBlock.Length -gt 0)
$keysDir = Join-Path ([IO.Path]::GetTempPath()) ('tw-2841-keys-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path (Join-Path $keysDir 'ssh') -Force | Out-Null
try {
    [IO.File]::WriteAllText((Join-Path $keysDir 'ssh/ssh_host_ed25519_key.pub'), "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl root@box`n")
    [IO.File]::WriteAllText((Join-Path $keysDir 'ssh/ssh_host_dsa_key.pub'), "ssh-dss AAAAB3NzaC1kc3MAAACBAP1/U4EddRIpUt9KnC7s5Of2EbdSPO9EAMMeP4C2USZpRV1AIlH7WT2NWPq/xfW6MPbLm1Vs14E7gB00b/JmYLdrmVClpJ+f6AR7ECLCT7up1/63xhv4O1fnxqimFQ8E+4P208UewwI1VBNaFpEy9nXzrith1yrv8iIDGZ3RSAHHAAAAFQCXYFCPFSMLzLKSuYKi64QL8Fgc9QAAAIEA9+GghdabPd7LvKtcNrhXuXmUr7v6OuqC+VdMCz0HgmdRWVeOutRZT+ZxBxCBgLRJFnEj6EwoFhO3zwkyjMim4TwWeotUfI0o4KOuHiuzpnWRbqN/C/ohNWLx+2J6ASQ7zKTxvqhRkImog9/hWuWfBpKLZl6Ae1UlZAFMO/7PSSo= root@box`n")
    [IO.File]::WriteAllText((Join-Path $keysDir 'ssh/ssh_host_bad_key.pub'), "not a key`n")
    $run = $hostBlock.Replace('`$', '$').Replace('@($pinned)', "@('SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU')").Replace('$Address', '192.0.2.1') + "`n" + '$lines'
    $oldPd = $env:ProgramData; $env:ProgramData = $keysDir
    $ErrorActionPreference = 'Stop'
    $got = @(& ([scriptblock]::Create($run)))
    $env:ProgramData = $oldPd
    Yes "the pinned ed25519 key is found by its fingerprint, past a DSA key and a file that is not a key (got $($got.Count))" ($got.Count -eq 1 -and $got[0] -eq '192.0.2.1 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl')
}
catch { $env:ProgramData = $oldPd; Yes ('the host key block runs: ' + $_.Exception.Message) $false }
finally { Remove-Item -LiteralPath $keysDir -Recurse -Force -ErrorAction SilentlyContinue }

# The broker runs under Windows PowerShell 5.1 too: every short program whose
# stderr it reads goes through Invoke-Short, which holds 'Continue' for itself.
$bk = Text 'scripts/vps/gate/GateBroker.ps1'
$shortFn = [regex]::Match($bk, '(?s)function Invoke-Short.*?\n\}').Value
Yes 'the broker''s short programs run with stderr unable to stop it' ($shortFn -match "ErrorActionPreference = 'Continue'" -and @([regex]::Matches($bk, '2>&1')).Count -eq 1 -and $bk -notmatch '2>\$null')

# ---- 7. Grant-BoxAccess -Deploy ------------------------------------------------
Invoke-Expression (Import-Functions 'scripts/vps/Grant-BoxAccess.ps1' @('Get-BoxKeyLine', 'Read-BoxKeyLine'))
$GateScript = 'C:\Thornswood-Gate\Gate.ps1'
$SayStaff = 'C:\Thornswood-Watch\say-staff.ps1'
$bare = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKk0ZXN0a2V5Zm9ydGhlZ2F0ZXRlc3QwMDAwMDAwMDAw'
$line = Get-BoxKeyLine $bare 'desk' $false $true
Yes 'a deploy key''s line: from the box only, restricted, forced to Gate.ps1' ($line -eq ('from="127.0.0.1",restrict,command="pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\Thornswood-Gate\Gate.ps1" ' + $bare + ' thornswood-desk'))
$parts = Read-BoxKeyLine $line
Yes '  and its reader sees the bridge and the gate in it, and no notices command' ($parts.Bridge -and $parts.Gate -and -not $parts.Notices -and $parts.Key -eq $bare)
Yes 'a plain key''s line is unchanged' ((Get-BoxKeyLine $bare 'one' $false) -eq ('from="127.0.0.1" ' + $bare + ' thornswood-one'))
Yes 'a notices key''s line is forced to say-staff.ps1 through pwsh' ((Get-BoxKeyLine $bare 'claude' $true) -like 'from="127.0.0.1",restrict,command="pwsh * -File C:\Thornswood-Watch\say-staff.ps1 -From claude" *')
$grant = Text 'scripts/vps/Grant-BoxAccess.ps1'
Yes 'a deploy key goes into the gate account''s authorized_keys, and stops without the account' ($grant.Contains("Run scripts\deploy\Install-Gate.ps1 first") -and $grant.Contains("ProfileImagePath '.ssh\authorized_keys'"))
Yes 'its proof needs a refused command and GATE READY' ($grant.Contains("@('echo THORNSWOOD_OK', 'ping')") -and $grant.Contains("'^\| GATE READY'") -and $grant.Contains('($NoticesOnly -or $Deploy) -and @($proof | Where-Object { $_ -match ''THORNSWOOD_OK'' }).Count'))
Yes 'it goes into DESK_KEY_B64 of a main-only environment' ($grant.Contains("if (`$Deploy) { 'DESK_KEY_B64' }") -and $grant.Contains('gh secret set $SecretName --env $ToEnvironment'))

# ShipAccess.ps1 against a stand-in ship-access.js, run by the real node.
if (Get-Command node -ErrorAction SilentlyContinue) {
    . (Join-Path $Repo 'scripts/vps/admin/ShipAccess.ps1')
    $fake = Join-Path ([IO.Path]::GetTempPath()) ('tw-2841-access-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path ([IO.Path]::Combine($fake, 'scripts', 'vps', 'admin')) -Force | Out-Null
    [IO.File]::WriteAllText([IO.Path]::Combine($fake, 'scripts', 'vps', 'admin', 'ship-access.js'), @'
const c = process.env.TW_FAKE_ACCESS;
if (c === 'long') { process.stdout.write('ghs_' + 'A1.b-'.repeat(60) + '\n'); }
else if (c === 'refused') { process.stderr.write('ship-access: GitHub gave the App no token (HTTP 403: no)\n'); process.exit(1); }
else if (c === 'silent') { process.exit(3); }
else if (c === 'nothing') { }
'@)
    function Try-Access([string]$case) {
        $env:TW_FAKE_ACCESS = $case
        try { return @{ Token = (Get-ThornswoodShipAccess -Repo $fake -AdminState $fake); Why = '' } }
        catch { return @{ Token = $null; Why = $_.Exception.Message } }
        finally { Remove-Item -LiteralPath Env:\TW_FAKE_ACCESS -ErrorAction SilentlyContinue }
    }
    $r = Try-Access 'long'
    Yes 'ShipAccess.ps1 takes the token by the stream it comes on, whatever its shape' ($r.Token -eq ('ghs_' + ('A1.b-' * 60)))
    $r = Try-Access 'refused'
    Yes '  a refusal throws with the exit code and what ship-access.js said' (-not $r.Token -and $r.Why -match '^ship-access\.js ended 1: ship-access: GitHub gave the App no token')
    $r = Try-Access 'silent'
    Yes '  an exit with nothing said throws saying so' ($r.Why -eq 'ship-access.js ended 3 and said nothing')
    $r = Try-Access 'nothing'
    Yes '  and an exit 0 with no token throws saying how many lines came' ($r.Why -match '^ship-access\.js ended 0 but printed 0 line')
    Remove-Item -LiteralPath $fake -Recurse -Force -ErrorAction SilentlyContinue
} else { Write-Host 'SKIP  ShipAccess.ps1 against a stand-in: there is no node here' }

# ---- 8. box-run.yml, in the ops repository (#4013) ---------------------------
Yes 'box-run.yml is not in this repository, which has no VPS runner once public' (-not (Test-Path -LiteralPath ([IO.Path]::Combine($Repo, '.github', 'workflows', 'box-run.yml'))))
$br = Text 'scripts/vps/Box-Run.ps1'
Yes '  Box-Run.ps1 starts it in the private ops repository, where the runners are registered' ($br.Contains("[string]`$GitHubRepo = 'ThornswoodRP/Thornswood-Ops'") -and $br.Contains("`$Workflow = 'box-run.yml'"))

# ---- 9. the seal, and the ssh it uses -------------------------------------------
. (Join-Path $Repo 'scripts/ops/Sealed.ps1')
$rsa = [Security.Cryptography.RSA]::Create(3072)
$other = [Security.Cryptography.RSA]::Create(3072)
$plain = [Text.Encoding]::UTF8.GetBytes('the servers'' logs ' + ('x' * 5000))
$sealed = Protect-ThornswoodSealed $plain ([Convert]::ToBase64String($rsa.ExportSubjectPublicKeyInfo()))
$back = Unprotect-ThornswoodSealed $sealed ([Convert]::ToBase64String($rsa.ExportPkcs8PrivateKey()))
Yes 'a sealed run opens with its own key to what went in' ([Convert]::ToBase64String($back) -eq [Convert]::ToBase64String($plain))
Yes '  and holds none of it in the clear' (-not ([Text.Encoding]::UTF8.GetString($sealed)).Contains('servers'))
$threw = $false; try { [void](Unprotect-ThornswoodSealed $sealed ([Convert]::ToBase64String($other.ExportPkcs8PrivateKey()))) } catch { $threw = $true }
Yes '  another key does not open it' $threw
$bent = [byte[]]$sealed.Clone(); $bent[$bent.Length - 3] = $bent[$bent.Length - 3] -bxor 1
$threw = $false; try { [void](Unprotect-ThornswoodSealed $bent ([Convert]::ToBase64String($rsa.ExportPkcs8PrivateKey()))) } catch { $threw = $true }
Yes '  and a changed byte is refused' $threw
# Through the run's log, with a stand-in gh serving one job and its log.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-2841-seal-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$sealedPath = Join-Path $tmp 'box-run.sealed'
[IO.File]::WriteAllBytes($sealedPath, $sealed)
$written = @(Write-ThornswoodSealedLog $sealedPath 6>&1 | ForEach-Object { "$_" })
Yes 'the runner writes the sealed file into its log as TWSEAL-LOG lines of 2000 characters' ($written.Count -ge 3 -and @($written | Where-Object { $_ -notmatch '^TWSEAL-LOG ' }).Count -eq 0 -and $written[0].Length -eq ('TWSEAL-LOG 1 '.Length + 2000))
Yes '  and ends them with the count and the sha256' ($written[-1] -match ('^TWSEAL-LOG END ' + ($written.Count - 1) + ' [0-9a-f]{64}$'))
Yes '  and with no sealed file writes only TWSEAL-LOG NONE' ((@(Write-ThornswoodSealedLog (Join-Path $tmp 'none.sealed') 6>&1 | ForEach-Object { "$_" }) -join '|') -eq 'TWSEAL-LOG NONE')
$script:fakeLog = @("$([char]0xFEFF)2026-10-31T04:00:00.0000000Z Current runner version: '2.338.0'", '2026-10-31T04:00:01.0000000Z | GATE Ship-Dev exit 0') + @($written | ForEach-Object { '2026-10-31T04:00:02.0000000Z ' + $_ })
function gh {
    $global:LASTEXITCODE = 0
    if ("$args" -match '/runs/\d+/jobs') { return '7' }
    if ("$args" -match '/jobs/7/logs') { return $script:fakeLog }
    $global:LASTEXITCODE = 1; return 'HTTP 404'
}
$l = Read-ThornswoodSealedLog 'o/r' 1
Yes 'the session reads the sealed bytes back from the log' ($l.Bytes -and [Convert]::ToBase64String($l.Bytes) -eq [Convert]::ToBase64String($sealed))
$keyPath = Join-Path $tmp 'run.key'
[IO.File]::WriteAllText($keyPath, [Convert]::ToBase64String($rsa.ExportPkcs8PrivateKey()))
$saved = Join-Path $tmp 'save'
New-Item -ItemType Directory -Path (Join-Path $saved 'files') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $saved 'output.txt'), 'the verb said this')
[IO.File]::WriteAllText((Join-Path (Join-Path $saved 'files') 'a.log'), 'a server log')
[void](Save-ThornswoodSealed $saved ([Convert]::ToBase64String($rsa.ExportSubjectPublicKeyInfo())) $sealedPath)
$written = @(Write-ThornswoodSealedLog $sealedPath 6>&1 | ForEach-Object { "$_" })
$script:fakeLog = @($written | ForEach-Object { '2026-10-31T04:00:02.0000000Z ' + $_ })
$into = Join-Path $tmp 'opened'
$o = Open-ThornswoodSealedRun -Repo 'o/r' -Run 1 -Artifact 'box-run-sealed' -File 'box-run.sealed' -KeyPath $keyPath -Into $into -FromLog
Yes '  and -FromLog opens it to the output and the files' ($o.Ok -and ([IO.File]::ReadAllText((Join-Path $into 'output.txt'))) -eq 'the verb said this' -and (Test-Path -LiteralPath (Join-Path (Join-Path $into 'files') 'a.log')))
$script:fakeLog = @($written | Where-Object { $_ -notmatch '^TWSEAL-LOG 1 ' } | ForEach-Object { '2026-10-31T04:00:02.0000000Z ' + $_ })
$l = Read-ThornswoodSealedLog 'o/r' 1
Yes '  a part missing from the log is refused' (-not $l.Bytes -and $l.Why -match 'lacks 1')
$script:fakeLog = @($written | ForEach-Object { '2026-10-31T04:00:02.0000000Z ' + $_ })
$p1 = $script:fakeLog[0]; $at = $p1.Length - 5
$script:fakeLog[0] = $p1.Substring(0, $at) + $(if ($p1[$at] -eq 'A') { 'B' } else { 'A' }) + $p1.Substring($at + 1)
$l = Read-ThornswoodSealedLog 'o/r' 1
Yes '  a changed part is refused by the sha256' (-not $l.Bytes -and $l.Why -match 'sha256')
$script:fakeLog = @('2026-10-31T04:00:02.0000000Z TWSEAL-LOG NONE')
$l = Read-ThornswoodSealedLog 'o/r' 1
Yes '  and a run that wrote none says so' (-not $l.Bytes -and $l.Why -eq 'the run wrote no sealed output')
Remove-Item -LiteralPath function:\gh
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
$br = Text 'scripts/vps/Box-Run.ps1'
Yes 'Box-Run.ps1 reads its sealed output from the run''s log, not an artifact' ($br.Contains("-KeyPath `$keyPath -Into `$dir -FromLog"))

$small = [Security.Cryptography.RSA]::Create(2048)
$threw = $false; try { [void](Protect-ThornswoodSealed $plain ([Convert]::ToBase64String($small.ExportSubjectPublicKeyInfo()))) } catch { $threw = $true }
Yes '  a recipient key under 3072 bits is refused' $threw
$br = Text 'scripts/vps/Box-Run.ps1'
Yes 'the box half uses the Microsoft-signed ssh.exe by its full path' ($br.Contains("& `$sshExe @sshArgs (`$GateUser + '@127.0.0.1') `$GateLine") -and $br.Contains('Get-AuthenticodeSignature') -and $br.Contains("O=Microsoft Corporation"))
# The gate follows main (#5178): the broker's ping names the copies of its
# three files it runs, and Box-Run sends Update-Gate before any verb when they
# are not main's, so a merged gate fix needs nobody on One.
$fdir = Join-Path ([IO.Path]::GetTempPath()) ('gate-files-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fdir 'lf'), (Join-Path $fdir 'crlf') | Out-Null
foreach ($n in 'Gate.ps1', 'GateBroker.ps1', 'GateRules.ps1') {
    [IO.File]::WriteAllText((Join-Path $fdir "lf/$n"), "line one`nline two $n`n")
    [IO.File]::WriteAllText((Join-Path $fdir "crlf/$n"), "line one`r`nline two $n`r`n")
}
$lfLine = Get-ThornswoodGateFileLine (Join-Path $fdir 'lf')
Yes 'the gate''s file line names all three files with a sha256 each' ($lfLine -match '^Gate\.ps1=[0-9a-f]{64} GateBroker\.ps1=[0-9a-f]{64} GateRules\.ps1=[0-9a-f]{64}$')
Yes '  a CRLF checkout and an LF one give the same line' ($lfLine -ceq (Get-ThornswoodGateFileLine (Join-Path $fdir 'crlf')))
[IO.File]::WriteAllText((Join-Path $fdir 'crlf/GateRules.ps1'), "line one`nline three`n")
Yes '  a changed file changes it' ($lfLine -cne (Get-ThornswoodGateFileLine (Join-Path $fdir 'crlf')))
Remove-Item -LiteralPath (Join-Path $fdir 'crlf/Gate.ps1')
Yes '  and a missing one is none' ((Get-ThornswoodGateFileLine (Join-Path $fdir 'crlf')) -match '^Gate\.ps1=none ')
Remove-Item -LiteralPath $fdir -Recurse -Force
$gb = Text 'scripts/vps/gate/GateBroker.ps1'
Yes 'the broker''s ping prints the line for the copies it runs from' ($gb.Contains("Send ('| GATE FILES ' + (Get-ThornswoodGateFileLine `$Root))") -and $gb.IndexOf('GATE FILES') -lt $gb.IndexOf("Log 'PING'"))
$pi = $br.IndexOf("Invoke-GateLine 'ping'"); $ui = $br.IndexOf("Invoke-GateLine 'Update-Gate'"); $li = $br.IndexOf('Invoke-GateLine $Line')
Yes 'Box-Run pings, then sends Update-Gate when the copies are not main''s, then the verb' ($pi -gt 0 -and $ui -gt $pi -and $li -gt $ui -and
    $br.Contains("Get-ThornswoodGateFileLine (Join-Path `$Here 'gate')") -and $br.Contains('if ($have -ne $want)'))
Yes '  never for ping or Update-Gate itself, and it sends no verb when the gate is still behind after one Update-Gate' (
    $br.Contains("if (`$req.Verb -cne 'ping' -and `$req.Verb -cne 'Update-Gate')") -and $br.Contains('if (-not $refused) {') -and
    ([regex]::Matches($br, "Invoke-GateLine 'Update-Gate'")).Count -eq 1)
# Update-Gate (#5178): main's three files go into the installed ones, which
# keep their access lists, the old copies are kept, and the broker hands
# over by itself once the request that changed its files has answered.
$ug = Join-Path $Repo 'scripts/vps/gate/Update-Gate.ps1'
$groot = Join-Path ([IO.Path]::GetTempPath()) ('update-gate-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $groot | Out-Null
foreach ($n in 'Gate.ps1', 'GateBroker.ps1', 'GateRules.ps1') { [IO.File]::WriteAllText((Join-Path $groot $n), "# the old $n`n") }
[IO.File]::WriteAllText((Join-Path $groot 'gate.json'), '{"commit":"' + ('0' * 40) + '","git":"git"}')
$o = & pwsh -NoProfile -File $ug -Root $groot -NoRestart 2>&1 | Out-String
$head = (& git -C $Repo rev-parse HEAD).Trim()
Yes 'Update-Gate puts main''s three files in place and records main''s commit' ($LASTEXITCODE -eq 0 -and $o -match 'CHANGED Gate\.ps1, GateBroker\.ps1, GateRules\.ps1' -and
    (Get-ThornswoodGateFileLine $groot) -ceq (Get-ThornswoodGateFileLine (Join-Path $Repo 'scripts/vps/gate')) -and
    ([IO.File]::ReadAllText((Join-Path $groot 'gate.json')) | ConvertFrom-Json).commit -eq $head)
$kept = @(Get-ChildItem -LiteralPath (Join-Path $groot 'update') -Directory)
Yes '  and keeps the files it replaced' ($kept.Count -eq 1 -and [IO.File]::ReadAllText((Join-Path $kept[0].FullName 'Gate.ps1')) -eq "# the old Gate.ps1`n")
$o = & pwsh -NoProfile -File $ug -Root $groot -NoRestart 2>&1 | Out-String
Yes '  a second run changes nothing' ($LASTEXITCODE -eq 0 -and $o -match 'ALREADY')
# The repository's name (#5184): when GitHub names it differently, the
# remote takes the new name; when GitHub cannot be asked, it stays.
$cfgAt = Join-Path $groot 'gate.json'
[IO.File]::WriteAllText($cfgAt, '{"commit":"' + $head + '","git":"git","remote":"ssh://git@ssh.github.com:443/EvilPatrick06/Thornswood.git"}')
$o = & pwsh -NoProfile -File $ug -Root $groot -NoRestart -FullName 'ThornswoodRP/Thornswood' 2>&1 | Out-String
Yes '  a repository GitHub names differently now goes into gate.json''s remote' ($LASTEXITCODE -eq 0 -and $o -match "CHANGED the gate's remote from ssh://git@ssh\.github\.com:443/EvilPatrick06/Thornswood\.git to ssh://git@ssh\.github\.com:443/ThornswoodRP/Thornswood\.git" -and
    ([IO.File]::ReadAllText($cfgAt) | ConvertFrom-Json).remote -ceq 'ssh://git@ssh.github.com:443/ThornswoodRP/Thornswood.git')
$o = & pwsh -NoProfile -File $ug -Root $groot -NoRestart -FullName 'ThornswoodRP/Thornswood' 2>&1 | Out-String
Yes '  and once it has, the next run changes nothing' ($LASTEXITCODE -eq 0 -and $o -match 'ALREADY' -and $o -match 'the repository is ThornswoodRP/Thornswood, as GitHub names it')
$o = & pwsh -NoProfile -File $ug -Root $groot -NoRestart -FullName 'not a name' 2>&1 | Out-String
Yes '  an answer that is not owner/name changes nothing' ($LASTEXITCODE -eq 0 -and $o -match 'ALREADY' -and $o -match 'not owner/name' -and
    ([IO.File]::ReadAllText($cfgAt) | ConvertFrom-Json).remote -ceq 'ssh://git@ssh.github.com:443/ThornswoodRP/Thornswood.git')
$o = & pwsh -NoProfile -File $ug -Root $groot 2>&1 | Out-String
Yes '  outside the gate it refuses' ($LASTEXITCODE -eq 1 -and $o -match 'Nothing was changed')
Remove-Item -LiteralPath $groot -Recurse -Force
$ugt = Text 'scripts/vps/gate/Update-Gate.ps1'
Yes '  each new file must parse first, and the old ones go back when the new broker does not start' ($ugt.Contains('[Management.Automation.Language.Parser]::ParseFile($src') -and
    $ugt.Contains("did not start, so the files it replaced were put back from") -and $ugt.Contains("[IO.FileMode]::Truncate"))
Yes '  its restart task starts at once and waits for the broker to end, never for a set time' ($ugt.Contains("Start-ScheduledTask -TaskName 'Thornswood Gate Update'") -and
    $ugt -notmatch 'New-ScheduledTaskTrigger' -and $ugt -notmatch 'Start-Sleep -Seconds 3')
Yes 'the broker ends once a request has changed its files on disk, without opening the pipe again' ($gb.Contains('$StartedOn = Get-ThornswoodGateFileLine $Root') -and
    $gb.Contains("Log ('BROKER handing over: its files on disk are now ' + `$onDisk); break") -and $gb.IndexOf('BROKER handing over') -gt $gb.IndexOf('$pipe.Dispose()'))
Yes 'Update-Gate is a verb that takes nothing' ((Words 'Update-Gate') -eq '' -and (Words 'Update-Gate -Root x') -eq 'REFUSED' -and (Words 'Update-Gate -NoRestart') -eq 'REFUSED' -and (Words 'Update-Gate -FullName x/y') -eq 'REFUSED')
Yes '  with the host keys held to the checkout''s pins, in a known_hosts of the run''s own' ($br.Contains('Get-ThornswoodVpsCommitted') -and $br.Contains("UserKnownHostsFile=`$knownHosts") -and $br.Contains("'-F', 'none'"))
Yes '  and prints none of the verb''s output into the run''s log' ($br -notmatch 'Write-Host \$Matches\[1\]' -and $br.Contains("[IO.File]::AppendAllText(`$out, `$Matches[1]"))

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
