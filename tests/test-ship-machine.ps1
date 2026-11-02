<#
  test-ship-machine.ps1

      pwsh -NoProfile -File .\tests\test-ship-machine.ps1

  Whether a second Windows machine can be made ready to Ship dev without
  anything copied from One, and without weakening signing. Issue #458.

  WHY THIS EXISTS. Measured on One on 29 September: the signing setup there
  (records\signing\signing.json naming C:\tools\metadata.json and a client folder only
  One has, and the az sign in behind it) and the client runtime the record
  names (held only in One's dev game folder) were the two things a Ship needs
  that no other machine could get. scripts\release\Setup-ShipMachine.ps1
  fetches or writes them, and docs/guide/set-up-a-machine.md "Shipping from another machine"
  says the rest. This proves both do what they say.

  What it runs. The helpers out of Setup-ShipMachine.ps1 and Get-SigningRows
  out of Check-ShipReady.ps1, lifted by the PowerShell parser, against a
  scratch repository, feed and client build, with the real Sync-Client.ps1
  and Assert-PublishSigned.ps1 answering:
    1. The template holds paths and "enabled": true only, is tracked, and a signing.json written
       from it is one Ship accepts.
    2. signing.json is written only when there is none, never changed after,
       never from a template that carries anything but the four paths.
    3. The signing client is found in either layout, fetched only at the
       pinned sha256, and nothing is unpacked from any other bytes.
    4. The client runtime is found on a feed by the record's commit, and put
       in the build folder only when the zip is the feed's bytes and every
       file is the recorded one; then Sync-Client -Check agrees.
    5. Check-ShipReady says NOT READY for a machine that cannot sign, and
       asks for the Vortex profile Ship stops on.
    6. The runbook section: every script it names is in the repository with
       the parameters it is given, and it covers every item the measurement
       found.

  Writes only to a temp folder of its own, and removes it. Nothing is fetched
  from the network.
#>
[CmdletBinding()]
param([string]$Work)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$Release = Join-Path $Repo 'scripts\release'
$Setup = Join-Path $Release 'Setup-ShipMachine.ps1'
# The sections lifted below call ConvertFrom-ThornswoodJson, which their script dot-sources.
. (Join-Path $Release 'Read-JsonFile.ps1')
$Ready = Join-Path $Release 'Check-ShipReady.ps1'
$Sync = Join-Path $Release 'Sync-Client.ps1'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
    else       { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

# ------------------------------------------------ the functions under test --
# Returns the parsed script and the text of each function asked for; the
# caller defines them, at this script's scope.
function Lift([string]$path, [string[]]$names) {
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errs)
    Yes ((Split-Path -Leaf $path) + ' parses') (@($errs).Count -eq 0)
    $fns = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true))
    $texts = @()
    foreach ($name in $names) {
        $f = @($fns | Where-Object { $_.Name -eq $name })
        Yes ((Split-Path -Leaf $path) + " has $name") ($f.Count -eq 1)
        if ($f.Count -eq 1) { $texts += $f[0].Extent.Text }
    }
    return [pscustomobject]@{ Ast = $ast; Texts = $texts }
}
$setupLift = Lift $Setup @('Get-SigningClientPin', 'Get-Sha256', 'Find-SigningDlib', 'Save-SigningClient', 'New-SigningConfig',
                           'Get-SigningPathsMissing', 'Get-SignatureIdentities', 'Find-ClientRuntime', 'Get-ClientMatch', 'Install-ClientRuntime')
$readyLift = Lift $Ready @('New-Row', 'Get-SigningRows')
foreach ($text in @($setupLift.Texts) + @($readyLift.Texts)) { Invoke-Expression $text }
$setupAst = $setupLift.Ast
. (Join-Path $Release 'Assert-PublishSigned.ps1')
if ($script:fail) { Write-Host "$($script:pass) passed, $($script:fail) failed"; exit 1 }

function Put([string]$root, [string]$rel, [string]$text) {
    $p = Join-Path $root $rel
    $d = Split-Path -Parent $p
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    [IO.File]::WriteAllText($p, $text)
    return $p
}
function Fresh([string]$p) {
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $p | Out-Null
}
function Zip([string]$from, [string]$to) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $to) { Remove-Item -LiteralPath $to -Force }
    [IO.Compression.ZipFile]::CreateFromDirectory($from, $to)
}

if (-not $Work) { $Work = [IO.Path]::GetTempPath() }
$tmp = Join-Path $Work ('ts-ship-machine-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    # ------------------------------------------------------ 1. the template --
    $template = Join-Path $Repo 'records\signing\signing.template.json'
    Yes '1. records\signing\signing.template.json is in the repository' (Test-Path -LiteralPath $template)
    $t = Get-Content -LiteralPath $template -Raw | ConvertFrom-Json
    $keys = @($t.PSObject.Properties.Name | Sort-Object)
    Yes '1. it holds the four paths and "enabled", and nothing else (no key, no password, no thumbprint)' (($keys -join ',') -eq 'dlib,enabled,metadata,method,timestampUrl')
    Yes '1. and "enabled" is true' ($t.enabled -eq $true)
    Yes '1. it signs with Artifact Signing' ($t.method -eq 'artifactsigning')
    Yes '1. its dlib and metadata are relative, so it works wherever the repository is cloned' (
        -not [IO.Path]::IsPathRooted([string]$t.dlib) -and -not [IO.Path]::IsPathRooted([string]$t.metadata))
    Yes '1. its metadata is the tracked records\signing\metadata.json' ([string]$t.metadata -eq 'records\signing\metadata.json' -and (Test-Path -LiteralPath (Join-Path $Repo $t.metadata)))
    Yes '1. its dlib is under records\signing\client, which git ignores' ([string]$t.dlib -like 'records\signing\client\*')
    Yes '1. it has the Artifact Signing timestamp, without which a signature dies with its 3 day certificate' ($t.timestampUrl -eq 'http://timestamp.acs.microsoft.com')
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & git -C $Repo check-ignore -q 'records/signing/signing.template.json' 2>$null; $ign = ($LASTEXITCODE -eq 0)
    & git -C $Repo check-ignore -q 'records/signing/signing.json' 2>$null; $cfgIgn = ($LASTEXITCODE -eq 0)
    & git -C $Repo check-ignore -q 'records/signing/signing.json.old' 2>$null; $oldIgn = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $old
    Yes '1. git tracks the template' (-not $ign)
    Yes '1. and ignores records\signing\signing.json and the .old a person moves aside' ($cfgIgn -and $oldIgn)

    # ------------------------------------------------ 2. writing signing.json --
    $fake = Join-Path $tmp 'repo'
    Fresh $fake
    $null = Put $fake 'records\signing\metadata.json' (Get-Content -LiteralPath (Join-Path $Repo 'records\signing\metadata.json') -Raw)
    $cfg = Join-Path $fake 'records\signing\signing.json'
    $r = New-SigningConfig $template $cfg ''
    Yes '2. with none there, it is written' ($r.Wrote -and (Test-Path -LiteralPath $cfg))
    $w = Get-Content -LiteralPath $cfg -Raw | ConvertFrom-Json
    Yes '2. as the template' ($w.dlib -eq $t.dlib -and $w.metadata -eq $t.metadata -and $w.method -eq 'artifactsigning')
    Yes '2. with signing on' ($w.enabled -eq $true)
    # This harness runs under Set-StrictMode -Version Latest, as Ship does,
    # where that check throws on a signing.json with no "enabled" (29 Sep).
    Yes '2. and Ship''s own check accepts it, under the strict mode Ship runs in' ((Get-SigningConfigRefusal -ConfigPath $cfg -RepoRoot $fake) -eq '')
    $miss = @(Get-SigningPathsMissing $cfg $fake)
    Yes '2. with no signing client yet, the missing dlib is named, and only it' ($miss.Count -eq 1 -and $miss[0] -like 'dlib *')

    $before = [IO.File]::ReadAllText($cfg)
    $r = New-SigningConfig $template $cfg 'records\signing\client\somewhere\bin\x64\Azure.CodeSigning.Dlib.dll'
    Yes '2. one that is there is never changed' (-not $r.Wrote -and [IO.File]::ReadAllText($cfg) -eq $before)

    Remove-Item -LiteralPath $cfg -Force
    $r = New-SigningConfig $template $cfg 'records\signing\client\client\X\bin\x64\Azure.CodeSigning.Dlib.dll'
    Yes '2. the dlib this machine has replaces the template''s' ($r.Wrote -and (Get-Content -LiteralPath $cfg -Raw | ConvertFrom-Json).dlib -eq 'records\signing\client\client\X\bin\x64\Azure.CodeSigning.Dlib.dll')

    Remove-Item -LiteralPath $cfg -Force
    $bad = Put $tmp 'bad-template.json' '{"method":"artifactsigning","dlib":"a","metadata":"b","timestampUrl":"c","enabled":false}'
    $r = New-SigningConfig $bad $cfg ''
    Yes '2. a template that turns signing off is refused, and nothing is written' (-not $r.Wrote -and $r.Why -match 'turns signing off' -and -not (Test-Path -LiteralPath $cfg))
    $bad = Put $tmp 'bad-template2.json' '{"method":"thumbprint","thumbprint":"0123","dlib":"a","metadata":"b","timestampUrl":"c","enabled":true}'
    $r = New-SigningConfig $bad $cfg ''
    Yes '2. so is one with anything but the four paths and "enabled"' (-not $r.Wrote -and $r.Why -match 'thumbprint')
    $bad = Put $tmp 'bad-template3.json' '{"method":"artifactsigning","dlib":"a","metadata":"b","timestampUrl":"c"}'
    $r = New-SigningConfig $bad $cfg ''
    Yes '2. and one without "enabled", which strict mode would throw on in Ship' (-not $r.Wrote -and -not (Test-Path -LiteralPath $cfg))

    $null = Put $fake 'records\signing\signing.json' '{"method":"artifactsigning","dlib":"C:\\tools\\nowhere\\Azure.CodeSigning.Dlib.dll","metadata":"C:\\tools\\nowhere\\metadata.json"}'
    $miss = @(Get-SigningPathsMissing $cfg $fake)
    Yes '2. a copy from One naming One''s paths says both are missing' ($miss.Count -eq 2)

    # ------------------------------------------------ 3. the signing client --
    $pin = Get-SigningClientPin
    Yes '3. the pin is Microsoft.ArtifactSigning.Client 1.0.128' ($pin.Id -eq 'Microsoft.ArtifactSigning.Client' -and $pin.Version -eq '1.0.128')
    Yes '3. with a sha256' ($pin.Sha256 -match '^[0-9a-f]{64}$')
    Yes '3. fetched from nuget.org by that id and version' ($pin.Url -eq ('https://api.nuget.org/v3-flatcontainer/microsoft.artifactsigning.client/' + $pin.Version + '/microsoft.artifactsigning.client.' + $pin.Version + '.nupkg'))

    Fresh $fake
    Yes '3. no client: nothing found' ((Find-SigningDlib $fake) -eq '')
    $null = Put $fake 'records\signing\client\client\Microsoft.ArtifactSigning.Client\bin\x86\Azure.CodeSigning.Dlib.dll' 'x86'
    Yes '3. an x86 dlib alone does not count' ((Find-SigningDlib $fake) -eq '')
    $null = Put $fake 'records\signing\client\client\Microsoft.ArtifactSigning.Client\bin\x64\Azure.CodeSigning.Dlib.dll' 'x64'
    Yes '3. One''s layout (nuget.exe''s) is found, relative to the repository' ((Find-SigningDlib $fake) -eq 'records\signing\client\client\Microsoft.ArtifactSigning.Client\bin\x64\Azure.CodeSigning.Dlib.dll')

    Fresh $fake
    $pkgDir = Join-Path $tmp 'pkg'
    Fresh $pkgDir
    $null = Put $pkgDir 'bin\x64\Azure.CodeSigning.Dlib.dll' 'the dlib'
    $null = Put $pkgDir 'bin\x64\Azure.Identity.dll' 'what comes with it'
    $pkg = Join-Path $tmp 'client.nupkg'
    Zip $pkgDir $pkg
    # A closure: inside Save-SigningClient a bare $pkg would be its own.
    $servedPkg = $pkg
    $fetch = { param($u, $p) Copy-Item -LiteralPath $servedPkg -Destination $p -Force }.GetNewClosure()
    $good = [pscustomobject]@{ Id = 'Microsoft.ArtifactSigning.Client'; Version = '9.9.9'; Sha256 = (Get-Sha256 $pkg); Url = 'https://example.invalid/x.nupkg' }
    $wrong = [pscustomobject]@{ Id = 'Microsoft.ArtifactSigning.Client'; Version = '9.9.9'; Sha256 = ('0' * 64); Url = 'https://example.invalid/x.nupkg' }
    $why = Save-SigningClient $fake $wrong $fetch (Join-Path $tmp 'dl')
    Yes '3. bytes that are not the pinned sha256 are refused' ($why -match 'not the pinned one')
    Yes '3. and nothing is unpacked' (-not (Test-Path -LiteralPath (Join-Path $fake 'records\signing\client')) -or (Find-SigningDlib $fake) -eq '')
    $why = Save-SigningClient $fake $good $fetch (Join-Path $tmp 'dl')
    Yes '3. the pinned bytes are unpacked' ($why -eq '')
    Yes '3. into records\signing\client\<id>, where the template looks' ((Find-SigningDlib $fake) -eq 'records\signing\client\Microsoft.ArtifactSigning.Client\bin\x64\Azure.CodeSigning.Dlib.dll')
    Yes '3. which is the template''s dlib exactly' ((Find-SigningDlib $fake) -eq [string]$t.dlib)
    Yes '3. with no half unpacked folder left beside it' (-not (Test-Path -LiteralPath (Join-Path $fake 'records\signing\client\Microsoft.ArtifactSigning.Client.part')))

    Fresh $pkgDir
    $null = Put $pkgDir 'lib\something.dll' 'not the dlib'
    Zip $pkgDir $pkg
    $empty = Join-Path $tmp 'repo2'
    Fresh $empty
    $good.Sha256 = Get-Sha256 $pkg
    $why = Save-SigningClient $empty $good $fetch (Join-Path $tmp 'dl')
    Yes '3. a package with no x64 dlib is refused and nothing is put in place' ($why -match 'no bin' -and (Find-SigningDlib $empty) -eq '')

    # ---------------------------------------------------- 4. the client runtime --
    $client = [ordered]@{
        'Data\SKSE\Plugins\MpClientPlugin.dll' = 'plugin'
        'Data\SKSE\Plugins\SkyrimPlatform.dll' = 'platform'
        'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformImpl.dll' = 'impl'
        'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformCEF.exe.hidden' = 'cef'
        'Data\Platform\Plugins\skymp5-client.js' = 'bundle'
        'Data\Scripts\TESModPlatform.pex' = 'pex'
    }
    $proto = Join-Path $tmp 'proto'
    Fresh $proto
    $files = [ordered]@{}
    foreach ($rel in $client.Keys) {
        $p = Put $proto $rel $client[$rel]
        $files[$rel] = [ordered]@{ sha256 = (Get-Sha256 $p); bytes = (Get-Item -LiteralPath $p).Length }
    }
    $null = Put $proto 'THIRD-PARTY-NOTICE.txt' 'the source notice the feed zip carries'
    $record = Join-Path $tmp 'client-build.json'
    ([ordered]@{ forkCommit = 'abcdef12'; forkBranch = 'thornswood/engine-changes'; recordedUtc = '2026-09-29T00:00:00Z'; files = $files } |
        ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $record -Encoding UTF8
    $zip = Join-Path $tmp 'client-runtime-abcdef12.zip'
    Zip $proto $zip
    $zsha = Get-Sha256 $zip; $zlen = (Get-Item -LiteralPath $zip).Length

    function Feed([string]$commit, [string]$sha) {
        return [pscustomobject]@{ launcherVersion = '1.1.1'; clientRuntime = [pscustomobject]@{ url = ('https://thornswood.net/feed-dev/assets/' + $sha); sha256 = $sha; bytes = $zlen; forkCommit = $commit } }
    }
    $feeds = @([pscustomobject]@{ Name = 'dev'; Doc = (Feed 'ffff0000' $zsha) }, [pscustomobject]@{ Name = 'main'; Doc = (Feed 'abcdef12' $zsha) })
    $cr = Find-ClientRuntime $feeds 'abcdef12'
    Yes '4. the runtime is found on the feed whose commit is the record''s' ($null -ne $cr -and $cr.Feed -eq 'main' -and $cr.Sha256 -eq $zsha -and $cr.Bytes -eq $zlen)
    Yes '4. a commit on no feed finds nothing' ($null -eq (Find-ClientRuntime $feeds '12345678'))
    $noSha = @([pscustomobject]@{ Name = 'dev'; Doc = (Feed 'abcdef12' 'not-a-sha') })
    Yes '4. an entry without a real sha256 is not trusted' ($null -eq (Find-ClientRuntime $noSha 'abcdef12'))
    $unread = @([pscustomobject]@{ Name = 'dev'; Doc = $null }, [pscustomobject]@{ Name = 'main'; Doc = [pscustomobject]@{ launcherVersion = '1' } })
    Yes '4. a feed that could not be read, or has no clientRuntime, is passed over' ($null -eq (Find-ClientRuntime $unread 'abcdef12'))

    $dist = Join-Path $tmp 'repo\engine\skymp\build\dist\client'
    $stage = Join-Path $tmp 'stage'
    $why = Install-ClientRuntime $zip ('1' * 64) $zlen $record $dist $stage
    Yes '4. a zip that is not the feed''s sha256 is refused' ($why -match 'not the one the feed names')
    Yes '4. and nothing is put in the build folder' (-not (Test-Path -LiteralPath $dist))
    $why = Install-ClientRuntime $zip $zsha ($zlen + 1) $record $dist $stage
    Yes '4. so is one that is not the size the feed names' ($why -match 'size' -and -not (Test-Path -LiteralPath $dist))

    $null = Put $proto 'Data\Scripts\TESModPlatform.pex' 'a pex from an edited engine'
    $zip2 = Join-Path $tmp 'edited.zip'
    Zip $proto $zip2
    $null = Put $proto 'Data\Scripts\TESModPlatform.pex' $client['Data\Scripts\TESModPlatform.pex']
    $why = Install-ClientRuntime $zip2 (Get-Sha256 $zip2) 0 $record $dist $stage
    Yes '4. a zip holding a file that is not the recorded build is refused, naming it' ($why -match 'TESModPlatform\.pex' -and $why -match 'not the recorded build')
    Yes '4. and not one of the six is put in the build folder' (-not (Test-Path -LiteralPath $dist))
    Yes '4. and the unpacked copy is cleaned up' (-not (Test-Path -LiteralPath $stage))

    $why = Install-ClientRuntime $zip $zsha $zlen $record $dist $stage
    Yes '4. the feed''s zip with the recorded files goes in' ($why -eq '')
    Yes '4. all six, as recorded' ((Get-ClientMatch $record $dist) -eq 6)
    Yes '4. and only the six: the notice stays out of the build folder' (-not (Test-Path -LiteralPath (Join-Path $dist 'THIRD-PARTY-NOTICE.txt')))
    Yes '4. with no unpacked copy left' (-not (Test-Path -LiteralPath $stage))

    $game = Join-Path $tmp 'Game'
    Fresh $game
    $global:LASTEXITCODE = 0
    & $Sync -Check -NoPause -Game $game -Dist $dist -Record $record 6>$null | Out-Null
    Yes '4. Sync-Client -Check agrees: the build matches and Ship copies it in (exit 2)' ($LASTEXITCODE -eq 2)
    Yes '4. an empty game folder holds none of them' ((Get-ClientMatch $record $game) -eq 0)
    Yes '4. a folder that is not there holds none of them' ((Get-ClientMatch $record (Join-Path $tmp 'nowhere')) -eq 0)

    $real = Get-Content -LiteralPath (Join-Path $Repo 'records\client-build.json') -Raw | ConvertFrom-Json
    Yes '4. the real record names six files, which is what the feed''s zip carries' (@($real.files.PSObject.Properties).Count -eq 6)

    # ---------------------------------------------- 5. Check-ShipReady rows --
    $sr = Join-Path $tmp 'sr'
    Fresh $sr
    $srCfg = Join-Path $sr 'records\signing\signing.json'
    $rows = @(Get-SigningRows $srCfg $sr '' 'C:\signtool.exe')
    Yes '5. no signing.json: one row, NOT READY, pointing at Setup-ShipMachine' ($rows.Count -eq 1 -and -not $rows[0].Ok -and $rows[0].Level -eq 'need' -and $rows[0].Fix -match 'Setup-ShipMachine\.ps1')
    $null = Put $sr 'records\signing\signing.json' '{"method":"artifactsigning","dlib":"records\\signing\\client\\X\\bin\\x64\\Azure.CodeSigning.Dlib.dll","metadata":"records\\signing\\metadata.json"}'
    $null = Put $sr 'records\signing\metadata.json' '{}'
    $rows = @(Get-SigningRows $srCfg $sr 'records\signing\signing.json has "enabled": false.' 'C:\signtool.exe')
    Yes '5. a signing.json Ship refuses is a need that fails, saying why' (-not $rows[0].Ok -and $rows[0].Level -eq 'need' -and $rows[0].Detail -match 'enabled')
    $rows = @(Get-SigningRows $srCfg $sr '' 'C:\signtool.exe')
    Yes '5. one Ship accepts, naming a dlib that is not here, fails on the dlib' ($rows[0].Ok -and -not $rows[1].Ok -and $rows[1].Detail -match 'dlib' -and $rows[1].Detail -notmatch 'metadata')
    $null = Put $sr 'records\signing\client\X\bin\x64\Azure.CodeSigning.Dlib.dll' 'dlib'
    $rows = @(Get-SigningRows $srCfg $sr '' 'C:\signtool.exe')
    Yes '5. with the dlib and metadata here and signtool installed, all three pass' (@($rows | Where-Object { -not $_.Ok }).Count -eq 0 -and $rows.Count -eq 3)
    $rows = @(Get-SigningRows $srCfg $sr '' '')
    Yes '5. no signtool fails as a need' (-not $rows[2].Ok -and $rows[2].Level -eq 'need')
    $readyText = Get-Content -LiteralPath $Ready -Raw
    Yes '5. Check-ShipReady asks the signing rows' ($readyText -match "Head 'Signing'" -and $readyText -match 'Get-SigningRows \$signCfg')
    Yes '5. and the Vortex profile named Thornswood, which Ship stops on' ($readyText -match "Ready 'Vortex has a profile named Thornswood'")

    # ------------------------------------------------ the script's own rules --
    $setupText = Get-Content -LiteralPath $Setup -Raw
    Yes 'Setup-ShipMachine never sets "enabled" on a signing config' ($setupText -notmatch '(?i)\.enabled\s*=' -and $setupText -notmatch '(?i)enabled\s*=\s*\$false')
    # Three writers since #2019: New-SigningConfig, the one for signing.json,
    # Save-ShipRoot, which records the release folder outside the repository
    # (#1692), and Save-EngineBuild, which records the engine build beside it.
    $writers = @(([System.Management.Automation.Language.Parser]::ParseInput($setupText, [ref]$null, [ref]$null)).FindAll({ param($n)
        $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and $n.Member.Extent.Text -eq 'WriteAllText' }, $true) | ForEach-Object {
        $p = $_.Parent; while ($p -and -not ($p -is [System.Management.Automation.Language.FunctionDefinitionAst])) { $p = $p.Parent }
        if ($p) { $p.Name } else { '(top level)' } })
    Yes ('it writes signing.json only through New-SigningConfig, and nothing else but Save-ShipRoot and Save-EngineBuild writes a file (' + ($writers -join ', ') + ')') (
        $writers.Count -eq 3 -and $writers -contains 'New-SigningConfig' -and $writers -contains 'Save-ShipRoot' -and $writers -contains 'Save-EngineBuild')
    Yes 'it never prints the Azure token' ($setupText -notmatch 'Say[^\n]*\$t\b' -and $setupText -notmatch 'Write-Host[^\n]*\$t\b')
    Yes 'it runs Check-ShipReady for the verdict' ($setupText -match "Check-ShipReady\.ps1'\) @readyArgs")
    $declared = @($setupAst.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
    $undoc = @($declared | Where-Object { $setupText -notmatch ('(?m)^\.PARAMETER ' + $_ + '\s*$') })
    Yes ('every parameter has its own .PARAMETER (' + ($declared -join ', ') + ')') ($declared.Count -ge 5 -and $undoc.Count -eq 0)
    $ids = @(Get-SignatureIdentities (Join-Path $Repo 'launcher\app\Signature.cs'))
    Yes 'the identity the launcher pins is read out of Signature.cs' ($ids -contains '1.3.6.1.4.1.311.97.203948530.216998690.847558466.123546472')

    # --------------------------------------------------------- 6. the runbook --
    # The runbook is a section of the guide's set up page, and the secrets
    # table is the guide's secrets page (tests/Guide-Text.ps1).
    . (Join-Path $PSScriptRoot 'Guide-Text.ps1')
    $dev = Get-GuidePage 'set-up-a-machine'
    $secrets = Get-GuidePage 'secrets'
    $m = [regex]::Match($dev, '(?m)^(?<hashes>#{2,3}) Shipping from another machine\s*$')
    Yes '6. docs/guide/set-up-a-machine.md has the section "Shipping from another machine"' ($m.Success)
    $level = $m.Groups['hashes'].Value.Length
    $rest = $dev.Substring($m.Index + $m.Length)
    $end = [regex]::Match($rest, ('(?m)^#{1,' + $level + '} '))
    $sec = if ($end.Success) { $rest.Substring(0, $end.Index) } else { $rest }
    foreach ($item in @('records\signing\signing.json', 'signing client', 'az login', 'Certificate Profile Signer', 'client runtime', 'game folder',
                        'Vortex', 'feed', 'webhooks', 'VPS access', 'Backups', 'records\signing\signing.template.json')) {
        Yes ("6. it covers " + $item) ($sec.IndexOf($item, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    }
    # Patrick, 4 Oct (#1740): each person who ships signs in as themselves, with
    # an account of their own that holds the signer role, which he makes once;
    # a device code is refused by the tenant (AADSTS530035). It replaced 29
    # Sep's rule that only his account signs (#1121). And the domain is in his
    # own Cloudflare login, signed in with GitHub.
    Yes '6. it says each person signs with an account of their own, made once by Patrick, never with a device code' (
        $sec -match 'an account of their own' -and $sec -match '(?m)^### Your own signing sign in\s*$' -and
        $sec -match 'AADSTS530035' -and $sec -notmatch "Only Patrick's Azure account has signing access" -and
        $sec -notmatch 'signs only while it is signed in as him')
    Yes '4. Setup-ShipMachine sends a sign in with no role to that step, not to Patrick''s own sign in' (
        $setupText.Contains('Your own signing sign in') -and $setupText.Contains('--allow-no-subscriptions') -and
        $setupText -notmatch 'as Patrick: only his Azure account' -and $setupText -notmatch 'signs only while signed in as him')
    # The same two rows of OWNERSHIP.md are checked by tests/test-ops-docs.js
    # in the private ops repo, where that page went with #3693.
    Yes 'docs/guide/secrets.md has the domain row and signing with an account of their own' (
        $secrets -match '(?m)^\| The domain, thornswood\.net \| Registered at Cloudflare, in Patrick''s own Cloudflare login, which he signs in to with GitHub' -and
        $secrets -match '(?m)^\| Code signing \|.*an account of their own')
    Yes '6. it names this harness' ($sec -match 'tests\\test-ship-machine\.ps1')
    Yes '6. and the dev channel for the Ship it ends on' ($sec -match '\.\\scripts\\release\\Ship\.ps1 -Channel dev')

    $cmdRe = [regex]'\.\\scripts\\(?<area>[a-z]+)\\(?<file>[A-Za-z-]+\.ps1)(?<args>[^`|\r\n]*)'
    $seen = 0
    foreach ($c in $cmdRe.Matches($sec)) {
        $seen++
        $file = Join-Path $Repo ('scripts\' + $c.Groups['area'].Value + '\' + $c.Groups['file'].Value)
        $rel = 'scripts\' + $c.Groups['area'].Value + '\' + $c.Groups['file'].Value
        if (-not (Test-Path -LiteralPath $file)) { Yes ("6. $rel is in the repository") $false; continue }
        $errs = $null
        $a = [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$null, [ref]$errs)
        $params = @()
        if ($a.ParamBlock) { $params = @($a.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) }
        # Quoted values are not parameters: drop them before reading the -Names.
        $argText = [regex]::Replace($c.Groups['args'].Value, '''[^'']*''|"[^"]*"', '')
        $asked = @([regex]::Matches($argText, '(?<![\w])-([A-Za-z]+)') | ForEach-Object { $_.Groups[1].Value })
        $unknown = @($asked | Where-Object { $params -notcontains $_ })
        Yes ("6. $rel is there" + $(if ($asked.Count) { ' and takes -' + ($asked -join ' -') } else { '' })) ($unknown.Count -eq 0)
    }
    Yes ("6. the section names scripts to walk ($seen)") ($seen -ge 8)
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
exit 0
