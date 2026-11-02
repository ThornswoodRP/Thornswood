<#
  test-docs-pwfile.ps1

  Deploy-Docs.ps1 -Password reads the site password from a locked-down file on
  the box (issue #2116), and falls back to the hidden prompt only when that file
  is not there.

  HOW. Offline. The two if ($Password) blocks are lifted out of the shipped
  Deploy-Docs.ps1 by the parser, so this tests what ships. ssh and scp are
  swapped for functions that run what they were handed in PowerShell 7 on
  this machine (what the box runs since #5356), against scratch folders. The
  password file is a scratch file whose ACL this sets the way the box's has to
  be, or wrong on purpose. Read-ThornswoodSecret is swapped for one that
  records it was asked. Never connects to anything, never touches the box.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Deploy = Join-Path $Repo 'scripts\deploy\Deploy-Docs.ps1'
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done { Write-Host ''; Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail); if ($script:fail) { exit 1 }; exit 0 }

. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'SKIP  the runs: the password file''s safety is its Windows ACL, which only Windows has'; Done }
$boxPs = Get-BoxPowerShell

. (Join-Path $Repo 'scripts\vps\Vps.ps1')
. (Join-Path $Repo 'scripts\vps\Send-Script.ps1')
. (Join-Path $Repo 'scripts\vps\Send-Secret.ps1')
. (Join-Path $Repo 'scripts\deploy\DocsPasswordFile.ps1')
# The read and write of config.json that -Password runs (#2317).
. (Join-Path $Repo 'scripts\deploy\SiteConfigSet.ps1')

Yes 'the file the code expects is C:\Thornswood-Secrets\docs-site-password.txt' ((Get-ThornswoodDocsPasswordFile) -eq 'C:\Thornswood-Secrets\docs-site-password.txt')
Yes 'it is outside the site''s own folder, which LOCAL SERVICE can read' (-not (Get-ThornswoodDocsPasswordFile).StartsWith('C:\Thornswood-Docs', [StringComparison]::OrdinalIgnoreCase))

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Deploy, [ref]$tokens, [ref]$errors)
Yes 'Deploy-Docs.ps1 parses' (@($errors).Count -eq 0)
$ifs = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -eq '$Password' }, $true))
Yes 'Deploy-Docs.ps1 has the two -Password blocks: ask, then set' ($ifs.Count -eq 2)
if ($ifs.Count -ne 2) { Done }
$askT = $ifs[0].Clauses[0].Item2.Extent.Text; $ask = $askT.Substring(1, $askT.Length - 2)
$setT = $ifs[1].Clauses[0].Item2.Extent.Text; $set = $setT.Substring(1, $setT.Length - 2)
Yes 'the ask block probes the box before it prompts' ($ask.IndexOf('Get-ThornswoodDocsPasswordProbe') -ge 0 -and $ask.IndexOf('Get-ThornswoodDocsPasswordProbe') -lt $ask.IndexOf('Read-ThornswoodSecret'))
Yes 'the prompt is only on PWFILE MISSING' ($ask -match "elseif \(\`$pwState -eq 'PWFILE MISSING'\) \{\s+Write-Host[^\r\n]+\s+\`$newPassword = Read-ThornswoodSecret")
Yes 'the file path is never sent as a password: the box value is read there' ($set -match 'Get-ThornswoodDocsPasswordSetHead \$PasswordFile' -and $set -match '-Secret \$newPassword')

# ---- the fake ssh and scp -----------------------------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-pwfile-' + [Guid]::NewGuid().ToString('N'))
$script:fakeBox = Join-Path $work 'far'
New-Item -ItemType Directory -Force -Path $script:fakeBox | Out-Null
$script:lines = New-Object System.Collections.ArrayList
function MapFar([string]$p) { return (Join-Path $script:fakeBox ([IO.Path]::GetFileName(($p -replace '^[^:]+@[^:]+:', '')))) }
function scp { $a = @($args | % { [string]$_ }); [void]$script:lines.Add(($a -join ' ')); Copy-Item -LiteralPath $a[-2] -Destination (MapFar $a[-1]) -Force; $global:LASTEXITCODE = 0 }
function ssh {
    $a = @($args | % { [string]$_ }); $cmd = $a[-1]
    [void]$script:lines.Add(($a -join ' '))
    $m = [regex]::Match($cmd, '-EncodedCommand (\S+)$')
    if ($m.Success) {
        # A long script's runner (Send-Script.ps1, #3059) takes its copy from
        # the stand-in box, and sweeps that, not this machine's temp folder.
        $run = $m.Groups[1].Value
        $said = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($run))
        $copy = Get-ThornswoodRemoteRunnerPath $said
        if ($copy) { $run = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($said.Replace($copy, (MapFar $copy.Replace('\', '/'))).Replace("'C:\Windows\Temp'", ("'" + $script:fakeBox + "'")))) }
        @($input) | & $boxPs -NoProfile -NonInteractive -EncodedCommand $run; return
    }
    $m = [regex]::Match($cmd, '-File (\S+)$')
    if ($m.Success) { @($input) | & $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (MapFar $m.Groups[1].Value); return }
    if ($cmd -match 'Remove-Item') { $global:LASTEXITCODE = 0; return }
    throw "the fake ssh was handed something it does not know: $cmd"
}

# ACLs, set the way the box's file has to be, or wrong on purpose.
$meSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$admins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
$users = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')
function Lock([string]$f, [switch]$AlsoUsers, [switch]$Inherit) {
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection((-not $Inherit), $false)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($admins, 'FullControl', 'Allow')))
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($meSid, 'FullControl', 'Allow')))
    if ($AlsoUsers) { $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($users, 'Read', 'Allow'))) }
    $fi = New-Object IO.FileInfo($f)
    [IO.FileSystemAclExtensions]::SetAccessControl($fi, $acl)
}
function Probe([string]$f) {
    $out = @(Invoke-ThornswoodRemote -Target 'u@box' -SshArgs @() -Script (Get-ThornswoodDocsPasswordProbe $f) | ? { $_ -is [string] })
    return ($out -join "`n")
}

$secret = 'pw-from-the-box-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$typed  = 'pw-typed-here-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$enc = New-Object Text.UTF8Encoding($false)
try {
    Write-Host ''
    Write-Host 'THE CHECK, IN THE BOX''S POWERSHELL, ON SCRATCH FILES'
    $f = Join-Path $work 'pw.txt'
    Yes 'no file: MISSING' ((Probe $f) -eq 'PWFILE MISSING')
    [IO.File]::WriteAllText($f, $secret + "`r`n", $enc)
    Yes 'a file that inherits its folder''s permissions: UNSAFE' ((Probe $f) -like 'PWFILE UNSAFE: it inherits*')
    Lock $f -AlsoUsers
    $p = Probe $f
    Yes 'a file Users can read: UNSAFE, naming them' ($p -like 'PWFILE UNSAFE:*Users*is allowed in')
    Lock $f
    Yes 'Administrators and the deploy account only, inheritance off: OK' ((Probe $f) -eq 'PWFILE OK')
    $e = Join-Path $work 'empty.txt'; [IO.File]::WriteAllText($e, "  `r`n", $enc); Lock $e
    Yes 'a locked file holding only blanks: EMPTY' ((Probe $e) -eq 'PWFILE EMPTY')
    Yes 'no probe printed the value' (-not (($script:lines -join "`n") + (Probe $f)).Contains($secret))

    # ---- the two blocks, end to end ------------------------------------------
    function Run([string]$pwFile, [string]$root) {
        $script:asked = 0
        function Read-ThornswoodSecret([string]$Prompt) { $script:asked++; return $typed }
        function Write-Host { }
        $Password = $true; $PasswordFile = $pwFile; $User = 'u'; $Vps = 'box'; $ssh = @(); $rootWin = $root
        $newPassword = ''; $pwFromBox = $false
        $said = @(. ([ScriptBlock]::Create($ask)))
        $said += @(. ([ScriptBlock]::Create($set)) | % { [string]$_ })
        return [pscustomobject]@{ said = ($said -join "`n"); asked = $script:asked; fromBox = $pwFromBox }
    }
    function Config([string]$name) {
        $d = Join-Path $work $name; New-Item -ItemType Directory -Force -Path $d | Out-Null
        [IO.File]::WriteAllText((Join-Path $d 'config.json'), '{ "password": "the-old-one", "cookieSecret": "keep-me", "gamePort": 7777 }', $enc)
        return $d
    }
    function ReadCfg([string]$d) { return (Get-Content -LiteralPath (Join-Path $d 'config.json') -Raw | ConvertFrom-Json) }

    Write-Host ''
    Write-Host 'DEPLOY-DOCS -PASSWORD, AGAINST THE FAKE BOX'
    $script:lines.Clear()
    $d = Config 'fromfile'
    $r = Run $f $d
    $c = ReadCfg $d
    Yes 'with the locked file there, nobody is asked' ($r.asked -eq 0 -and $r.fromBox)
    Yes 'config.json gets the file''s value, trimmed' ($c.password -eq $secret)
    Yes 'and keeps every other setting' ($c.cookieSecret -eq 'keep-me' -and $c.gamePort -eq 7777)
    Yes 'it says set' ($r.said -match 'set password, 2 other setting\(s\) kept')
    $all = ($script:lines -join "`n")
    Yes 'the value is on no command line or script it sent' (-not $all.Contains($secret))
    Yes 'and nothing printed it' (-not $r.said.Contains($secret))

    $d = Config 'missing'
    $r = Run (Join-Path $work 'not-there.txt') $d
    $c = ReadCfg $d
    Yes 'with no file, the hidden prompt is asked once' ($r.asked -eq 1 -and -not $r.fromBox)
    Yes 'and its value is what is set, the rest kept' ($c.password -eq $typed -and $c.cookieSecret -eq 'keep-me')
    Yes 'the typed value went on standard input, not a command line' (-not ($script:lines -join "`n").Contains($typed))

    Lock $f -AlsoUsers
    $d = Config 'unsafe'
    $threw = $null
    try { $null = Run $f $d } catch { $threw = $_.Exception.Message }
    $c = ReadCfg $d
    Yes 'a file others can read stops it, naming why, with no prompt' ($threw -and $threw -like '*not one to use (PWFILE UNSAFE:*' -and $script:asked -eq 0)
    Yes 'and config.json is untouched' ($c.password -eq 'the-old-one')

    Lock $f
    $d = Config 'loosened'
    # Loosened between the probe and the set: the set head checks again.
    $script:asked = 0
    $head = Get-ThornswoodDocsPasswordSetHead $f
    Lock $f -AlsoUsers
    $out = @(Invoke-ThornswoodRemote -Target 'u@box' -SshArgs @() -Script ($head + "`$pw | Out-Null`n'reached the write'") | ? { $_ -is [string] }) -join "`n"
    Yes 'a file loosened after the probe is refused at the moment of use' ($out -like 'PASSWORD FILE UNSAFE:*Nothing written*' -and $out -notmatch 'reached the write')
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done