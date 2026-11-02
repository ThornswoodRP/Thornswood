<#
  test-3216-turnstile-seal.ps1

  Set-Turnstile.ps1 -FromCloudflare puts the report form's Turnstile keys on
  the box with the token Patrick pasted into the repository's Actions
  secrets, and no session, log or annotation ever holds the token or the
  widget's secret in a form anybody can read (#3216, Patrick's A of 22 Oct).

  HOW. Three parts, nothing connecting anywhere:
    1. scripts\vps\Seal.ps1's box-side blocks run in PowerShell 7, the box's
       PowerShell, against a scratch folder: the key is made once and kept,
       its private half is never printed, a value sealed to it opens, and
       one sealed to another key or cut short does not.
    2. The workflow's half, Set-Turnstile.ps1 -SealOnGitHub, is run as the
       workflow runs it: it leaves only the sealed token, as an annotation
       titled Turnstile, and with no token it stops and says so.
    3. -FromCloudflare from end to end, in this PowerShell, with gh and ssh
       (and scp) as functions here. gh plays GitHub: the workflow's run
       seals the token with the shipped -SealOnGitHub half. ssh runs each
       script it is handed against scratch folders, with Cloudflare's answer
       and the site's restart replaced by stand-ins. The stand-in for
       Cloudflare hands the widget's secret only to a request bearing the
       token. Afterwards every command line, script and input handed to gh,
       ssh and scp is searched for the token and the secret, plain and base64.

    pwsh -File tests\test-3216-turnstile-seal.ps1
#>
[CmdletBinding()]
param()
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$TurnstileScript = Join-Path $Root 'scripts\deploy\Set-Turnstile.ps1'

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

. (Join-Path $Root 'scripts\vps\Seal.ps1')
. (Join-Path $PSScriptRoot 'Windows.ps1')
$thisShell = (Get-Process -Id $PID).Path
$boxShell = Get-BoxPowerShell

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-3216-seal-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null

# A box-side script as the box would run it: in the box's PowerShell, with
# the seal folder moved to scratch. Off Windows a folder's ACL is not
# Windows', so the lock is a stand-in there and the real one is renamed out
# of the way; on Windows the real lock runs on the scratch folder.
function Fit([string]$t, [string]$sealDir) {
    $t = $t.Replace('C:\Thornswood-Seal', $sealDir)
    if (-not $OnWindows) {
        $t = $t.Replace('function Lock-ThornswoodSealFolder(', 'function Lock-ThornswoodSealFolder-OnWindows(')
        $t = "function Lock-ThornswoodSealFolder([string]`$dir) { }`r`n" + $t
        # Set-Turnstile.ps1 names the docs folder the box's way round.
        if ($docs) { $t = $t.Replace($docs.Replace('/', '\'), $docs) }
        $t = $t.Replace('\config.json', '/config.json')
    }
    return $t
}
function Run-Box([string]$t, [string]$stdin = '') {
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($t))
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $boxShell
    $psi.Arguments = '-NoProfile -NonInteractive -EncodedCommand ' + $enc
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $p = [Diagnostics.Process]::Start($psi)
    $p.StandardInput.Write($stdin)
    $p.StandardInput.Close()
    $out = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    return @($out -split "`r?`n" | Where-Object { $_ -ne '' })
}

try {
    # ---- 1. the box's key ---------------------------------------------------
    $sealDir = Join-Path $work 'seal'
    $keyScript = "`$ErrorActionPreference = 'Stop'`r`n" + (Get-ThornswoodSealLockFunction) + "`r`n" + (Get-ThornswoodSealKeyBlock)
    $first = Run-Box (Fit $keyScript $sealDir)
    $second = Run-Box (Fit $keyScript $sealDir)
    $pub1 = (@($first | Where-Object { $_ -like 'SEAL KEY *' }) | Select-Object -Last 1)
    $pub2 = (@($second | Where-Object { $_ -like 'SEAL KEY *' }) | Select-Object -Last 1)
    Yes 'the first ask makes the key and prints its public half' ($first -contains 'seal key made' -and $pub1 -like 'SEAL KEY <RSAKeyValue><Modulus>*')
    if (-not $pub1) { Write-Host ('      it said: ' + ($first -join ' | ')) }
    Yes 'the second ask keeps the same key' ($second -notcontains 'seal key made' -and $pub2 -eq $pub1)
    Yes 'the private half is never printed' (-not (($first + $second) -join ' ').Contains('<D>') -and -not (($first + $second) -join ' ').Contains('<P>'))
    Yes 'it is kept as one file in the seal folder' (Test-Path -LiteralPath (Join-Path $sealDir 'seal-key.xml'))
    if (-not $pub1) { Done }
    $publicKey = $pub1.Substring('SEAL KEY '.Length)

    # ---- sealing and opening -------------------------------------------------
    $value = 'harness-token-' + [Guid]::NewGuid().ToString('N')
    $sealed = ConvertTo-ThornswoodSealed -PublicKeyXml $publicKey -Value $value
    Yes 'a sealed value is one line of base64 that does not hold the value' ($sealed -match '^[A-Za-z0-9+/]+={0,2}$' -and -not $sealed.Contains($value))
    $open = "`$sealed = '__SEALED__'`r`n" + (Get-ThornswoodUnsealBlock) + "`r`nif (`$ThornswoodSecret -ceq `$env:TW_EXPECT) { 'OPENED THE SAME' } else { 'OPENED SOMETHING ELSE' }"
    $env:TW_EXPECT = $value
    try {
        $o = Run-Box (Fit ($open.Replace('__SEALED__', $sealed)) $sealDir)
        Yes 'the box opens it to the value' ($o -contains 'OPENED THE SAME')
        if (-not ($o -contains 'OPENED THE SAME')) { Write-Host ('      it said: ' + ($o -join ' | ')) }
        $other = [Security.Cryptography.RSA]::Create(); $other.KeySize = 3072
        $wrong = ConvertTo-ThornswoodSealed -PublicKeyXml $other.ToXmlString($false) -Value $value
        $other.Dispose()
        $o = Run-Box (Fit ($open.Replace('__SEALED__', $wrong)) $sealDir)
        Yes 'one sealed to another key does not open, and nothing goes on' (($o -join ' ') -match 'DID NOT OPEN' -and ($o -join ' ') -notmatch 'OPENED')
        $o = Run-Box (Fit ($open.Replace('__SEALED__', $sealed.Substring(0, 100))) $sealDir)
        Yes 'one cut short does not open either' (($o -join ' ') -match 'DID NOT OPEN')
        $o = Run-Box (Fit ($open.Replace('__SEALED__', $sealed)) (Join-Path $work 'no-key-here'))
        Yes 'with no key on the box it says so and changes nothing' (($o -join ' ') -match 'NO SEAL KEY')
    } finally { Remove-Item Env:\TW_EXPECT -ErrorAction SilentlyContinue }
    $small = [Security.Cryptography.RSA]::Create(); $small.KeySize = 1024
    $refused = $false
    try { [void](ConvertTo-ThornswoodSealed -PublicKeyXml $small.ToXmlString($false) -Value 'x') } catch { $refused = $true }
    $small.Dispose()
    Yes 'a key under 3072 bits is refused' $refused
    $refused = $false
    try { [void](ConvertTo-ThornswoodSealed -PublicKeyXml '<RSAKeyValue><Modulus>AQAB</Modulus><D>AQAB</D></RSAKeyValue>' -Value 'x') } catch { $refused = $true }
    Yes 'anything but a bare public key is refused, a private one included' $refused

    # ---- 2. the workflow's half ----------------------------------------------
    function Run-Seal([string]$token, [string]$key) {
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = $thisShell
        $psi.Arguments = '-NoProfile -NonInteractive -File "' + $TurnstileScript + '" -SealOnGitHub'
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.Environment['GITHUB_ACTIONS'] = 'true'
        $psi.Environment['CLOUDFLARE_TURNSTILE_TOKEN'] = $token
        $psi.Environment['SEAL_KEY'] = $key
        $p = [Diagnostics.Process]::Start($psi)
        $out = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()
        $p.WaitForExit()
        return @{ Out = $out; Code = $p.ExitCode }
    }
    $r = Run-Seal $value $publicKey
    $m = [regex]::Match($r.Out, '::notice title=Turnstile::([A-Za-z0-9+/=]+)')
    Yes '-SealOnGitHub leaves the sealed token as a notice titled Turnstile' ($r.Code -eq 0 -and $m.Success)
    Yes '  and the token is nowhere in what it printed' (-not $r.Out.Contains($value) -and -not $r.Out.Contains([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($value))))
    if ($m.Success) {
        $env:TW_EXPECT = $value
        try { $o = Run-Box (Fit ($open.Replace('__SEALED__', $m.Groups[1].Value)) $sealDir) }
        finally { Remove-Item Env:\TW_EXPECT -ErrorAction SilentlyContinue }
        Yes '  and the box opens that notice to the token' ($o -contains 'OPENED THE SAME')
    }
    $r = Run-Seal '' $publicKey
    Yes 'with no token it stops with an error titled Turnstile and seals nothing' ($r.Code -ne 0 -and $r.Out -match '::error title=Turnstile::CLOUDFLARE_TURNSTILE_TOKEN is not' -and $r.Out -notmatch '::notice')

    # ---- 3. -FromCloudflare from end to end -----------------------------------
    $siteKey = '0x4AAAAAAFhUyY9jKwKOoC8J'
    $widgetSecret = '0x4AAAAAAFharness-secret-' + [Guid]::NewGuid().ToString('N')
    $docs = Join-Path $work 'docs'
    New-Item -ItemType Directory -Path $docs -Force | Out-Null
    $noMark = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $docs 'config.json'), '{ "password": "not-a-real-one", "botKey": "not-a-real-key" }', $noMark)

    # The box's stand-ins: Cloudflare's answer, which hands the secret only to
    # the token, and the site's restart and answer. Functions win over
    # cmdlets of the same name.
    $stubs = @'
function Get-CimInstance { }
function Stop-Process { }
function Start-ScheduledTask { 'STUB Start-ScheduledTask' }
function Start-Sleep { }
function Get-NetTCPConnection { $true }
function Invoke-RestMethod {
  param($Uri, $Headers, [switch]$UseBasicParsing, $TimeoutSec)
  if ($Uri -like 'https://api.cloudflare.com/*') {
    [IO.File]::AppendAllText($env:TW_ASKED, $Uri + "`n")
    if (-not $Headers -or $Headers['Authorization'] -cne ('Bearer ' + $env:TW_WANT)) { throw 'STUB 403 not the token' }
    return [pscustomobject]@{ success = $true; result = [pscustomobject]@{ sitekey = $env:TW_SITEKEY; secret = $env:TW_SECRET } }
  }
  $c = [IO.File]::ReadAllText($env:TW_CFG) | ConvertFrom-Json
  $on = [string]$c.turnstileSiteKey -and [string]$c.turnstileSecret
  [pscustomobject]@{ turnstile = $(if ($on) { [string]$c.turnstileSiteKey } else { '' }) }
}

'@
    # Set-Turnstile.ps1 runs in a script scope of its own, so these keep what
    # they record in objects found from there, not in $script: variables.
    $handed = New-Object System.Collections.ArrayList
    $state = @{ copied = $null; sealed = '' }
    function ssh {
        $a = @($args | ForEach-Object { [string]$_ })
        [void]$handed.Add(($a -join ' '))
        $mm = [regex]::Match($a[-1], '-EncodedCommand (\S+)$')
        if (-not $mm.Success) { throw 'the fake ssh was handed no encoded command' }
        $t = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($mm.Groups[1].Value))
        [void]$handed.Add($t)
        if ($t -match 'thornswood-remote-[0-9a-f]{32}\.ps1' -and $null -ne $state.copied) { $t = $state.copied; $state.copied = $null }
        $in = @($input) -join "`n"
        [void]$handed.Add($in)
        foreach ($l in (Run-Box ($stubs + (Fit $t $sealDir)) $in)) { $l }
        $global:LASTEXITCODE = 0
    }
    function scp {
        $a = @($args | ForEach-Object { [string]$_ })
        [void]$handed.Add('scp ' + ($a -join ' '))
        $state.copied = [IO.File]::ReadAllText($a[-2])
        [void]$handed.Add($state.copied)
        $global:LASTEXITCODE = 0
    }
    # GitHub: the dispatch runs the shipped -SealOnGitHub half with the key it
    # was given, and the run's one job carries what that half printed.
    function gh {
        $a = @($args | ForEach-Object { [string]$_ })
        $in = @($input) -join "`n"
        [void]$handed.Add('gh ' + ($a -join ' ') + ' ' + $in)
        $global:LASTEXITCODE = 0
        $path = @($a | Where-Object { $_ -like 'repos/*' })[0]
        if ($path -like '*/dispatches') {
            $body = $in | ConvertFrom-Json
            if ($body.ref -ne 'main') { $global:LASTEXITCODE = 1; return 'not main' }
            $rr = Run-Seal $env:TW_TOKEN ([string]$body.inputs.seal_key)
            $n = [regex]::Match($rr.Out, '::notice title=Turnstile::([A-Za-z0-9+/=]+)')
            $state.sealed = $(if ($n.Success) { $n.Groups[1].Value } else { '' })
            return '{"workflow_run_id": 4242, "html_url": "https://github.invalid/run/4242"}'
        }
        if ($path -like '*/actions/runs/4242') { return '{"status": "completed", "conclusion": "success", "path": ".github/workflows/turnstile-keys.yml", "html_url": "https://github.invalid/run/4242"}' }
        if ($path -like '*/actions/runs/4242/jobs') { return '{"jobs": [{"id": 77}]}' }
        if ($path -like '*/check-runs/77/annotations') { return (ConvertTo-Json -Compress -InputObject @(@{ title = 'Turnstile'; annotation_level = 'notice'; message = $state.sealed })) }
        $global:LASTEXITCODE = 1
        return "gh: Not Found (HTTP 404)"
    }
    Yes 'gh, ssh and scp are the harness''s own, so nothing connects' (
        (Get-Command gh).CommandType -eq 'Function' -and (Get-Command ssh).CommandType -eq 'Function' -and (Get-Command scp).CommandType -eq 'Function')

    $token = 'cf-harness-' + [Guid]::NewGuid().ToString('N')
    $env:TW_TOKEN = $token; $env:TW_WANT = $token; $env:TW_SECRET = $widgetSecret; $env:TW_SITEKEY = $siteKey
    $env:TW_CFG = Join-Path $docs 'config.json'; $env:TW_ASKED = Join-Path $work 'asked.txt'
    try {
        $said = @(& $TurnstileScript -FromCloudflare -Vps 'nowhere.invalid' -User 'nobody' -DocsRoot $docs *>&1 | ForEach-Object { [string]$_ })
    } finally {
        Remove-Item Env:\TW_TOKEN, Env:\TW_WANT, Env:\TW_SECRET, Env:\TW_SITEKEY -ErrorAction SilentlyContinue
    }
    $all = $said -join ' | '
    $cfg = [IO.File]::ReadAllText((Join-Path $docs 'config.json')) | ConvertFrom-Json
    Yes '-FromCloudflare writes the widget''s site key and secret into config.json' ($cfg.turnstileSiteKey -eq $siteKey -and $cfg.turnstileSecret -eq $widgetSecret)
    Yes '  and keeps every other setting' ($cfg.password -eq 'not-a-real-one' -and $cfg.botKey -eq 'not-a-real-key')
    Yes '  and restarts the site, which then says the check is on' ($all -match 'STUB Start-ScheduledTask' -and $all -match 'the report form is told the site key: the check is on')
    if ($all -notmatch 'the check is on') { Write-Host ('      it said: ' + $all) }
    Yes 'turnstile-keys.yml is not in this repository, which has no VPS runner once public (#4013)' (-not (Test-Path -LiteralPath (Join-Path (Join-Path (Join-Path $Root '.github') 'workflows') 'turnstile-keys.yml')))
    Yes '  through turnstile-keys.yml in the private ops repository, where the VPS runners are (#4013)' (@($handed | Where-Object { $_ -match '^gh api -X POST repos/ThornswoodRP/Thornswood-Ops/actions/workflows/turnstile-keys\.yml/dispatches ' }).Count -eq 1)
    $asked = if (Test-Path -LiteralPath $env:TW_ASKED) { [IO.File]::ReadAllText($env:TW_ASKED) } else { '' }
    Yes '  having asked Cloudflare for that widget in that account, once' ($asked.Trim() -eq "https://api.cloudflare.com/client/v4/accounts/c7738b46d6dea435f5228b00b6198706/challenges/widgets/$siteKey")
    $handedAll = ($handed -join "`n") + "`n" + $all
    $found = @()
    foreach ($v in @($token, $widgetSecret)) {
        foreach ($form in @($v, [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($v)), [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($v)))) {
            if ($handedAll.Contains($form)) { $found += $form.Substring(0, 6) }
        }
    }
    Yes 'neither the token nor the widget''s secret is in anything handed to gh, ssh or scp, or printed, plain or base64' ($found.Count -eq 0)

    # A token that cannot read the widget: nothing written.
    [IO.File]::WriteAllText((Join-Path $docs 'config.json'), '{ "password": "not-a-real-one" }', $noMark)
    $env:TW_TOKEN = 'cf-other-' + [Guid]::NewGuid().ToString('N'); $env:TW_WANT = $token; $env:TW_SECRET = $widgetSecret; $env:TW_SITEKEY = $siteKey
    try { $said = @(& $TurnstileScript -FromCloudflare -Vps 'nowhere.invalid' -User 'nobody' -DocsRoot $docs *>&1 | ForEach-Object { [string]$_ }) }
    finally { Remove-Item Env:\TW_TOKEN, Env:\TW_WANT, Env:\TW_SECRET, Env:\TW_SITEKEY -ErrorAction SilentlyContinue }
    $cfg = [IO.File]::ReadAllText((Join-Path $docs 'config.json')) | ConvertFrom-Json
    Yes 'a token Cloudflare refuses: it says so, writes nothing and restarts nothing' (
        ($said -join ' ') -match 'CLOUDFLARE DID NOT HAND OVER THE WIDGET' -and -not $cfg.PSObject.Properties['turnstileSecret'] -and ($said -join ' ') -notmatch 'STUB Start-ScheduledTask')
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
