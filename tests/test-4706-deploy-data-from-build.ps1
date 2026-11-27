<#
  test-4706-deploy-data-from-build.ps1

      pwsh -NoProfile -File .\tests\test-4706-deploy-data-from-build.ps1

  Issue #4706. Deploy-Server.ps1 read the plugins the VPS does not have yet
  from -Data, and -Data defaulted to Skyrim in Steam's own library on drive C,
  whatever game folder the build was made from. On a machine with Skyrim in
  another library the deploy looked in the wrong folder, or sent an old
  copy's bytes from a C: folder that was still there. Now, left off, -Data is
  the Data folder the build's own server-settings.json names its plugins in
  (Deploy-Gamemode writes each at its full path there), and given, it wins.

  This lifts the real parameter default, Resolve-ThornswoodDeployData and the
  line that builds each plugin's local path out of Deploy-Server.ps1 and runs
  them against a build made from a copy outside drive C: a made up library
  under TEMP, and a D: path. Nothing is sent and no server is touched.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$src = [IO.Path]::Combine($Repo, 'scripts', 'deploy', 'Deploy-Server.ps1')
$text = [IO.File]::ReadAllText($src)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Threw([scriptblock]$b) {
    try { & $b | Out-Null; return '' } catch { return $_.Exception.Message }
}

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
Yes 'Deploy-Server.ps1 parses' ($errors.Count -eq 0)

# 1. The default is no longer a fixed folder on drive C.
$dataParam = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Data' })
$default = if ($dataParam.Count -and $dataParam[0].DefaultValue) { [string]$dataParam[0].DefaultValue.SafeGetValue() } else { $null }
Yes '-Data has a parameter' ($dataParam.Count -eq 1)
Yes '  and left off it names no folder of its own, so the build''s folder is used' ($default -eq '')

# 2. The function, lifted and loaded.
$fn = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Resolve-ThornswoodDeployData' }, $true))
Yes 'Resolve-ThornswoodDeployData is defined in Deploy-Server.ps1' ($fn.Count -eq 1)
if ($fn.Count -ne 1) {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, ($script:fail + 1))
    exit 1
}
. ([scriptblock]::Create($fn[0].Extent.Text))

# The line that turns a plugin name into the local file it goes up from.
$localLine = @($text -split "`r?`n" | Where-Object { $_ -match '^\s*\$local = if \(\$Data -match' })
Yes 'the local path of each plugin is built from $Data in one line' ($localLine.Count -eq 1)
function LocalOf([string]$Data, [string]$n) {
    $local = $null
    Invoke-Expression $localLine[0].Trim()
    return $local
}

$names = @('Skyrim.esm', 'Update.esm', 'Somebody.esp', 'Thornswood-Content.esp')

# 3. A build made from a copy outside drive C: a library of its own under TEMP.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-4706-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $data = [IO.Path]::Combine($tmp, 'Games', 'SteamLibrary', 'steamapps', 'common', 'Skyrim Special Edition', 'Data')
    [void][IO.Directory]::CreateDirectory($data)
    foreach ($n in $names) { [IO.File]::WriteAllText((Join-Path $data $n), "made up $n") }
    $fwd = $data.Replace('\', '/')
    $order = @($names | ForEach-Object { $fwd + '/' + $_ })
    $settingsSrc = Join-Path $tmp 'server-settings.json'
    [IO.File]::WriteAllText($settingsSrc, (@{ port = 7777; loadOrder = $order } | ConvertTo-Json))
    $settings = Get-Content -LiteralPath $settingsSrc -Raw | ConvertFrom-Json

    $got = Resolve-ThornswoodDeployData '' @($settings.loadOrder) $settingsSrc
    Yes 'left off, -Data is the Data folder the build''s loadOrder names' ($got.Replace('\', '/') -eq $fwd)
    $found = @($names | Where-Object { Test-Path -LiteralPath (LocalOf $got $_) -PathType Leaf })
    Yes '  and every plugin the order names is found there' ($found.Count -eq $names.Count)

    # 4. An explicit path still wins over the build's folder.
    $mine = Join-Path $tmp 'Mine'
    [void][IO.Directory]::CreateDirectory($mine)
    [IO.File]::WriteAllText((Join-Path $mine 'Somebody.esp'), 'the one asked for')
    $given = Resolve-ThornswoodDeployData $mine @($settings.loadOrder) $settingsSrc
    Yes 'given, -Data wins over the folder the build names' ($given -eq $mine)
    Yes '  and the plugin goes up from there' ([IO.File]::ReadAllText((LocalOf $given 'Somebody.esp')) -eq 'the one asked for')
} finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}

# 5. A D: library as Deploy-Gamemode writes it on Windows, read on any machine.
$dOrder = @($names | ForEach-Object { 'D:/SteamLibrary/steamapps/common/Skyrim Special Edition/Data/' + $_ })
$d = Resolve-ThornswoodDeployData '' $dOrder 'server-settings.json'
Yes 'a build from D: reads from D:, not from drive C' ($d -eq 'D:\SteamLibrary\steamapps\common\Skyrim Special Edition\Data')
Yes '  and a plugin''s local path is under it' ((LocalOf $d 'Somebody.esp') -eq 'D:\SteamLibrary\steamapps\common\Skyrim Special Edition\Data\Somebody.esp')
$mixedCase = @('D:/SteamLibrary/steamapps/common/Skyrim Special Edition/Data/Skyrim.esm', 'd:/steamlibrary/steamapps/common/skyrim special edition/data/Update.esm')
Yes '  a folder named in two cases is one folder' ((Resolve-ThornswoodDeployData '' $mixedCase 'server-settings.json') -eq 'D:\SteamLibrary\steamapps\common\Skyrim Special Edition\Data')

# 6. A build that cannot say which folder stops, naming why.
$two = @('C:/Program Files (x86)/Steam/steamapps/common/Skyrim Special Edition/Data/Skyrim.esm', 'D:/SteamLibrary/steamapps/common/Skyrim Special Edition/Data/Update.esm')
$said = Threw { Resolve-ThornswoodDeployData '' $two 'server-settings.json' }
Yes 'plugins named in two folders stop, naming both' ($said -match 'more than one folder' -and $said.Contains($two[0]) -and $said.Contains($two[1]) -and $said -match '-Data')
$bare = Threw { Resolve-ThornswoodDeployData '' @('Skyrim.esm') 'server-settings.json' }
Yes 'a plugin named with no folder stops, saying to pass -Data' ($bare -match 'no folder' -and $bare -match '-Data')
$none = Threw { Resolve-ThornswoodDeployData '' @() 'server-settings.json' }
Yes 'no loadOrder stops' ($none -match 'no loadOrder')
Yes '  and with -Data given none of that is asked' ((Resolve-ThornswoodDeployData 'E:\x\Data' $two 'server-settings.json') -eq 'E:\x\Data')

# 7. It is read from the build's paths, before they are made the box's.
$call = $text.IndexOf('$Data = Resolve-ThornswoodDeployData $Data @($settings.loadOrder) $settingsSrc')
$load = $text.IndexOf('$settings = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $settingsSrc -Raw) $settingsSrc')
$rewrite = $text.IndexOf('$settings.loadOrder = @($pluginNames')
$use = $text.IndexOf($localLine[0].Trim())
Yes 'Deploy-Server resolves -Data after reading the build''s settings' ($call -gt 0 -and $load -gt 0 -and $call -gt $load)
Yes '  before the loadOrder is rewritten to the box''s plugins folder' ($rewrite -gt 0 -and $call -lt $rewrite)
Yes '  and before any plugin''s local path is built' ($use -gt 0 -and $call -lt $use)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
