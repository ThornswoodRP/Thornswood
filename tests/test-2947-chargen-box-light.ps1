<#
  test-2947-chargen-box-light.ps1

      pwsh -NoProfile -File .\tests\test-2947-chargen-box-light.ps1

  Check-Chargen.ps1 -From dev and -From live read which plugins are light on
  the box, from the files the server loads, and whether its engine loads
  them from the server's own server-build.json (#2947). In the same call
  they read the plugin records from the Thornswood-Content.esp its load
  order names and the gamemode.js the server runs (#2950).

  WHY. Until #2947 both came from the machine running the check: the headers
  in -Data (C:\Thornswood\Game\Data) and this checkout's record. On a machine
  with no game folder, a cloud one, Get-ThornswoodLightTest threw on the
  first plugin it could not find, so the check stopped before it said
  anything; and a game folder holding another copy of a plugin answered for
  a file the server does not load. The plugin records and the gamemode were
  read from -Data and -Dist the same way until #2950, so for a server they
  described files it does not run, and failed with "not found" on a cloud
  machine.

  HOW. The script the check sends is lifted out of Check-Chargen.ps1,
  expanded here with the values the check would give it (the server root and
  Test-ThornswoodPluginLight from ServerOrder.ps1), and run in Windows
  PowerShell, what sshd runs on the box, against a server folder made in a
  temp folder: a server-settings.json, a server-build.json, plugin files
  whose TES4 headers say light or not, a Thornswood-Content.esp with a BOOK
  group and a MESG group, and a gamemode.js. The two readers Check-Chargen.ps1 sends up
  with it are lifted out of it by the parser, as is its list of what a
  gamemode should mention. Nothing connects to anything.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
# What this runs, the box runs in PowerShell 7 since #5356, and so does this.
$boxPs = Get-BoxPowerShell

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $here
$check = Join-Path $repo 'scripts\ops\Check-Chargen.ps1'
. (Join-Path $repo 'scripts\deploy\ServerOrder.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$text = [IO.File]::ReadAllText($check)
$open = $text.IndexOf('$remote = @"')
$close = -1
$m = [regex]::Match($text.Substring([Math]::Max($open, 0)), '\r?\n"@')
if ($open -ge 0 -and $m.Success) { $close = $open + $m.Index }
Yes 'the script the check sends is where it was' ($open -ge 0 -and $close -gt $open)
$body = $text.Substring($open + '$remote = @"'.Length, $close - $open - '$remote = @"'.Length).Trim("`r", "`n")
Yes 'it reads each plugin with Test-ThornswoodPluginLight, sent up with it' ($body.Contains('$lightDef') -and $body.Contains('Test-ThornswoodPluginLight `$f'))
Yes '  and the server''s own server-build.json' ($body.Contains('$root\server-build.json'))
# Only the build on this machine reads -Data and this checkout's record.
$build = [regex]::IsMatch($text, "if \(\`$From -eq 'build'\) \{\s*\`$lightTest = Get-ThornswoodLightTest")
Yes 'a server''s light plugins are not read from -Data' ($build -and ([regex]::Matches($text, 'Get-ThornswoodLightTest')).Count -eq 1)
Yes 'it reads the plugin records and the gamemode there, sent up with it (#2950)' (
    $body.Contains('$recordsDef') -and $body.Contains('Read-ThornswoodChargenRecords `$esp') -and
    $body.Contains('$gmDef') -and $body.Contains('Find-ThornswoodGamemodeText `$gm @($needleList)'))
# -Data and -Dist are read in the build's branch and nowhere else.
$buildAt = $text.IndexOf("if (`$From -eq 'build') {")
$elseAt = if ($buildAt -ge 0) { $text.IndexOf('} else {', $buildAt) } else { -1 }
$espRead = "Join-Path `$Data 'Thornswood-Content.esp'"
$gmRead = "Join-Path `$Dist 'gamemode.js'"
Yes 'a server''s plugin records and gamemode are not read from -Data or -Dist' (
    $buildAt -ge 0 -and $elseAt -gt $buildAt -and
    ([regex]::Matches($text, [regex]::Escape($espRead))).Count -eq 1 -and ([regex]::Matches($text, [regex]::Escape($gmRead))).Count -eq 1 -and
    $text.IndexOf($espRead) -gt $buildAt -and $text.IndexOf($espRead) -lt $elseAt -and
    $text.IndexOf($gmRead) -gt $buildAt -and $text.IndexOf($gmRead) -lt $elseAt)

# The readers and the list, lifted out of the check by the parser: the check
# runs its own work at the top level, so it cannot be dot-sourced.
$ast = [Management.Automation.Language.Parser]::ParseFile($check, [ref]$null, [ref]$null)
foreach ($name in 'Read-ThornswoodChargenRecords', 'Find-ThornswoodGamemodeText') {
    $fn = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true))
    Yes "Check-Chargen.ps1 defines $name once" ($fn.Count -eq 1)
    . ([scriptblock]::Create($fn[0].Extent.Text))
}
$needlesAt = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$gmNeedles' }, $false))
Yes 'Check-Chargen.ps1 sets $gmNeedles once' ($needlesAt.Count -eq 1)
. ([scriptblock]::Create($needlesAt[0].Extent.Text))

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-chargen-light-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $tmp 'plugins') -Force | Out-Null

function Write-Plugin([string]$name, [bool]$light) {
    $b = New-Object byte[] 24
    [Text.Encoding]::ASCII.GetBytes('TES4').CopyTo($b, 0)
    $flags = [uint32]0
    if ($light) { $flags = [uint32]0x200 }
    [BitConverter]::GetBytes($flags).CopyTo($b, 8)
    [IO.File]::WriteAllBytes((Join-Path (Join-Path $tmp 'plugins') $name), $b)
}

# A record or group: tag, size, then 16 bytes (flags, form id, ...) and data.
# For a GRUP the size counts its own 24 bytes and the label is at 8.
function Get-Record([string]$tag, [uint32]$formId, [string]$data) {
    $d = [Text.Encoding]::ASCII.GetBytes($data)
    $b = New-Object byte[] (24 + $d.Length)
    [Text.Encoding]::ASCII.GetBytes($tag).CopyTo($b, 0)
    [BitConverter]::GetBytes([uint32]$d.Length).CopyTo($b, 4)
    [BitConverter]::GetBytes($formId).CopyTo($b, 12)
    $d.CopyTo($b, 24)
    return ,$b
}
function Get-Group([string]$label, [byte[][]]$records) {
    $inner = New-Object Collections.Generic.List[byte]
    foreach ($r in $records) { $inner.AddRange($r) }
    $b = New-Object byte[] (24 + $inner.Count)
    [Text.Encoding]::ASCII.GetBytes('GRUP').CopyTo($b, 0)
    [BitConverter]::GetBytes([uint32](24 + $inner.Count)).CopyTo($b, 4)
    [Text.Encoding]::ASCII.GetBytes($label).CopyTo($b, 8)
    $inner.ToArray().CopyTo($b, 24)
    return ,$b
}
# The content plugin, at $folder under the temp folder.
function Write-Content([string]$folder) {
    $all = New-Object Collections.Generic.List[byte]
    $all.AddRange([byte[]](Get-Record 'TES4' 0 'HEDR'))
    $all.AddRange([byte[]](Get-Group 'BOOK' @(
        (Get-Record 'BOOK' 0x05E80030 'EDIDxFULLxMODLx'),
        (Get-Record 'BOOK' 0x05E80031 'EDIDxFULLx'),
        (Get-Record 'BOOK' 0x05E80000 'EDIDxMODLx'))))
    $all.AddRange([byte[]](Get-Group 'MESG' @(,(Get-Record 'MESG' 0x05E80050 'ITXTaITXTbITXTc'))))
    $dir = Join-Path $tmp $folder
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $dir 'Thornswood-Content.esp'), $all.ToArray())
}

# $engine is the server-build.json text, or $null for none. An entry of
# $order is written as a full path under plugins, the way both servers name
# theirs, unless it starts with ':', which is written as it stands after it.
# $more is added to the settings.
function Run-Remote([string[]]$order, $engine, [hashtable]$more = @{}) {
    $root = $tmp
    $settingsPath = Join-Path $tmp 'server-settings.json'
    $settings = [ordered]@{ port = 7787; dataDir = 'data'; loadOrder = @($order | ForEach-Object {
        if ($_.StartsWith(':')) { $_.Substring(1) } else { (Join-Path (Join-Path $tmp 'plugins') $_).Replace('\', '/') } }) }
    foreach ($k in $more.Keys) { $settings[$k] = $more[$k] }
    [IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
    $rp = Join-Path $tmp 'server-build.json'
    if ($null -eq $engine) { Remove-Item -LiteralPath $rp -Force -ErrorAction SilentlyContinue }
    else { [IO.File]::WriteAllText($rp, $engine, (New-Object Text.UTF8Encoding $false)) }
    $lightDef = 'function Test-ThornswoodPluginLight {' + "`n" + (Get-Command Test-ThornswoodPluginLight).Definition + "`n}"
    $recordsDef = 'function Read-ThornswoodChargenRecords {' + "`n" + (Get-Command Read-ThornswoodChargenRecords).Definition + "`n}"
    $gmDef = 'function Find-ThornswoodGamemodeText {' + "`n" + (Get-Command Find-ThornswoodGamemodeText).Definition + "`n}"
    $needleList = (@($gmNeedles | ForEach-Object { "'" + $_.Text.Replace("'", "''") + "'" }) -join ', ')
    $expanded = $ExecutionContext.InvokeCommand.ExpandString($body)
    $file = Join-Path $tmp 'remote.ps1'
    [IO.File]::WriteAllText($file, $expanded, (New-Object Text.UTF8Encoding $true))
    return @(& $boxPs -NoProfile -ExecutionPolicy Bypass -File $file 2>&1 | ForEach-Object { "$_" })
}

try {
    Write-Plugin 'Skyrim.esm' $false
    Write-Plugin 'Light One.esp' $true
    Write-Plugin 'Skyrim Unbound.esp' $false
    $order = @('Skyrim.esm', 'Light One.esp', '_ResourcePack.esl', 'Skyrim Unbound.esp')

    $said = Run-Remote $order '{ "lightPlugins": true }'
    Yes 'each plugin the order names is read on the box' (
        ($said -contains 'LIGHT 0 Skyrim.esm') -and ($said -contains 'LIGHT 1 Light One.esp') -and
        ($said -contains 'LIGHT 1 _ResourcePack.esl') -and ($said -contains 'LIGHT 0 Skyrim Unbound.esp'))
    Yes '  and the engine is the server''s record: ENGINE True' ($said -contains 'ENGINE True')
    $at = [Array]::IndexOf([string[]]$said, 'SETTINGS')
    $json = (@($said | Select-Object -Skip ($at + 1)) -join "`n")
    Yes '  and the settings follow SETTINGS whole' ($at -ge 0 -and @(($json | ConvertFrom-Json).loadOrder).Count -eq 4)

    $said = Run-Remote $order '{ "lightPlugins": false }'
    Yes 'a record that says its engine does not load them: ENGINE False' ($said -contains 'ENGINE False')
    $said = Run-Remote $order $null
    Yes 'no record on the server: ENGINE none, which the check refuses' ($said -contains 'ENGINE none' -and $text.Contains("so it is not known whether its engine loads light plugins"))
    $said = Run-Remote $order '{ not json'
    Yes 'a record that does not read: ENGINE unreadable' ($said -contains 'ENGINE unreadable')

    $said = Run-Remote @('Skyrim.esm', 'Mystery.esp', 'Skyrim Unbound.esp') '{ "lightPlugins": true }'
    Yes 'a plugin the server does not have is named, not guessed' ($said -contains 'UNREAD Mystery.esp' -and -not @($said | Where-Object { $_ -like 'LIGHT * Mystery.esp' }).Count)

    # #2950: the plugin records and the gamemode, from the server's files.
    Yes 'no Thornswood-Content.esp in the order: PLUGIN NONE' ($said -contains 'PLUGIN NONE')
    Yes 'no gamemode.js in the server folder: GAMEMODE MISSING, naming it' ($said -contains ('GAMEMODE MISSING ' + (Join-Path $tmp 'gamemode.js')))

    $order2 = @('Skyrim.esm', 'Thornswood-Content.esp', 'Skyrim Unbound.esp')
    $said = Run-Remote $order2 '{ "lightPlugins": true }'
    $esp = (Join-Path (Join-Path $tmp 'plugins') 'Thornswood-Content.esp').Replace('\', '/')
    Yes 'a plugin the order names that is not there: PLUGIN MISSING, naming it' ($said -contains ('PLUGIN MISSING ' + $esp))

    Write-Content 'plugins'
    $said = Run-Remote $order2 '{ "lightPlugins": true }'
    Yes 'the plugin the order names is read: PLUGIN AT its path' ($said -contains ('PLUGIN AT ' + $esp))
    Yes '  each BOOK with whether it has a name and a mesh' (
        ($said -contains 'BOOK 05E80030 1 1') -and ($said -contains 'BOOK 05E80031 1 0') -and ($said -contains 'BOOK 05E80000 0 1'))
    Yes '  and no MESG: the creation menus are out of the plugin and the check (#2962)' (
        @($said | Where-Object { $_ -like 'MESG *' }).Count -eq 0)
    $local = @(Read-ThornswoodChargenRecords (Join-Path (Join-Path $tmp 'plugins') 'Thornswood-Content.esp'))
    Yes '  and the box says what the build''s own read says' (
        $local.Count -eq 3 -and @($local | Where-Object { $said -notcontains $_ }).Count -eq 0)

    # A load order entry that is not a full path is under dataDir.
    Write-Content 'data'
    $said = Run-Remote @('Skyrim.esm', ':Thornswood-Content.esp', 'Skyrim Unbound.esp') '{ "lightPlugins": true }'
    Yes 'an entry that is not a full path is read under dataDir' ($said -contains ('PLUGIN AT ' + (Join-Path (Join-Path $tmp 'data') 'Thornswood-Content.esp')))

    $want = @($gmNeedles | ForEach-Object { $_.Text })
    [IO.File]::WriteAllText((Join-Path $tmp 'gamemode.js'), ('const a = "' + $want[0] + '";' + "`n"), (New-Object Text.UTF8Encoding $false))
    $said = Run-Remote $order2 '{ "lightPlugins": true }'
    Yes 'the server folder''s gamemode.js is read: GAMEMODE AT its path' ($said -contains ('GAMEMODE AT ' + (Join-Path $tmp 'gamemode.js')))
    Yes '  and it says which of the check''s texts it holds' (
        ($said -contains ('HAS 1 ' + $want[0])) -and @($want | Select-Object -Skip 1 | Where-Object { $said -notcontains ('HAS 0 ' + $_) }).Count -eq 0)

    # The engine's rule: a skymp5-gamemode folder wins over gamemode.js, and
    # the settings' gamemodePath over both.
    New-Item -ItemType Directory -Path (Join-Path $tmp 'skymp5-gamemode') -Force | Out-Null
    $said = Run-Remote $order2 '{ "lightPlugins": true }'
    Yes 'with a skymp5-gamemode folder, its gamemode.js is the one read' ($said -contains ('GAMEMODE MISSING ' + (Join-Path $tmp 'skymp5-gamemode\gamemode.js')))
    $said = Run-Remote $order2 '{ "lightPlugins": true }' @{ gamemodePath = 'gm\main.js' }
    Yes 'with a gamemodePath, that is the one read' ($said -contains ('GAMEMODE MISSING ' + (Join-Path $tmp 'gm\main.js')))
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
