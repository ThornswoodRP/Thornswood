<#
  test-publish-sign-gate.ps1

  Ship must refuse an unsigned tip (and a machine that cannot sign), not
  only print "not signing". Local Build-Launcher may still soft-skip; the
  gate is on publish to the feed (#825). Publish-Installer.ps1, which held
  the old installer to the same gate, went with it (#4824).

  Static wiring plus helper behaviour against temp unsigned files and a fake
  signing.json. No Azure, no network, no real Ship.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$Utf8 = New-Object Text.UTF8Encoding($false)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$assert = Join-Path $repo 'scripts\release\Assert-PublishSigned.ps1'
$ship = Join-Path $repo 'scripts\release\Ship.ps1'
$build = Join-Path $repo 'scripts\release\Build-Launcher.ps1'

Yes 'Assert-PublishSigned.ps1 is there' (Test-Path -LiteralPath $assert)
Yes 'Ship.ps1 is there' (Test-Path -LiteralPath $ship)
Yes 'Build-Launcher.ps1 is there' (Test-Path -LiteralPath $build)
if (-not (Test-Path -LiteralPath $assert)) {
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    exit 1
}

. $assert

$shipSrc = [IO.File]::ReadAllText($ship, $Utf8)
$buildSrc = [IO.File]::ReadAllText($build, $Utf8)

Yes 'Ship dotsources Assert-PublishSigned' ($shipSrc -match 'Assert-PublishSigned\.ps1')
Yes 'Ship calls Get-SigningConfigRefusal' ($shipSrc -match 'Get-SigningConfigRefusal')
Yes 'Ship calls Get-PublishSignRefusal for the launcher' ($shipSrc -match 'Get-PublishSignRefusal')
Yes 'Build-Launcher signs every program of the launcher, the native libraries too (#4823)' (
    $buildSrc.Contains('$programs = @(Get-ChildItem -LiteralPath $outDir -File | Where-Object { $_.Extension -in ''.exe'', ''.dll'' })') -and
    $buildSrc.Contains('& $signer -Path @($programs | ForEach-Object { $_.FullName })'))
Yes '  and there is no setup stub left to leave unsigned (#4824)' ($buildSrc -notmatch 'setup-stub')

$frag = Get-ExpectedSignerFragment -RepoRoot $repo
# Compared with Updater.cs read here, rather than with the name written out, so
# the name stays in the one place it has to be (#1052).
$pinned = [regex]::Match([IO.File]::ReadAllText((Join-Path $repo 'launcher\app\Updater.cs')), 'const string ExpectedSigner = "([^"]+)"').Groups[1].Value
Yes 'ExpectedSigner fragment is the one Updater.cs pins' ($frag -and $frag -eq $pinned)
# The fragment is read from Updater.cs above. This file must not contain it,
# and nothing this harness prints may either. Say "the name on the signing
# certificate" (#1176).
$gatePath = $MyInvocation.MyCommand.Path
Yes 'this harness does not contain the name on the signing certificate' (
    $gatePath -and $pinned -and
    ([IO.File]::ReadAllText($gatePath, $Utf8)).IndexOf($pinned, [StringComparison]::Ordinal) -lt 0)

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-sign-gate-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
    $missing = Get-SigningConfigRefusal -ConfigPath (Join-Path $work 'no-such-signing.json') -RepoRoot $repo
    Yes 'missing signing.json refuses Ship' ($missing -match 'signing\.json' -and $missing -match 'Nothing was published')

    $off = Join-Path $work 'signing-off.json'
    [IO.File]::WriteAllText($off, '{"enabled":false,"method":"artifactsigning"}', $Utf8)
    $disabled = Get-SigningConfigRefusal -ConfigPath $off -RepoRoot $repo
    Yes 'enabled false refuses Ship' ($disabled -match 'enabled')

    $on = Join-Path $work 'signing-on.json'
    [IO.File]::WriteAllText($on, '{"enabled":true,"method":"thumbprint","thumbprint":"ABC"}', $Utf8)
    $ready = Get-SigningConfigRefusal -ConfigPath $on -RepoRoot $repo
    Yes 'enabled true with no placeholder metadata is ready' ($ready -eq '')

    $unsigned = Join-Path $work 'Thornswood.exe'
    [IO.File]::WriteAllBytes($unsigned, [byte[]](0x4D, 0x5A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))
    $refuse = Get-PublishSignRefusal -Path $unsigned -ExpectedSigner $frag
    . (Join-Path $PSScriptRoot 'Windows.ps1')
    if ($OnWindows) {
        Yes 'unsigned launcher tip is refused' ($refuse -match 'not Authenticode Valid' -and $refuse -match 'Nothing was published')
    } else {
        # Only Windows reads a signature, so here every file is refused, and the
        # refusal says why in words rather than as a command not found.
        Yes 'unsigned launcher tip is refused: off Windows no signature can be read, and it says so' (
            $refuse -match 'cannot be checked for a signature on this machine' -and $refuse -match 'Nothing was published' -and $refuse -notmatch 'not recognized')
    }

    $missingFile = Get-PublishSignRefusal -Path (Join-Path $work 'gone.exe') -ExpectedSigner $frag
    Yes 'missing tip file is refused' ($missingFile -match 'missing file')

    if (-not $OnWindows) {
        Write-Host 'SKIP  a file Microsoft signed, refused for its signer: only Windows reads a signature'
    } else {
        # pwsh.exe, which Microsoft signs.
        $wrong = Get-PublishSignRefusal -Path (Get-BoxPowerShell) -ExpectedSigner $frag
        Yes 'Valid signature without ExpectedSigner is refused' (
            $wrong -match 'ExpectedSigner' -or $wrong -match 'does not contain')
    }

    # A signing.json with no "enabled" (#1072), the shape records\signing\README.md
    # shows. Ship runs under Set-StrictMode -Version Latest and its children
    # inherit it, so both are run that way, in a child, as Ship runs them.
    $bare = Join-Path $work 'signing-bare.json'
    [IO.File]::WriteAllText($bare, '{"method":"thumbprint","thumbprint":"ABC","timestampUrl":"http://timestamp.example"}', $Utf8)
    $sh = (Get-Process -Id $PID).Path
    function Q([string]$s) { return "'" + $s.Replace("'", "''") + "'" }
    function Child([string]$cmd) {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { return (& $sh -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $cmd 2>&1 | Out-String) }
        finally { $ErrorActionPreference = $old }
    }
    $out = Child ("Set-StrictMode -Version Latest; `$ErrorActionPreference = 'Stop'; . $(Q $assert); " +
                  "'GATE=[' + (Get-SigningConfigRefusal -ConfigPath $(Q $bare) -RepoRoot $(Q $repo)) + ']'")
    Yes ('under strict mode, a signing.json with no "enabled" is ready, not an error' + $(if ($out -notmatch 'GATE=\[\]') { ': ' + $out.Trim() } else { '' })) (
        $out -match 'GATE=\[\]' -and $out -notmatch 'cannot be found')
    $meta = Join-Path $work 'metadata.json'
    [IO.File]::WriteAllText($meta, '{"Endpoint":"https://example.invalid"}', $Utf8)
    $noProfile = Join-Path $work 'signing-noprofile.json'
    [IO.File]::WriteAllText($noProfile, ('{"method":"artifactsigning","metadata":' + ($meta | ConvertTo-Json) + '}'), $Utf8)
    $out = Child ("Set-StrictMode -Version Latest; `$ErrorActionPreference = 'Stop'; . $(Q $assert); " +
                  "'GATE=[' + (Get-SigningConfigRefusal -ConfigPath $(Q $noProfile) -RepoRoot $(Q $repo)) + ']'")
    Yes '  and a metadata.json with no profile name gets the gate''s sentence, not an error' ($out -match 'GATE=\[the certificate profile' -and $out -notmatch 'cannot be found')

    $signer = Join-Path $repo 'scripts\release\Sign-Artifact.ps1'
    $out = Child ("Set-StrictMode -Version Latest; & $(Q $signer) -Path $(Q (Join-Path $work 'not-built.exe')) -ConfigPath $(Q $bare)")
    Yes ('under strict mode, Sign-Artifact reads it and goes on to look for signtool' + $(if ($out -match 'cannot be found|not signing') { ': ' + $out.Trim() } else { '' })) (
        $out -notmatch 'cannot be found on this object' -and $out -notmatch 'not signing' -and $out -match 'signtool')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
