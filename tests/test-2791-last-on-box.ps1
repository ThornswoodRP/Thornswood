<#
  test-2791-last-on-box.ps1

      pwsh -NoProfile -File .\tests\test-2791-last-on-box.ps1

  #2791 steps 2 and 3. Thornswood-Last.esp copies other authors' records, so
  no repository holds it and no deploy or release carries it: a release
  carries its recipe, and the box makes the plugin into each deploy's stage
  (scripts\deploy\LastPluginOnBox.ps1) with scripts\mods\Make-LastPlugin.py.

  WHAT THIS HOLDS.
    W  Get-ThornswoodLastPluginWant reads the plugin game\data\last-plugin.json
       names, and the recipe names the same size and sha256.
    H  Get-ThornswoodLastRecipeHead hands back the recipe's first step, the
       plugin's own file header: TES4, whole, light, with the masters the
       manifest names.
    R  Read-ThornswoodLastMade takes what the box said: the plugin the manifest
       names, made; and stops on a make that failed, a make that said nothing
       of how it ended, and a plugin of other bytes, naming why.
    S  Get-ThornswoodLastMakeScript writes the make for the box: this commit's
       tools from tools.zip, the plugin into the stage, every folder it reads
       and the archive store, Python isolated, and how it ended; it refuses a
       folder it could not name safely.
    M  Make-LastPlugin.py on made-up game folders (tests\fixtures\2791, nothing
       of anybody's): makes the plugin the recipe names, byte for byte, with
       its tables in the plugins' folder or in a folder of their own as on the
       box; makes nothing and writes nothing for another copy, a missing
       plugin or a missing table, and says which.
    D  By the source: both deploys make the plugin into the stage they send
       and hold it to the manifest's sha256 with what they sent; no deploy,
       release or builder reads it from game\content; the tools the box is
       sent are all in the repository. Publish-Server.ps1 -FromStore, when
       the running server's is not this recipe's, makes it on the box from our
       plugins and the server's and hands it to the installer, which holds it
       to its sha256 and takes it into the stage only with -FromStore.

  Reads the repository; writes only its own folder under the scratch folder.
  M needs Python and prints SKIP without it.
#>
[CmdletBinding()]
param([string]$Repo, [string]$Scratch)

$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    exit ([int]($script:fail -gt 0))
}
function Read-Text([string]$rel) { return ([IO.File]::ReadAllText((Join-Path $Repo $rel)) -replace "`r", '') }

. (Join-Path $Repo 'scripts\deploy\LastPluginOnBox.ps1')

# ---------------------------------------------------------------- W
$want = Get-ThornswoodLastPluginWant $Repo
$manifest = [IO.File]::ReadAllText((Join-Path $Repo 'game\data\last-plugin.json')) | ConvertFrom-Json
Yes 'W1 the want is the plugin last-plugin.json names' ($null -ne $want -and $want.Bytes -eq [int64]$manifest.plugin.size -and $want.Sha -ceq ([string]$manifest.plugin.sha256).ToLowerInvariant())
$recipe = [IO.File]::ReadAllBytes((Join-Path $Repo 'game\data\last-plugin.recipe'))
$named = -join ($recipe[9..40] | ForEach-Object { $_.ToString('x2') })
Yes ('W2 and the recipe names the same plugin ({0:N0} bytes)' -f $want.Bytes) ([BitConverter]::ToUInt32($recipe, 5) -eq $want.Bytes -and $named -ceq $want.Sha)
Yes 'W3 a checkout with no manifest wants nothing' ($null -eq (Get-ThornswoodLastPluginWant (Join-Path $Scratch ('tw-2791-none-' + [Guid]::NewGuid().ToString('N')))))

# ---------------------------------------------------------------- H
$head = Get-ThornswoodLastRecipeHead $Repo
Yes 'H1 the recipe starts with the plugin''s file header, whole' ($head -is [byte[]] -and $head.Length -ge 24 -and [Text.Encoding]::ASCII.GetString($head, 0, 4) -eq 'TES4' -and ([BitConverter]::ToUInt32($head, 4) + 24) -eq $head.Length)
Yes 'H2 and it is light (flags 0x200), as the game must load it' (($head.Length -ge 12) -and (([BitConverter]::ToUInt32($head, 8) -band 0x200) -ne 0))
$masters = @()
$at = 24
while ($at + 6 -le $head.Length) {
    $tag = [Text.Encoding]::ASCII.GetString($head, $at, 4)
    $n = [BitConverter]::ToUInt16($head, $at + 4)
    if ($tag -eq 'MAST') { $masters += [Text.Encoding]::UTF8.GetString($head, $at + 6, $n - 1) }
    $at += 6 + $n
}
$wantMasters = @($manifest.masters | ForEach-Object { if ($_ -is [string]) { $_ } else { [string]$_.name } })
Yes ('H3 and it names the masters last-plugin.json names ({0})' -f $masters.Count) ($masters.Count -gt 0 -and (($masters -join '|') -eq ($wantMasters -join '|')))
Yes 'H4 a checkout with no recipe has no header' ($null -eq (Get-ThornswoodLastRecipeHead (Join-Path $Scratch ('tw-2791-none-' + [Guid]::NewGuid().ToString('N')))))

# ---------------------------------------------------------------- R
$w = [pscustomobject]@{ Bytes = [int64]1234; Sha = ('ab' * 32) }
$got = Read-ThornswoodLastMade @(('MADE 1234 ' + ('ab' * 32) + ' from 3 plugins and string tables'), 'EXIT 0') $w
Yes 'R1 a make that made the wanted plugin is taken' ($got.Bytes -eq 1234 -and $got.Sha -ceq ('ab' * 32))
function Stops([string[]]$lines, [string]$words) {
    try { $null = Read-ThornswoodLastMade $lines $w; return $false } catch { return ($_.Exception.Message -like ('*' + $words + '*')) }
}
Yes 'R2 a make that failed stops, with what Python said' (Stops @('STOP. Thornswood-Last.esp could not be made from its recipe: Theirs.esp is not there. Nothing was written.', 'EXIT 1') 'Theirs.esp is not there')
Yes 'R3 a make that never said how it ended stops' (Stops @(('MADE 1234 ' + ('ab' * 32) + ' from 3 plugins and string tables')) 'did not say how the make')
Yes 'R4 a plugin of other bytes stops, naming both' (Stops @(('MADE 1234 ' + ('cd' * 32) + ' from 3 plugins and string tables'), 'EXIT 0') ('sha256 ' + ('cd' * 6)))
Yes 'R5 so does one of another size' (Stops @(('MADE 99 ' + ('ab' * 32) + ' from 3 plugins and string tables'), 'EXIT 0') 'names 1,234 bytes')

# ---------------------------------------------------------------- S
$s = Get-ThornswoodLastMakeScript -Run 'C:\Windows\Temp\tw-run' -Reads @('C:\Thornswood-Server-Dev\stage\plugins', 'C:\Thornswood-Server-Dev\plugins') -Into 'C:\Thornswood-Server-Dev\stage\plugins'
Yes 'S1 the make unpacks this commit''s tools in the run''s folder' ($s -match [regex]::Escape("ExtractToDirectory((Join-Path `$run 'tools.zip'), `$tools)"))
Yes 'S2 and runs Make-LastPlugin.py isolated (-I -B)' ($s -match [regex]::Escape("@('-I', '-B', (Join-Path `$tools 'scripts\mods\Make-LastPlugin.py')"))
Yes 'S3 into the stage' ($s -match [regex]::Escape("'--out', 'C:\Thornswood-Server-Dev\stage\plugins\Thornswood-Last.esp'"))
Yes 'S4 with the archive store''s tables' ($s -match [regex]::Escape("'--tables', '$ThornswoodGameArchiveStore'"))
Yes 'S5 reading the stage before the server''s plugins' ($s -match [regex]::Escape("@('C:\Thornswood-Server-Dev\stage\plugins', 'C:\Thornswood-Server-Dev\plugins')"))
Yes 'S6 and says how it ended' ($s -match [regex]::Escape("'EXIT ' + `$code"))
$refused = $false
try { $null = Get-ThornswoodLastMakeScript -Run 'C:\Windows\Temp\tw-run' -Reads @("C:\x'; Remove-Item C:\ -Recurse; '") -Into 'C:\y' } catch { $refused = $true }
Yes 'S7 a folder it could not name safely is refused' $refused
$parsed = $null; $errs = $null
$null = [Management.Automation.Language.Parser]::ParseInput($s, [ref]$parsed, [ref]$errs)
Yes 'S8 the make parses' (@($errs).Count -eq 0)

# ---------------------------------------------------------------- M
$python = $null
foreach ($exe in @('python3', 'python', 'py')) {
    $c = Get-Command $exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) {
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $null = & $c.Source -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>&1
        $ok = $LASTEXITCODE -eq 0
        $ErrorActionPreference = $old
        if ($ok) { $python = $c.Source; break }
    }
}
$work = Join-Path $Scratch ('tw-2791-on-box-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
if (-not $python) {
    Write-Host 'SKIP  M: no Python here'
} else {
    try {
        New-Item -ItemType Directory -Force -Path $work | Out-Null
        $games = Join-Path $work 'games'
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $said = & $python -I -B (Join-Path $Repo 'tests\fixtures\2791\last-plugin-fixture.py') $games 2>&1; $rc = $LASTEXITCODE
        $ErrorActionPreference = $old
        Yes 'M0 the made-up game folders are written' ($rc -eq 0)
        if ($rc -ne 0) { $said | ForEach-Object { Write-Host "      $_" } }
        $make = Join-Path $Repo 'scripts\mods\Make-LastPlugin.py'
        function Make([string]$game, [string[]]$more) {
            $data = Join-Path $game 'Data'
            $out = Join-Path $game 'made.esp'
            $args2 = @('-I', '-B', $make, '--recipe', (Join-Path $data 'Thornswood-Last.recipe'), '--out', $out) + $more
            $o = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            $lines = @(& $python @args2 2>&1 | ForEach-Object { "$_" })
            $code = $LASTEXITCODE
            $ErrorActionPreference = $o
            return [pscustomobject]@{ Code = $code; Said = ($lines -join ' '); Out = $out }
        }
        function Sha([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
        foreach ($name in @('made', 'loose', 'long')) {
            $game = Join-Path $games $name
            $r = Make $game @('--data', (Join-Path $game 'Data'))
            $same = $r.Code -eq 0 -and (Test-Path -LiteralPath $r.Out) -and ((Sha $r.Out) -ceq (Sha (Join-Path $game 'want.esp')))
            Yes ("M1 $name`: the plugin the recipe names, byte for byte") $same
            Yes ("    and it says MADE with its size and sha256") ($r.Said -match ('^MADE {0} {1} ' -f (Get-Item -LiteralPath (Join-Path $game 'want.esp')).Length, (Sha (Join-Path $game 'want.esp'))))
            if (-not $same) { Write-Host "      $($r.Said)" }
        }
        # As on the box: the plugins in one folder, the archives and loose
        # tables in the archive store, C:\Thornswood-GameData.
        foreach ($name in @('made', 'loose')) {
            $game = Join-Path $games $name
            $plugins = Join-Path $game 'Plugins'
            $store = Join-Path $game 'Store'
            New-Item -ItemType Directory -Force -Path $plugins, $store | Out-Null
            foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $game 'Data') -Force)) {
                if ($f.Name -like '*.esp') { Copy-Item -LiteralPath $f.FullName -Destination $plugins }
                elseif ($f.Name -like '*.bsa' -or $f.Name -eq 'Strings') { Copy-Item -LiteralPath $f.FullName -Destination $store -Recurse }
            }
            Remove-Item -LiteralPath (Join-Path $game 'made.esp') -Force -ErrorAction SilentlyContinue
            $r = Make $game @('--data', (Join-Path $game 'Stage'), '--data', $plugins, '--tables', $store)
            Yes ("M2 $name`: the same with its tables in a folder of their own, and a stage that is not there read first") ($r.Code -eq 0 -and ((Sha $r.Out) -ceq (Sha (Join-Path $game 'want.esp'))))
        }
        foreach ($name in @('other', 'no-plugin', 'no-table', 'later')) {
            $game = Join-Path $games $name
            $r = Make $game @('--data', (Join-Path $game 'Data'))
            $words = [IO.File]::ReadAllText((Join-Path $game 'want.txt')).Trim()
            $file = ($words -split ' ')[0]
            Yes ("M3 $name`: makes nothing, writes nothing, and names $file") ($r.Code -eq 1 -and -not (Test-Path -LiteralPath $r.Out) -and -not (Test-Path -LiteralPath ($r.Out + '.making')) -and $r.Said -like 'STOP.*' -and $r.Said -like ('*' + $file + '*'))
            if ($r.Code -ne 1) { Write-Host "      $($r.Said)" }
        }
        $kept = Join-Path $games 'other\made.esp'
        [IO.File]::WriteAllText($kept, 'what was there')
        $r = Make (Join-Path $games 'other') @('--data', (Join-Path $games 'other\Data'))
        Yes 'M4 a refusal leaves what was there' ($r.Code -eq 1 -and [IO.File]::ReadAllText($kept) -eq 'what was there')
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------- D
Yes 'D1 no repository folder holds the plugin' (-not (Test-Path -LiteralPath (Join-Path (Join-Path $Repo 'game\content') $ThornswoodLastPlugin)))
foreach ($t in $ThornswoodLastTools) {
    Yes "D2 the box is sent $t, which is in the repository" (Test-Path -LiteralPath (Join-Path $Repo $t))
}
$dev = Read-Text 'scripts\deploy\Deploy-DevGamemode.ps1'
Yes 'D3 Deploy-DevGamemode.ps1 makes it into the stage, read before the server''s plugins' ($dev -match [regex]::Escape('Invoke-ThornswoodLastPluginMake') -and $dev -match [regex]::Escape('-Reads @("$stageWin\plugins", "$rootWin\plugins") -Into "$stageWin\plugins"'))
Yes '    and holds it to the manifest''s sha256 with what it sent' ($dev -match [regex]::Escape("`$hashes['plugins/' + `$lastName] = `$lastMade.Sha"))
Yes '    and sends the recipe and manifest, never the plugin' ($dev -match [regex]::Escape("'game/data/last-plugin.recipe'") -and $dev -notmatch [regex]::Escape('game/content/Thornswood-Last.esp'))
$srv = Read-Text 'scripts\deploy\Deploy-Server.ps1'
Yes 'D4 Deploy-Server.ps1 makes it into its stage too' ($srv -match [regex]::Escape('Invoke-ThornswoodLastPluginMake') -and $srv -match [regex]::Escape('-Into "$rootWin\$stageName\plugins"'))
Yes '    and holds it with what it sent' ($srv -match [regex]::Escape("`$hashes['plugins/' + `$ThornswoodLastPlugin] = `$lastMade.Sha"))
foreach ($rel in @('scripts\deploy\Deploy-DevGamemode.ps1', 'scripts\deploy\Deploy-Server.ps1', 'scripts\deploy\Deploy-Gamemode.ps1', 'scripts\release\Publish-Server.ps1', 'scripts\release\Publish-Update.ps1', 'scripts\release\Ship-Rules.ps1')) {
    Yes "D5 $rel reads no Thornswood-Last.esp from game\content" ((Read-Text $rel) -notmatch 'game[\\/]content[\\/]Thornswood-Last\.esp')
}
$chain = (Read-Text 'scripts\mods\content-tables.json') | ConvertFrom-Json
$lastStep = @($chain.steps | Where-Object { $_.tool -eq 'scripts/mods/Build-LastPlugin.py' })[0]
Yes 'D6 the content chain''s Build-LastPlugin.py step writes the recipe and manifest, not the plugin' ($lastStep -and @($lastStep.writes) -contains 'game/data/last-plugin.recipe' -and -not (@($lastStep.writes) -match 'Thornswood-Last\.esp').Count)
$pub = Read-Text 'scripts\release\Publish-Server.ps1'
Yes 'D8 Publish-Server.ps1 -FromStore makes it on the box when the running server''s is not this recipe''s, and does not stop' ($pub -match [regex]::Escape('$script:LastMake = $lastWant') -and $pub -notmatch [regex]::Escape('the deploy makes it on the box first'))
Yes '    from our plugins as the payload carries them, read before the server''s own' ($pub -match [regex]::Escape("-Reads @((`$lastBox.Run + '\reads'), (`$VpsRoot.TrimEnd('\') + '\plugins')) -Into (`$lastBox.Run + '\made') -Want `$script:LastMake"))
# What it reads, worked out the way the call works it out, not read off the
# text: on 31 Oct a list written as @((a), $b + '\plugins') was three folders,
# the last of them '\plugins', and the box refused to make it.
$pubAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo 'scripts\release\Publish-Server.ps1'), [ref]$null, [ref]$null)
$makeCall = @($pubAst.FindAll({ param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Invoke-ThornswoodLastPluginMake' }, $true))[0]
$readsArg = $null
if ($makeCall) {
    $els = $makeCall.CommandElements
    for ($i = 0; $i -lt $els.Count - 1; $i++) { if ($els[$i] -is [Management.Automation.Language.CommandParameterAst] -and $els[$i].ParameterName -eq 'Reads') { $readsArg = $els[$i + 1].Extent.Text } }
}
$readsGot = $null
if ($readsArg) {
    $readsGot = & {
        $lastBox = [pscustomobject]@{ Run = 'C:\Windows\Temp\thornswood-onbox-000000000000' }
        $VpsRoot = 'C:\Thornswood-Server-Dev\'
        @(Invoke-Expression $readsArg)
    }
}
Yes '    and those are two folders: the run''s reads, then the server''s plugins' ($readsGot -and @($readsGot).Count -eq 2 -and $readsGot[0] -eq 'C:\Windows\Temp\thornswood-onbox-000000000000\reads' -and $readsGot[1] -eq 'C:\Thornswood-Server-Dev\plugins')
Yes '    and hands the installer the plugin with the sha256 the box made' ($pub -match [regex]::Escape("-LastPlugin '") -and $pub -match [regex]::Escape("-LastSha256 `" + `$made.Sha"))
Yes '    and lets its folder on the box go after the install, whatever the install did' ($pub -match [regex]::Escape('finally { if ($lastBox) { $null = Close-ThornswoodOnBoxFolder $lastBox } }'))
$inst = Read-Text 'scripts\deploy\Install-ThornswoodServer.ps1'
Yes 'D9 the installer takes -LastPlugin only with -FromStore' ($inst -match [regex]::Escape("if (`$LastPlugin -and -not `$FromStore) { Refuse"))
Yes '    holds it to -LastSha256 before it goes into the stage' ($inst -match '(?s)\$lastSum -ne \$LastSha256\.ToLowerInvariant\(\)\) \{ Refuse.*Copy-Item -LiteralPath \$LastPlugin -Destination \(Join-Path \$plugDir ''Thornswood-Last\.esp''\)')
Yes '    and puts it there before the running server''s plugins, so the old one is not taken' ($inst.IndexOf('Copy-Item -LiteralPath $LastPlugin') -gt 0 -and $inst.IndexOf('Copy-Item -LiteralPath $LastPlugin') -lt $inst.IndexOf('foreach ($p in @($s.loadOrder)) {'))
$onBox = Read-Text 'scripts\mods\OnBox.ps1'
Yes 'D7 a box run makes this commit''s plugin in its data folder first' ($onBox -match [regex]::Escape('(Join-Path `$repo ''scripts\mods\Make-LastPlugin.py'') --data `$data --recipe `$lastRecipe'))

Done
