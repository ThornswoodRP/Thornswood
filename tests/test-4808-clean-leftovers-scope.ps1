<#
  test-4808-clean-leftovers-scope.ps1

      pwsh -NoProfile -File .\tests\test-4808-clean-leftovers-scope.ps1

  #4808. Clean-Leftovers.ps1 -Go deleted every file ending .bak, .old, .tmp,
  .temp, .orig, .backup or ~ under each folder it walked, and it walked the
  whole Downloads folder, the engine clone, the install's Game\Data (where
  Vortex deploys the collection) and two other launchers' folders: places
  Thornswood does not own. A delete that failed was printed and the run still
  exited 0.

  The real script runs as a child from a scratch copy of the repository (the
  script, Where.ps1 and layout.json), with the install, the user's folders
  and LocalAppData pointed at scratch folders, so no root it can reach is a
  real one: not this checkout's engine, not this machine's Downloads.

  The scratch tree:
    <install>\Launcher\Thornswood.exe.old            Thornswood's own: the
        launcher's swap leaves it, launcher\move clears it. Goes with -Go,
        once nothing holds it; the first -Go finds it undeletable (held open
        on Windows, a read-only folder elsewhere).
    <install>-DevBuild\Launcher\Thornswood.exe.old   the same in the dev
        build's install, which the main launcher's Settings page makes. Goes.
    <install>\Game\Data\CBBE.esp.bak                 deployed by Vortex. Stays.
    Downloads\someone-elses.bak                      another program's. Stays.
    Downloads\a-clone\notes.orig (with .git)         another clone. Stays.
    <repo>\engine\skymp\src\patch.orig               the engine clone. Stays.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Shell = (Get-Process -Id $PID).Path
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function P([string]$root, [string[]]$parts) { $p = $root; foreach ($x in $parts) { $p = Join-Path $p $x }; return $p }
function Put([string]$path, [string]$text = 'x') {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text)
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4808-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$saved = @{ USERPROFILE = $env:USERPROFILE; LOCALAPPDATA = $env:LOCALAPPDATA; THORNSWOOD_INSTALL = $env:THORNSWOOD_INSTALL }
$hold = $null
$lockedDir = $null
try {
    # The scratch repository: the script where main keeps it, and what it asks.
    $R = P $T @('repo')
    $script = P $R @('scripts', 'mods', 'Clean-Leftovers.ps1')
    Put $script ([IO.File]::ReadAllText((P $Repo @('scripts', 'mods', 'Clean-Leftovers.ps1'))))
    Put (P $R @('scripts', 'release', 'Where.ps1')) ([IO.File]::ReadAllText((P $Repo @('scripts', 'release', 'Where.ps1'))))
    Put (P $R @('layout.json')) ([IO.File]::ReadAllText((P $Repo @('layout.json'))))

    $I = P $T @('Thornswood')
    $U = P $T @('user')
    $L = P $T @('local')
    [void][IO.Directory]::CreateDirectory($L)
    $env:THORNSWOOD_INSTALL = $I
    $env:USERPROFILE = $U
    $env:LOCALAPPDATA = $L

    $lockedDir = P $I @('Launcher')
    $locked = Join-Path $lockedDir 'Thornswood.exe.old'
    $dev = P ($I + '-DevBuild') @('Launcher', 'Thornswood.exe.old')
    $deployed = P $I @('Game', 'Data', 'CBBE.esp.bak')
    $foreign = P $U @('Downloads', 'someone-elses.bak')
    $clone = P $U @('Downloads', 'a-clone', 'notes.orig')
    $engine = P $R @('engine', 'skymp', 'src', 'patch.orig')
    Put $locked; Put $dev; Put $deployed; Put $foreign; Put $clone; Put $engine
    Put (P $U @('Downloads', 'a-clone', '.git', 'HEAD')) 'ref: refs/heads/main'

    function Run([string[]]$a) {
        $ErrorActionPreference = 'Continue'
        $out = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script @a 2>&1 | Out-String
        return @{ Code = $LASTEXITCODE; Out = $out }
    }

    # 1. Without -Go nothing goes.
    $r = Run @('-NoPause')
    Yes 'without -Go it exits 0' ($r.Code -eq 0)
    Yes '  and removes nothing' ((Test-Path -LiteralPath $locked) -and (Test-Path -LiteralPath $dev) -and (Test-Path -LiteralPath $deployed) -and (Test-Path -LiteralPath $foreign) -and (Test-Path -LiteralPath $clone) -and (Test-Path -LiteralPath $engine))
    Yes '  and lists the launcher''s Thornswood.exe.old in both installs' ($r.Out.Contains($locked) -and $r.Out.Contains($dev))

    # 2. -Go, with one of Thornswood's own leftovers that cannot be deleted.
    if ($IsWindows) { $hold = [IO.File]::Open($locked, 'Open', 'Read', 'None') }
    else { [IO.File]::SetUnixFileMode($lockedDir, [IO.UnixFileMode]'UserRead,UserExecute') }
    $r = Run @('-Go', '-NoPause')
    Yes '-Go removes Thornswood''s own leftover in the dev build''s install' (-not (Test-Path -LiteralPath $dev))
    Yes '-Go leaves a file Vortex deployed into Game\Data' (Test-Path -LiteralPath $deployed)
    Yes '-Go leaves another program''s file in Downloads' (Test-Path -LiteralPath $foreign)
    Yes '-Go leaves a file in another clone in Downloads' (Test-Path -LiteralPath $clone)
    Yes '-Go leaves a file in the engine clone' (Test-Path -LiteralPath $engine)
    Yes 'a leftover that would not delete is still there' (Test-Path -LiteralPath $locked)
    Yes '  and the run exits non-zero' ($r.Code -ne 0)
    Yes '  naming it' ($r.Out.Contains($locked))
    if ($hold) { $hold.Dispose(); $hold = $null }
    if (-not $IsWindows) { [IO.File]::SetUnixFileMode($lockedDir, [IO.UnixFileMode]'UserRead,UserWrite,UserExecute') }

    # 3. -Go again once it can be deleted.
    $r = Run @('-Go', '-NoPause')
    Yes 'once nothing holds it, -Go removes it and exits 0' ((-not (Test-Path -LiteralPath $locked)) -and $r.Code -eq 0)
    Yes '  and still leaves Data, Downloads and the clones alone' ((Test-Path -LiteralPath $deployed) -and (Test-Path -LiteralPath $foreign) -and (Test-Path -LiteralPath $clone) -and (Test-Path -LiteralPath $engine))
}
finally {
    if ($hold) { $hold.Dispose() }
    if (-not $IsWindows -and $lockedDir -and (Test-Path -LiteralPath $lockedDir)) { [IO.File]::SetUnixFileMode($lockedDir, [IO.UnixFileMode]'UserRead,UserWrite,UserExecute') }
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
