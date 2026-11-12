<#
  test-virustotal-comment.ps1

      pwsh -NoProfile -File .\tests\test-virustotal-comment.ps1

  Add-VirusTotalComment.ps1 keeps its contract and never stops a release.

  WHY THIS EXISTS. The engines that flag the setup program are machine
  learning scores and hash intelligence rather than signatures for anything
  known. A comment on the report saying what the file is, who publishes it and
  where from is signal added beside the certificate (issue #390) while the
  signed publisher has little reputation (docs\VIRUSTOTAL-FALSE-POSITIVE.md). That makes it a
  script that runs at the end of a release, and the failure worth guarding
  against is not a missing comment: it is a missing comment that stops a
  release which has already been published. So every way out has to be exit 0.

  The other one is commenting under the wrong hash, which is worse than not
  commenting, so the file's own bytes decide the hash and a -Sha256 that
  disagrees is reported rather than used.

  WHAT IT RUNS. Four cases end before any request leaves the machine: no key,
  no file, and a hash that does not match. The fifth points the script at a
  closed port on the loopback address with a key set, which is the comment
  failing for real, and it still has to exit 0 and say why. Nothing here
  reaches VirusTotal, and the key it sets is the word that says so.

  Read only. Writes one small file into the temp folder and removes it.
#>
[CmdletBinding()]
param([string]$ScriptPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This test lives in tests\; repo root is one level up.
$repoRoot = Split-Path -Parent $Here
if (-not $ScriptPath) { $ScriptPath = Join-Path $repoRoot 'scripts\release\Add-VirusTotalComment.ps1' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

Yes 'Add-VirusTotalComment.ps1 is where this expects it' (Test-Path -LiteralPath $ScriptPath)
if (-not (Test-Path -LiteralPath $ScriptPath)) {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    exit 1
}
$Utf8 = New-Object Text.UTF8Encoding($false)
$src = [IO.File]::ReadAllText($ScriptPath, $Utf8)

# ---- 1. it parses, and its contract is the one the callers were given ------
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($src, $ScriptPath, [ref]$tokens, [ref]$errors)
Yes 'it parses' (@($errors).Count -eq 0)
$declared = @()
if ($ast.ParamBlock) { $declared = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) }
Yes 'it takes -Path' ($declared -contains 'Path')
Yes 'and -Sha256, for a caller that already measured it' ($declared -contains 'Sha256')
# Publish-VirusTotal.ps1 reads the key from the environment and has no
# parameter for it, so that it cannot be typed on a command line a shell then
# writes into its history. Same here, and the same reason.
Yes 'the key comes from VT_API_KEY and there is no parameter for it' (
    ($src -match '\$env:VT_API_KEY') -and ($declared -notcontains 'ApiKey') -and ($declared -notcontains 'Key'))
$help = $ast.GetHelpContent()
Yes 'it has a help block PowerShell recognises' ($null -ne $help)
Yes 'with a synopsis, which is the row scripts\README.md carries' (
    $null -ne $help -and ([string]$help.Synopsis).Trim().Length -gt 0)
$documented = @()
if ($null -ne $help) {
    foreach ($k in $help.Parameters.Keys) {
        if (([string]$help.Parameters[$k]).Trim()) { $documented += $k.ToUpperInvariant() }
    }
}
$missing = @($declared | Where-Object { $documented -notcontains $_.ToUpperInvariant() })
Yes ('every parameter has a .PARAMETER of its own' +
     $(if ($missing.Count) { ', missing: ' + ($missing -join ', ') } else { '' })) ($missing.Count -eq 0)

# ---- 2. it never stops a release ------------------------------------------
# The host this harness is running in, so the child is the same PowerShell.
$hostExe = ''
try { $hostExe = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName } catch { $hostExe = '' }
if (-not $hostExe) {
    $c = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($c) { $hostExe = $c.Source }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('vt-comment-' + [Guid]::NewGuid().ToString('N') + '.bin')
[IO.File]::WriteAllText($tmp, 'not an installer, only something to hash', $Utf8)
$gone = Join-Path ([IO.Path]::GetTempPath()) ('vt-missing-' + [Guid]::NewGuid().ToString('N') + '.bin')
# Nothing is listening here and nothing in this harness starts anything that
# would. A request to it is refused by the machine itself, which is the dead
# network case without a network.
$dead = 'http://127.0.0.1:9/api/v3'
# Not a key. It never leaves the loopback address, and every case below is
# read for it, so a script that started printing what it holds fails here.
$fakeKey = 'not-a-real-key-0000'

function Invoke-Child([string]$key, [string[]]$sArgs) {
    $was = $env:VT_API_KEY
    $env:VT_API_KEY = $key
    try {
        $out = & $hostExe -NoProfile -File $ScriptPath @sArgs 2>&1 | Out-String
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
    } finally { $env:VT_API_KEY = $was }
}

if (-not $hostExe) {
    Write-Host 'SKIP  no PowerShell host to run the script in, so only its text was read'
} else {
    $ran = @()
    try {
        $noKey = Invoke-Child '' @('-Path', $tmp)
        $ran += $noKey
        Yes 'with no VT_API_KEY it exits 0, so a release carries on' ($noKey.Code -eq 0)
        Yes 'and says that is why there is no comment' ($noKey.Out -match '(?i)no comment \(VT_API_KEY not set\)')

        $noFile = Invoke-Child $fakeKey @('-Path', $gone)
        $ran += $noFile
        Yes 'a file that is not there is exit 0 as well' ($noFile.Code -eq 0)
        Yes 'and it says which file' (
            $noFile.Out -match '(?i)no file at' -and
            $noFile.Out -match [regex]::Escape((Split-Path $gone -Leaf)))

        $wrongHash = Invoke-Child $fakeKey @('-Path', $tmp, '-Sha256', ('0' * 64), '-Api', $dead)
        $ran += $wrongHash
        Yes 'a -Sha256 that is not the file''s is exit 0' ($wrongHash.Code -eq 0)
        Yes 'and is reported, with the hash of the bytes on disk used instead' (
            $wrongHash.Out -match "(?i)hash passed in is not this file's, using the file's [0-9a-f]{64}")

        $dead1 = Invoke-Child $fakeKey @('-Path', $tmp, '-Api', $dead)
        $ran += $dead1
        Yes 'a comment that cannot be posted at all is exit 0' ($dead1.Code -eq 0)
        Yes 'and says so in one line' ($dead1.Out -match '(?i)no comment \(')
        Yes 'and still names the report address for the measured hash' (
            $dead1.Out -match 'https://www\.virustotal\.com/gui/file/[0-9a-f]{64}')
        Yes 'and nothing it printed is a stack trace' (-not ($dead1.Out -match 'at line:\d'))

        $leaked = @($ran | Where-Object { $_.Out -match [regex]::Escape($fakeKey) })
        Yes ('no case printed the key, ' + $ran.Count + ' cases read') ($leaked.Count -eq 0)
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

# ---- 3. the rest of the refusals, read off the script ---------------------
# These need VirusTotal to answer, which nothing here may ask it to do, so the
# script's own text is what says they end the same way.
Yes 'a key VirusTotal refuses is soft' ($src -match '401\s*\{\s*Stop-Here')
Yes 'a hash with no report yet is soft, and says to send the file first' (
    $src -match '404\s*\{\s*Stop-Here' -and $src -match 'Publish-VirusTotal\.ps1')
Yes 'a comment already on the report is soft' ($src -match '409\s*\{\s*Stop-Here')
Yes 'being out of quota is soft' ($src -match '429\s*\{\s*Stop-Here')
Yes 'and every Stop-Here exits 0' ($src -match '(?s)function Stop-Here.{0,200}?exit 0')
Yes 'nothing in the script exits non-zero' (-not ($src -match '(?m)^\s*exit [1-9]'))
Yes 'the key is scrubbed out of anything printed that came from outside' (
    $src -match '(?s)function Clean.{0,200}?\$script:key')

# ---- 4. what the comment says ---------------------------------------------
# The vendors read this. It has to name the program, the site and the state of
# the signing, and say what the program does now. Until #4539 it described the
# setup program #4824 retired: one that downloaded a payload from the site and
# started the Setup.bat inside it. Today's download is Velopack's setup
# program, which carries its package inside it and starts the launcher, and
# there is no Setup.bat (tests\test-4824-install.py holds it gone). So the
# comment is the description in docs\VIRUSTOTAL-FALSE-POSITIVE.md's
# checklist, the one every vendor form gets, word for word.
$iText = $src.IndexOf('function Get-DefaultText')
Yes 'there is a default comment' ($iText -gt 0)
$said = ''
if ($iText -gt 0) {
    $text = $src.Substring($iText, [Math]::Min(2000, $src.Length - $iText))
    $said = ((@([regex]::Matches($text.Substring(0, $text.IndexOf("`n}") + 1), "'((?:[^']|'')*)'") | ForEach-Object { $_.Groups[1].Value.Replace("''", "'") })) -join ' ')
    Yes 'it names the product, Thornswood Setup' ($text -match 'Thornswood Setup')
    Yes 'it names thornswood.net' ($text -match 'thornswood\.net')
    Yes 'and that it is signed, as every published build is since 27 September' (
        $text -match '(?i)Authenticode signed' -and $text -notmatch '(?i)not (Authenticode |code )?signed')
    Yes 'it does not say setup starts a Setup.bat, which is gone since #4824' ($said -notmatch '(?i)Setup\.bat|Install\.bat')
    Yes 'nor that it downloads a payload and unpacks it, which the setup before Velopack did' (
        $said -notmatch '(?i)\bdownloads\b|\bpayload\b|\bunpacks\b')
    Yes 'it says it is a Velopack setup program that starts the launcher' ($said -match 'Velopack setup program' -and $said -match '(?i)starts the\s+launcher')
}
Yes 'the script does not send readers to installer\setup\Bootstrap.cs, gone since #4824' (-not ($src -match '(?i)installer[\\/]setup[\\/]Bootstrap\.cs'))
Yes 'the script has no em dash in it' (-not $src.Contains([string][char]0x2014))

# ---- 5. the page and the index it belongs to ------------------------------
$page = Join-Path $repoRoot 'docs\VIRUSTOTAL-FALSE-POSITIVE.md'
Yes 'docs\VIRUSTOTAL-FALSE-POSITIVE.md is there' (Test-Path -LiteralPath $page)
if (Test-Path -LiteralPath $page) {
    $doc = [IO.File]::ReadAllText($page, $Utf8)
    Yes 'and it names this script as the way the comment gets posted' (
        $doc.Contains('Add-VirusTotalComment.ps1'))
    # The description every vendor form gets, from the checklist's indented
    # block: the comment says the same, so a reviewer reading either reads
    # one program.
    $m = [regex]::Match($doc, '(?ms)^    (Thornswood Setup, the installer for Thornswood.*?published on the Thornswood GitHub Releases\.)')
    $facts = if ($m.Success) { ($m.Groups[1].Value -replace '\s+', ' ').Trim() } else { '' }
    Yes 'the page''s checklist has the description the vendors are sent' ($facts.Length -gt 0)
    Yes 'and the default comment says it, word for word' ($facts.Length -gt 0 -and (($said -replace '\s+', ' ').Trim()).StartsWith($facts))
}

# ---- 6. what else describes setup ------------------------------------------
# A comment in the launcher's uninstall still said the installer runs
# Setup.bat, as if it still did. That folder is the one the setup before #4824
# left behind, and the uninstall still looks for it on machines that ran it.
$un = Join-Path $repoRoot 'launcher\app\Uninstall.cs'
if (Test-Path -LiteralPath $un) {
    $unText = [IO.File]::ReadAllText($un, $Utf8) -replace '(?m)^\s*///\s?', ''
    Yes 'Uninstall.cs does not say the installer runs Setup.bat today' (-not ($unText -match '(?i)\bruns\s+Setup\.bat'))
}
# scripts\README.md is generated from the scripts, so a new one that is not in
# it fails test-script-index.ps1 on the nightly run. Caught here beside the
# script instead, where it is obvious what to do about it.
$index = Join-Path $repoRoot 'scripts\README.md'
Yes 'scripts\README.md lists it' (
    (Test-Path -LiteralPath $index) -and
    ([IO.File]::ReadAllText($index, $Utf8)).Contains('release/Add-VirusTotalComment.ps1'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
