<#
  test-pinned-downloads.ps1

  What a fresh VPS downloads is one exact version, checked against the
  checksum its vendor published for it, and nothing is installed when the
  download does not match.

  WHY THIS EXISTS. Entry 266 on the To Do List. Setup-Domain.ps1 fetched
  caddyserver.com/api/download, which is whatever build Caddy serves that day,
  guarded only by whether caddy.exe was already there. Bootstrap-VPS.ps1 read
  nodejs.org/dist/index.json and took the newest v24 with Select-Object
  -First 1. Install-Bot.ps1 ran pip install discord.py pillow certifi by name.
  The same script fetched python-3.12.8 with no checksum (issue #1334).
  None of the three checked a checksum. In the entry's words: "The next full
  install otherwise takes whatever the next major release turns out to be."

  THE PARSE CHECK CANNOT SEE ANY OF IT. The Caddy download and the pip install
  are inside here-strings that are sent to the VPS and run there, and
  build.yml's ParseFile treats each of those as one string literal, so a
  broken line in them stays green. This expands each block the way the script
  does before sending it, parses what would actually be sent, and then runs
  the Caddy download block and Install-Msi for real, in a temp folder, against
  a stand-in download, with the web request and msiexec replaced. So the
  checksum code is exercised, not just read.

  Never connects to anything. Never runs msiexec, never touches the firewall,
  never writes outside its own temp folder.
#>
[CmdletBinding()]
param([string]$RepoPath)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $RepoPath) { $RepoPath = $Here }
$RepoRoot = $RepoPath

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

function ParseOf([string]$path) {
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    return @{ Ast = $ast; Errors = @($errors) }
}

function ParseErrors([string]$text) {
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
    return @($errors)
}

function ParamDefault($ast, [string]$name) {
    $p = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq $name })
    if ($p.Count -and $p[0].DefaultValue) { return $p[0].DefaultValue.SafeGetValue() }
    return $null
}

# Every double quoted here-string in a script, which is how the remote blocks
# are written.
function HereStrings($ast) {
    return @($ast.FindAll({
        param($n)
        $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and
        $n.StringConstantType -eq 'DoubleQuotedHereString'
    }, $true))
}

# A remote block exactly as the script would send it: the here-string is
# evaluated as written, with the script's own variables set to the values
# given. Backticks and dollar signs come out the way they would on the wire.
# Setup-Domain.ps1 dot-sources scripts\vps\Lock-Folder.ps1 and its caddy block
# calls Get-ThornswoodLockedFolderScript (#2105), so it is loaded here the same
# way. Loading it locks nothing; only the text it returns is read.
. (Join-Path $RepoPath 'scripts\vps\Lock-Folder.ps1')
# Its web rules block calls Get-ThornswoodFirewallScript (#3896) the same way.
. (Join-Path $RepoPath 'scripts\vps\BoxFirewall.ps1')
function Expand([string]$hereString, [hashtable]$vars) {
    $sb = [scriptblock]::Create($hereString)
    return (& {
        param($__sb, $__vars)
        foreach ($k in $__vars.Keys) { Set-Variable -Name $k -Value $__vars[$k] }
        & $__sb
    } $sb $vars)
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-pinned-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work -Force | Out-Null

# ---- the stand-ins for the network and for msiexec --------------------------
#
# Functions win over cmdlets of the same name, so while this runs, the blocks
# under test get these instead of the real ones. Whatever they ask for, they
# are handed the file in $script:serve.
$script:serve = $null
$script:fetched = @()
$script:msiexec = 0
function Invoke-WebRequest {
    param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing, [int]$TimeoutSec)
    $script:fetched += $Uri
    Copy-Item -LiteralPath $script:serve -Destination $OutFile -Force
}
function Start-Process {
    param([Parameter(Position = 0)][string]$FilePath, [object[]]$ArgumentList, [switch]$Wait, [switch]$PassThru)
    $script:msiexec++
    return [pscustomobject]@{ ExitCode = 0 }
}

try {

# ============================================================== caddy ======
$sdPath = Join-Path $RepoPath 'scripts\deploy\Setup-Domain.ps1'
$sd = ParseOf $sdPath
$sdText = Get-Content -LiteralPath $sdPath -Raw
Yes 'Setup-Domain.ps1 parses' ($sd.Errors.Count -eq 0)
Yes 'Setup-Domain.ps1 no longer fetches caddyserver.com/api/download' ($sdText -notmatch 'api/download')

$caddyVersion = ParamDefault $sd.Ast 'CaddyVersion'
$caddySha = ParamDefault $sd.Ast 'CaddySha512'
Yes "Caddy is pinned to one release ($caddyVersion)" ("$caddyVersion" -match '^\d+\.\d+\.\d+$')
Yes 'and carries the SHA-512 Caddy publishes for it, 128 hex digits' ("$caddySha" -match '^[0-9a-fA-F]{128}$')

$caddyBlocks = @(HereStrings $sd.Ast | Where-Object {
    $_.Extent.Text -match 'caddy\.exe' -and $_.Extent.Text -match 'Invoke-WebRequest' })
Yes 'there is exactly one remote block that downloads caddy' ($caddyBlocks.Count -eq 1)

if ($caddyBlocks.Count -eq 1) {
    $caddyHere = $caddyBlocks[0].Extent.Text
    $sent = Expand $caddyHere @{ caddyWin = 'C:\Thornswood-Caddy'; cfg64 = 'e30='
                                 CaddyVersion = $caddyVersion; CaddySha512 = $caddySha }
    $errs = ParseErrors $sent
    Yes ('the caddy block parses as it would be sent to the VPS' +
         $(if ($errs.Count) { ': ' + $errs[0].Message } else { '' })) ($errs.Count -eq 0)
    $asset = 'https://github.com/caddyserver/caddy/releases/download/v{0}/caddy_{0}_windows_amd64.zip' -f $caddyVersion
    Yes 'it downloads the pinned release asset from GitHub' ($sent.Contains($asset))
    Yes 'it compares against the pinned SHA-512' ($sent.Contains("'$caddySha'") -and $sent -match 'Get-FileHash[^\r\n]*-Algorithm SHA512')

    # A stand-in release laid out like the real one, which on 24 Sep was
    # caddy.exe, LICENSE and README.md at the top of the zip.
    $stage = Join-Path $work 'caddy-stage'
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $stage 'caddy.exe') -Value 'stand-in caddy' -NoNewline
    Set-Content -LiteralPath (Join-Path $stage 'LICENSE') -Value 'licence' -NoNewline
    Set-Content -LiteralPath (Join-Path $stage 'README.md') -Value 'readme' -NoNewline
    $fakeZip = Join-Path $work 'caddy-release.zip'
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $fakeZip -Force
    $fakeSha = (Get-FileHash -LiteralPath $fakeZip -Algorithm SHA512).Hash

    # Only the download step, the if around caddy.exe, is run. The rest of the
    # block writes the Caddyfile and opens the firewall, which is not this.
    function RunCaddyDownload([string]$dir, [string]$sha) {
        $text = Expand $caddyHere @{ caddyWin = $dir; cfg64 = 'e30='
                                     CaddyVersion = $caddyVersion; CaddySha512 = $sha }
        $t = $null; $e = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$t, [ref]$e)
        $if = @($ast.EndBlock.Statements | Where-Object {
            $_ -is [System.Management.Automation.Language.IfStatementAst] -and $_.Extent.Text -match 'caddy\.exe' })
        if (-not $if.Count) { throw 'no download step found in the caddy block' }
        $code = "`$ErrorActionPreference = 'Stop'`n`$dir = '{0}'`n{1}" -f $dir, $if[0].Extent.Text
        return (& ([scriptblock]::Create($code)))
    }

    # A download that does not match: refused, nothing installed, nothing left.
    $bad = Join-Path $work 'caddy-bad'
    New-Item -ItemType Directory -Path $bad -Force | Out-Null
    $script:serve = $fakeZip
    $script:fetched = @()
    $threw = $false
    try { RunCaddyDownload $bad $caddySha | Out-Null } catch { $threw = $true }
    Yes 'a caddy zip that does not match the checksum stops the block' $threw
    Yes '  and no caddy.exe is installed' (-not (Test-Path -LiteralPath (Join-Path $bad 'caddy.exe')))
    Yes '  and the zip is not left behind' (@(Get-ChildItem -LiteralPath $bad -Filter *.zip).Count -eq 0)
    Yes '  and what it asked for was the pinned asset' (($script:fetched -join ' ') -eq $asset)

    # A download that matches: caddy.exe, and only caddy.exe, ends up there.
    $good = Join-Path $work 'caddy-good'
    New-Item -ItemType Directory -Path $good -Force | Out-Null
    $script:fetched = @()
    $said = @()
    $threw = $false
    try { $said = @(RunCaddyDownload $good $fakeSha) } catch { $threw = $true; Write-Host "      $($_.Exception.Message)" }
    Yes 'a caddy zip that matches is installed' ((-not $threw) -and
        (Test-Path -LiteralPath (Join-Path $good 'caddy.exe')))
    Yes '  and it is the caddy.exe out of the zip' (
        (Test-Path -LiteralPath (Join-Path $good 'caddy.exe')) -and
        ((Get-Content -LiteralPath (Join-Path $good 'caddy.exe') -Raw) -eq 'stand-in caddy'))
    Yes '  with no zip, unpack folder, LICENSE or README left beside it' (
        @(Get-ChildItem -LiteralPath $good -Force | Where-Object { $_.Name -ne 'caddy.exe' }).Count -eq 0)
    Yes '  and it says the checksum matched' (($said -join ' ') -match 'checksum matched')

    # A box that already has caddy keeps it and asks for nothing.
    $script:fetched = @()
    $said = @()
    $threw = $false
    try { $said = @(RunCaddyDownload $good $fakeSha) } catch { $threw = $true; Write-Host "      $($_.Exception.Message)" }
    Yes 'a box that already has caddy.exe downloads nothing' ((-not $threw) -and $script:fetched.Count -eq 0)
    Yes '  and says what it has and what a fresh box gets' (($said -join ' ') -match "already here.*$([regex]::Escape($caddyVersion))")
}

# =============================================================== node ======
$bvPath = Join-Path $RepoPath 'scripts\vps\Bootstrap-VPS.ps1'
$bv = ParseOf $bvPath
$bvText = Get-Content -LiteralPath $bvPath -Raw
Yes 'Bootstrap-VPS.ps1 parses' ($bv.Errors.Count -eq 0)

$nodeMajor = ParamDefault $bv.Ast 'NodeMajor'
$nodeVersion = ParamDefault $bv.Ast 'NodeVersion'
$nodeSha = ParamDefault $bv.Ast 'NodeSha256'
Yes "Node is pinned to one release ($nodeVersion)" ("$nodeVersion" -match '^v\d+\.\d+\.\d+$')
Yes "  and it is a $nodeMajor release, so the Node-API addon's major holds" ("$nodeVersion".StartsWith("$nodeMajor."))
Yes '  and carries the SHA-256 nodejs.org publishes for it, 64 hex digits' ("$nodeSha" -match '^[0-9a-fA-F]{64}$')

$m = [regex]::Match($bvText, '(?s)# --- Node -+\r?\n(.*?)# --- Git')
$nodeBlock = $m.Groups[1].Value
Yes 'the Node block is there' ($m.Success)
Yes '  and no longer takes the newest with Select-Object -First 1' ($m.Success -and $nodeBlock -notmatch 'Select-Object -First 1')
Yes '  and no longer reads index.json to choose one' ($m.Success -and $nodeBlock -notmatch 'index\.json')
Yes '  and hands Install-Msi the pinned checksum' ($m.Success -and $nodeBlock -match 'Install-Msi\s[^\r\n]*\$NodeVersion[^\r\n]*\$NodeSha256')

$fn = @($bv.Ast.FindAll({
    param($n)
    $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Install-Msi'
}, $true))
Yes 'Install-Msi is there' ($fn.Count -eq 1)
if ($fn.Count -eq 1) {
    # Install-Msi downloads into $tmp, as the script sets it.
    $tmp = Join-Path $work 'msi'
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    . ([scriptblock]::Create($fn[0].Extent.Text))

    $fakeMsi = Join-Path $work 'stand-in.msi'
    Set-Content -LiteralPath $fakeMsi -Value 'stand-in msi' -NoNewline
    $fakeMsiSha = (Get-FileHash -LiteralPath $fakeMsi -Algorithm SHA256).Hash
    $script:serve = $fakeMsi
    $url = 'https://nodejs.org/dist/{0}/node-{0}-x64.msi' -f $nodeVersion
    $landed = Join-Path $tmp ('node-{0}-x64.msi' -f $nodeVersion)

    $script:msiexec = 0
    $threw = $false
    try { Install-Msi $url 'Node' $nodeSha 6>$null } catch { $threw = $true }
    Yes 'an msi that does not match its checksum stops Install-Msi' $threw
    Yes '  and msiexec is never run on it' ($script:msiexec -eq 0)
    Yes '  and the download is deleted' (-not (Test-Path -LiteralPath $landed))

    $script:msiexec = 0
    $threw = $false
    try { Install-Msi $url 'Node' $fakeMsiSha 6>$null } catch { $threw = $true; Write-Host "      $($_.Exception.Message)" }
    Yes 'an msi that matches is installed' ((-not $threw) -and $script:msiexec -eq 1)

    # PowerShell 7 is still resolved on the day and has no checksum to pass,
    # so Install-Msi without one has to go on working as it did.
    $script:msiexec = 0
    $threw = $false
    try { Install-Msi $url 'PowerShell' 6>$null } catch { $threw = $true; Write-Host "      $($_.Exception.Message)" }
    Yes 'Install-Msi with no checksum given still installs, for PowerShell 7' ((-not $threw) -and $script:msiexec -eq 1)
}

# ================================================================ bot ======
$reqPath = Join-Path $RepoPath 'bot\requirements.txt'
Yes 'bot\requirements.txt exists' (Test-Path -LiteralPath $reqPath)
# Since #2190 the file is generated from bot\requirements.in with every
# library the bot pulls in, each pinned by version AND by sha256: comment
# lines on top, and each requirement continued over lines ending in "\" with
# its --hash=sha256: values. So a requirement is read as the whole logical
# line, and names compare as pip does (discord.py and discord-py are one).
# tests\test-bot-requirements.ps1 holds the hashes and the installers' flags.
$req = @()
if (Test-Path -LiteralPath $reqPath) {
    $joined = ([IO.File]::ReadAllText($reqPath).Replace("`r`n", "`n") -replace '\\\n', ' ')
    $req = @($joined -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
}
$loose = @($req | Where-Object { $_ -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*==[0-9][0-9A-Za-z.]*(\s+--hash=sha256:[0-9a-f]{64})+$' })
Yes ('every requirement in it is one exact == pin with its sha256 hashes' +
     $(if ($loose.Count) { ' (not: ' + (($loose | ForEach-Object { $_.Substring(0, [Math]::Min(60, $_.Length)) }) -join ', ') + ')' } else { '' })) (
    $req.Count -gt 0 -and $loose.Count -eq 0)
function Norm-Pip([string]$n) { return ($n.ToLowerInvariant() -replace '[-_.]+', '-') }
foreach ($lib in 'discord.py', 'pillow', 'certifi') {
    Yes "  $lib is pinned" (@($req | Where-Object { $_ -match '^([^=\s]+)==' -and (Norm-Pip $Matches[1]) -eq (Norm-Pip $lib) }).Count -eq 1)
}

$ibPath = Join-Path $RepoPath 'scripts\deploy\Install-Bot.ps1'
$ib = ParseOf $ibPath
$ibText = Get-Content -LiteralPath $ibPath -Raw
Yes 'Install-Bot.ps1 parses' ($ib.Errors.Count -eq 0)
Yes 'requirements.txt goes up to the VPS with the code' ($ibText -match "foreach \(\`$f in [^\r\n]*'requirements\.txt'")

$pipBlocks = @(HereStrings $ib.Ast | Where-Object { $_.Extent.Text -match 'pip install' })
Yes 'there is exactly one remote block that runs pip install' ($pipBlocks.Count -eq 1)
if ($pipBlocks.Count -eq 1) {
    # Since #1093 every file goes up into a stage folder first (stage, check,
    # swap), so pip installs from the requirements.txt staged beside the
    # staged bot.py, which is what the swap then puts in place.
    $sent = Expand $pipBlocks[0].Extent.Text @{ rootWin = 'C:\Thornswood-Bot'; stageName = '.stage-20260929-000000' }
    $errs = ParseErrors $sent
    Yes ('the pip block parses as it would be sent to the VPS' +
         $(if ($errs.Count) { ': ' + $errs[0].Message } else { '' })) ($errs.Count -eq 0)
    Yes '  and installs from the requirements.txt staged beside bot.py' ($sent -match "pip install [^\r\n]*-r 'C:\\Thornswood-Bot\\\.stage-20260929-000000\\requirements\.txt'")
    Yes '  and no longer installs any of the three by name' ($sent -notmatch 'pip install[^\r\n]*\b(discord\.py|pillow|certifi)\b')
}

# ===================================================== python installer ======
# Issue #1334. The only Python download is the remote block in Install-Bot.ps1
# (there is no second downloader). It must be one exact python.org file, and a
# file that does not match the recorded SHA-256 must exit non-zero without
# starting the installer.
$pyVersion = ParamDefault $ib.Ast 'PythonVersion'
$pySha = ParamDefault $ib.Ast 'PythonSha256'
Yes "Python is pinned to one 3.12 release ($pyVersion)" ("$pyVersion" -eq '3.12.10')
Yes '  and carries a SHA-256, 64 hex digits' ("$pySha" -match '^[0-9a-fA-F]{64}$')
Yes 'Install-Bot.ps1 no longer fetches python-3.12.8' ($ibText -notmatch '3\.12\.8')
Yes 'a failed Python download stops the run' ($ibText -match "if \(\`$LASTEXITCODE -ne 0\) \{ Die 'Python was not installed")

$pyBlocks = @(HereStrings $ib.Ast | Where-Object {
    $_.Extent.Text -match 'python\.org/ftp/python' -and $_.Extent.Text -match 'Invoke-WebRequest' })
Yes 'there is exactly one remote block that downloads the Python installer' ($pyBlocks.Count -eq 1)
if ($pyBlocks.Count -eq 1) {
    $pyHere = $pyBlocks[0].Extent.Text
    $sent = Expand $pyHere @{ PythonVersion = $pyVersion; PythonSha256 = $pySha }
    $errs = ParseErrors $sent
    Yes ('the python block parses as it would be sent to the VPS' +
         $(if ($errs.Count) { ': ' + $errs[0].Message } else { '' })) ($errs.Count -eq 0)
    $asset = 'https://www.python.org/ftp/python/{0}/python-{0}-amd64.exe' -f $pyVersion
    Yes 'it downloads that exact python.org file' ($sent.Contains($asset))
    Yes 'it compares against the pinned SHA-256 before the installer runs' (
        $sent.Contains("'$pySha'") -and $sent -match 'Get-FileHash[^\r\n]*-Algorithm SHA256' -and
        $sent.IndexOf('Get-FileHash') -lt $sent.IndexOf('Start-Process'))

}
if ($pyBlocks.Count -eq 1) {
    # The block downloads into the box's TEMP. Here that is a folder of this
    # run's own, handed to the shell that runs it, so nothing lands in this
    # machine's temp folder and the same run works where TEMP is not set.
    $boxTemp = Join-Path $work 'box-temp'
    $null = New-Item -ItemType Directory -Force -Path $boxTemp
    # The box runs it in PowerShell 7 since #5356, and so does this.
    $pyShell = $boxPs
    $fakeExe = Join-Path $work 'stand-in-python.exe'
    Set-Content -LiteralPath $fakeExe -Value 'stand-in python' -NoNewline
    $fakeSha = (Get-FileHash -LiteralPath $fakeExe -Algorithm SHA256).Hash
    $runner = Join-Path $work 'run-python-pin.ps1'
    $started = Join-Path $work 'python-installer-started.txt'
    $landed = Join-Path $boxTemp ('python-{0}-amd64.exe' -f $pyVersion)

    function Write-PythonRunner([string]$sha) {
        $text = Expand $pyHere @{ PythonVersion = $pyVersion; PythonSha256 = $sha }
        $head = @"
`$ErrorActionPreference = 'Continue'
`$script:serve = '$($fakeExe.Replace("'", "''"))'
function Invoke-WebRequest {
    param([string]`$Uri, [string]`$OutFile, [switch]`$UseBasicParsing, [int]`$TimeoutSec)
    Copy-Item -LiteralPath `$script:serve -Destination `$OutFile -Force
}
function Start-Process {
    param([Parameter(Position = 0)][string]`$FilePath, [object[]]`$ArgumentList, [switch]`$Wait, [switch]`$PassThru)
    Set-Content -LiteralPath '$($started.Replace("'", "''"))' -Value 'started' -Encoding ascii
    return [pscustomobject]@{ ExitCode = 0 }
}
"@
        [IO.File]::WriteAllText($runner, ($head + "`r`n" + $text), (New-Object Text.UTF8Encoding $false))
    }

    Remove-Item -LiteralPath $started -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $landed -Force -ErrorAction SilentlyContinue
    Write-PythonRunner $pySha
    $pinErr = Join-Path $work 'python-pin-err.txt'
    $pref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $savedTemp = $env:TEMP
    $env:TEMP = $boxTemp
    # -ExecutionPolicy Bypass, as the other harnesses that run a script do:
    # where the policy is Restricted the runner never
    # loads, and that non-zero exit is not the checksum refusing anything.
    try { $said = @(& $pyShell -NoProfile -ExecutionPolicy Bypass -File $runner 2>$pinErr) }
    finally { $env:TEMP = $savedTemp }
    $ErrorActionPreference = $pref
    $pinSaid = if (Test-Path -LiteralPath $pinErr) { Get-Content -LiteralPath $pinErr -Raw } else { '' }
    Yes 'a python installer that does not match the checksum exits non-zero' ($LASTEXITCODE -ne 0)
    Yes '  and it is the checksum that refused it' ("$pinSaid" -match 'does not match the checksum recorded for it')
    Yes '  and the installer is never started' (-not (Test-Path -LiteralPath $started))
    Yes '  and the download is not left behind' (-not (Test-Path -LiteralPath $landed))

    Remove-Item -LiteralPath $started -Force -ErrorAction SilentlyContinue
    Write-PythonRunner $fakeSha
    $env:TEMP = $boxTemp
    try { $said = @(& $pyShell -NoProfile -ExecutionPolicy Bypass -File $runner) }
    finally { $env:TEMP = $savedTemp }
    Yes 'a python installer that matches exits 0 and is run' (
        $LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $started))
    Yes '  and it says the checksum matched' (($said -join ' ') -match 'checksum matched')
    Yes '  and the download is removed after' (-not (Test-Path -LiteralPath $landed))
}

# The build check installs what the VPS installs, so what is tested is what runs.
# The bot harnesses run in the nightly checks since 25 September.
$yml = Join-Path $RepoRoot '.github\workflows\nightly.yml'
if (Test-Path -LiteralPath $yml) {
    $ymlText = Get-Content -LiteralPath $yml -Raw
    Yes 'the build check installs the bot libraries from the same requirements.txt' (
        $ymlText -match 'pip install [^\r\n]*-r bot[\\/]requirements\.txt' -and
        $ymlText -notmatch 'pip install[^\r\n]*discord\.py pillow')
} else {
    Write-Host 'SKIP  build.yml is not beside this tools folder'
}

}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
