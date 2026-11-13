<#
  test-2309-loadorder-fresh.ps1

      pwsh -NoProfile -File .\tests\test-2309-loadorder-fresh.ps1

  Deploy-DevGamemode.ps1 -LoadOrder runs from the fresh checkout the deploy
  guard asks for (#2309). The deploys refuse anything but a clean checkout at
  origin (#2118), which on the shipping machine is a fresh worktree, and a
  fresh worktree has no engine build. -LoadOrder used to read the order from
  the built server under Where.ps1 ServerDist inside the checkout, so on
  11 Oct it stopped at "-LoadOrder needs the built server's settings" from
  exactly the place the guard allowed.

  The order is the dev server's own now (the one its installed server build
  carries, which Deploy-Gamemode.ps1 keeps and Publish-Server.ps1 -Channel dev
  installs), read off the box in the same call that reads which content
  plugin it holds (ServerContent.ps1). -Dist <a built server> is the one way
  to write a build's order over it.

  HOW. A scratch folder stands in for a fresh checkout: the scripts, the
  records and game\content, and no engine at all, so Where.ps1 ServerDist
  names a folder that is not there. The load order block is lifted out of the
  real Deploy-DevGamemode.ps1, between its two marker lines, and run with that
  folder as the script's own, against a scratch folder standing in for the
  dev server root (the box read runs its real far side text there, and the
  plugin listing runs in place). It proves:
    1. with no -Dist the order is the box's, it is kept (no list goes up to
       rewrite it), and our content plugin goes up when the box holds another
       size, and when it holds the same size with other bytes (sha256, #2308);
       the same bytes send nothing;
    2. a box whose settings give no order is refused, naming the server
       publish, with nothing sent;
    3. -Dist naming a build sends that build's order to be written over the
       dev one; -Dist naming no build is refused;
    4. the script no longer resolves Where.ps1 ServerDist at all, -Dist has no
       default, and nothing reads -Dist outside -LoadOrder.

  Nothing connects anywhere, and everything it writes is in its own temp
  folder.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

$script = Join-Path $repo 'scripts\deploy\Deploy-DevGamemode.ps1'
$src = [IO.File]::ReadAllText($script).Replace("`r`n", "`n")
$open = $src.IndexOf('# --------------------------------------------------------- the load order ---')
$close = $src.IndexOf('# ------------------------------------------------------------ the warning ---')
Yes 'the load order block is in Deploy-DevGamemode.ps1' ($open -gt 0 -and $close -gt $open)
if (-not ($open -gt 0 -and $close -gt $open)) { Done }
$block = $src.Substring($open, $close - $open)
Yes '  and it holds the box read between its markers' ($block.Contains('# ==== thornswood dev load order source ====') -and $block.Contains('Read-ThornswoodServerContent -Channel dev'))

$Scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-2309-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
$oldServerDir = $env:THORNSWOOD_TEST_SERVER_DIR
# This machine's own data is LOCALAPPDATA (Where.ps1 Get-MachineData asks the
# variable first, and the known folder only when it is empty), and a Ship
# machine records its engine build there (engine-build.json, #2019, #3047).
# Read from the real one, that record sent Where.ps1 ServerDist to CI's build
# of a pin the scratch checkout has no record of, and the test stopped before
# its checks (#4168). A fresh checkout on a fresh machine has empty user
# folders, so this run has its own.
$oldLocalAppData = $env:LOCALAPPDATA
$oldAppData = $env:APPDATA
$env:LOCALAPPDATA = Join-Path $Scratch 'localappdata'
$env:APPDATA = Join-Path $Scratch 'appdata'
New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA, $env:APPDATA | Out-Null
try {
    # ---- the fresh checkout ---------------------------------------------------------------
    $fresh = Join-Path $Scratch 'fresh'
    New-Item -ItemType Directory -Force -Path $fresh | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'scripts') -Destination $fresh -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repo 'layout.json') -Destination (Join-Path $fresh 'layout.json') -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $fresh 'records') | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'records\collection-plugins.json') -Destination (Join-Path $fresh 'records\collection-plugins.json') -Force
    $ours = Join-Path $fresh 'game\content\Thornswood-Content.esp'
    Put $ours 'the content plugin, version two'
    $dist = [string](& (Join-Path $fresh 'scripts\release\Where.ps1') ServerDist)
    Yes ("the fresh checkout has no engine build: Where.ps1 ServerDist names {0}, which is not there" -f $dist) (
        $dist.StartsWith($fresh, [StringComparison]::OrdinalIgnoreCase) -and -not (Test-Path -LiteralPath $dist) -and -not (Test-Path -LiteralPath (Join-Path $fresh 'engine')))

    # ---- the dev server root and this machine's collection --------------------------------
    $box = Join-Path $Scratch 'Thornswood-Server-Dev'
    $data = Join-Path $Scratch 'Data'
    $hdr = 'TES4 a master'
    Put (Join-Path $data 'Skyrim.esm') $hdr
    Put (Join-Path $box 'plugins\Skyrim.esm') $hdr
    function BoxSettings([string]$text) { Put (Join-Path $box 'server-settings.json') $text }
    $boxOrder = '{"port":7787,"loadOrder":["C:/Thornswood-Server-Dev/plugins/Skyrim.esm","C:/Thornswood-Server-Dev/plugins/Thornswood-Content.esp"]}'
    $env:THORNSWOOD_TEST_SERVER_DIR = $box

    . (Join-Path $repo 'scripts\release\Read-JsonFile.ps1')
    function Plan([bool]$loadOrder, [string]$distArg, [string[]]$dropArg = @()) {
        # The variables the script has by the time it reaches the block.
        $Here = Join-Path $fresh 'scripts\deploy'
        $LoadOrder = $loadOrder
        $Dist = $distArg
        $FromRecord = $false
        $DropPlugins = $dropArg
        $Root = $box
        $User = 'Administrator'
        $Vps = '127.0.0.1'
        $ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
        $Data = $data
        # The plugin listing runs in place on the stand-in root.
        function Remote($s) { return @(& ([scriptblock]::Create($s)) | ForEach-Object { [string]$_ }) }
        $thrown = ''
        try { . ([scriptblock]::Create($block)) } catch { $thrown = $_.Exception.Message }
        $o = [pscustomobject]@{
            Thrown = $thrown; Names = @($pluginNames); Send = @($sendPlugins | ForEach-Object { Split-Path $_ -Leaf }); Changed = @($changed)
            OrderWire = $orderWire; OrderText = $(if ($orderWire) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($orderWire)) } else { '' })
        }
        return $o
    }

    # ---- 1. no -Dist: the box's own order --------------------------------------------------
    Write-Host ''; Write-Host 'no -Dist, from the fresh checkout'
    BoxSettings $boxOrder
    Put (Join-Path $box 'plugins\Thornswood-Content.esp') 'the content plugin, version one, longer'
    $p = Plan $true ''
    Yes ('it goes through with no engine build' + $(if ($p.Thrown) { ': ' + $p.Thrown } else { '' })) ($p.Thrown -eq '')
    Yes ("  the order is the dev server's own ({0})" -f ($p.Names -join ', ')) (($p.Names -join '|') -eq 'Skyrim.esm|Thornswood-Content.esp')
    Yes '  and it is kept: no list goes up to rewrite it' ($p.OrderWire -eq '')
    Yes ("  our content plugin goes up, from the checkout, when the box holds another size ({0})" -f ($p.Send -join ', ')) (($p.Send -join '|') -eq 'Thornswood-Content.esp')
    Yes '  and Skyrim.esm, the same on both, does not' ($p.Send -notcontains 'Skyrim.esm')

    Put (Join-Path $box 'plugins\Thornswood-Content.esp') 'the content plugin, version one'
    Yes '  (the box copy is now the same length as the checkout''s)' ((Get-Item -LiteralPath (Join-Path $box 'plugins\Thornswood-Content.esp')).Length -eq (Get-Item -LiteralPath $ours).Length)
    $p = Plan $true ''
    Yes 'the same size with other bytes still goes up, by sha256' ($p.Thrown -eq '' -and ($p.Send -join '|') -eq 'Thornswood-Content.esp' -and ($p.Changed -join ' ') -match 'sha256')

    Copy-Item -LiteralPath $ours -Destination (Join-Path $box 'plugins\Thornswood-Content.esp') -Force
    $p = Plan $true ''
    Yes 'the same bytes send nothing' ($p.Thrown -eq '' -and $p.Send.Count -eq 0)

    Remove-Item -LiteralPath (Join-Path $box 'plugins\Thornswood-Content.esp') -Force
    $p = Plan $true ''
    Yes 'a box with no content plugin gets ours' ($p.Thrown -eq '' -and ($p.Send -join '|') -eq 'Thornswood-Content.esp')

    # ---- 2. a box with no order --------------------------------------------------------------
    Write-Host ''; Write-Host 'a dev server with no load order'
    BoxSettings '{"port":7787}'
    $p = Plan $true ''
    Yes 'is refused, naming the server publish that puts one there' ($p.Thrown -match 'gave no load order' -and $p.Thrown.Contains('Publish-Server.ps1 -Channel dev') -and $p.Send.Count -eq 0)

    # ---- 3. -Dist ----------------------------------------------------------------------------
    Write-Host ''; Write-Host '-Dist naming a build'
    BoxSettings $boxOrder
    Copy-Item -LiteralPath $ours -Destination (Join-Path $box 'plugins\Thornswood-Content.esp') -Force
    $build = Join-Path $Scratch 'build\dist\server'
    Put (Join-Path $data 'Update.esm') $hdr
    Put (Join-Path $build 'server-settings.json') '{"port":7777,"loadOrder":["c:/steam/Data/Skyrim.esm","c:/steam/Data/Update.esm","c:/steam/Data/Thornswood-Content.esp"]}'
    # Update.esm is not the collection's bytes here, so the record refuses to
    # send it; the build is the order to write, not a way round #2019.
    $p = Plan $true $build
    Yes ("the order is the build's ({0})" -f ($p.Names -join ', ')) (($p.Names -join '|') -eq 'Skyrim.esm|Update.esm|Thornswood-Content.esp')
    Yes '  and a plugin that is not the collection''s bytes is still refused before anything goes' ($p.Thrown -match 'not the collection')
    Put (Join-Path $box 'plugins\Update.esm') $hdr
    $p = Plan $true $build
    Yes ('  with every plugin on the box, it goes through' + $(if ($p.Thrown) { ': ' + $p.Thrown } else { '' })) ($p.Thrown -eq '' -and $p.Send.Count -eq 0)
    Yes '  and the build''s order goes up as the list that rewrites the dev one' ($p.OrderText -eq "Skyrim.esm`nUpdate.esm`nThornswood-Content.esp")
    $p = Plan $true (Join-Path $Scratch 'no-build-here')
    Yes '-Dist naming no build is refused, saying to leave it out' ($p.Thrown -match '-Dist names no built server' -and $p.Thrown -match 'Leave -Dist out')
    # A build whose order leaves out a plugin the dev server loads (#2320):
    # on 5 Oct a fresh build carried only the five base masters.
    $short = Join-Path $Scratch 'short\dist\server'
    Put (Join-Path $short 'server-settings.json') '{"port":7777,"loadOrder":["c:/steam/Data/Skyrim.esm"]}'
    $p = Plan $true $short
    Yes 'a build''s order that drops a plugin the dev server loads is refused before anything goes (#2320)' (
        $p.Thrown -match 'leaves out 1 of the 2' -and $p.Thrown -match 'Thornswood-Content\.esp' -and $p.Thrown -match '-DropPlugins' -and $p.Send.Count -eq 0 -and $p.OrderWire -eq '')
    $p = Plan $true $short @('Thornswood-Content.esp')
    Yes '  and goes through when -DropPlugins names it' ($p.Thrown -eq '' -and $p.OrderText -eq 'Skyrim.esm')
    $p = Plan $true '' @('Thornswood-Content.esp')
    Yes '  -DropPlugins without -Dist is refused: the dev server''s own order drops nothing' ($p.Thrown -match '-DropPlugins goes with -Dist')

    # ---- 4. the script ------------------------------------------------------------------------
    Write-Host ''; Write-Host 'the script'
    Yes 'Deploy-DevGamemode.ps1 no longer asks Where.ps1 for ServerDist' ($src -notmatch "Where\.ps1'\)\s+ServerDist")
    $ast = [Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($script), [ref]$null, [ref]$null)
    $distParam = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Dist' })
    Yes '  -Dist has no default' ($distParam.Count -eq 1 -and ($null -eq $distParam[0].DefaultValue -or $distParam[0].DefaultValue.Extent.Text -eq "''"))
    Yes '  and -Dist is read only inside -LoadOrder' (@([regex]::Matches($src.Substring(0, $open), '\$Dist\b')).Count -le 1)
    # Until #3035 the list went up as a file of its own in C:\Windows\Temp, and a
    # deploy that stopped before the block that removed it left it there.
    Yes '  and the load order list goes inside the settings block that reads it, with no file of its own on the box' (
        $src.Contains("`$orderWire = '`$orderWire'") -and $src -notmatch 'dev-loadorder' -and $src -notmatch '\$farOrder\b')
}
finally {
    $env:THORNSWOOD_TEST_SERVER_DIR = $oldServerDir
    $env:LOCALAPPDATA = $oldLocalAppData
    $env:APPDATA = $oldAppData
    Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue
}
Done
