<#
  test-3317-access-lists.ps1

  Set-DiscordLogin.ps1 -Access writes one of the site's access lists whole
  and keeps the rest (#3317). Patrick split who gets the dev build from who
  is staff in the game (access.devBuild), and the Trading Company role became
  the company's member role, Free Skyrim Trading Company (access.company).
  Until this, nothing changed a list on the box after the first time but a
  hand in config.json.

    A1 the lists -Access takes are exactly the site's cfg.access lists
    A2 what runs on the box writes a named list whole and keeps every other
       list, and every other setting
    A3 a run with no -Access leaves the lists as they are
    A4 an access block read as a table (a first-time run) is kept the same way

  HOW. Runs the part of what Set-DiscordLogin.ps1 sends to the box that reads
  config.json and changes it, against a file in a scratch folder, the way
  test-bot-login-rotation.ps1 runs its head. Never connects to anything.
#>
[CmdletBinding()]
param([string]$Scratch)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$login  = Join-Path $repo 'scripts\deploy\Set-DiscordLogin.ps1'
# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot 'SiteFiles.ps1')
$server = Get-SiteSource (Join-Path $repo 'site')
. (Join-Path $repo 'scripts\vps\Write-BotToken.ps1')

# ------------------------------------------------------------------- A1 ---
$lt = [IO.File]::ReadAllText($login)
$m = [regex]::Match($lt, "(?m)^\`$accessLists = (.+)$")
$took = @(if ($m.Success) { [regex]::Matches($m.Groups[1].Value, "'([A-Za-z0-9]+)'") | ForEach-Object { $_.Groups[1].Value } })
$site = @([regex]::Matches($server, 'cfg\.access\.([A-Za-z0-9]+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
Yes ('A1 -Access takes the site''s lists: ' + ($site -join ', ')) ((@($took | Sort-Object) -join ',') -ceq ($site -join ','))

# ------------------------------------------------------------- A2 to A4 ---
$ll = @(Get-Content -LiteralPath $login)
$hs = [Array]::IndexOf($ll, '`$patch = `$null')
$he = -1
for ($i = 0; $i -lt $ll.Count; $i++) { if ($ll[$i] -like '# Set-Content -Encoding UTF8 on Windows PowerShell*') { $he = $i; break } }
Yes 'found what Set-DiscordLogin.ps1 runs on the box, up to its write' ($hs -ge 0 -and $he -gt $hs)
if ($hs -ge 0 -and $he -gt $hs) {
    $dir = Join-Path $Scratch ('access-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $dir | Out-Null
    try {
        $rootWin = $dir
        $body = $ExecutionContext.InvokeCommand.ExpandString(($ll[$hs..($he - 1)] -join "`r`n")) +
            "`r`n`$cfg | ConvertTo-Json -Depth 6"
        $cfgFile = Join-Path $dir 'config.json'
        $live = '{"botKey":"not-a-real-key","discord":{"clientId":"1"},"access":{"admin":["Owner","Dev"],' +
                '"play":["Owner","Playtester"],"company":["Trading Company"],"banned":["Banned"]}}'

        function Run([string]$secret) {
            $script:ThornswoodSecret = $secret
            $ThornswoodSecret = $secret
            $out = @(& ([scriptblock]::Create($body)) | ForEach-Object { "$_" }) -join "`n"
            return ($out | ConvertFrom-Json)
        }

        [IO.File]::WriteAllText($cfgFile, $live)
        $got = Run '{"discord":{},"token":"","patreon":"","admins":[],"access":{"company":["Free Skyrim Trading Company"],"devBuild":["Owner","Co-Owner","Dev"]}}'
        Yes 'A2 the named lists are written whole' (
            (@($got.access.company) -join '|') -ceq 'Free Skyrim Trading Company' -and
            (@($got.access.devBuild) -join '|') -ceq 'Owner|Co-Owner|Dev')
        Yes 'A2 every list not named is kept as it was' (
            (@($got.access.admin) -join '|') -ceq 'Owner|Dev' -and
            (@($got.access.play) -join '|') -ceq 'Owner|Playtester' -and
            (@($got.access.banned) -join '|') -ceq 'Banned')
        Yes 'A2 and so is every other setting' ($got.botKey -ceq 'not-a-real-key' -and $got.discord.clientId -ceq '1')

        [IO.File]::WriteAllText($cfgFile, $live)
        $got = Run '{"discord":{},"token":"","patreon":"","admins":[]}'
        Yes 'A3 a run with no -Access leaves the lists as they are' (
            (@($got.access.company) -join '|') -ceq 'Trading Company' -and
            (@($got.access.play) -join '|') -ceq 'Owner|Playtester' -and -not $got.access.devBuild)

        [IO.File]::WriteAllText($cfgFile, '{"botKey":"not-a-real-key"}')
        $got = Run '{"discord":{},"token":"","patreon":"","admins":[],"access":{"company":["Free Skyrim Trading Company"]}}'
        Yes 'A4 on a first-time file the defaults are made and the named list written over them' (
            (@($got.access.company) -join '|') -ceq 'Free Skyrim Trading Company' -and
            (@($got.access.banned) -join '|') -ceq 'Banned' -and @($got.access.play) -contains 'Playtester')
    } finally { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
