<#
  test-tools-retired.ps1

      pwsh -NoProfile -File .\tests\test-tools-retired.ps1

  tools\ is gone: git tracks nothing in it, this checkout has no such folder,
  nothing in the repository tells anybody to type one of the old forwarding
  copies, no script, harness or workflow reads a path under it, and every
  file a machine used to keep there has a home of its own that git ignores.

  WHY. The reorganisation (issue #440) moved every script out of tools\ into
  scripts\<area> on 25 September and left forwarding copies of the eleven
  commands people typed most, plus tools\Vps.ps1, "for one release". Main
  release 1.1.101 went out from the new layout on 27 September, and the rule
  since 28 September is no backwards compatibility except for updating, so
  the copies went (phase 9). Phase 10, 29 September, moved what was left, the
  files one machine keeps and git never sees, and deleted the folder:

      signing.json                    records\signing\signing.json
      setup-stub.exe, setup-stub.pdb  out\ (the build output, Where.ps1 Out)
      thornswood-front.zip            local\
      mod-audit.json                  local\
      backup-key.txt                  local\

  The setup stub went with the old installer in #4824, so nothing makes or
  reads setup-stub.exe or its .pdb any more; out\ stays the build output.

  A doc that still says .\tools\Ship.ps1 sends somebody to a file that is not
  there, and a script that still reads tools\signing.json would decide a
  signing machine cannot sign, which is what this catches.

  HOW. git ls-files, and every tracked text file read for a path to one of
  the old copies, and every script, harness and workflow read for a path it
  builds into tools\. docs\archive and scripts\oneoff are history and keep the
  paths they were written with. Sync-LoadOrder.py is asked for its default
  settings file, because until phase 9 it looked two folders up from
  scripts\mods and fell back to the old C:\Thornswood-Dev folder.

  Read only.
#>
[CmdletBinding()]
param([string]$Repo)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
if (-not $Repo) {
    $Here = $PSScriptRoot
    if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
    $Repo = Split-Path -Parent $Here
}

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# The folder's name, built so that this file's own text does not match the
# searches below.
$T = 'to' + 'ols'

# ---- 1. there is no tools folder --------------------------------------------
$trackedTools = @(& git -C $Repo ls-files -- $T)
Yes ('git tracks nothing in ' + $T + ' (' + ($trackedTools -join ', ') + ')') ($trackedTools.Count -eq 0)
$folder = Join-Path $Repo $T
$left = @()
if (Test-Path -LiteralPath $folder) { $left = @(Get-ChildItem -LiteralPath $folder -Force -Recurse -File | ForEach-Object { $_.Name }) }
Yes ('there is no ' + $T + ' folder in this checkout' + $(if ($left.Count) { ' (it still holds ' + ($left -join ', ') + ': move them to their homes, see the header)' } else { '' })) (
    -not (Test-Path -LiteralPath $folder))

$stubs = @('Build-Launcher', 'Deploy-DevGamemode', 'Deploy-Docs', 'Deploy-Gamemode',
           'Deploy-Server', 'Go', 'Install-Bot', 'Install-Runner', 'Install-Voice', 'Ship', 'Vps')
$areas = @('release', 'deploy', 'vps', 'ops', 'mods', 'dev')
foreach ($s in $stubs) {
    $real = @($areas | Where-Object { Test-Path -LiteralPath ([IO.Path]::Combine($Repo, 'scripts', $_, $s + '.ps1')) })
    Yes ('  ' + $s + '.ps1 is in scripts\' + ($real -join ',')) ($real.Count -eq 1)
}

# ---- 2. nothing tells anybody to run one of the old copies ------------------
$rx = [regex]('(?i)' + $T + '[\\/]+(' + (($stubs | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')\.ps1\b')
$skip = '^(docs/archive/|scripts/oneoff/|tests/test-tools-retired\.ps1$|tests/test-vps-defaults\.ps1$)'
$hits = @()
$read = 0
$all = @(& git -C $Repo ls-files)
foreach ($f in $all) {
    if ($f -match $skip) { continue }
    if ($f -notmatch '\.(md|ps1|psm1|js|cs|py|json|yml|yaml|txt|cmd|bat|html|xaml|ini)$') { continue }
    $full = Join-Path $Repo $f
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $text = [IO.File]::ReadAllText($full)
    $read++
    $i = 0
    foreach ($line in ($text -split "`n")) {
        $i++
        if ($rx.IsMatch($line)) { $hits += ('{0}:{1}' -f $f, $i) }
    }
}
foreach ($h in $hits) { Write-Host "      still names an old $T copy: $h" }
Yes ("no tracked file names an old $T copy ($read files read)") ($hits.Count -eq 0 -and $read -gt 500)

# ---- 3. no script, harness or workflow builds a path into tools -------------
# What a path into the folder looks like in code: '..\..\tools\x', 'tools\x'
# handed to Join-Path, (Split-Path -Parent $Here) 'tools', the harnesses' old
# TOOLS_DIR, path.join(__dirname, '..', 'tools'), and a workflow that lists
# the folder beside scripts.
#
# The folder name is matched as written, lowercase. Skyrim's Creation Kit
# installs its own Tools\ into the game folder, and the lines that keep those
# files out of a release (#1152) name it that way. A capital T is that game
# folder, not this repository.
$code = @(
    ("'(?:\.\.\\)*" + $T + "\\"),
    ("Join-Path \S+ '" + $T + "'"),
    ("'\.\.', '" + $T + "'"),
    ($T.ToUpper() + '_DIR'),
    ("scripts, " + $T + ", tests")
)
$codeRx = [regex]($code -join '|')
# Proved on strings in this file, which the scan below skips. A real path into
# this repository still matches. A Creation Kit path does not.
$intoRepo = "'" + '..\..\' + $T + '\signing.json' + "'"
$intoGame = "'Tools\Archive\Archive.exe'"
Yes 'a path into this repository''s tools\ still matches' (
    $codeRx.IsMatch($intoRepo) -and $codeRx.IsMatch(("'" + $T + '\signing.json' + "'")) -and
    $codeRx.IsMatch(('Join-Path $Here ''' + $T + '''')))
Yes 'a Creation Kit path under Tools\ is not a path into this repository' (
    -not $codeRx.IsMatch($intoGame) -and -not $codeRx.IsMatch('$_ -like ''Tools\*'''))
$codeSkip = '^(scripts/oneoff/|tests/test-tools-retired\.ps1$)'
$codeHits = @()
$codeRead = 0
foreach ($f in $all) {
    if ($f -match $codeSkip) { continue }
    if ($f -notmatch '^(scripts|tests|installer|bot|voice|site|\.github)/') { continue }
    if ($f -notmatch '\.(ps1|psm1|js|py|yml|yaml|cmd|bat)$') { continue }
    $full = Join-Path $Repo $f
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $codeRead++
    $i = 0
    foreach ($line in ([IO.File]::ReadAllText($full) -split "`n")) {
        $i++
        if ($codeRx.IsMatch($line)) { $codeHits += ('{0}:{1}  {2}' -f $f, $i, $line.Trim()) }
    }
}
foreach ($h in $codeHits) { Write-Host "      builds a path into ${T}: $h" }
Yes ("no script, harness or workflow builds a path into $T ($codeRead files read)") ($codeHits.Count -eq 0 -and $codeRead -gt 300)

# ---- 4. every file a machine kept there has its own home ---------------------
# Its new path is ignored by git, the script that reads it names that path,
# and the guide lists it (its index or a page: tests/Guide-Text.ps1).
. (Join-Path $PSScriptRoot 'Guide-Text.ps1')
$dev = Get-GuideText
function Read-Repo([string]$rel) { [IO.File]::ReadAllText((Join-Path $Repo $rel)) }
$homes = @(
    @{ File = 'signing.json'; At = 'records/signing/signing.json'; Script = 'scripts\release\Sign-Artifact.ps1'; Says = "'..\..\records\signing\signing.json'" },
    @{ File = 'signing.json'; At = 'records/signing/signing.json'; Script = 'scripts\release\Ship.ps1'; Says = "'..\..\records\signing\signing.json'" },
    @{ File = 'signing.json'; At = 'records/signing/signing.json'; Script = 'scripts\release\Setup-ShipMachine.ps1'; Says = "Join-Path `$RepoDir 'records\signing\signing.json'" },
    @{ File = 'signing.json'; At = 'records/signing/signing.json'; Script = 'scripts\release\Check-ShipReady.ps1'; Says = "Join-Path `$RepoDir 'records\signing\signing.json'" },
    @{ File = 'thornswood-front.zip'; At = 'local/thornswood-front.zip'; Script = 'scripts\release\Go.ps1'; Says = "'..\..\local\thornswood-front.zip'" },
    @{ File = 'mod-audit.json'; At = 'local/mod-audit.json'; Script = 'scripts\mods\Audit-Mods.ps1'; Says = "Join-Path `$outDir 'mod-audit.json'" },
    @{ File = 'backup-key.txt'; At = 'local/backup-key.txt'; Script = 'scripts\vps\Restore-Backup.ps1'; Says = "'..\..\local\backup-key.txt'" }
)
foreach ($h in $homes) {
    & git -C $Repo check-ignore -q -- $h.At
    $ignored = ($LASTEXITCODE -eq 0)
    $text = Read-Repo $h.Script
    Yes ('  ' + $h.File + ' is at ' + $h.At + ', ignored by git, and ' + (Split-Path -Leaf $h.Script) + ' reads it there') (
        $ignored -and $text.Contains($h.Says))
    Yes ('    and the guide lists ' + $h.File) ($dev.Contains('`' + $h.File + '`'))
}
# Where.ps1 is what Setup-ShipMachine asks for out\, so it has to say out.
$out = [string](& (Join-Path $Repo 'scripts\release\Where.ps1') Out)
Yes ('Where.ps1 Out is the out folder in the repository (' + $out + ')') (
    [IO.Path]::GetFullPath($out) -eq [IO.Path]::GetFullPath((Join-Path $Repo 'out')))

# ---- 5. Sync-LoadOrder.py finds the fork in the repository ------------------
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
if ($py) {
    $sync = Join-Path $Repo 'scripts\mods\Sync-LoadOrder.py'
    $pycode = "import importlib.util,sys; s=importlib.util.spec_from_file_location('s', sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.default_settings())"
    $said = [string](& $py.Source -c $pycode $sync)
    $want = [IO.Path]::Combine($Repo, 'engine', 'skymp', 'build', 'dist', 'server', 'server-settings.json')
    Yes ('Sync-LoadOrder.py''s default settings are in the repository''s engine build (' + $said.Trim() + ')') (
        [IO.Path]::GetFullPath($said.Trim()) -eq [IO.Path]::GetFullPath($want))
}
else {
    Write-Host 'SKIP  no python here to ask Sync-LoadOrder.py'
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
