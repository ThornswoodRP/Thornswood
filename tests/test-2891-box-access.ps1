<#
  test-2891-box-access.ps1

      pwsh -NoProfile -File .\tests\test-2891-box-access.ps1

  Each person and machine reaches the box through the bridge with a key and a
  token of their own (#2891). This holds the PowerShell half of that:
  Grant-BoxAccess.ps1 (issues and takes away one name at a time, on One),
  Setup-SshKey.ps1 (a PC's end) and the bridge functions in Vps.ps1.
  tests\test-2753-box-bridge.js runs bridge.js and connect.js themselves.

  WHAT IT HOLDS THEM TO.
    1. Each parses, and each script Grant-BoxAccess.ps1 sends to the box,
       built the way it builds them, parses too.
    2. The box change, run here against a scratch key file and token folder
       with stand-ins for the task cmdlets: it saves both and arms the put
       back before it changes anything; a grant replaces that name's line and
       any line holding the same key under another comment, and writes the
       digest; a removal takes that name's alone; every other key and token
       stays; the put back puts both back as they were and removes its
       copy; an armed put back from an earlier run, or no bridge, stops it
       with nothing changed. The copy's folder is locked to SYSTEM and
       Administrators while it is empty, before anything goes in it (#3034):
       on Windows the real lock runs and its rules are read back, elsewhere
       a stand-in says when it was called.
    3. A key line is found in a pasted Discord message, a code block and a
       line a narrow window wrapped, and nothing is found in what is not one.
    4. The digest is the SHA-256 bridge.js computes, in hex, and a token is
       43 characters bridge.js and Setup-SshKey.ps1 take.
    5. Set-ThornswoodBridgeSsh against a scratch config: the block goes first
       with the ProxyCommand, a second run replaces it, -Direct leaves the
       ProxyCommand out, and ssh itself reads the file it writes (ssh -G),
       taking the block's values over a Host entry for the same address
       further down that it did not write and leaves alone.
    6. Write-ThornswoodPrivateFile leaves a file only this account can read.
    7. The order and the secrets: the token never goes to the box (only its
       digest), is never printed, and the change is kept only after a new
       login; Setup-SshKey.ps1 reads the token where nothing shows it.
  Nothing connects anywhere and nothing outside the temp folder is touched.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function P([string[]]$parts) { return [IO.Path]::Combine([string[]](@($repo) + $parts)) }
function Text([string]$p) { return [IO.File]::ReadAllText($p) }
function ParseErrors([string]$code) {
    $e = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$null, [ref]$e)
    return @($e)
}

$grantPath = P 'scripts', 'vps', 'Grant-BoxAccess.ps1'
$setupPath = P 'scripts', 'vps', 'Setup-SshKey.ps1'
$grant = Text $grantPath
$setup = Text $setupPath
. (P 'scripts', 'vps', 'Vps.ps1')
. (P 'scripts', 'vps', 'Lock-Folder.ps1')
. (Join-Path $PSScriptRoot 'Windows.ps1')

# ---- 1. they parse ----------------------------------------------------------
$e = $null
$gast = [System.Management.Automation.Language.Parser]::ParseFile($grantPath, [ref]$null, [ref]$e)
Yes 'Grant-BoxAccess.ps1 parses' (@($e).Count -eq 0)
$e = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($setupPath, [ref]$null, [ref]$e)
Yes 'Setup-SshKey.ps1 parses' (@($e).Count -eq 0)

# The functions that build what goes to the box, defined from the script's
# own text, with the values the script gives them.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-2891-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$BridgeRoot = Join-Path $tmp 'bridge'
$PutBack = 'Thornswood box access put back'
foreach ($n in 'Get-BoxChangeScript', 'Get-BoxKeepScript', 'Get-BoxListScript', 'Find-PublicKeyLine') {
    $fn = @($gast.FindAll({ param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n }, $true))
    Yes ("Grant-BoxAccess.ps1 has one $n") ($fn.Count -eq 1)
    Invoke-Expression $fn[0].Extent.Text
}
$pubA = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGRZxJ2G1nGDrjqLMTed+Bui13icdTMAODXpx0ZQd55T'
$blobA = ($pubA -split ' ')[1]
$built = @(
    (Get-BoxChangeScript 'djinn' ('a' * 64) ('from="127.0.0.1" ' + $pubA + ' thornswood-djinn') $blobA),
    (Get-BoxChangeScript 'djinn' '' '' ''),
    (Get-BoxKeepScript),
    (Get-BoxListScript)
)
$bad = @()
foreach ($b in $built) { $errs = @(ParseErrors $b); if ($errs.Count) { $bad += $errs[0].Message } }
Yes ('every script Grant-BoxAccess.ps1 sends parses once built' + $(if ($bad.Count) { ': ' + ($bad -join '; ') })) ($bad.Count -eq 0)
$back = [regex]::Match($built[0], "(?s)\`$back = @'\r?\n(.*?)\r?\n'@").Groups[1].Value
$joined = (@($back -split '\r?\n' | Where-Object { $_.Trim() }) -join '; ')
Yes '  and so does the put back, joined into the one -Command the task runs' ($back -and (@(ParseErrors $joined).Count -eq 0))
Yes 'the put back runs once, inline, and removes itself (#2612)' ($back -notmatch '"' -and $back.Contains("Unregister-ScheduledTask -TaskName '" + $PutBack + "'") -and
    $built[0].Contains("-Argument ('-NoProfile -Command") -and $built[0] -notmatch '-Argument [^\r\n]*-File' -and $built[0] -notmatch '-Daily|-Weekly|-AtStartup|-AtLogOn|RepetitionInterval')

# ---- 2. the box change, against a scratch box ----------------------------------
$keys = Join-Path $tmp 'administrators_authorized_keys'
$save = Join-Path $tmp 'box-access-before'
$tokens = Join-Path $BridgeRoot 'tokens'
# Stand-ins for what touches Windows' task scheduler and icacls, defined in
# front of the script so its calls find them first.
$stubs = @'
function Get-ScheduledTask { param($TaskName, $EA, $ErrorAction) if ($global:Armed) { 'a task' } }
function New-ScheduledTaskAction { param($Execute, $Argument) $global:PutBackExe = $Execute; $global:PutBackArg = $Argument; 'action' }
function New-ScheduledTaskTrigger { param([switch]$Once, $At) 'trigger' }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) 'principal' }
function Register-ScheduledTask { param($TaskName, $Action, $Trigger, $Principal, [switch]$Force) $global:Armed = $true; 'registered' }
function Unregister-ScheduledTask { param($TaskName, $Confirm, $EA, $ErrorAction) $global:Armed = $false }
function icacls { }
'@
# Off Windows there is no ACL to set: the lock the box script carries is
# renamed out of the way and this one says when it was called.
if (-not $OnWindows) {
    $stubs += @'

function Lock-ThornswoodFolder { param([string]$Path, [switch]$Only) $global:Locked = @{ Path = $Path; Only = [bool]$Only; Empty = (@(Get-ChildItem -LiteralPath $Path -Force).Count -eq 0) } }
'@
}
# Where the box keeps the pwsh its tasks run.
$boxPwsh = 'C:\Program Files\PowerShell\7\pwsh.exe'
if ($OnWindows) { $boxPwsh = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe' }
function OnScratch([string]$script) {
    $s = $script.Replace('C:\ProgramData\ssh\administrators_authorized_keys', $keys).Replace('C:\ProgramData\ssh\box-access-before', $save)
    # On the box a STOP ends its pwsh; here, run in this one, it ends the
    # script block, so the harness goes on.
    $s = $s.Replace('; exit 1 }', '; return }')
    if (-not $OnWindows) {
        $s = $s.Replace('function Lock-ThornswoodFolder {', 'function Lock-ThornswoodFolder-OnTheBox {')
        # The put back's task names the box's pwsh under Program Files, which
        # off Windows no variable names, so it is named as the box has it.
        $s = $s.Replace("(Join-Path `$env:ProgramFiles 'PowerShell\7\pwsh.exe')", "'" + $boxPwsh + "'")
    }
    return ($stubs + "`n" + $s)
}
function RunBox([string]$script) {
    $out = @(& ([scriptblock]::Create((OnScratch $script))) 2>&1 | ForEach-Object { "$_" })
    return $out
}
function Fresh {
    Remove-Item -LiteralPath $BridgeRoot, $save -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $tokens -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $BridgeRoot 'bridge.js'), '// stand-in')
    [IO.File]::WriteAllText((Join-Path $tokens 'cloud'), ('c' * 64))
    [IO.File]::WriteAllLines($keys, [string[]]@(
        ($pubA + ' thornswood'),
        'from="127.0.0.1" ssh-ed25519 AAAAcloudkey thornswood-cloud',
        'from="127.0.0.1" ssh-ed25519 AAAAolddjinn thornswood-djinn',
        'ssh-rsa AAAAsomebody someone-else'))
    $global:Armed = $false
}
function Lines { return @([IO.File]::ReadAllLines($keys)) }
function Names { return @(Get-ChildItem -LiteralPath $tokens -File | ForEach-Object { $_.Name } | Sort-Object) }

try {
    Fresh
    $pubB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINewDjinnKeyInHereOnlyForTheHarnessAAAAAAAAAAAAA'
    $digest = 'd' * 64
    $out = RunBox (Get-BoxChangeScript 'djinn' $digest ('from="127.0.0.1" ' + $pubB + ' thornswood-djinn') (($pubB -split ' ')[1]))
    $after = Lines
    Yes 'a grant: ARMED, then CHANGED, then DONE' (($out -join '|') -match '^ARMED .*\|CHANGED djinn: 1 key line\(s\) taken off.*\|CHANGED now 4 key line\(s\), and tokens for: cloud, djinn\|DONE$')
    Yes '  the put back is armed before anything changed' ($global:Armed -and (Test-Path -LiteralPath (Join-Path $save 'keys')))
    if ($OnWindows) {
        $sacl = Get-Acl -LiteralPath $save
        $open = @($sacl.Access | Where-Object { @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-3-0') -contains $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value })
        $kacl = Get-Acl -LiteralPath (Join-Path $save 'keys')
        $kopen = @($kacl.Access | Where-Object { @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-3-0') -contains $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value })
        Yes '  the copy''s folder takes nothing from above and gives no broad group a rule, nor does the key file copied into it (#3034)' ($sacl.AreAccessRulesProtected -and -not $open.Count -and -not $kopen.Count)
    } else {
        Yes '  the copy''s folder is locked, -Only, while it is still empty (#3034)' ($global:Locked -and $global:Locked.Path -eq $save -and $global:Locked.Only -and $global:Locked.Empty)
    }
    Yes '  the old djinn line goes and the new one, only through the bridge, comes' ($after -contains ('from="127.0.0.1" ' + $pubB + ' thornswood-djinn') -and -not ($after -match 'AAAAolddjinn'))
    Yes '  every other key line stays as it was' ($after[0] -eq ($pubA + ' thornswood') -and $after[1] -match 'thornswood-cloud$' -and $after[2] -eq 'ssh-rsa AAAAsomebody someone-else' -and $after.Count -eq 4)
    Yes '  the digest is written under the name, and the cloud token stays' ((Text (Join-Path $tokens 'djinn')) -eq $digest -and (Text (Join-Path $tokens 'cloud')) -eq ('c' * 64))
    Yes '  the put back task runs the box''s PowerShell 7' ($global:PutBackExe -eq $boxPwsh)
    Yes '  the put back task carries its command inline' ($global:PutBackArg -match '^-NoProfile -Command ".*Unregister-ScheduledTask.*"$')

    # The put back, as the task would run it: the command out of its argument.
    $pb = [regex]::Match($global:PutBackArg, '^-NoProfile -Command "(.*)"$').Groups[1].Value
    $null = & ([scriptblock]::Create($stubs + "`n" + $pb))
    $back = Lines
    Yes 'the put back puts the key file back as it was' ($back.Count -eq 4 -and ($back -match 'AAAAolddjinn').Count -eq 1 -and -not ($back -match 'NewDjinn'))
    Yes '  and the tokens, and disarms itself' ((@(Names) -join ',') -eq 'cloud' -and -not $global:Armed)
    Yes '  and removes its copy, which nothing reads after it' (-not (Test-Path -LiteralPath $save))

    # A machine's own key under an older comment is replaced, not doubled.
    Fresh
    $null = RunBox (Get-BoxChangeScript 'one' ('e' * 64) ('from="127.0.0.1" ' + $pubA + ' thornswood-one') $blobA)
    $after = Lines
    Yes 'granting a key already on the box under another comment takes that line off' (@($after | Where-Object { $_.Contains($blobA) }).Count -eq 1 -and $after -contains ('from="127.0.0.1" ' + $pubA + ' thornswood-one'))

    # Taking one name away.
    Fresh
    $out = RunBox (Get-BoxChangeScript 'djinn' '' '' '')
    $after = Lines
    Yes 'a removal takes that name''s line and token, and nothing else' ($out -contains 'DONE' -and -not ($after -match 'thornswood-djinn') -and $after.Count -eq 3 -and (@(Names) -join ',') -eq 'cloud')

    # Refusals, each with nothing changed.
    Fresh
    $global:Armed = $true
    $before = (Lines) -join '|'
    $out = RunBox (Get-BoxChangeScript 'djinn' $digest ('from="127.0.0.1" ' + $pubB + ' thornswood-djinn') '')
    Yes 'an armed put back from an earlier run: STOP, nothing changed' (($out -join ' ') -match '^STOP the put back from an earlier run is still armed' -and ((Lines) -join '|') -eq $before -and (@(Names) -join ',') -eq 'cloud')
    Fresh
    Remove-Item -LiteralPath (Join-Path $BridgeRoot 'bridge.js')
    $out = RunBox (Get-BoxChangeScript 'djinn' $digest ('from="127.0.0.1" ' + $pubB + ' thornswood-djinn') '')
    Yes 'no bridge on the box: STOP, nothing changed' (($out -join ' ') -match '^STOP there is no bridge' -and ((Lines) -join '|') -eq $before -and -not $global:Armed)

    # The keep step, once a new login got in.
    Fresh
    $null = RunBox (Get-BoxChangeScript 'djinn' $digest ('from="127.0.0.1" ' + $pubB + ' thornswood-djinn') '')
    $out = RunBox (Get-BoxKeepScript)
    Yes 'keeping it cancels the put back and removes its copy' ($out -contains 'KEPT' -and -not $global:Armed -and -not (Test-Path -LiteralPath $save))

    # ---- 3. the key line --------------------------------------------------------
    Yes 'a key line is found on its own, without its comment' ((Find-PublicKeyLine ($pubA + ' thornswood')) -eq $pubA)
    Yes '  inside a Discord message with words and a code block around it' ((Find-PublicKeyLine ("here is mine`n``````" + "`n" + $pubA + ' thornswood' + "`n``````" + "`nthanks")) -eq $pubA)
    $wrapped = $pubA.Substring(0, 50) + "`n" + $pubA.Substring(50) + ' thornswood'
    Yes '  and wrapped over two lines by a narrow window' ((Find-PublicKeyLine $wrapped) -eq $pubA)
    Yes 'a cut key, or none, finds nothing' ((Find-PublicKeyLine ($pubA.Substring(0, 60))) -eq '' -and (Find-PublicKeyLine 'hello there') -eq '')

    # ---- 4. the token and its digest -------------------------------------------
    $tok = New-ThornswoodBridgeToken
    Yes 'a new token is 43 characters of base64url, which the checks take' ($tok.Length -eq 43 -and (Test-ThornswoodBridgeToken $tok) -and $tok -match '^[A-Za-z0-9_-]+$')
    Yes '  and a cut one is refused' (-not (Test-ThornswoodBridgeToken $tok.Substring(0, 20)) -and -not (Test-ThornswoodBridgeToken ($tok + ' ')))
    if (Get-Command node -ErrorAction SilentlyContinue) {
        # The token goes to node in the environment, not on its command line:
        # base64url starts with '-' one time in 64, and node read such a token
        # as an option of its own ("bad option") and printed no digest, which
        # failed this check on PR #3049's build. A token that starts with '-'
        # is checked every run, beside the random one.
        foreach ($t in @($tok, ('-' + $tok.Substring(1)))) {
            $env:TS_BRIDGE_TOKEN = $t
            try { $nodeHex = (& node -e "process.stdout.write(require('crypto').createHash('sha256').update(process.env.TS_BRIDGE_TOKEN).digest('hex'))") }
            finally { Remove-Item Env:TS_BRIDGE_TOKEN -ErrorAction SilentlyContinue }
            Yes ("the digest is the SHA-256 in hex bridge.js computes for the same token" + $(if ($t.StartsWith('-')) { ", one that starts with '-' too" } else { '' })) ((Get-ThornswoodBridgeDigest $t) -eq $nodeHex)
        }
    } else { Yes 'node is here to check the digest against' $false }
    $connectJs = Text (P 'scripts', 'vps', 'bridge', 'connect.js')
    Yes 'connect.js reads the token file where Setup-SshKey.ps1 keeps it' ($connectJs.Contains("path.join(os.homedir(), '.ssh', 'thornswood-box-token')") -and
        (Get-ThornswoodBridgeTokenPath) -eq (Join-Path (Join-Path $HOME '.ssh') 'thornswood-box-token'))

    # ---- 5. the ssh config ----------------------------------------------------
    $cfg = Join-Path $tmp 'config'
    [IO.File]::WriteAllText($cfg, "Host bmo`n    HostName bmo`n    User patrick`n")
    $a = @{ Address = '203.0.113.9'; User = 'Administrator'; KeyPath = 'C:\k\thornswood_ed25519'; Node = 'C:\Program Files\nodejs\node.exe'; Connect = 'C:\c\connect.js'; Config = $cfg }
    $null = Set-ThornswoodBridgeSsh @a
    $t = Text $cfg
    Yes 'the bridge block goes first, with the ProxyCommand quoted, and the other Host stays' ($t.StartsWith('# >>> thornswood bridge') -and
        $t.Contains('    ProxyCommand "C:\Program Files\nodejs\node.exe" "C:\c\connect.js"') -and $t.Contains('    StrictHostKeyChecking yes') -and $t.Contains("Host bmo`n    HostName bmo"))
    $null = Set-ThornswoodBridgeSsh @a
    Yes '  a second run replaces it, never two' (([regex]::Matches((Text $cfg), 'Host 203\.0\.113\.9')).Count -eq 1)
    if (Get-Command ssh -ErrorAction SilentlyContinue) {
        $g = @(Invoke-ThornswoodNative { & ssh -F $cfg -G 203.0.113.9 } 2>$null | ForEach-Object { "$_" })
        Yes '  and ssh reads the file it wrote, ProxyCommand and all' ($LASTEXITCODE -eq 0 -and @($g | Where-Object { $_ -match '^proxycommand .*connect\.js' }).Count -eq 1 -and $g -contains 'stricthostkeychecking true')
    }
    $d = $a.Clone(); $d.Remove('Node'); $d.Remove('Connect'); $d.Direct = $true
    $null = Set-ThornswoodBridgeSsh @d
    Yes '-Direct writes the same block with no ProxyCommand' ((Text $cfg) -notmatch 'ProxyCommand' -and ([regex]::Matches((Text $cfg), 'Host 203\.0\.113\.9')).Count -eq 1)
    # The block an older Setup-SshKey.ps1 wrote, as One's config holds it,
    # and a stranger one: both stay, below, and lose to the bridge block.
    $old = "Host 203.0.113.9`n    User someone`n    IdentityFile C:\k\other_ed25519`n    ProxyCommand none`n    StrictHostKeyChecking no`n"
    [IO.File]::WriteAllText($cfg, $old)
    $null = Set-ThornswoodBridgeSsh @a
    $t = Text $cfg
    Yes 'a Host entry it did not write is left as it was, below the bridge block' ($t.StartsWith('# >>> thornswood bridge') -and $t.EndsWith($old))
    if (Get-Command ssh -ErrorAction SilentlyContinue) {
        $g = @(Invoke-ThornswoodNative { & ssh -F $cfg -G 203.0.113.9 } 2>$null | ForEach-Object { "$_" })
        Yes '  and ssh takes the bridge block''s user, ProxyCommand and host key checking over it' ($g -contains 'user Administrator' -and
            @($g | Where-Object { $_ -match '^proxycommand .*connect\.js' }).Count -eq 1 -and $g -contains 'stricthostkeychecking true')
    }

    # ---- 6. a private file -----------------------------------------------------
    $pf = Join-Path $tmp 'private.txt'
    Write-ThornswoodPrivateFile -Path $pf -Text 'secret-stand-in'
    Yes 'Write-ThornswoodPrivateFile writes what it is given' ((Text $pf) -eq 'secret-stand-in')
    if ($env:OS -eq 'Windows_NT') {
        $acl = Get-Acl -LiteralPath $pf
        $me = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $who = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique)
        Yes '  readable by this account alone, nothing inherited' ($acl.AreAccessRulesProtected -and $who.Count -eq 1 -and $who[0] -eq $me.Value)
    }

    # ---- 7. order and secrets --------------------------------------------------
    Yes 'only the digest goes to the box, never the token' ($grant.Contains('Get-BoxChangeScript $Name $digest $keyLine $blob') -and $grant -notmatch 'Get-BoxChangeScript[^\r\n]*\$token')
    Yes 'the token is never printed' (-not ($grant -match '(?m)^\s*(Say|Write-Host)[^\r\n]*\$token\b') -and -not ($setup -match '(?m)^\s*(Say|Write-Host)[^\r\n]*\$token\b'))
    Yes 'the change is kept only after a new login gets in' ($grant.IndexOf('$w = Test-Login') -gt 0 -and $grant.IndexOf('$w = Test-Login') -lt $grant.IndexOf('-Script (Get-BoxKeepScript)'))
    Yes '  and puts the config and token file back when its proof fails' ($grant -match '(?s)if \(-not \$w\.Ok\) \{.*WriteAllText\(\(Join-Path \(Join-Path \$HOME ''\.ssh''\) ''config''\), \$cfgBefore')
    Yes 'Setup-SshKey.ps1 reads the token where nothing shows it, and keeps it readable by its owner only' ($setup -match 'Read-Host -AsSecureString' -and $setup -match 'Write-ThornswoodPrivateFile -Path \$tokenPath')
    Yes 'the token file''s folder comes from Get-ScratchDir.ps1, and no script names the temps path' ($grant.Contains("'Get-ScratchDir.ps1') 'box-access'") -and
        -not $grant.Contains('ThornswoodTemps') -and -not $setup.Contains('ThornswoodTemps'))
    Yes 'Setup-SshKey.ps1 never turns host key checking down' ($setup -notmatch '(?i)StrictHostKeyChecking\s*[= ]\s*"?(no|off|accept-new|ask)\b')
}
finally {
    foreach ($n in 'Armed', 'PutBackExe', 'PutBackArg', 'Locked') { Remove-Variable -Name $n -Scope Global -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
