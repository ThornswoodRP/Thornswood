# tests\test-sign-pilot.ps1
# Issue #2163. The verify half of scripts\release\Test-SignPilot.ps1, offline:
# no Azure sign in and no signing. An unsigned test exe, a stale SHA256SUMS
# and a missing folder must each be refused (exit 1), never accepted with a
# warning. The signed run is the pilot on One, recorded in
# records\signing\pilot-2163.json.
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'NOT RUN  the verify half reads Authenticode signatures, which are Windows'' own'; exit 0 }
$boxPs = Get-BoxPowerShell
$repo = Split-Path -Parent $PSScriptRoot
$pilot = Join-Path $repo 'scripts\release\Test-SignPilot.ps1'
$pass = 0; $fail = 0
function T([bool]$ok, [string]$what) { if ($ok) { Write-Host "PASS  $what"; $script:pass++ } else { Write-Host "FAIL  $what"; $script:fail++ } }
function Run([string]$dir) {
    $o = & $boxPs -NoProfile -ExecutionPolicy Bypass -File $pilot -Verify -Out $dir 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Text = $o }
}

$errs = $null; [void][Management.Automation.Language.Parser]::ParseFile($pilot, [ref]$null, [ref]$errs)
T ($errs.Count -eq 0) 'Test-SignPilot.ps1 parses'
$raw = Get-Content -LiteralPath $pilot -Raw
T ($raw -match "Sign-Artifact\.ps1'\) @signArgs" -and $raw -match 'Required = \$true') 'the pilot signs through Sign-Artifact.ps1 -Required, the same path as a release'
T ($raw -match 'Get-PublishSignRefusal') 'the pilot verifies with the Ship gate (Get-PublishSignRefusal)'
T ($raw -notmatch 'release\.yml\s*=|Publish-Update|Send-FeedStore|Publish-Installer\.ps1') 'the pilot touches no release, feed or publish path'

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('sign-pilot-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
    $r = Run (Join-Path $scratch 'nothing-here')
    T ($r.Code -eq 1) 'a folder with no pilot.exe is refused'

    $exe = Join-Path $scratch 'pilot.exe'
    # PowerShell 7's Add-Type writes no exe, so the .NET SDK the launcher
    # builds with makes it, with its apphost, as Test-SignPilot.ps1 does
    # (#5356, #4823).
    . (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')
    $built = $null
    try { $built = Build-LauncherCode -Exe -Property @{ UseAppHost = 'true' } -Source 'public static class P { public static int Main() { return 0; } }' }
    catch { ($_.Exception.Message -split "`n") | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
    $builtExe = if ($built) { [IO.Path]::ChangeExtension($built, '.exe') } else { '' }
    T ($builtExe -and (Test-Path -LiteralPath $builtExe)) 'the .NET SDK made the unsigned exe'
    if ($builtExe -and (Test-Path -LiteralPath $builtExe)) { Copy-Item -LiteralPath $builtExe -Destination $exe }
    $h = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
    Set-Content (Join-Path $scratch 'SHA256SUMS') "$h  pilot.exe" -Encoding ascii
    (@{ signedSha256 = $h; unsignedSha256 = 'x' } | ConvertTo-Json) | Set-Content (Join-Path $scratch 'provenance.json')
    $r = Run $scratch
    T ($r.Code -eq 1) 'an unsigned exe with a correct checksum is still refused'
    T ($r.Text -match 'PASS\s+SHA256SUMS matches') 'the checksum check still runs and passes on its own'
    T ($r.Text -match 'FAIL\s+the Ship gate') 'the refusal names the signature check'

    Set-Content (Join-Path $scratch 'SHA256SUMS') ("0" * 64 + "  pilot.exe") -Encoding ascii
    $r = Run $scratch
    T ($r.Code -eq 1 -and $r.Text -match 'FAIL\s+SHA256SUMS matches') 'a checksum that does not match is refused'

    $rec = Get-Content (Join-Path $repo 'records\signing\pilot-2163.json') -Raw | ConvertFrom-Json
    T ($rec.signedSha256 -match '^[0-9a-f]{64}$' -and $rec.signerMatchesExpectedSigner -eq $true -and -not $rec.PSObject.Properties['signer']) 'the pilot record names a signed hash and the release signer'
    T (-not ((Get-Content (Join-Path $repo 'records\signing\pilot-2163.json') -Raw) -match '(?i)password|secret|token|BEGIN ')) 'the pilot record holds no secret'
} finally { Remove-Item -LiteralPath $scratch -Recurse -Force -EA SilentlyContinue }

Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
