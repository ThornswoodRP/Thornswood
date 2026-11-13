<#
  test-5925-build-servers.ps1

      pwsh -NoProfile -File .\tests\test-5925-build-servers.ps1

  Issue #5925. tests\test-5180-deploy-agent.ps1's locked restore of
  tools\DeployAgent.Tests failed on Linux gate share 4 of 4 for two merge
  queue groups (a5efbfd, aafffe8), and passed on the same share for the next
  group on the same tree (0c27b7d). On both failed shares, and not the one
  that passed, tests\test-5183-check-change.ps1 ended leaving an MSBuild
  node running, which the runner killed ("harness left 2 process(es)
  running when it ended, now killed: MSBuild, VBCSCompiler"). test-5183 runs
  scripts\dev\Check-Change.ps1 -Body, whose dotnet run of
  tools\ReleaseNotes kept the build servers on, so its MSBuild node stayed
  up for any later build of the same user to reuse; test-5180's restore,
  beside it in the same share with the build servers on too, could take
  that node, and the runner killed it under the restore when test-5183
  ended.

  #3169 already holds the release note harnesses' builds and tests to
  --disable-build-servers (tests\test-pr-release-note.ps1). This holds every
  dotnet command that builds or restores, in every gate harness written in
  PowerShell, the helpers in tests\ and the scripts under scripts\dev a
  harness runs, to it, read from the code so it holds where there is no SDK
  too:

    dotnet / $dotnet / $dotnet.Source / $LauncherDotnet, then restore,
    build, test, run, publish or pack, with --disable-build-servers among
    its arguments.

  Never runs dotnet.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# Each command in a file that runs dotnet with a verb that builds or
# restores, and whether it keeps the build servers on.
function Get-DotnetBuilds([string]$path) {
    $ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
    foreach ($c in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.CommandAst] }, $true)) {
        $e = @($c.CommandElements)
        if ($e.Count -lt 2) { continue }
        $exe = $e[0].Extent.Text
        if ($exe -notmatch '^(dotnet|\$dotnet(\.Source)?|\$LauncherDotnet|\$[A-Za-z]*[Dd]otnet[A-Za-z]*(\.Source)?)$') { continue }
        if ($e[1].Extent.Text -notmatch '^(restore|build|test|run|publish|pack)$') { continue }
        [pscustomobject]@{
            File = $path.Substring($repo.Length + 1).Replace('\', '/')
            Line = $c.Extent.StartLineNumber
            Verb = $e[1].Extent.Text
            On = -not @($e | Where-Object { $_.Extent.Text -eq '--disable-build-servers' }).Count
        }
    }
}

. (Join-Path $repo 'scripts\dev\Harness-Files.ps1')
$files = @(Get-Harnesses $repo | Where-Object { $_.File.Extension -eq '.ps1' } | ForEach-Object { $_.File.FullName })
$files += @(Get-ChildItem -LiteralPath (Join-Path $repo 'tests') -Filter '*.ps1' -File | Where-Object { $_.Name -notlike 'test-*' } | ForEach-Object { $_.FullName })
$files += @(Get-ChildItem -LiteralPath (Join-Path $repo 'scripts\dev') -Filter '*.ps1' -File | ForEach-Object { $_.FullName })
$all = @(foreach ($f in $files) { Get-DotnetBuilds $f })
$on = @($all | Where-Object { $_.On })

Yes ('the reading finds the dotnet builds in the harnesses and their scripts (' + $all.Count + ')') ($all.Count -ge 5)
foreach ($want in @('tests/test-5180-deploy-agent.ps1 restore', 'tests/test-5180-deploy-agent.ps1 test', 'scripts/dev/Check-Change.ps1 run')) {
    $f, $v = $want -split ' '
    Yes ("  among them $f's dotnet $v") (@($all | Where-Object { $_.File -eq $f -and $_.Verb -eq $v }).Count -ge 1)
}
Yes ('every one of them turns the build servers off, so none leaves an MSBuild node for another harness''s build to take' +
    $(if ($on.Count) { ': on in ' + ((@($on | ForEach-Object { '{0}:{1} {2}' -f $_.File, $_.Line, $_.Verb })) -join ', ') } else { '' })) (-not $on.Count)

# The case this was found on, by name.
$cc = @($all | Where-Object { $_.File -eq 'scripts/dev/Check-Change.ps1' -and $_.Verb -eq 'run' })
Yes 'Check-Change.ps1''s dotnet run of tools\ReleaseNotes, which test-5183 runs, turns them off' ($cc.Count -ge 1 -and -not @($cc | Where-Object { $_.On }).Count)
$rs = @($all | Where-Object { $_.File -eq 'tests/test-5180-deploy-agent.ps1' -and $_.Verb -eq 'restore' })
Yes '  and test-5180''s locked restore turns them off, so it takes no node another harness left' ($rs.Count -ge 1 -and -not @($rs | Where-Object { $_.On }).Count)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
