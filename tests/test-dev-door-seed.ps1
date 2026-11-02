<#
  test-dev-door-seed.ps1

      powershell -NoProfile -File .\tests\test-dev-door-seed.ps1 [-Temp <folder>]

  The dev server's door asks the dev list, and a dev publish leaves the dev
  server's own files alone (#964).

  On 28 Sep the dev door list went from 46 profiles to 28 after Set-Door
  pointed the dev server at https://thornswood.net/dev, which is the design
  (SERVER.md in the ops repo, "The door"; site\server.js, /dev/api/allowed lists only the
  people with the dev role). The 46 was the live list: Set-Door -Connect aimed
  at the dev root wrote the live address unless -Site was given. And
  Publish-Server.ps1's step that was meant to give dev the live roster was
  Copy-Item -LiteralPath with a *, which copies nothing; had it worked it would
  have copied the whole private folder, the live address and the dev world's
  own door.log, characters.json and property files with it.

  This lifts the script Publish-Server.ps1 sends to the VPS out of the file,
  runs it the way the VPS does (Windows PowerShell, -EncodedCommand) against
  two folders standing in for the live and dev private folders, and reads back
  what each file holds afterwards. It also runs Set-Door.ps1's dev default.
  No key is printed: the stand-in keys are checked for in the output.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$Temp)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
# What this runs, every machine runs in PowerShell 7 since #5356, the box
# included, and this harness runs in it too.
$boxPs = Get-BoxPowerShell
$Repo = Split-Path -Parent $PSScriptRoot
$publish = Join-Path $Repo 'scripts\release\Publish-Server.ps1'
$setDoor = Join-Path $Repo 'scripts\ops\Set-Door.ps1'
$siteJs = Join-Path $Repo 'site\server.js'
$gamemode = Join-Path $Repo 'game\gamemode.js'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 } else { exit 0 }
}

# ---- the script a dev publish sends ------------------------------------------
$lines = Get-Content -LiteralPath $publish
$from = -1; $to = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($from -lt 0 -and $lines[$i] -match '^\s*\$seed = @''\s*$') { $from = $i + 1; continue }
    if ($from -ge 0 -and $lines[$i] -eq "'@") { $to = $i - 1; break }
}
Yes 'Publish-Server.ps1 still has the roster script it sends to the dev server' ($from -gt 0 -and $to -gt $from)
if ($to -le $from) { Done }
$seed = ($lines[$from..$to]) -join "`r`n"
Yes 'it names the live private folder the way the test expects' ($seed.Contains("'C:\Thornswood-Server\private'"))
Yes 'and the dev root placeholder' ($seed.Contains('@@DEVROOT@@'))

if (-not $Temp) { $Temp = [IO.Path]::GetTempPath() }
$tmp = Join-Path $Temp ('dev-door-seed-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$LIVEKEY = 'live-bot-key-' + [Guid]::NewGuid().ToString('N')
$PASSKEY = 'live-pass-key-' + [Guid]::NewGuid().ToString('N')
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$file, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $text, $utf8)
}
function Text([string]$file) {
    if (Test-Path -LiteralPath $file) { return [IO.File]::ReadAllText($file) }
    return $null
}
function Door([string]$file) {
    $t = Text $file
    if ($null -eq $t) { return $null }
    return $t | ConvertFrom-Json
}

# Runs the seed the way the VPS does. Returns its output lines.
function Seed([string]$case, [string]$liveSite, [bool]$liveDoor = $true, [bool]$livePriv = $true) {
    $root = Join-Path $tmp $case
    $live = Join-Path $root 'live\private'
    $devRoot = Join-Path $root 'dev'
    if ($livePriv) {
        New-Item -ItemType Directory -Force -Path $live | Out-Null
        if ($liveDoor) {
            Put (Join-Path $live 'door.json') (@{ site = $liveSite; key = $LIVEKEY; passKey = $PASSKEY } | ConvertTo-Json)
        }
        Put (Join-Path $live 'allowed.json') '{"enforce":false,"profiles":[1,2,3],"devProfiles":[1]}'
        Put (Join-Path $live 'characters.json') '{"live":"book"}'
        Put (Join-Path $live 'door.log') "live door log`n"
        Put (Join-Path $live 'property.json') '{"live":"property"}'
    }
    $s = $seed.Replace("'C:\Thornswood-Server\private'", "'" + $live + "'").Replace('@@DEVROOT@@', $devRoot)
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($s))
    $out = & $boxPs -NoProfile -EncodedCommand $enc 2>&1
    return @{ out = @($out | ForEach-Object { [string]$_ }); dev = (Join-Path $devRoot 'private'); code = $LASTEXITCODE }
}
function Quiet($r) {
    $all = $r.out -join "`n"
    return -not ($all.Contains($LIVEKEY) -or $all.Contains($PASSKEY))
}

try {
    # ---- a dev server that already has its own files ------------------------
    $case = 'kept'
    $dev = Join-Path $tmp "$case\dev\private"
    Put (Join-Path $dev 'door.json') (@{ site = 'https://thornswood.net/dev'; key = 'an old rotated key' } | ConvertTo-Json)
    Put (Join-Path $dev 'allowed.json') '{"enforce":false,"profiles":[1],"devProfiles":[1]}'
    Put (Join-Path $dev 'characters.json') '{"dev":"book"}'
    Put (Join-Path $dev 'door.log') "dev door log`n"
    Put (Join-Path $dev 'property.json') '{"dev":"property"}'
    $r = Seed $case 'https://thornswood.net'
    Yes 'the seed runs under Windows PowerShell' ($r.code -eq 0)
    $d = Door (Join-Path $r.dev 'door.json')
    Yes 'the dev door asks the dev list, https://thornswood.net/dev' ($d.site -eq 'https://thornswood.net/dev')
    Yes 'and carries the live bot key, so a rotated key reaches dev' ($d.key -eq $LIVEKEY)
    Yes 'and the live join pass key' ($d.passKey -eq $PASSKEY)
    Yes 'the dev list is left as the dev door fetched it' ((Text (Join-Path $r.dev 'allowed.json')) -eq '{"enforce":false,"profiles":[1],"devProfiles":[1]}')
    Yes 'the dev server keeps its own character book' ((Text (Join-Path $r.dev 'characters.json')) -eq '{"dev":"book"}')
    Yes 'the dev door keeps its own log' ((Text (Join-Path $r.dev 'door.log')) -eq "dev door log`n")
    Yes 'the dev world keeps its own property' ((Text (Join-Path $r.dev 'property.json')) -eq '{"dev":"property"}')
    Yes 'it says which address the dev door asks' (($r.out -join ' ').Contains('https://thornswood.net/dev/api/allowed'))
    Yes 'no key appears in what it prints' (Quiet $r)
    Yes 'the dev door.json has no byte order mark' ([IO.File]::ReadAllBytes((Join-Path $r.dev 'door.json'))[0] -eq [byte][char]'{')

    # ---- a fresh dev root ----------------------------------------------------
    $r = Seed 'fresh' 'https://thornswood.net/'
    $d = Door (Join-Path $r.dev 'door.json')
    Yes 'a fresh dev root gets its private folder and a door.json' ($null -ne $d)
    Yes 'a trailing slash on the live address does not make a double slash' ($d.site -eq 'https://thornswood.net/dev')
    Yes 'a fresh dev root starts from the live list so the Owner has commands' ((Text (Join-Path $r.dev 'allowed.json')) -eq '{"enforce":false,"profiles":[1,2,3],"devProfiles":[1]}')
    Yes 'and says so' (($r.out -join ' ').Contains('dev had no allowed.json'))
    Yes 'the live character book is not copied to a fresh dev root' (-not (Test-Path -LiteralPath (Join-Path $r.dev 'characters.json')))
    Yes 'nor the live door log' (-not (Test-Path -LiteralPath (Join-Path $r.dev 'door.log')))
    Yes 'nor live property' (-not (Test-Path -LiteralPath (Join-Path $r.dev 'property.json')))
    Yes 'no key appears in what it prints on a fresh root' (Quiet $r)

    # ---- an address that already names the dev list ---------------------------
    $r = Seed 'already' 'https://thornswood.net/dev'
    Yes 'an address already ending in /dev is not given a second one' ((Door (Join-Path $r.dev 'door.json')).site -eq 'https://thornswood.net/dev')

    # ---- nothing on live to take ------------------------------------------------
    $case = 'nodoor'
    $dev = Join-Path $tmp "$case\dev\private"
    Put (Join-Path $dev 'door.json') '{"site":"https://thornswood.net/dev","key":"dev own"}'
    $r = Seed $case '' $false
    Yes 'with no live door.json the dev one is left as it was' ((Text (Join-Path $dev 'door.json')) -eq '{"site":"https://thornswood.net/dev","key":"dev own"}')
    Yes 'and it says so' (($r.out -join ' ').Contains('no door.json'))

    $r = Seed 'nopriv' '' $false $false
    Yes 'with no live private folder it says there is nothing to copy' (($r.out -join ' ').Contains('no private folder'))
    Yes 'and makes nothing on dev' (-not (Test-Path -LiteralPath $r.dev))
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- Set-Door.ps1 aimed at the dev root ----------------------------------------
$sd = Get-Content -LiteralPath $setDoor -Raw
$m = [regex]::Match($sd, "(?ms)^if \(\`$root -match '-Dev\`$'.*?^\}")
Yes 'Set-Door.ps1 has the dev address default' ($m.Success)
if ($m.Success) {
    $f = [scriptblock]::Create("param([string]`$Site = 'https://thornswood.net', [string]`$root)`r`n" + $m.Value + "`r`n`$Site")
    Yes 'Set-Door -Connect -Root C:\Thornswood-Server-Dev points the dev door at /dev' ((& $f -root 'C:\Thornswood-Server-Dev') -eq 'https://thornswood.net/dev')
    Yes 'the live root keeps the live address' ((& $f -root 'C:\Thornswood-Server') -eq 'https://thornswood.net')
    Yes 'a -Site given outright still wins on the dev root' ((& $f -root 'C:\Thornswood-Server-Dev' -Site 'https://example.test') -eq 'https://example.test')
}

# ---- the address the door builds lands on the route that lists dev only -------
$gm = Get-Content -LiteralPath $gamemode -Raw
Yes 'the door asks <site>/api/allowed' ($gm.Contains("String(conf.site).replace(/\/+`$/, '') + '/api/allowed'"))
# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot 'SiteFiles.ps1')
$js = Get-SiteSource (Join-Path $Repo 'site')
Yes 'the site answers /dev/api/allowed' ($js.Contains("const devDoor = (route === '/dev/api/allowed');"))
# Since #3317 the dev server lets in the dev build's list (access.devBuild:
# Owner, Co-Owner, Dev and the leads), not the staff list access.dev.
Yes 'and that list is only people the dev build is for' ($js.Contains('if (devDoor && !st.devBuild) continue;'))

Done
