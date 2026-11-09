<#
  Sign-OnGitHub.ps1

  Signs the release manifest's catalog on GitHub's runner in the public engine
  fork, and checks it the way every installed launcher checks a launcher
  (#2903, Patrick's A of 20 Oct). Dot-sourced by Publish-Update.ps1 and
  Ship.ps1; defines functions and nothing else.

      . (Join-Path $PSScriptRoot 'Sign-OnGitHub.ps1')
      $why = Get-SignOnGitHubRefusal $repoDir                  '' when this machine can ask
      $why = Invoke-ReleaseCatalogSignOnGitHub $json $cat $repoDir $request
                                                               '' when signed and accepted

  WHY. Every release since 19 Oct, dev included, signs its manifest
  (Sign-ReleaseCatalog.ps1, #2163 phase B), and only a machine with Patrick's
  Azure sign in and records\signing\signing.json could sign. A release from
  the feed (Ship -FromFeed, #2754) runs anywhere, the cloud included, so its
  signing cannot need that machine. The fork's
  .github\workflows\thornswood-sign-manifest.yml signs instead: it signs in to
  Azure with a federated identity (OIDC), no secret stored anywhere, through
  an environment only the fork's main may use, and the fork is public, so its
  runner costs nothing.

  WHAT GOES. release.json, base64, and its sha256; the signing client pin
  (Setup-ShipMachine.ps1, Get-SigningClientPin), the Azure account and
  profile (records\signing\metadata.json) and ExpectedSigner (Updater.cs), so
  the fork holds no second copy of any of them; and, since #3312, where the
  site serves the launcher the release names and launcher\app\Signature.cs,
  gzipped and base64. The job first fetches that launcher from the site,
  holds it to the sha256 release.json lists and runs the launcher's own
  check on it, in a job of its own with no Azure token, so a launcher is
  checked by a job that cannot sign before the release that names it is
  signed. Then it makes the catalog over
  release.json the way New-ReleaseManifestFiles does, signs it with the
  ThornswoodRelease profile, reads it back, and keeps it as the artifact
  release-cat-<request> for a day. Nothing secret goes either way.

  THE LAUNCHER ITSELF is not built or signed here any more. Since Velopack a
  launcher goes out only on the Releases merge-release.yml and
  promote-main.yml make (#4825), so Invoke-ReleaseLauncherOnGitHub, which
  asked release-tag.yml and release.yml for one, went with them (#5385), and
  so did the box check of a single signed file it used.

  WHAT IS HELD when it comes back, before the publish goes on: the catalog
  holds release.json as it is here (Test-FileCatalog) and passes
  Get-PublishSignRefusal (Assert-PublishSigned.ps1): Authenticode Valid, the
  Subject naming ExpectedSigner, and launcher\app\Signature.cs, the launcher's
  own check. Those are Windows calls. On Windows they run here; anywhere else
  they run on the box, which holds no signing setup, under its Windows
  PowerShell 5.1, with the files and the check sent in the script and removed
  afterwards. The job's own read back is not taken on trust.

  It talks to GitHub through gh, and to the box through Send-Script.ps1. A
  harness passes its own gh (-Gh) and box (-Box).

  Keep it ASCII. It runs in PowerShell 7.
#>

. (Join-Path $PSScriptRoot 'Assert-PublishSigned.ps1')

$SignOnGitHubRepo = 'ThornswoodRP/skymp'
$SignOnGitHubWorkflow = 'thornswood-sign-manifest.yml'
$SignOnGitHubRef = 'main'

# gh with these arguments; what it printed, or a throw that says what it said.
function Invoke-SignOnGitHubGh([string[]]$GhArgs) {
    $was = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = @(& gh @GhArgs 2>&1 | ForEach-Object { [string]$_ }) }
    finally { $ErrorActionPreference = $was }
    if ($LASTEXITCODE -ne 0) { throw ('gh ' + $GhArgs[0] + ' ' + $GhArgs[1] + ' exited ' + $LASTEXITCODE + ': ' + (($out | Select-Object -Last 3) -join ' | ')) }
    return ($out -join "`n")
}

# The signing client pin, lifted out of Setup-ShipMachine.ps1 by the parser so
# it lives in one place (Sign-OnRunner.ps1 reads it the same way).
function Get-SignOnGitHubClientPin([string]$RepoDir) {
    $src = [IO.File]::ReadAllText((Join-Path $RepoDir 'scripts\release\Setup-ShipMachine.ps1'))
    $t = $null; $e = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$t, [ref]$e)
    $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-SigningClientPin' }, $true)
    if (-not $fn) { throw 'Setup-ShipMachine.ps1 has no Get-SigningClientPin' }
    . ([scriptblock]::Create($fn.Extent.Text))
    return (Get-SigningClientPin)
}

# launcher\app\Signature.cs, gzipped and base64: the launcher's own check, for
# the fork's launcher job. Gzipped so the dispatch fits a Windows command line.
function Get-SignOnGitHubSignatureCs([string]$RepoDir) {
    $bytes = [IO.File]::ReadAllBytes((Join-Path $RepoDir 'launcher\app\Signature.cs'))
    $ms = New-Object IO.MemoryStream
    try {
        $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress, $true)
        try { $gz.Write($bytes, 0, $bytes.Length) } finally { $gz.Dispose() }
        return [Convert]::ToBase64String($ms.ToArray())
    } finally { $ms.Dispose() }
}

# What the fork's job is asked with, as name = value. Throws when Thornswood's
# own records do not say.
function Get-SignOnGitHubInputs([string]$RepoDir, [string]$Json, [string]$Request, [string]$LauncherUrl) {
    $bytes = [IO.File]::ReadAllBytes($Json)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $jsonSha = -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) } finally { $sha.Dispose() }
    $pin = Get-SignOnGitHubClientPin $RepoDir
    $metaPath = Join-Path $RepoDir 'records\signing\metadata.json'
    $meta = [IO.File]::ReadAllText($metaPath) | ConvertFrom-Json
    $in = [ordered]@{
        request             = $Request
        manifest            = [Convert]::ToBase64String($bytes)
        manifest_sha256     = $jsonSha
        client_version      = [string]$pin.Version
        client_sha256       = [string]$pin.Sha256
        endpoint            = [string](Get-SigningConfigValue $meta 'Endpoint')
        account             = [string](Get-SigningConfigValue $meta 'CodeSigningAccountName')
        certificate_profile = [string](Get-SigningConfigValue $meta 'CertificateProfileName')
        expected_signer     = (Get-ExpectedSignerFragment -RepoRoot $RepoDir)
        signature_cs_gz     = (Get-SignOnGitHubSignatureCs $RepoDir)
        launcher_url        = $LauncherUrl
    }
    foreach ($k in @($in.Keys)) { if (-not $in[$k]) { throw "nothing says what to send the signing job as $k" } }
    return $in
}

# '' when this machine can ask the fork to sign: gh is here, and Thornswood's
# records name the client, the account and the signer.
function Get-SignOnGitHubRefusal([string]$RepoDir) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        return ('A release from the feed signs on GitHub, in the engine fork, and this machine has no gh to ask it with. ' +
                'Install the GitHub CLI and sign in (gh auth login). Nothing was published.')
    }
    $probe = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-signprobe-' + [Guid]::NewGuid().ToString('N') + '.json')
    try {
        [IO.File]::WriteAllText($probe, '{}')
        [void](Get-SignOnGitHubInputs $RepoDir $probe 'probe' 'probe')
    } catch {
        return ('What the signing job is sent could not be read from this checkout: ' + $_.Exception.Message + ' Nothing was published.')
    } finally { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue }
    return ''
}

# The run the dispatch for $Request started, or $null while there is none yet.
function Find-SignOnGitHubRun([scriptblock]$Gh, [string]$Request) {
    $list = @('run', 'list', '-R', $SignOnGitHubRepo, '-w', $SignOnGitHubWorkflow, '-e', 'workflow_dispatch', '-L', '30',
              '--json', 'databaseId,displayTitle,status,conclusion,url')
    $text = & $Gh @list
    # Through ForEach-Object so the list is one run per item whether or not
    # this PowerShell unrolled the JSON array itself (5.1 does not).
    foreach ($r in @(($text | ConvertFrom-Json) | ForEach-Object { $_ })) {
        if ([string]$r.displayTitle -ceq ('sign ' + $Request)) { return $r }
    }
    return $null
}

# Asks the fork to sign release.json, waits for it, and puts the signed
# catalog at $Catalog. Then holds it as the header says. '' when signed and
# accepted, else why. -WaitSeconds bounds the whole wait; -Poll the gap.
function Invoke-ReleaseCatalogSignOnGitHub {
    param(
        [Parameter(Mandatory = $true)][string]$Json,
        [Parameter(Mandatory = $true)][string]$Catalog,
        [Parameter(Mandatory = $true)][string]$RepoDir,
        [Parameter(Mandatory = $true)][string]$Request,
        # Where the site serves the launcher release.json names (the feed's
        # launcherUrl), for the fork's launcher check.
        [Parameter(Mandatory = $true)][string]$LauncherUrl,
        [scriptblock]$Gh = { Invoke-SignOnGitHubGh $args },
        [scriptblock]$Box,
        [int]$WaitSeconds = 1200,
        [int]$Poll = 10
    )
    if (-not (Test-Path -LiteralPath $Json -PathType Leaf)) { return "there is no release.json at $Json to sign" }
    try { $in = Get-SignOnGitHubInputs $RepoDir $Json $Request $LauncherUrl } catch { return $_.Exception.Message }
    $dispatch = @('workflow', 'run', $SignOnGitHubWorkflow, '-R', $SignOnGitHubRepo, '--ref', $SignOnGitHubRef)
    foreach ($k in $in.Keys) { $dispatch += @('-f', ($k + '=' + $in[$k])) }
    try { [void](& $Gh @dispatch) } catch { return ('the fork''s signing job could not be started: ' + $_.Exception.Message) }
    Write-Host ("  asked {0} to sign release.json ({1}), request {2}" -f $SignOnGitHubRepo, $in.manifest_sha256.Substring(0, 12), $Request) -ForegroundColor DarkGray

    $until = (Get-Date).AddSeconds($WaitSeconds)
    $run = $null
    while ($true) {
        try { $run = Find-SignOnGitHubRun $Gh $Request } catch { return ('the fork''s signing runs could not be read: ' + $_.Exception.Message) }
        if ($null -ne $run -and [string]$run.status -eq 'completed') { break }
        if ((Get-Date) -gt $until) {
            if ($null -eq $run) { return "the fork started no signing run for $Request in $WaitSeconds seconds" }
            return ("the fork's signing run is still " + [string]$run.status + " after $WaitSeconds seconds: " + [string]$run.url)
        }
        Start-Sleep -Seconds $Poll
    }
    if ([string]$run.conclusion -ne 'success') {
        return ("the fork's signing run ended " + [string]$run.conclusion + ', so nothing was signed (its launcher job says whether the launcher this release names failed the launcher''s own check): ' + [string]$run.url)
    }

    $got = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-signed-' + [Guid]::NewGuid().ToString('N'))
    try {
        $fetch = @('run', 'download', [string]$run.databaseId, '-R', $SignOnGitHubRepo, '-n', ('release-cat-' + $Request), '-D', $got)
        try { [void](& $Gh @fetch) }
        catch { return ('the signed catalog could not be fetched from ' + [string]$run.url + ': ' + $_.Exception.Message) }
        $cat = Join-Path $got 'release.cat'
        if (-not (Test-Path -LiteralPath $cat -PathType Leaf)) { return ('the signing run kept no release.cat: ' + [string]$run.url) }
        Copy-Item -LiteralPath $cat -Destination $Catalog -Force
    } finally { Remove-Item -LiteralPath $got -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Host ("  signed on GitHub: " + [string]$run.url) -ForegroundColor DarkGray
    return (Get-SignedCatalogRefusal $Json $Catalog $in.expected_signer $RepoDir $Box)
}

# '' when $Catalog holds $Json as it is and passes the launcher's own check,
# else why. Here on Windows; on the box anywhere else (-Box stands in for it).
function Get-SignedCatalogRefusal([string]$Json, [string]$Catalog, [string]$ExpectedSigner, [string]$RepoDir, [scriptblock]$Box) {
    $onWindows = ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT)
    if ($onWindows -and -not $Box) {
        $st = ''
        try { $st = [string](Test-FileCatalog -Path (Split-Path -Parent $Json) -CatalogFilePath $Catalog) }
        catch { return ('the signed catalog could not be checked against release.json: ' + $_.Exception.Message) }
        if ($st -ne 'Valid') { return "the signed catalog does not hold release.json as it is here (Test-FileCatalog said $st)" }
        return (Get-PublishSignRefusal -Path $Catalog -ExpectedSigner $ExpectedSigner)
    }
    $script = New-SignedCatalogCheckScript $Json $Catalog $ExpectedSigner $RepoDir
    $lines = @()
    try {
        if ($Box) { $lines = @(& $Box $script) }
        else {
            $vps = Join-Path $PSScriptRoot '..\vps'
            . (Join-Path $vps 'Send-Script.ps1')
            $target = (Get-ThornswoodVpsUser) + '@' + (Get-ThornswoodVpsAddress)
            $lines = @(Invoke-ThornswoodRemote -Target $target -SshArgs @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes') -Script $script)
        }
    } catch { return ('the box could not check the signed catalog: ' + $_.Exception.Message) }
    $said = @($lines | ForEach-Object { [string]$_ } | Where-Object { $_ -match '^CATALOG ' })
    if ($said.Count -ne 1) {
        return ('the box did not say whether the signed catalog passes (it answered: ' + ((@($lines | ForEach-Object { [string]$_ }) | Select-Object -Last 3) -join ' | ') + ')')
    }
    if ($said[0] -eq 'CATALOG ACCEPTED') { Write-Host '  the box, which holds no signing setup, accepts it with the launcher''s own check' -ForegroundColor DarkGray; return '' }
    return ($said[0] -replace '^CATALOG REFUSED ', '')
}

# The script the box runs: the two files and Signature.cs as base64, the
# check from Assert-PublishSigned.ps1 as it is here, and one line back,
# CATALOG ACCEPTED or CATALOG REFUSED <why>. Its folder goes whatever happens.
function New-SignedCatalogCheckScript([string]$Json, [string]$Catalog, [string]$ExpectedSigner, [string]$RepoDir) {
    $b64 = { param($p) [Convert]::ToBase64String([IO.File]::ReadAllBytes($p)) }
    $assert = [IO.File]::ReadAllText((Join-Path $RepoDir 'scripts\release\Assert-PublishSigned.ps1'))
    $q = { param($s) "'" + ([string]$s).Replace("'", "''") + "'" }
    return @(
        '$ErrorActionPreference = ''Stop'''
        '$d = Join-Path $env:TEMP (''thornswood-catalog-'' + [Guid]::NewGuid().ToString(''N''))'
        '$files = Join-Path $d ''files'''
        'New-Item -ItemType Directory -Force -Path $files | Out-Null'
        'try {'
        ('    [IO.File]::WriteAllBytes((Join-Path $files ''release.json''), [Convert]::FromBase64String(' + (& $q (& $b64 $Json)) + '))')
        ('    [IO.File]::WriteAllBytes((Join-Path $d ''release.cat''), [Convert]::FromBase64String(' + (& $q (& $b64 $Catalog)) + '))')
        ('    [IO.File]::WriteAllBytes((Join-Path $d ''Signature.cs''), [Convert]::FromBase64String(' + (& $q (& $b64 (Join-Path $RepoDir 'launcher\app\Signature.cs'))) + '))')
        $assert
        '    $AssertPublishSignedCs = Join-Path $d ''Signature.cs'''
        '    $st = [string](Test-FileCatalog -Path $files -CatalogFilePath (Join-Path $d ''release.cat''))'
        '    if ($st -ne ''Valid'') { ''CATALOG REFUSED the signed catalog does not hold release.json (Test-FileCatalog said '' + $st + '')'' }'
        ('    else { $why = Get-PublishSignRefusal -Path (Join-Path $d ''release.cat'') -ExpectedSigner ' + (& $q $ExpectedSigner))
        '        if ($why) { ''CATALOG REFUSED '' + $why } else { ''CATALOG ACCEPTED'' } }'
        '} catch { ''CATALOG REFUSED the box could not run the check: '' + $_.Exception.Message }'
        'finally { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }'
    ) -join "`r`n"
}
