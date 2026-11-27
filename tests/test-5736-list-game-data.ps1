<#
  test-5736-list-game-data.ps1

  The deploy gate's List-GameData verb runs only the read-only listers it
  names, each against the data folder of the server asked for (#5736).

  No verb ran a lister of Skyrim's own data on the box, so a cloud thread or
  a Bot could not start List-KillMoveIdles.py, and #4507's engine work waited
  on One (#5754). scripts\mods\List-GameDataOnBox.ps1 is that verb. This
  runs it with a stand-in for Run-OnBox.ps1 and proves:

    L1  each lister is run as scripts/dev/List-<name>.py --data '{data}', and
        that script is in the repository
    L2  the server asked for reaches the runner; main when none is asked
    L3  the lister's exit code is the verb's
    L4  a lister the script does not name is refused before anything runs,
        and the gate's rule for -Lister is the script's own list

  Runs anywhere in PowerShell 7. Nothing connects to anything; the stand-in
  writes into a temp folder of its own.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script = Join-Path $repo 'scripts/mods/List-GameDataOnBox.ps1'
$failed = 0
$passed = 0
function Yes([string]$What, [bool]$Ok) {
    if ($Ok) { $script:passed++; Write-Host "PASS  $What" } else { $script:failed++; Write-Host "FAIL  $What" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('test-5736-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
    $said = Join-Path $work 'said.json'
    $runner = Join-Path $work 'Runner.ps1'
    # Writes what it was given and exits with THORNSWOOD_TEST_EXIT.
    @"
param([string]`$Script, [string[]]`$Arguments = @(), [string]`$Server = 'dev')
@{ script = `$Script; arguments = @(`$Arguments); server = `$Server } | ConvertTo-Json | Set-Content -LiteralPath '$said'
Write-Output 'a line the lister printed'
exit [int]`$env:THORNSWOOD_TEST_EXIT
"@ | Set-Content -LiteralPath $runner

    function Run([string[]]$Words, [int]$Exit = 0) {
        if (Test-Path -LiteralPath $said) { Remove-Item -LiteralPath $said }
        $env:THORNSWOOD_TEST_EXIT = "$Exit"
        $out = @(& pwsh -NoProfile -File $script @Words -Runner $runner 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
        $got = if (Test-Path -LiteralPath $said) { Get-Content -LiteralPath $said -Raw | ConvertFrom-Json } else { $null }
        return [pscustomobject]@{ Code = $code; Out = $out; Got = $got }
    }

    foreach ($name in 'ArmourMaterials', 'KillMoveIdles', 'ToolRecords') {
        $r = Run @('-Lister', $name)
        $tool = "scripts/dev/List-$name.py"
        # ArmourMaterials reads the whole load order, so it takes the plugin list too (#4650).
        $want = if ($name -ceq 'ArmourMaterials') { '--data {data} --plugins {plugins}' } else { '--data {data}' }
        Yes "L1 $name runs $tool with $want" ($r.Got -and $r.Got.script -ceq $tool -and
            (@($r.Got.arguments) -join ' ') -ceq $want)
        Yes "L1 $tool is in the repository" (Test-Path -LiteralPath (Join-Path $repo $tool))
        Yes "L2 $name reads the live server's plugins when no server is asked" ($r.Got -and $r.Got.server -ceq 'main')
        Yes "L3 $name prints what the lister printed and exits 0 with it" ($r.Code -eq 0 -and ($r.Out -contains 'a line the lister printed'))
    }
    $r = Run @('-Lister', 'KillMoveIdles', '-Server', 'dev')
    Yes 'L2 -Server dev reaches the runner' ($r.Got -and $r.Got.server -ceq 'dev')
    $r = Run @('-Lister', 'KillMoveIdles') 3
    Yes 'L3 the lister''s exit code is the verb''s' ($r.Code -eq 3)

    $r = Run @('-Lister', 'CellRefs')
    Yes 'L4 a lister the script does not name is refused and the runner is never started' ($r.Code -ne 0 -and -not $r.Got)
    $r = Run @('-Lister', 'scripts/dev/List-KillMoveIdles.py')
    Yes 'L4 so is a path' ($r.Code -ne 0 -and -not $r.Got)

    $verbs = Get-Content -LiteralPath (Join-Path $repo 'scripts/vps/gate/verbs.json') -Raw | ConvertFrom-Json
    $rule = $verbs.verbs.'List-GameData'.params.Lister
    $set = @((Get-Command $script).Parameters['Lister'].Attributes | Where-Object { $_ -is [System.Management.Automation.ValidateSetAttribute] } | ForEach-Object { $_.ValidValues })
    Yes 'L4 the gate''s rule for -Lister is the script''s own list' ($rule -ceq ('^(' + ($set -join '|') + ')$'))
    Yes 'L4 the verb runs this script' ($verbs.verbs.'List-GameData'.script -ceq 'scripts/mods/List-GameDataOnBox.ps1')
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\THORNSWOOD_TEST_EXIT -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$passed passed, $failed failed"
exit $(if ($failed) { 1 } else { 0 })
