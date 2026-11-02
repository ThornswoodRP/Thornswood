<#
  test-bot-lib-rollback.ps1

  Issue #1076. A full Install-Bot run installs the bot libraries into
  py-libs beside the code, and the swap puts that folder back with the code.
  This bumps a library in a scratch folder, the new bot fails to start, and
  the old version is what runs afterwards.

  Nothing here is the live bot. The scratch folder is under the temp directory.
  pip installs a local wheel with --target, not into the machine Python.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
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

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path (Join-Path $Here '..')).Path
$install = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Install-Bot.ps1'))
$swap = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Swap.ps1'))
# The code it sends (the live smoke export was on it from #2020 until the
# checklist came out on 11 Oct), and never joins.json, the bot's own record (#2042).
Yes 'Install-Bot installs into py-libs with pip --target, and sends the code, never joins.json' (
    $install.Contains('--target ''$rootWin\$stageName\py-libs''') -and
    $install.Contains('foreach ($f in ''bot.py'', ''_pyguard.py'', ''trust.py'', ''card.py'', ''staff-channel.txt'', ''dev-channel.txt'', ''requirements.txt'', ''factions.json'')') -and
    -not $install.Contains('joins.json'''))
Yes 'the swap is told to put py-libs back with the code' ($install.Contains('$Dirs = @(''''py-libs'''')') -and $swap.Contains('$moveRels'))
# pip --target on Python 3.12.4 and later leaves its files with the rules of
# the folder tempfile.mkdtemp made (SYSTEM, Administrators, owner) and none of
# the bot folder's, so the bot's account could not read them (11 Oct).
Yes 'Install-Bot puts py-libs under the folder''s rules and refuses before stopping the bot when its account cannot read a file' (
    $install.Contains('& icacls ''$rootWin\$stageName\py-libs'' /reset /T /Q') -and
    $install.Contains('''NT SERVICE\$Service''') -and
    $install.Contains('if ("$libs" -match ''PY-LIBS NOT'') { Die'))

# The python the bot runs on: python on the PATH, the one Bot-Service.ps1
# hands the service and Install-Bot.ps1 installs for all users (3.12 on the
# VPS), else whatever py -3 finds. Taken by its full path, so the swap below
# starts the same one. Until #1880 this asked py for 3.9, which neither the
# bot nor the VPS has, so on the build runner it stopped at the first wheel.
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
$py = ''
foreach ($c in @(@('python'), @('py', '-3'))) {
    if (-not (Get-Command $c[0] -CommandType Application -EA SilentlyContinue)) { continue }
    $pre = @($c | Select-Object -Skip 1)
    $o = ''
    try { $o = "$(& $c[0] @pre -c 'import sys; print(sys.executable)' 2>$null | Select-Object -Last 1)".Trim() } catch { }
    if ($LASTEXITCODE -ne 0 -or -not $o -or -not (Test-Path -LiteralPath $o)) { continue }
    $null = & $o -m pip --version 2>$null
    if ($LASTEXITCODE -eq 0) { $py = $o; break }
}
if (-not $py) {
    Write-Host 'SKIP  needs a python 3 with pip'
    Done
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-lib1076-' + [Guid]::NewGuid().ToString('N'))
$rootBot = Join-Path $work 'bot'
$stageName = '.stage-test'
$stage = Join-Path $rootBot $stageName
Yes 'the scratch folder is not the live bot' ($rootBot -notmatch 'Thornswood-Bot')
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$maker = Join-Path $work 'make-wheel.py'
$makerLines = @(
    'import base64, hashlib, pathlib, sys, zipfile'
    'ver, dest = sys.argv[1], sys.argv[2]'
    'init = ("version = ''%s''\n" % ver).encode()'
    'meta = ("Metadata-Version: 2.1\nName: thornslib\nVersion: %s\n" % ver).encode()'
    'wheel = b"Wheel-Version: 1.0\nGenerator: thornswood-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n"'
    'name = "thornslib-%s" % ver'
    'files = {'
    '  "thornslib/__init__.py": init,'
    '  "thornsmod.py": b"name = 1\n",'
    '  name + ".dist-info/METADATA": meta,'
    '  name + ".dist-info/WHEEL": wheel,'
    '}'
    'rec = []'
    'for path, data in files.items():'
    '    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("=")'
    '    rec.append("%s,sha256=%s,%d" % (path, digest, len(data)))'
    'rec.append(name + ".dist-info/RECORD,,")'
    'files[name + ".dist-info/RECORD"] = ("\n".join(rec) + "\n").encode()'
    'pathlib.Path(dest).parent.mkdir(parents=True, exist_ok=True)'
    'with zipfile.ZipFile(dest, "w") as z:'
    '    for path, data in files.items():'
    '        z.writestr(path, data)'
)
[IO.File]::WriteAllLines($maker, $makerLines)
function Wheel([string]$ver, [string]$dest) {
    & $py $maker $ver $dest
    if ($LASTEXITCODE -ne 0) { throw "could not build wheel $ver" }
}
$w1 = Join-Path $work 'thornslib-1.0.0-py3-none-any.whl'
$w2 = Join-Path $work 'thornslib-2.0.0-py3-none-any.whl'
Wheel '1.0.0' $w1
Wheel '2.0.0' $w2

function PipTarget([string]$wheel, [string]$dest, [string]$req) {
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    [IO.File]::WriteAllText($req, ($wheel + "`r`n"))
    & $py -m pip install --quiet --disable-pip-version-check --upgrade --target $dest --no-index -r $req
    if ($LASTEXITCODE -ne 0) { throw "pip --target failed for $dest" }
}
PipTarget $w1 (Join-Path $rootBot 'py-libs') (Join-Path $work 'req-old.txt')
PipTarget $w2 (Join-Path $stage 'py-libs') (Join-Path $stage 'requirements.txt')

# The cause and the reset Install-Bot runs, on the stage pip just filled.
# What pip renames into py-libs is each top-level entry: a module file
# (thornsmod.py here, typing_extensions.py on the VPS on 11 Oct) and each
# package and dist-info folder. Those keep the protected rules of the folder
# mkdtemp made and inherit nothing from py-libs; a file inside a package folder
# shows its rules as inherited, but from that protected folder, so the bot's
# account cannot reach it either. So every entry is read, folders too, and
# one is outside the folder's rules when its rules are protected or none of
# them is inherited. Measured on Python 3.12.10 (12 Oct): the four top-level
# entries protected with three rules of their own, everything under them
# inherited. Reading files alone, as this did until then, saw only inherited
# rules and failed on the runner's 3.12 (#1273).
# Those rules are Windows ACLs, read with Get-Acl and reset with icacls,
# which only Windows has; the swap after them runs anywhere.
if ($OnWindows) {
    $libItems = @(Get-ChildItem -LiteralPath (Join-Path $stage 'py-libs') -Recurse -Force)
    function Unruled($items) {
        @($items | Where-Object {
            $acl = Get-Acl -LiteralPath $_.FullName
            $acl.AreAccessRulesProtected -or -not @($acl.Access | Where-Object { $_.IsInherited }).Count
        })
    }
    $newPy = "$(& $py -c 'import sys; print(sys.version_info >= (3, 12, 4))')".Trim() -eq 'True'
    if ($newPy) { Yes 'pip --target on Python 3.12.4 or later leaves what it installs outside the folder''s rules' ((Unruled $libItems).Count -gt 0) }
    & icacls (Join-Path $stage 'py-libs') /reset /T /Q | Out-Null
    Yes 'icacls /reset /T puts every py-libs file and folder under the folder''s own rules' ($libItems.Count -gt 0 -and (Unruled $libItems).Count -eq 0)
} else { Write-Host 'SKIP  the py-libs rules: they are Windows ACLs, read with Get-Acl and reset with icacls, which only Windows has' }

$botLines = @(
    'import thornslib, sys'
    'print(''LIB '' + thornslib.version, flush=True)'
    'if thornslib.version != ''1.0.0'':'
    '    sys.exit(1)'
    'print(''watching 1 server'', flush=True)'
)
[IO.File]::WriteAllLines((Join-Path $rootBot 'bot.py'), $botLines)
[IO.File]::WriteAllLines((Join-Path $stage 'bot.py'), $botLines)
$oldVer = [IO.File]::ReadAllText((Join-Path $rootBot 'py-libs\thornslib\__init__.py'))
$newVer = [IO.File]::ReadAllText((Join-Path $stage 'py-libs\thornslib\__init__.py'))
Yes 'the scratch bot was on 1.0.0 and the stage bumped it to 2.0.0' ($oldVer.Contains('1.0.0') -and $newVer.Contains('2.0.0'))

$blockPath = Join-Path $work 'swap-block.ps1'
$marker = "`$serviceSwapBlock = @'"
$start = $swap.IndexOf($marker)
if ($start -lt 0) { throw 'service swap block not found' }
$start = $swap.IndexOf("`n", $start) + 1
$end = $swap.IndexOf("`n'@", $start)
if ($end -lt 0) { throw 'service swap block did not end' }
# With StopAndMove.ps1 in front, as Swap.ps1 puts it (#2928).
$block = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\StopAndMove.ps1')) + "`r`n" + $swap.Substring($start, $end - $start)
[IO.File]::WriteAllText($blockPath, $block)

$child = Join-Path $work 'run-swap.ps1'
$pyLit = $py.Replace("'", "''")
$rootLit = $rootBot.Replace("'", "''")
$blockLit = $blockPath.Replace("'", "''")
$childLines = @(
    '$ErrorActionPreference = ''Continue'''
    '$Root = ''__ROOT__'''
    '$Stage = ''.stage-test'''
    '$Prev = ''.prev-test'''
    '$Wait = 5'
    '$KeepStage = $false'
    '$Want = [ordered]@{}'
    '$Want[''bot.py''] = ''unused'''
    '$Dirs = @(''py-libs'')'
    '$Parse = @()'
    '$script:last = '''''
    'function StopIt { ''stopped'' }'
    'function StartIt {'
    '  $env:PYTHONPATH = Join-Path $Root ''py-libs'''
    '  $out = Join-Path $Root ''run-out.txt'''
    '  $err = Join-Path $Root ''run-err.txt'''
    '  $bot = Join-Path $Root ''bot.py'''
    '  $p = Start-Process -FilePath ''__PY__'' -ArgumentList @($bot) -WorkingDirectory $Root -Wait -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err'
    '  $text = '''''
    '  if (Test-Path -LiteralPath $out) { $text = [IO.File]::ReadAllText($out) }'
    '  if (Test-Path -LiteralPath $err) { $text += [IO.File]::ReadAllText($err) }'
    '  $script:last = $text'
    '  Add-Content -LiteralPath (Join-Path $Root ''runs.txt'') ("--- exit " + $p.ExitCode + "`r`n" + $text)'
    '}'
    'function Healthy { return [bool]($script:last -match ''watching 1 server'') }'
    'function Answer { return $script:last.Trim() }'
    'function Why { $script:last }'
    '. ''__BLOCK__'''
)
$childText = ($childLines -join "`r`n").Replace('__ROOT__', $rootLit).Replace('__PY__', $pyLit).Replace('__BLOCK__', $blockLit)
[IO.File]::WriteAllText($child, $childText)

$said = & $boxPs -NoProfile -ExecutionPolicy Bypass -File $child 2>&1 | ForEach-Object { "$_" }
$saidText = $said -join "`n"
$runs = ''
$runsPath = Join-Path $rootBot 'runs.txt'
if (Test-Path -LiteralPath $runsPath) { $runs = [IO.File]::ReadAllText($runsPath) }
$parts = @($runs -split '--- exit ' | Where-Object { $_.Trim() })
Yes 'the bumped library started and did not stay up' ($parts.Count -ge 1 -and $parts[0].Contains('LIB 2.0.0') -and $parts[0] -notmatch 'watching 1 server')
Yes 'after the rollback the old version is what runs' ($parts.Count -ge 2 -and $parts[1].Contains('LIB 1.0.0') -and $parts[1].Contains('watching 1 server'))
Yes 'the swap says the previous files are back' ($saidText -match 'SWAP ROLLED BACK' -and $saidText -match 'answering again')
$now = ''
$nowPath = Join-Path $rootBot 'py-libs\thornslib\__init__.py'
if (Test-Path -LiteralPath $nowPath) { $now = [IO.File]::ReadAllText($nowPath) }
Yes 'py-libs beside the code is the old version again' ($now.Contains("version = '1.0.0'") -and -not $now.Contains('2.0.0'))

Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
Done
