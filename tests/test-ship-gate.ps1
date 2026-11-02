<#
  test-ship-gate.ps1

  A main release ships what is on GitHub, and nothing else.

  Entry 205 on the list. Ship used to build from the working tree, then
  `git add -A`, commit it and push it to main, which is how a 28 KB audit
  document ended up inside the 1.1.45 release commit. Since f917dd8 on 22 Sep
  Ship commits nothing, and its Git gate refuses a main release with anything
  uncommitted or unpushed. The review of that on 24 Sep found two ways round
  the gate, and this proves both are shut:

  1. A file git has never been told about. The gate counted with
     `git status --untracked-files=no`, so a new file was invisible to it, and
     Go.ps1 copies every game\plugins\*.js into the game folder whether
     git knows it or not. A scratch plugin would pass the gate and go out in
     the pack, which is where the entry's worry ("a scratch file with
     something private in it lands next") had moved to.

  2. -Version on a main release. It wrote a new number into Updater.cs, built,
     published, and nothing committed it or put it back, so every launcher
     would be told a version main had never heard of. Since #4825 Ship sends
     no launcher and has no number at all, so this holds that its param block
     declares none of the switches that chose one (-Version, -NoBump,
     -ModsOnly, -RebuildLauncher).

  It lifts the Git gate out of the shipped Ship.ps1 and drives it against a throwaway repository with its own origin, so nothing
  here touches this repository, the network or any launcher. Read only apart
  from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$ShipPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $ShipPath) { $ShipPath = Join-Path $Here 'scripts\release\Ship.ps1' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host "$script:pass passed, $script:fail failed"
    exit $(if ($script:fail) { 1 } else { 0 })
}

$src = [IO.File]::ReadAllText($ShipPath)

$tokens = $null; $errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ShipPath, [ref]$tokens, [ref]$errs)
Yes 'Ship.ps1 parses' (@($errs).Count -eq 0)

# ---- lift the two blocks out of the shipped script --------------------------
# The whole if statement from its first character to its matching brace, so
# the condition in front of it runs too.
function Statement([string]$text, [int]$at) {
    $b = $text.IndexOf('{', $at)
    $depth = 0
    for ($i = $b; $i -lt $text.Length; $i++) {
        if ($text[$i] -eq '{') { $depth++ }
        elseif ($text[$i] -eq '}') { $depth--; if ($depth -eq 0) { return $text.Substring($at, $i - $at + 1) } }
    }
    return ''
}

$gateAt = $src.IndexOf('if (-not $DryRun -and (Test-Path (Join-Path $RepoDir ''.git''))) {')
Yes 'the Git gate is in Ship.ps1' ($gateAt -ge 0)
# No number to choose (#4825): the param block declares none of the switches
# that chose the launcher's, so no Ship can tell a launcher a version.
$declared = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
$gone = @('Version', 'NoBump', 'ModsOnly', 'RebuildLauncher' | Where-Object { $declared -contains $_ })
Yes ("V1 Ship.ps1 declares no -Version, -NoBump, -ModsOnly or -RebuildLauncher: '" + ($gone -join ', ') + "'") ($declared.Count -gt 0 -and $gone.Count -eq 0)
Yes 'V2 and nothing in it works out a launcher number' (-not $src.Contains('Get-LauncherVersion') -and -not $src.Contains('$target') -and -not $src.Contains('VersionOverride'))
if ($gateAt -lt 0) { Done }
$gate = Statement $src $gateAt

# Die is Ship's own exit; here it throws, so a refusal comes back as its words.
$stubs = 'function Say($m, $c) { }; function Head($m) { }; function Die($m) { throw ("STOP. " + $m) };'
$gateSb = [scriptblock]::Create('$RepoDir = $args[0]; $Dev = $args[1]; $DryRun = $false;' + $stubs + $gate)

# '' when the gate lets the release through, the STOP line when it does not.
function Gate([string]$repo, [bool]$dev) {
    try { & $gateSb $repo $dev | Out-Null; return '' }
    catch { return [string]$_.Exception.Message }
}

# git writes progress on stderr even when all is well, which Stop turns into a
# halt in Windows PowerShell. Not called Git: a function wins over git.exe,
# and the lifted gate calls git.
function Run-Git {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & git @args 2>&1 | Out-Null; return $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
}
function Put([string]$rel, [string]$text) {
    $p = Join-Path $work $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
    [IO.File]::WriteAllText($p, $text)
}
function Drop([string]$rel) { Remove-Item -LiteralPath (Join-Path $work $rel) -Force }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tsgate-' + [Guid]::NewGuid().ToString('N'))
$origin = Join-Path $tmp 'origin.git'
$work = Join-Path $tmp 'work'

try {
    # ---- a repository shaped like this one, with an origin to be behind --------
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $ok = ((Run-Git init -q --bare $origin) -eq 0)
    $ok = $ok -and ((Run-Git init -q $work) -eq 0)
    $ok = $ok -and ((Run-Git -C $work symbolic-ref HEAD refs/heads/main) -eq 0)
    foreach ($kv in @(@('user.name', 'test'), @('user.email', 'test@example.invalid'), @('core.autocrlf', 'false'))) {
        $ok = $ok -and ((Run-Git -C $work config $kv[0] $kv[1]) -eq 0)
    }
    # The same ignore rules that matter here: the front's zip and the logs.
    Put '.gitignore' "*.zip`n*.log`n"
    Put 'game/plugins/thornswood-front.js' "// ours`n"
    Put 'launcher/app/Updater.cs' "class Updater { const string Version = ""1.1.92""; }`n"
    $ok = $ok -and ((Run-Git -C $work add -A) -eq 0)
    $ok = $ok -and ((Run-Git -C $work commit -q -m 'start') -eq 0)
    $ok = $ok -and ((Run-Git -C $work remote add origin $origin) -eq 0)
    $ok = $ok -and ((Run-Git -C $work push -q -u origin main) -eq 0)
    Yes 'a throwaway repository with an origin was made' $ok
    if (-not $ok) { Done }

    # G1: the ordinary case must still pass.
    $r = Gate $work $false
    Yes "G1 main, clean and in step with origin, goes through: '$r'" ($r -eq '')

    # G2: THE HOLE. A plugin git has never been told about.
    Put 'game/plugins/scratch.js' "// something private`n"
    $r = Gate $work $false
    Yes "G2 an untracked game\plugins\scratch.js stops a main release" ($r -ne '')
    Yes "G2 and says it is a file git does not know: '$r'" ($r -match 'git does not know')
    Yes 'G2 and counts it' ($r -match '\b1 file')

    # G3: the dev channel ships from the working tree on purpose, so the same
    #     file does not stop a dev release.
    $r = Gate $work $true
    Yes "G3 the same file does not stop a dev release: '$r'" ($r -eq '')
    Drop 'game/plugins/scratch.js'

    # G4: the launcher compiles every launcher\app\*.cs, tracked or not.
    Put 'launcher/app/Scratch.cs' "class Scratch { }`n"
    $r = Gate $work $false
    Yes 'G4 an untracked launcher\app\Scratch.cs stops a main release' ($r -match 'git does not know')
    Drop 'launcher/app/Scratch.cs'

    # G5: ignored files are not counted. Measured 24 Sep on Patrick's machine:
    #     14 files under tools are not tracked and every one is ignored
    #     (webhooks, signing.json, __pycache__, the front's zip, a log), so a
    #     gate that counted them would stop every main release.
    Put 'local/thornswood-front.zip' 'zip'
    Put 'tools/thornswood.log' "log`n"
    $r = Gate $work $false
    Yes "G5 ignored files under tools do not stop a main release: '$r'" ($r -eq '')

    # G6: untracked files outside tools do not ship, and there are always some:
    #     the ops repo's CLAUDE.md names Claude outputs\ and art-latest.txt.
    Put 'Claude outputs/notes.md' "notes`n"
    Put 'art-latest.txt' "art`n"
    $r = Gate $work $false
    Yes "G6 untracked files outside tools do not stop a main release: '$r'" ($r -eq '')

    # G7: the refusals that were already there still stand.
    Put 'game/plugins/thornswood-front.js' "// changed`n"
    $r = Gate $work $false
    Yes "G7 a changed tracked file still stops it: '$r'" ($r -match 'uncommitted')
    [void](Run-Git -C $work checkout -q -- game/plugins/thornswood-front.js)
    Put 'game/plugins/thornswood-more.js' "// more`n"
    [void](Run-Git -C $work add -- game/plugins/thornswood-more.js)
    [void](Run-Git -C $work commit -q -m 'more')
    $r = Gate $work $false
    Yes "G7 a commit not yet pushed still stops it: '$r'" ($r -match 'ahead of origin')

}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Done
