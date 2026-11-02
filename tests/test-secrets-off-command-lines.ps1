<#
  test-secrets-off-command-lines.ps1

  No script sends a secret to the VPS on a command line (issue #451).

      pwsh -NoProfile -File .\tests\test-secrets-off-command-lines.ps1

  WHY THIS EXISTS. The server password, the site password, the bot token and
  the site's bot key, the Discord client secret, the webhooks and the build
  runner's registration token all went to the VPS base64'd inside the script
  handed to ssh, so each was in the command line of ssh here and of powershell
  on the VPS while it ran, where the process list and a process creation audit
  event show it. Two comments said the opposite. Send-Secret.ps1 is the one
  channel now: the value on ssh's standard input. This keeps it that way.

  HOW. Every PowerShell script in the repository outside tests\ is parsed and
  followed, by name, the way a value moves through it:

    - A secret is a variable with a secret's name (password, pw, token,
      secret, botKey, payload, webhook, passphrase and the like), or one
      assigned from a secure prompt, a random key or a GitHub token request,
      or from anything already a secret: base64 of a token is a token.
    - A command line to the VPS is ssh, scp, plink, Invoke-Command, a Remote
      function, Remote.ps1, or a function of the script that hands one of its
      parameters to any of those. Invoke-ThornswoodSecretRemote is one too,
      except its -Secret, and so is Remote.ps1 except its -Secret: those go on
      standard input.

  A secret reaching a command line fails, with the file and line. So does a
  literal that looks like a live value (a bot token, a webhook address, a
  GitHub token, a private key) in one. Piping into ssh is standard input and
  is fine. Then the same scan runs over the shapes that leaked before this
  change, so it is known to catch them.

  AND NO SECRET IS TYPED (issue #1069). A value typed after a parameter is
  saved in PowerShell's history file and is in the command line of any
  pwsh -File that runs the script, on the machine running it, whatever the
  script does with it afterwards. So no script's own parameter with a
  secret's name may take a value a person can type: it is a switch that asks
  with a hidden prompt (Read-ThornswoodSecret, Read-Host -AsSecureString), or
  a SecureString one script hands another, which cannot be typed.

  Read only. Never connects to anything.
#>
[CmdletBinding()]
param(
    # Another checkout to scan, to see what it finds there.
    [string]$Root
)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
if ($Root) { $repo = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\') }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

Add-Type -AssemblyName System.Management.Automation -ErrorAction SilentlyContinue
$A = 'System.Management.Automation.Language'

# ---- what a secret is ----------------------------------------------------
$SecretName = '^(?i)(password|passwd|pw|pass|passphrase|token|tok|bottoken|clientsecret|secret|botkey|payload|webhook|hook|regtoken|removetoken|apikey|sitekey|passkey|signingsecret|thornswoodsecret)$'
$SecretSource = '(?i)PtrToStringAuto|PtrToStringBSTR|PtrToStringUni|SecureStringToBSTR|GetNetworkCredential|registration-token|remove-token|\bNewKey\b'
# Names that hold a secret in one script only. Discord-Hook.ps1 -Save asks
# for the webhook and -Url takes it from another script.
$ExtraNames = @{ 'Discord-Hook.ps1' = @('Save', 'url') }

# Live values, built here so this file holds none of them.
$ValueShapes = @(
    ('[MNO][A-Za-z0-9_-]{23,27}' + '\.' + '[A-Za-z0-9_-]{6}' + '\.' + '[A-Za-z0-9_-]{27,40}'),
    ('discord(app)?\.com/api/' + 'webhooks/\d{15,}/[A-Za-z0-9_-]{40,}'),
    ('\bgh[pousr]' + '_[A-Za-z0-9]{30,}'),
    ('github' + '_pat_[A-Za-z0-9_]{40,}'),
    ('-----BEGIN [A-Z ]*PRIVATE ' + 'KEY-----')
)

$PrimitiveSink = '^(?i)(ssh|scp|ssh\.exe|scp\.exe|plink|plink\.exe|pscp|pscp\.exe|Invoke-Command|Remote)$'

function NameOf($v) {
    $p = $v.VariablePath
    $n = $p.UnqualifiedPath
    if (-not $n) { $n = $p.UserPath }
    return [string]$n
}

# The variables an assignment writes.
function Targets($assign) {
    $out = @()
    foreach ($v in @($assign.Left.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] }, $true))) { $out += (NameOf $v) }
    return $out
}

function RefsIn($ast) {
    return @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] }, $true) | ForEach-Object { NameOf $_ })
}

# Names in $scope that hold what $isSeed says, and everything assigned from
# them, to a fixed point.
function Derived($scope, [scriptblock]$isSeed, [bool]$useSource) {
    $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $assigns = @($scope.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true))
    foreach ($a in $assigns) { foreach ($t in (Targets $a)) { if (& $isSeed $t) { [void]$set.Add($t) } } }
    foreach ($v in @($scope.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] }, $true))) {
        $nm = NameOf $v
        if (& $isSeed $nm) { [void]$set.Add($nm) }
    }
    $grew = $true
    while ($grew) {
        $grew = $false
        foreach ($a in $assigns) {
            $rhs = $a.Right
            if ($rhs.Extent.Text.Trim() -eq '$null') { continue }
            $hit = $false
            if ($useSource -and $rhs.Extent.Text -match $SecretSource) { $hit = $true }
            if (-not $hit) { foreach ($r in (RefsIn $rhs)) { if ($set.Contains($r)) { $hit = $true; break } } }
            if ($hit) { foreach ($t in (Targets $a)) { if ($set.Add($t)) { $grew = $true } } }
        }
    }
    return , $set
}

# The name a command is called by, and whether it is Remote.ps1 or the
# harness hook for it ($RemoteScript).
function CallName($cmd) {
    $first = $cmd.CommandElements[0]
    $n = $cmd.GetCommandName()
    if ($n) { return [string]$n }
    $t = $first.Extent.Text
    if ($t -match '(?i)Remote\.ps1' -or $t -match '(?i)^\$RemoteScript$') { return 'Remote.ps1' }
    return ''
}

# The arguments of a call that reach its command line, as (name or position,
# ast) pairs. -Secret is left out for the two that send it on standard input.
function Arguments($cmd, [string]$name) {
    $out = @()
    $els = $cmd.CommandElements
    $pos = 0
    $i = 1
    while ($i -lt $els.Count) {
        $e = $els[$i]
        if ($e -is [System.Management.Automation.Language.CommandParameterAst]) {
            $pn = $e.ParameterName
            $arg = $e.Argument
            $next = $null
            if (-not $arg -and ($i + 1) -lt $els.Count -and -not ($els[$i + 1] -is [System.Management.Automation.Language.CommandParameterAst])) {
                $next = $els[$i + 1]; $i++
            }
            $val = $arg
            if (-not $val) { $val = $next }
            $skip = ($pn -eq 'Secret' -and $name -match '^(?i)(Invoke-ThornswoodSecretRemote|Remote\.ps1)$')
            if ($val -and -not $skip) { $out += , @($pn, $val) }
        }
        else {
            $out += , @([string]$pos, $e); $pos++
        }
        $i++
    }
    return , $out
}

# Every function in the file that is itself a way onto a command line: which
# of its parameters (by name and by position) get there.
function SinkFunctions($ast) {
    $fns = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true))
    $known = @{}
    $grew = $true
    while ($grew) {
        $grew = $false
        foreach ($f in $fns) {
            $params = @()
            if ($f.Parameters) { $params = @($f.Parameters) }
            elseif ($f.Body.ParamBlock) { $params = @($f.Body.ParamBlock.Parameters) }
            $names = @($params | ForEach-Object { NameOf $_.Name })
            for ($k = 0; $k -lt $names.Count; $k++) {
                $p = $names[$k]
                $key = $f.Name + '|' + $p
                if ($known.ContainsKey($key)) { continue }
                $set = Derived $f.Body ([scriptblock]::Create("param(`$n) `$n -eq '$p'")) $false
                foreach ($c in @($f.Body.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true))) {
                    if (Leaks $c $set $known) { $known[$key] = $k; $grew = $true; break }
                }
            }
        }
    }
    return $known
}

# Does this call put anything in $set on a command line?
function Leaks($cmd, $set, $known) {
    $name = CallName $cmd
    if (-not $name) { return $false }
    $isPrim = ($name -match $PrimitiveSink) -or ($name -match '^(?i)(Invoke-ThornswoodSecretRemote|Remote\.ps1)$')
    $fnKeys = @($known.Keys | Where-Object { $_ -like ($name + '|*') })
    if (-not $isPrim -and -not $fnKeys.Count) { return $false }
    foreach ($pair in (Arguments $cmd $name)) {
        $label = $pair[0]; $val = $pair[1]
        if (-not $isPrim) {
            # A function of the script: only the parameters that reach a
            # command line count, by name or by position.
            $reach = $false
            foreach ($k in $fnKeys) {
                $pn = $k.Split('|')[1]
                if ($label -eq $pn -or $label -eq [string]$known[$k]) { $reach = $true }
            }
            if (-not $reach) { continue }
        }
        foreach ($r in (RefsIn $val)) { if ($set.Contains($r)) { return $true } }
    }
    return $false
}

# Every finding in one file: "file:line  what".
function Scan([string]$path, [string]$leaf) {
    $tokens = $null; $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errs)
    $found = @()
    $extra = @()
    if ($ExtraNames.ContainsKey($leaf)) { $extra = $ExtraNames[$leaf] }
    $seed = { param($n) ($n -match $SecretName) -or ($extra -contains $n) }.GetNewClosure()
    $set = Derived $ast $seed $true
    $known = SinkFunctions $ast
    foreach ($c in @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true))) {
        $name = CallName $c
        if (-not $name) { continue }
        if (Leaks $c $set $known) {
            $found += ('{0}:{1}  a secret reaches the command line of {2}' -f $leaf, $c.Extent.StartLineNumber, $name)
        }
        $isSink = ($name -match $PrimitiveSink) -or ($name -match '^(?i)(Invoke-ThornswoodSecretRemote|Remote\.ps1)$') -or @($known.Keys | Where-Object { $_ -like ($name + '|*') }).Count
        if ($isSink) {
            foreach ($shape in $ValueShapes) {
                if ($c.Extent.Text -match $shape) { $found += ('{0}:{1}  a literal that looks like a live secret is on the command line of {2}' -f $leaf, $c.Extent.StartLineNumber, $name) }
            }
        }
    }
    return , $found
}

# ---- 1. the shapes that leaked, so the scan is known to catch them --------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-secret-scan-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
    $controls = [ordered]@{
        'the server password base64''d into a Remote block (Rotate-ServerPassword before #451)' = @'
function Remote($script) {
  $e = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  $cmd = "powershell -NoProfile -EncodedCommand $e"
  return & ssh @ssh "$User@$Vps" $cmd 2>&1
}
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Password))
Remote @"
`$pw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$b64'))
"@
'@
        'a token from a secure prompt, base64''d, in a script handed to ssh directly' = @'
$ss = Read-Host 'x' -AsSecureString
$t = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss))
$b = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))
$s = "`$v = '$b'"
$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($s))
& ssh -o BatchMode=yes host "powershell -NoProfile -EncodedCommand $enc"
'@
        'a registration token in a config.cmd argument inside a Remote block (Install-Runner before #451)' = @'
function Remote($script) { return & ssh @ssh $target $script 2>&1 }
$token = (Invoke-Gh api -X POST "repos/x/actions/runners/registration-token" --jq .token | Out-String).Trim()
$out = Remote @"
& .\config.cmd --unattended --token '$token'
"@
'@
        'a webhook written into a Remote.ps1 script (Discord-Hook before #451)' = @'
function OnVps([string]$body) { return @(& $RemoteScript $body 2>&1) }
$url = $Save.Trim()
$r = OnVps ("[IO.File]::WriteAllText('C:\x.txt', '$url')")
'@
        'a secret in the script of Invoke-ThornswoodSecretRemote rather than its -Secret' = @'
Invoke-ThornswoodSecretRemote -Target $t -SshArgs $ssh -Secret $x -Script "`$p = '$Password'"
'@
        'a secret set in the environment on the ssh command line' = @'
& ssh $target "set TOKEN=$token&& run.cmd"
'@
        'a literal bot token on an ssh line' = ("& ssh host `"echo " + 'MTIz' + 'NDU2Nzg5MDEyMzQ1Njc4OTAx' + '.' + 'GaBcDe' + '.' + ('x' * 32) + "`"")
    }
    $n = 0
    foreach ($k in $controls.Keys) {
        $n++
        $leaf = if ($k -like '*Discord-Hook*') { 'Discord-Hook.ps1' } else { "control-$n.ps1" }
        $f = Join-Path $tmp $leaf
        [IO.File]::WriteAllText($f, $controls[$k], (New-Object Text.UTF8Encoding($false)))
        $hits = Scan $f $leaf
        Yes ("caught: $k") ($hits.Count -gt 0)
        Remove-Item -LiteralPath $f -Force
    }

    $fine = [ordered]@{
        'the password as -Secret of Invoke-ThornswoodSecretRemote' = @'
Invoke-ThornswoodSecretRemote -Target "$User@$Vps" -SshArgs $ssh -Secret $Password -Script @"
`$pw = `$ThornswoodSecret; `$ThornswoodSecret = `$null
"@
$Password = $null
'@
        'a webhook piped into ssh (Watch-Services -Webhook)' = @'
$e = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($put))
$out = $url | & ssh @ssh "$User@$Vps" "pwsh -NoProfile -EncodedCommand $e" 2>&1
'@
        'Remote.ps1 -Secret from a function of the script' = @'
function OnVpsWith([string]$body, [string]$value) { return @(& $RemoteScript $body -Secret $value 2>&1) }
$url = $Save.Trim()
$r = OnVpsWith ("`$u = `$ThornswoodSecret") $url
'@
    }
    $n = 0
    foreach ($k in $fine.Keys) {
        $n++
        $leaf = if ($k -like 'Remote.ps1 -Secret*') { 'Discord-Hook.ps1' } else { "fine-$n.ps1" }
        $f = Join-Path $tmp $leaf
        [IO.File]::WriteAllText($f, $fine[$k], (New-Object Text.UTF8Encoding($false)))
        $hits = Scan $f $leaf
        Yes ("passed as safe: $k" + $(if ($hits.Count) { ': ' + ($hits -join '; ') } else { '' })) ($hits.Count -eq 0)
        Remove-Item -LiteralPath $f -Force
    }
}
finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }

# ---- 2. every script in the repository ------------------------------------
$skip = '(?i)[\\/](tests|engine|node_modules|\.git|local|out)[\\/]'
$files = @(Get-ChildItem -LiteralPath $repo -Recurse -File -Filter *.ps1 -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName.Substring($repo.Length) -notmatch $skip })
Yes ("scripts found to scan: " + $files.Count) ($files.Count -gt 100)
$all = @()
foreach ($f in $files) { foreach ($h in (Scan $f.FullName $f.Name)) { if ($h) { $all += $h } } }
foreach ($h in $all) { Write-Host "      $h" }
Yes ('no script puts a secret on an ssh, scp or remote command line (' + $all.Count + ' found)') ($all.Count -eq 0)

# The same for anything else that could shell out to ssh: a line naming ssh
# or scp and a secret together.
# By extension rather than -Include, which Windows PowerShell 5.1 ignores
# beside -LiteralPath.
$other = @(Get-ChildItem -LiteralPath $repo -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { @('.py', '.js', '.cmd', '.bat', '.sh') -contains $_.Extension.ToLowerInvariant() -and $_.FullName.Substring($repo.Length) -notmatch $skip })
$bad = @()
foreach ($f in $other) {
    $i = 0
    foreach ($l in [IO.File]::ReadAllLines($f.FullName)) {
        $i++
        if ($l -match '(^|[\s''"(\[])(ssh|scp)(\.exe)?[\s''",]' -and $l -match '(?i)(token|password|secret|webhook|passphrase)') { $bad += ('{0}:{1}' -f $f.Name, $i) }
    }
}
foreach ($b in $bad) { Write-Host "      $b" }
Yes ('no python, node or batch line hands ssh or scp a secret (' + $other.Count + ' files read)') ($bad.Count -eq 0)

# ---- 3. the scripts #451 named, by what they do now -----------------------
$named = @(
    'scripts\deploy\Rotate-ServerPassword.ps1',
    'scripts\deploy\Deploy-Docs.ps1',
    'scripts\deploy\Install-Bot.ps1',
    'scripts\deploy\Rotate-BotToken.ps1',
    'scripts\deploy\Set-DiscordLogin.ps1',
    'scripts\deploy\Install-Runner.ps1'
)
foreach ($rel in $named) {
    $t = [IO.File]::ReadAllText((Join-Path $repo $rel))
    $leaf = Split-Path -Leaf $rel
    Yes "$leaf sends its secret with Invoke-ThornswoodSecretRemote" ($t -match 'Invoke-ThornswoodSecretRemote .*-Secret \$')
    Yes "$leaf loads Send-Secret.ps1" ($t -match [regex]::Escape("..\vps\Send-Secret.ps1"))
    Yes "$leaf decodes no base64 value inside a remote block" ($t -notmatch "FromBase64String\('\`$b64'\)")
}
$hook = [IO.File]::ReadAllText((Join-Path $repo 'scripts\ops\Discord-Hook.ps1'))
Yes 'Discord-Hook.ps1 -Save sends the webhook with Remote.ps1 -Secret' ($hook -match '-Secret \$value' -and $hook -notmatch "WriteAllText\('\`$far', '\`$url'")
$runner = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Install-Runner.ps1'))
Yes 'Install-Runner.ps1 hands config.cmd no --token argument' ($runner -notmatch 'config\.cmd[^\r\n]*--token')
Yes 'Install-Runner.ps1 hands config.cmd no --windowslogonpassword argument' ($runner -notmatch 'config\.cmd[^\r\n]*--windowslogonpassword')
Yes '  it hands both to config.cmd in its environment, and takes them out again' (
    $runner -match 'ACTIONS_RUNNER_INPUT_TOKEN' -and $runner -match 'ACTIONS_RUNNER_INPUT_WINDOWSLOGONPASSWORD' -and
    $runner -match 'Remove-Item Env:\\ACTIONS_RUNNER_INPUT_TOKEN, Env:\\ACTIONS_RUNNER_INPUT_WINDOWSLOGONPASSWORD')
# ---- 4. no secret is a typed parameter (issue #1069) ------------------------
#
# Every script's own param block, the one a person types after the script's
# name. A parameter with a secret's name has to be a switch (it asks, hidden)
# or a SecureString (handed over by a script that asked); a string, an
# untyped one or anything else that takes typed text fails.
function TypedSecrets([string]$path, [string]$leaf) {
    $tokens = $null; $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errs)
    $out = @()
    if (-not $ast.ParamBlock) { return , $out }
    $extra = @()
    if ($ExtraNames.ContainsKey($leaf)) { $extra = $ExtraNames[$leaf] }
    foreach ($prm in $ast.ParamBlock.Parameters) {
        $n = NameOf $prm.Name
        if (-not (($n -match $SecretName) -or ($extra -contains $n))) { continue }
        $type = $prm.StaticType
        if ($type -eq [System.Management.Automation.SwitchParameter] -or $type -eq [System.Security.SecureString]) { continue }
        $out += ('{0}:{1}  -{2} takes a typed {3}' -f $leaf, $prm.Extent.StartLineNumber, $n, $type.Name)
    }
    return , $out
}

$tmp2 = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-typed-secret-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp2 -Force | Out-Null
try {
    $typedControls = [ordered]@{
        'a [string]$Password (Deploy-Docs and Rotate-ServerPassword before #1069)' = @('control-a.ps1', "param([string]`$Password, [switch]`$Site)")
        'a [string]$Webhook (Publish-Discord before #1069)' = @('control-b.ps1', "param([string]`$Webhook, [switch]`$Dev)")
        'a [string]$Save holding the webhook (Discord-Hook before #1069)' = @('Discord-Hook.ps1', "param([string]`$Name, [string]`$Save)")
        'an untyped $Token' = @('control-c.ps1', "param(`$Token)")
        'a [string]$Secret with attributes' = @('control-d.ps1', "[CmdletBinding()]`nparam([Parameter(Mandatory = `$true)][string]`$Secret)")
    }
    foreach ($k in $typedControls.Keys) {
        $f = Join-Path $tmp2 $typedControls[$k][0]
        [IO.File]::WriteAllText($f, $typedControls[$k][1], (New-Object Text.UTF8Encoding($false)))
        Yes ("caught: $k") ((TypedSecrets $f $typedControls[$k][0]).Count -gt 0)
        Remove-Item -LiteralPath $f -Force
    }
    $typedFine = [ordered]@{
        'a [switch]$Password that asks' = @('fine-a.ps1', "param([switch]`$Password)")
        'a [SecureString]$Secret handed over by a script (Remote.ps1)' = @('fine-b.ps1', "param([System.Security.SecureString]`$Secret)")
        'a [SecureString]$Url beside a [switch]$Save (Discord-Hook)' = @('Discord-Hook.ps1', "param([string]`$Name, [switch]`$Save, [securestring]`$Url)")
        'a [string]$RequirePass, which is on or off' = @('fine-c.ps1', "param([string]`$RequirePass, [string]`$KeyFile)")
    }
    foreach ($k in $typedFine.Keys) {
        $f = Join-Path $tmp2 $typedFine[$k][0]
        [IO.File]::WriteAllText($f, $typedFine[$k][1], (New-Object Text.UTF8Encoding($false)))
        $hits = TypedSecrets $f $typedFine[$k][0]
        Yes ("passed as safe: $k" + $(if ($hits.Count) { ': ' + ($hits -join '; ') } else { '' })) ($hits.Count -eq 0)
        Remove-Item -LiteralPath $f -Force
    }
}
finally { Remove-Item -LiteralPath $tmp2 -Recurse -Force -ErrorAction SilentlyContinue }

$typed = @()
foreach ($f in $files) { foreach ($h in (TypedSecrets $f.FullName $f.Name)) { if ($h) { $typed += $h } } }
foreach ($h in $typed) { Write-Host "      $h" }
Yes ('no script takes a secret as a typed parameter (' + $typed.Count + ' found in ' + $files.Count + ' scripts)') ($typed.Count -eq 0)

# The four #1069 named, by what they do now, and what their usage text says.
$typedNamed = [ordered]@{
    'scripts\deploy\Deploy-Docs.ps1'          = 'Password'
    'scripts\deploy\Rotate-ServerPassword.ps1' = 'Password'
    'scripts\ops\Discord-Hook.ps1'            = 'Save'
}
foreach ($rel in $typedNamed.Keys) {
    $path = Join-Path $repo $rel
    $t = [IO.File]::ReadAllText($path)
    $leaf = Split-Path -Leaf $rel
    $pn = $typedNamed[$rel]
    Yes "$leaf -$pn is a switch" ($t -match ('\[switch\]\$' + $pn + '\b'))
    Yes "  it asks with a hidden prompt" ($t -match 'Read-ThornswoodSecret ' -and $t -match [regex]::Escape("..\vps\Send-Secret.ps1"))
    Yes "  its usage text types no value after -$pn" ($t -notmatch ('(?m)^\s*\.\\\S*' + [regex]::Escape($leaf) + '.*-' + $pn + '[ \t]+[''"<]'))
}
$pub = [IO.File]::ReadAllText((Join-Path $repo 'scripts\ops\Publish-Discord.ps1'))
$pubAst = [System.Management.Automation.Language.Parser]::ParseInput($pub, [ref]$null, [ref]$null)
Yes 'Publish-Discord.ps1 has no -Webhook: it reads the webhook through Discord-Hook.ps1 only' (
    @($pubAst.ParamBlock.Parameters | Where-Object { (NameOf $_.Name) -eq 'Webhook' }).Count -eq 0 -and $pub -match 'Discord-Hook\.ps1''\) -Name \$hookName')
$hookText = [IO.File]::ReadAllText((Join-Path $repo 'scripts\ops\Discord-Hook.ps1'))
Yes 'Discord-Hook.ps1 takes a webhook from another script only as a SecureString (-Url)' ($hookText -match '\[System\.Security\.SecureString\]\$Url')
foreach ($caller in @('scripts\ops\Set-DevNews.ps1', 'scripts\deploy\Setup-Discord.ps1')) {
    $ct = [IO.File]::ReadAllText((Join-Path $repo $caller))
    Yes ((Split-Path -Leaf $caller) + ' hands Discord-Hook.ps1 the webhook as -Save -Url, a SecureString') ($ct -match 'Discord-Hook\.ps1''\) -Name \w+ -Save -Url ')
}
$remoteText = [IO.File]::ReadAllText((Join-Path $repo 'scripts\vps\Remote.ps1'))
Yes 'Remote.ps1 -Secret is a SecureString' ($remoteText -match '\[System\.Security\.SecureString\]\$Secret')

# Docs: no page shows a secret typed after one of these. local and out are
# what one machine keeps and builds, not pages: since 5 October One's dev
# release folder, a whole game with its mods' read me files, is in local.
$docHits = @()
foreach ($d in @(Get-ChildItem -LiteralPath $repo -Recurse -File -Filter *.md -ErrorAction SilentlyContinue | Where-Object { $_.FullName.Substring($repo.Length) -notmatch '(?i)[\\/](docs[\\/]archive|engine|node_modules|\.git|local|out)[\\/]' })) {
    $i = 0
    foreach ($l in [IO.File]::ReadAllLines($d.FullName)) {
        $i++
        if ($l -match '(Discord-Hook(\.ps1)?[^|`]*-Save\s+[<''"\w])|(Rotate-ServerPassword(\.ps1)?\s+-Password\s+[<''"\w])|(Deploy-Docs(\.ps1)?\s+-Password\s+[<''"\w])|(Publish-Discord(\.ps1)?[^|`]*-Webhook\b)') { $docHits += ('{0}:{1}' -f $d.Name, $i) }
    }
}
foreach ($h in $docHits) { Write-Host "      $h" }
Yes ('no page shows a secret typed on the command line (' + $docHits.Count + ' found)') ($docHits.Count -eq 0)

$false1 = @()
foreach ($f in $files) {
    $t = [IO.File]::ReadAllText($f.FullName)
    if ($t -match '(?i)never (be )?a word on a command line|not sitting in a command line') { $false1 += $f.Name }
}
Yes ('no comment still says base64 keeps a secret off the command line' + $(if ($false1.Count) { ': ' + ($false1 -join ', ') } else { '' })) ($false1.Count -eq 0)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
