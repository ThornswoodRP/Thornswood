<#
  test-move.ps1

      pwsh -NoProfile -File .\launcher\tests\test-move.ps1

  The old launcher moves itself to the new one (2 Nov 2026). Patrick: "is
  there not a way to from the current launchers people have have it update to
  the new one or install the new one and delete the old". A launcher from
  before Velopack takes launcher\move as its last update (the site names it
  in the old feed, site\lib\feed.js feedMove; merge-release.yml builds, signs
  and publishes it beside each channel's Setup.exe), and it installs the new
  launcher for the install's channel, hands it the install's folder, and
  removes the old launcher's folder.

  Checks:
    - launcher\move builds as it is, with the .NET SDK the launcher builds with.
    - Its Channel() reads config.json the way the old launcher did: "dev" in
      Channel or UpdateBranch is dev, anything else or no file is main.
    - Its signer is the launcher's own Updater.ExpectedSigner, read from
      Updater.cs at its build and read back out of the built program.
    - Its steps run in the order Program.cs gives: the swap script's .old goes
      first, the download is held to the signature before the handover is
      written or anything runs, the handover is written before the setup
      runs, and the old folder goes last, from a cmd that is not in it.
    - The new launcher takes the handover only on its first start after
      Velopack's setup, before the install window would ask, and only a
      folder with config.json in it.
    - merge-release.yml builds and signs it once and puts it beside each
      channel's Setup.exe under the names the site looks for.

  Builds under out\harness\ (which git ignores) and deletes its own folder.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's SDK and settings
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Before([string]$text, [string]$a, [string]$b) {
    $i = $text.IndexOf($a); $j = $text.IndexOf($b)
    return ($i -ge 0 -and $j -ge 0 -and $i -lt $j)
}

$repo = $launcherRepo
$program = Get-Content -LiteralPath (Join-Path $repo 'launcher\move\Program.cs') -Raw
$main = $program.Substring($program.IndexOf('static int Main('))
$main = $main.Substring(0, $main.IndexOf('public static string Channel('))
$updater = Get-Content -LiteralPath (Join-Path $repo 'launcher\app\Updater.cs') -Raw
$place = Get-Content -LiteralPath (Join-Path $repo 'launcher\app\InstallPlace.cs') -Raw
$shell = Get-Content -LiteralPath (Join-Path $repo 'launcher\app\Shell.cs') -Raw
$wf = Get-Content -LiteralPath (Join-Path $repo '.github\workflows\merge-release.yml') -Raw

# ---- the build, and Channel() as the old launcher read it
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (Test-Path -LiteralPath $LauncherDotnet) {
    $work = Join-Path $repo (Join-Path 'out' (Join-Path 'harness' ('move-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))))
    $null = New-Item -ItemType Directory -Force -Path $work
    try {
        $sep = [IO.Path]::DirectorySeparatorChar
        $bin = Join-Path $work 'bin'
        $proj = Join-Path $repo (Join-Path 'launcher' (Join-Path 'move' 'Move.csproj'))
        $said = & $LauncherDotnet build $proj -c Release ('-p:OutDir=' + $bin + $sep) ('-p:BaseIntermediateOutputPath=' + (Join-Path $work 'obj') + $sep) ('-p:BaseOutputPath=' + (Join-Path $work 'out') + $sep) -nologo -v:q '-clp:NoSummary;ErrorsOnly' --disable-build-servers 2>&1 | Out-String
        $exe = Join-Path $bin 'Thornswood.exe'
        $built = ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $exe))
        if (-not $built) { Write-Host ('      ' + $said.Trim()) }
        Yes 'the move program builds as it is' $built
        if ($built) {
            # Channel() is plain file and Regex work, which this PowerShell's
            # .NET runs from the .NET Framework build as it is.
            $move = [Reflection.Assembly]::LoadFile($exe).GetType('Thornswood.Move', $true)
            $channel = $move.GetMethod('Channel')
            $cfgDir = Join-Path $work 'cfg'
            $null = New-Item -ItemType Directory -Force -Path $cfgDir
            $cases = @(
                @('{"Channel": "dev"}', 'dev', 'Channel dev'),
                @('{"UpdateBranch":"DEV","Channel":""}', 'dev', 'UpdateBranch DEV'),
                @('{"Channel": "main"}', 'main', 'Channel main'),
                @('{"UpdateBranch": "main"}', 'main', 'UpdateBranch main'),
                @('{}', 'main', 'neither field')
            )
            $i = 0
            foreach ($c in $cases) {
                $f = Join-Path $cfgDir ("config-$i.json"); $i++
                Set-Content -LiteralPath $f -Value $c[0] -NoNewline
                Yes ("Channel() reads " + $c[2] + " as " + $c[1]) ($channel.Invoke($null, [object[]]@([string]$f)) -eq $c[1])
            }
            Yes 'Channel() reads no config.json as main' ($channel.Invoke($null, [object[]]@([string](Join-Path $cfgDir "none.json"))) -eq "main")
            # The signer it holds, read back out of the built program: Move.csproj
            # takes it from Updater.cs, the one file that writes the name.
            $theirs = [regex]::Match((Get-Content -LiteralPath (Join-Path $repo 'launcher\app\Updater.cs') -Raw), 'public const string ExpectedSigner = "([^"]+)"').Groups[1].Value
            $field = $move.GetField('ExpectedSigner', [Reflection.BindingFlags]'NonPublic, Static')
            $mine = if ($field) { [string]$field.GetRawConstantValue() } else { '' }
            Yes 'the move program holds the download to the launcher''s own signer, read from Updater.cs at its build' ($mine.Length -gt 0 -and $mine -eq $theirs)
        }
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---- the signer and the order of the steps
Yes 'the move program writes no signer name of its own' (-not [regex]::IsMatch($program, 'ExpectedSigner = "'))
Yes 'its build reads the signer from Updater.cs' ((Get-Content -LiteralPath (Join-Path $repo 'launcher\move\Move.csproj') -Raw).Contains("'app', 'Updater.cs'"))
Yes 'it is the launcher''s own signature check, the same file' ($program.Length -gt 0 -and (Get-Content -LiteralPath (Join-Path $repo 'launcher\move\Move.csproj') -Raw).Contains('<Compile Include="..\app\Signature.cs"'))
Yes 'the swap script''s .old goes before anything else' (Before $main 'ClearOld(exe + ".old")' 'string local =')
Yes 'the setup is held to the signature before the handover is written' (Before $main 'Signature.Refusal(setup, ExpectedSigner' 'Thornswood-moved-from.txt')
Yes 'a setup that fails the signature is deleted and nothing runs' ([regex]::IsMatch($main, 'if \(why\.Length > 0\)\s*\{\s*TryDelete\(setup\);\s*throw'))
Yes 'the handover is written before the setup runs' (Before $main 'Thornswood-moved-from.txt' 'Process.Start(run)')
Yes 'the setup it downloads is the site''s link for the channel' ($main.Contains('"https://thornswood.net/file/" + name') -and $main.Contains('channel == "dev" ? "Thornswood-Dev-Setup.exe" : "Thornswood-Setup.exe"'))
Yes 'a setup that ends with a failure stops the move before the old folder goes' ($main.IndexOf('p.ExitCode != 0') -gt 0 -and $main.LastIndexOf('RemoveAfterExit(launcherDir);') -gt $main.IndexOf('p.ExitCode != 0'))
Yes 'the setup and the new launcher are started outside the old folder' ($main.Contains('run.WorkingDirectory = Path.GetTempPath();') -and $main.Contains('start.WorkingDirectory = Path.GetDirectoryName(newExe);'))
Yes 'the cmd that removes the old folder runs from the temp folder and waits for this one to end' ($program.Contains('psi.WorkingDirectory = Path.GetTempPath();') -and $program.Contains('tasklist /fi \"PID eq " + me'))
Yes 'a launcher already installed for the account is started, not installed over' (Before $main 'install-root.txt' 'Download(')
Yes 'the handover file is the one the new launcher reads' ($place.Contains('"Thornswood-moved-from.txt"') -and $main.Contains('"Thornswood-moved-from.txt"'))

# ---- the new launcher's half
Yes 'the new launcher takes the handover only on a Velopack first start with nothing recorded or given' ($shell.Contains('if (recorded == null && root == null && Velo.Installed && !askedToUninstall) recorded = InstallPlace.TakeHandover();'))
Yes 'it takes the handover before the install window would ask' (Before $shell 'recorded = InstallPlace.TakeHandover();' 'installing = new InstallWindow();')
Yes 'a handover is used once, and only a folder with config.json in it' ((Before $place 'File.Delete(f);' 'Record(root);') -and $place.Contains('if (!File.Exists(Path.Combine(root, "config.json"))) return null;') -and $place.Contains('Path.IsPathFullyQualified(root)'))

# ---- the release
Yes 'merge-release.yml builds the move program and signs it' ($wf.Contains('dotnet build launcher\move\Move.csproj') -and (Before $wf 'dotnet build launcher\move\Move.csproj' './scripts/release/Sign-OnRunner.ps1 -Path $moveExe'))
Yes 'it goes beside dev''s Setup.exe as Thornswood-Dev-Move.exe and main''s as Thornswood-Move.exe' ($wf.Contains("'Thornswood-Dev-Move.exe' } else { 'Thornswood-Move.exe' }") -and (Before $wf '$files += Get-Item -LiteralPath $download' '$files += Get-Item -LiteralPath $move'))
$feed = Get-Content -LiteralPath (Join-Path $repo 'site\lib\feed.js') -Raw
Yes 'the site looks for the same names' ($feed.Contains("move: 'Thornswood-Move.exe'") -and $feed.Contains("move: 'Thornswood-Dev-Move.exe'"))

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) { exit 1 }
exit 0
