<#
  test-2899-run-on-box.ps1

      pwsh -NoProfile -File .\tests\test-2899-run-on-box.ps1

  scripts\mods\Run-OnBox.ps1 runs a repository content tool on the box against
  a game server's plugins and brings back what it wrote under game\,
  records\ and docs\systems\ (issue #2899; node and PowerShell tools and
  the plugin list since #3100). This holds it to that:

  1. A path that is not a .py, .js or .ps1 tool under scripts\mods or
     scripts\dev, a tool that is not there, and an argument with a double
     quote in it are refused before anything is built or sent.
  1b. The artifact carries what every builder of the content chain reads,
     uses or writes, and every script a builder loads from beside it; what
     comes back is game\, records\, docs\systems\ and every other file a
     builder writes (#3425).
  2. The far side text (scripts\mods\OnBox.ps1) is ASCII and parses, and the
     server's plugins folder is only ever read from.
  3. On Windows, the far side text runs under PowerShell 7, as on the box
     since #5356, against a stand-in server and a stand-in artifact: the data
     folder is the server's plugins with the commit's own Thornswood plugins
     in their place, '{data}' reaches the tool as that folder, a tool that
     writes into the data folder leaves the server's files as they were,
     only what changed under game\ and records\ is listed and zipped back,
     the tool's exit code comes back, and the keeper removes the run's folder
     when its end event is set. A PowerShell tool given '{plugins}' gets the
     server's loadOrder after the five masters as plugins.txt, the settings'
     other values never reach the run, and what it writes under
     docs\systems comes back. Skyrim's archives in the store are linked into the data folder,
     and a tool that opens one to write is refused, the store keeping its
     bytes; the loose string tables in the store's Strings are linked into
     the data folder's Strings, where the tools look for them. Off Windows
     the keeper's named event and kernel32 are not there, nor py, and this
     part says so and is skipped; the Windows runner runs it.
  5. The run's folder lives as long as its keeper (#2999): the keeper's
     text is ASCII, parses, fits on the command line and reads nothing from
     its standard input, which on the box never closes (#3063); the end
     script parses, and both refuse an event name not made for a keeper;
     Start-ThornswoodRemote refuses a weaker host key check, a script too
     long for the command line and a word with a double quote, and hands the
     far side its words whole and its input until it is closed. On Windows,
     under PowerShell 7: a keeper removes the folders whose lock
     nobody holds (one from before the lock, an orphaned lock) and leaves
     one that is held and anything not named like a run's; its input closing
     does not end it, its end event set from another process does, and an
     end sent after that finds no keeper; a second keeper given an event
     already made refuses before it makes anything; a keeper that is ended
     leaves its folder, and the next keeper removes it; a keeper whose run
     still holds the folder leaves it, says so, and the next keeper removes
     it once the run let go; the run refuses to start in a folder no keeper
     holds.
  4. scripts\mods\Send-GameArchives.ps1 refuses archives that are missing or
     not the bytes records\skyrim-files.json names, before it asks the box
     anything, and its far side text is ASCII and parses. Every file
     records\game-strings.json names is a loose string table under Strings,
     with its size and sha256.

  Nothing here reaches the box.
#>
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$runOnBox = Join-Path $Repo 'scripts\mods\Run-OnBox.ps1'
$lib = Join-Path $Repo 'scripts\mods\OnBox.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# The refusal's own message, written out as text. Formatted as an error it
# is wrapped at the console's width with a gutter put in the middle of it,
# which on the runners split the longer refusal since #3100 (#2933, #3106;
# a 60-column console here does the same).
function Refused([string[]]$words) {
    $out = (& pwsh -NoProfile -Command { param($s, $w) try { & $s @w -VpsHost 127.0.0.1 -VpsUser nobody } catch { 'REFUSED: ' + $_.Exception.Message; exit 1 } } -args $runOnBox, $words 2>&1 | Out-String)
    return [pscustomobject]@{ Code = $LASTEXITCODE; Text = $out }
}

# ---- 1. refused before anything is built or sent -------------------------
$r = Refused @('scripts/vps/Remote.ps1')
Yes 'a tool outside scripts/mods and scripts/dev is refused' ($r.Code -ne 0 -and $r.Text -match 'is not a Python, node or PowerShell tool' -and $r.Text -match 'Nothing was sent' -and $r.Text -notmatch 'artifact ')
$r = Refused @('scripts/mods/content-tables.json')
Yes 'and a file there that is not a .py, .js or .ps1' ($r.Code -ne 0 -and $r.Text -match 'is not a Python, node or PowerShell tool' -and $r.Text -notmatch 'artifact ')
$r = Refused @('scripts/mods/No-Such-Tool.py')
Yes 'a tool that is not in the checkout is refused' ($r.Code -ne 0 -and $r.Text -match 'There is no scripts/mods/No-Such-Tool.py' -and $r.Text -notmatch 'artifact ')
$r = Refused @('scripts/mods/../vps/x.py')
Yes 'a path that climbs out of scripts/mods is refused' ($r.Code -ne 0 -and $r.Text -match 'is not a Python, node or PowerShell tool')
$r = Refused @('scripts/mods/..ps1')
Yes 'and one whose name starts with a dot' ($r.Code -ne 0 -and $r.Text -match 'is not a Python, node or PowerShell tool')
$r = Refused @('scripts/mods/Add-ContentRecords.py', '--note', 'say "hi"')
Yes 'an argument with a double quote in it is refused' ($r.Code -ne 0 -and $r.Text -match 'double quote' -and $r.Text -notmatch 'artifact ')

# ---- 1b. the artifact carries what the chain's builders touch -----------
# Until #2962 it held scripts, game\content, game\data, records and
# layout.json only, so a builder that writes into game\gamemode.js stopped on
# the box. Until #3100 it carried only what the Python builders touch. The
# lines that make $paths are lifted out of Run-OnBox.ps1 by the parser and
# run here with its $Here, for the whole chain's tool.
$ast = [Management.Automation.Language.Parser]::ParseFile($runOnBox, [ref]$null, [ref]$null)
$top = @($ast.EndBlock.Statements)
$from = @($top | Where-Object { $_.Extent.Text -like '$paths = @(*' })
$upTo = @($top | Where-Object { $_.Extent.Text -like 'while ($load.Count)*' })
Yes 'Run-OnBox.ps1 makes $paths once and adds the chain''s files and what its builders load to it once' ($from.Count -eq 1 -and $upTo.Count -eq 1)
$Here = Join-Path $Repo 'scripts\mods'
$tool = 'scripts/mods/Rebuild-ContentTables.ps1'
$paths = $null
foreach ($st in $top) {
    if ($st.Extent.StartOffset -lt $from[0].Extent.StartOffset -or $st.Extent.StartOffset -gt $upTo[0].Extent.StartOffset) { continue }
    . ([scriptblock]::Create($st.Extent.Text))
}
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$chain = Get-Content -LiteralPath (Join-Path $Repo 'scripts\mods\content-tables.json') -Raw | ConvertFrom-Json
$need = @($chain.steps | ForEach-Object { @($_.reads) + @($_.readsBack) + @($_.uses) + @($_.writes) } | Where-Object { $_ } | Sort-Object -Unique)
$left = @($need | Where-Object { $n = [string]$_; -not @($paths | Where-Object { $n -eq $_ -or $n.StartsWith($_ + '/') }).Count })
Yes ('every file a builder of the chain reads, uses or writes goes up (' + $need.Count + ')' + $(if ($left.Count) { ': not ' + ($left -join ', ') } else { '' })) (
    $need.Count -gt 0 -and $left.Count -eq 0)
Yes '  game\gamemode.js among them' ($paths -contains 'game/gamemode.js')
Yes '  and the K panel''s book Build-SpellTable.ps1 reads, which until #3425 stopped the box run at the spell table' ($paths -contains 'game/ui/thornswood-skills.js')
Yes '  and the game scripts Build-MerchantGamemode.js embeds' (($paths -contains 'game/merchant-trading.js') -and ($paths -contains 'game/quest-eligibility.js'))
$writes = @($chain.steps | ForEach-Object { @($_.writes) } | Where-Object { $_ } | Sort-Object -Unique)
$unwatched = @($writes | Where-Object { $n = [string]$_; -not @($watch | Where-Object { $n -eq $_ -or $n.StartsWith($_ + '/') }).Count })
Yes ('every file a builder of the chain writes comes back (' + $writes.Count + ')' + $(if ($unwatched.Count) { ': not ' + ($unwatched -join ', ') } else { '' })) (
    $writes.Count -gt 0 -and $unwatched.Count -eq 0)
Yes '  tests\fixtures\merchant-retrieval-records.json among them, which a box run left on the box until #3425' ($watch -contains 'tests/fixtures/merchant-retrieval-records.json')
Yes '  and what Build-RecipeTable.ps1 loads from scripts\deploy, and what that loads from scripts\release' (
    ($paths -contains 'scripts/deploy/ServerOrder.ps1') -and ($paths -contains 'scripts/release/Read-JsonFile.ps1'))
$loads = @()
foreach ($t in @($chain.steps | ForEach-Object { [string]$_.tool }) + @($paths | Where-Object { $_ -like 'scripts/*.ps1' -or $_ -like 'scripts/*.js' })) {
    $text = Get-Content -LiteralPath (Join-Path $Repo $t) -Raw
    foreach ($m in [regex]::Matches($text, "\.\s+\(Join-Path\s+\`$PSScriptRoot\s+'([^']+)'\)")) {
        $loads += [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent (Join-Path $Repo $t)) $m.Groups[1].Value.Replace('\', [IO.Path]::DirectorySeparatorChar)))
    }
}
$missed = @($loads | Sort-Object -Unique | ForEach-Object { $_.Substring($Repo.Length + 1).Replace('\', '/') } | Where-Object { $n = $_; -not @($paths | Where-Object { $n -eq $_ -or $n.StartsWith($_ + '/') }).Count })
Yes ('every script a chain builder dot-sources goes up' + $(if ($missed.Count) { ': not ' + ($missed -join ', ') } else { '' })) ($loads.Count -gt 0 -and $missed.Count -eq 0)

# ---- 4. Send-GameArchives refuses what is not the pinned build -----------
$send = Join-Path $Repo 'scripts\mods\Send-GameArchives.ps1'
$empty = Join-Path ([IO.Path]::GetTempPath()) ('ts-2899-empty-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $empty | Out-Null
try {
    $out = (& pwsh -NoProfile -File $send -Data $empty -VpsHost 127.0.0.1 -VpsUser nobody 2>&1 | Out-String)
    Yes 'Send-GameArchives refuses a Data folder without the archives, before asking the box' (
        $LASTEXITCODE -ne 0 -and $out -match 'STOP  Skyrim - Interface.bsa is not there' -and $out -match 'nothing was sent' -and $out -notmatch 'On the box')
    [IO.File]::WriteAllText((Join-Path $empty 'Skyrim - Interface.bsa'), 'not the archive')
    $out = (& pwsh -NoProfile -File $send -Data $empty -VpsHost 127.0.0.1 -VpsUser nobody 2>&1 | Out-String)
    Yes 'and an archive that is not the recorded bytes' ($LASTEXITCODE -ne 0 -and $out -match 'STOP  Skyrim - Interface.bsa is 15 bytes, the record says 105,799,354' -and $out -notmatch 'On the box')
} finally { Remove-Item -LiteralPath $empty -Recurse -Force -ErrorAction SilentlyContinue }
$sendText = Get-Content -LiteralPath $send -Raw
Yes 'it sends only the archives OnBox.ps1 names, each held to records\skyrim-files.json' ($sendText -match 'foreach \(\$n in \$ThornswoodGameArchives\)' -and $sendText -match "records\\skyrim-files.json")
Yes 'and the string tables records\game-strings.json names, each held to its sha256' ($sendText -match "records\\game-strings.json" -and $sendText -match "Algo = 'sha256'")
$gs = Get-Content -LiteralPath (Join-Path $Repo 'records\game-strings.json') -Raw | ConvertFrom-Json
$gsFiles = @($gs.files.PSObject.Properties)
Yes 'records\game-strings.json names loose string tables under Strings, each with its size and sha256' (
    $gsFiles.Count -gt 0 -and -not @($gsFiles | Where-Object {
        $_.Name -notmatch '^Strings\\[^\\]+\.(STRINGS|DLSTRINGS|ILSTRINGS)$' -or [long]$_.Value.bytes -le 0 -or [string]$_.Value.sha256 -notmatch '^[0-9a-f]{64}$' }).Count)

# ---- 2. the far side text ------------------------------------------------
. $lib
$far = Get-ThornswoodOnBoxScript -Run 'C:\Windows\Temp\thornswood-onbox-test' -ServerRoot 'C:\Thornswood-Server-Dev' -Tool 'scripts/mods/Add-ContentRecords.py' -Arguments @('--check', '--masters', '{data}', "it's")
function New-End { 'Global\Thornswood-OnBoxEnd-' + [Guid]::NewGuid().ToString('N') }
$keep = Get-ThornswoodOnBoxKeepScript -Run 'C:\Windows\Temp\thornswood-onbox-0123456789ab' -End (New-End)
Yes 'the far side text is ASCII' (-not ($far + $keep).ToCharArray().Where({ [int]$_ -gt 127 }, 'First'))
$errs = $null
[void][Management.Automation.Language.Parser]::ParseInput($far, [ref]$null, [ref]$errs)
Yes 'and it parses' (-not $errs -or $errs.Count -eq 0)
Yes 'the server''s plugins folder is only read from: nothing is copied, moved or written to it' (
    $far -match "plugins = 'C:\\Thornswood-Server-Dev\\plugins'" -and
    $far -notmatch '(?i)-Destination\s+`\$plugins' -and $far -notmatch '(?i)(Remove-Item|Move-Item|Set-Content|Out-File)[^\r\n]*`\$plugins')
Yes 'the tool runs below normal priority, beside the game servers' ($far -match "PriorityClass = 'BelowNormal'")
Yes 'an argument with a single quote in it is carried whole' ($far -match [regex]::Escape("@('--check', '--masters', '{data}', 'it''s')"))
$farPs = Get-ThornswoodOnBoxScript -Run 'C:\Windows\Temp\thornswood-onbox-test' -ServerRoot 'C:\Thornswood-Server-Dev' -Tool 'scripts/mods/Rebuild-ContentTables.ps1' -Arguments @('-Data', '{data}', '-PluginsTxt', '{plugins}')
$farJs = Get-ThornswoodOnBoxScript -Run 'C:\Windows\Temp\thornswood-onbox-test' -ServerRoot 'C:\Thornswood-Server-Dev' -Tool 'scripts/dev/Build-FoodTable.js' -Arguments @('--data', '{data}')
$errs = $null
[void][Management.Automation.Language.Parser]::ParseInput($farPs, [ref]$null, [ref]$errs)
$errs2 = $null
[void][Management.Automation.Language.Parser]::ParseInput($farJs, [ref]$null, [ref]$errs2)
Yes 'the far side text for a PowerShell or node tool is ASCII and parses' (
    -not ($farPs + $farJs).ToCharArray().Where({ [int]$_ -gt 127 }, 'First') -and (-not $errs -or $errs.Count -eq 0) -and (-not $errs2 -or $errs2.Count -eq 0))
Yes 'a PowerShell tool runs under PowerShell 7 with no profile, a node tool under node, a Python tool under Python' (
    $farPs.Contains("switch ('.ps1')") -and $farPs.Contains("'-NoProfile', '-NonInteractive'") -and $farJs.Contains("switch ('.js')") -and $far.Contains("switch ('.py')"))
Yes '{plugins} makes the plugin list from the server''s loadOrder alone, and only when an argument names it' (
    $farPs.Contains('if ($True) {') -and $farPs.Contains(").loadOrder)") -and $farPs.Contains(".Replace('{plugins}', `$pluginList)") -and $far.Contains('if ($False) {'))
Yes 'what changed under docs\systems is listed with game\ and records\' ($far.Contains("foreach (`$top in 'game', 'records', 'docs\systems')"))
$farWatch = Get-ThornswoodOnBoxScript -Run 'C:\Windows\Temp\thornswood-onbox-test' -ServerRoot 'C:\Thornswood-Server-Dev' -Tool 'scripts/mods/Rebuild-ContentTables.ps1' -Arguments @('-Data', '{data}') -Watch @('game', 'records', 'docs/systems', 'tests/fixtures/merchant-retrieval-records.json')
$errs = $null
[void][Management.Automation.Language.Parser]::ParseInput($farWatch, [ref]$null, [ref]$errs)
Yes 'a watched file outside them is listed too, a file read as itself and a folder walked, and the text parses (#3425)' (
    (-not $errs -or $errs.Count -eq 0) -and $farWatch.Contains("foreach (`$top in 'game', 'records', 'docs\systems', 'tests\fixtures\merchant-retrieval-records.json')") -and
    $farWatch.Contains('Test-Path -LiteralPath $d -PathType Leaf'))
$bad = @(foreach ($w in @('../outside', 'game/../..', '/etc', 'a b')) { try { [void](Get-ThornswoodOnBoxScript -Run 'C:\Windows\Temp\thornswood-onbox-test' -ServerRoot 'C:\Thornswood-Server-Dev' -Tool 'scripts/mods/Rebuild-ContentTables.ps1' -Watch @($w)); $w } catch { } })
Yes 'and a watch that is not a plain path inside the repository is refused' ($bad.Count -eq 0)
$ro = Get-ThornswoodArchiveReadOnlyScript
$errs = $null
[void][Management.Automation.Language.Parser]::ParseInput($ro, [ref]$null, [ref]$errs)
Yes 'the archives'' read-only rule is ASCII and parses' (-not $ro.ToCharArray().Where({ [int]$_ -gt 127 }, 'First') -and (-not $errs -or $errs.Count -eq 0))
Yes 'thirteen archives: Interface, Meshes0-1 and Textures0-8 (Patrick''s A on #2899) and _ResourcePack.bsa (#3100)' ($ThornswoodGameArchives.Count -eq 13 -and $ThornswoodGameArchives[0] -eq 'Skyrim - Interface.bsa' -and $ThornswoodGameArchives[11] -eq 'Skyrim - Textures8.bsa' -and $ThornswoodGameArchives[12] -eq '_ResourcePack.bsa')
$recorded = (Get-Content -LiteralPath (Join-Path $Repo 'records\skyrim-files.json') -Raw | ConvertFrom-Json).files
Yes 'and records\skyrim-files.json holds the size and sha1 of every one of them' (-not @($ThornswoodGameArchives | Where-Object { -not $recorded.('Data\' + $_).sha1 -or -not $recorded.('Data\' + $_).bytes }).Count)
$farSet = Get-ThornswoodOnBoxScript -Run 'C:\Windows\Temp\thornswood-onbox-test' -ServerRoot 'C:\Thornswood-Server-Dev' -Tool 'scripts/dev/Build-NpcPopulation.py' -Arguments @('--settings', '{settings}')
Yes '{settings} makes a server-settings.json of the loadOrder alone, each plugin in the run''s data folder, and only when an argument names it' (
    $farSet.Contains('if ($False -or $True) {') -and $farSet.Contains('loadOrder = [string[]]$inData') -and $farSet.Contains(".Replace('{settings}', `$orderSettings)") -and $far.Contains('if ($False -or $False) {'))
$errs = $null
[void][Management.Automation.Language.Parser]::ParseInput($keep, [ref]$null, [ref]$errs)
Yes 'the keeper''s text parses' (-not $errs -or $errs.Count -eq 0)
$keepLine = 'pwsh -NoProfile -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($keep))
Yes ('and fits on the command line, so nothing is sent ahead of it as a file (' + $keepLine.Length + ' of 6000)') ($keepLine.Length -le 6000)
Yes 'and reads nothing from its standard input, which on the box never closes (#3063): it waits on its end event' ($keep -notmatch '\[Console\]::In' -and $keep.Contains('while (-not $end.WaitOne(5000))'))
Yes 'and it learns its caller is gone from a write WriteFile itself makes, not .NET''s console stream, which swallows a broken pipe' (
    $keep.Contains('WriteFile(GetStdHandle(-11)') -and $keep.Contains('if ([ThornswoodKeeperOut]::Beat()) { break }'))
$endText = Get-ThornswoodOnBoxEndScript -End (New-End)
$errs = $null
[void][Management.Automation.Language.Parser]::ParseInput($endText, [ref]$null, [ref]$errs)
Yes 'the end script is ASCII and parses' (-not $endText.ToCharArray().Where({ [int]$_ -gt 127 }, 'First') -and (-not $errs -or $errs.Count -eq 0))
$m = ''
try { Get-ThornswoodOnBoxEndScript -End "Global\Thornswood-OnBoxEnd-x'; Remove-Item C:\ -Recurse; '" | Out-Null } catch { $m = $_.Exception.Message }
$m2 = ''
try { Get-ThornswoodOnBoxKeepScript -Run 'C:\Windows\Temp\thornswood-onbox-0123456789ab' -End 'Global\Something-Else' | Out-Null } catch { $m2 = $_.Exception.Message }
Yes 'and both refuse an event name that is not a keeper''s' ($m -match 'not a keeper''s end event' -and $m2 -match 'not a keeper''s end event')
Yes 'the run holds its folder''s lock while it runs, and stops when it cannot' ($far.Contains("New-Object IO.FileStream((`$run + '.lock'), 'Open', 'ReadWrite', 'ReadWrite')") -and $far -match 'could not be held through its lock')
$runText = Get-Content -LiteralPath $runOnBox -Raw
# The keeper is started and told the run is over in OnBox.ps1, for every
# script that lands files on the box (#3035), and Run-OnBox.ps1 goes through it.
$onBoxText = Get-Content -LiteralPath (Join-Path $Repo 'scripts\mods\OnBox.ps1') -Raw
Yes 'OnBox.ps1 starts the keeper for a run''s folder and sets its end event from a second session to end the run' (
    $onBoxText -match 'Start-ThornswoodRemote -Target \$Target -SshArgs \$SshArgs -Script \(Get-ThornswoodOnBoxKeepScript -Run \$run -End \$end\)' -and
    $onBoxText -match 'Invoke-ThornswoodRemote -Target \$Folder\.Target -SshArgs \$Folder\.SshArgs -Script \(Get-ThornswoodOnBoxEndScript -End \$Folder\.End\)' -and
    $onBoxText -notmatch 'StandardInput\.Close\(\)' -and $onBoxText -match "'GONE ' \+ \`$Folder\.Run")
Yes 'and reads what the keeper says as it comes, so its line ends never fill the pipe' (
    $onBoxText.Contains('$rest = $keeper.StandardOutput.ReadToEndAsync()') -and $onBoxText.Contains('$Folder.Rest.Result') -and $onBoxText -notmatch 'StandardOutput\.ReadToEnd\(\)')
Yes 'Run-OnBox.ps1 opens its folder there, sends the run into it and no longer removes the folder by a call of its own' (
    $runText -match 'Open-ThornswoodOnBoxFolder -Target \$target -SshArgs \$ssh' -and $runText -match 'Close-ThornswoodOnBoxFolder \$box' -and
    $runText -match "\(\`$runFar \+ '/run\.ps1'\)" -and $runText -notmatch 'Start-ThornswoodRemote' -and
    $runText -notmatch 'OnBoxCleanScript' -and $runText -notmatch 'Invoke-ThornswoodArtifactRemote \$target \$ssh \$farRun')
Yes 'and its own scratch folder here is not named like a run folder on the box' ($runText -match "'thornswood-runonbox-'" -and $runText -notmatch "GetTempPath\(\)\) \('thornswood-onbox-'")

# ---- 5. Start-ThornswoodRemote -------------------------------------------
. (Join-Path $Repo 'scripts\vps\Send-Script.ps1')
function Refusal([scriptblock]$b) { try { & $b | Out-Null; return '' } catch { return $_.Exception.Message } }
$m = Refusal { Start-ThornswoodRemote -Target 'nobody@box.invalid' -SshArgs @('-o', 'StrictHostKeyChecking=no') -Script "'hi'" }
Yes 'Start-ThornswoodRemote refuses a weaker host key check, before sending anything' ($m -match 'host key checking turned down' -and $m -match 'Nothing was sent')
$m = Refusal { Start-ThornswoodRemote -Target 'nobody@box.invalid' -Script ("'" + ('x' * 3000) + "'") }
Yes 'and a script too long for the command line, rather than sending it as a file' ($m -match 'over 6000' -and $m -match 'Nothing was sent')
$m = Refusal { Start-ThornswoodRemote -Target 'nobody@box.invalid' -SshArgs @('-o', 'User="x"') -Script "'hi'" }
Yes 'and an ssh word with a double quote in it' ($m -match 'double quote' -and $m -match 'Nothing was sent')
. (Join-Path $PSScriptRoot 'Windows.ps1')
if ($OnWindows) {
    Write-Host 'SKIP  Start-ThornswoodRemote against a stand-in ssh: ssh is ssh.exe here, and a stand-in would have to be one too (the Linux runs check it)'
} else {
    $bin = Join-Path ([IO.Path]::GetTempPath()) ('ts-2999-bin-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    $savedPath = $env:PATH
    try {
        $fake = Join-Path $bin 'ssh'
        [IO.File]::WriteAllText($fake, "#!/bin/sh`nfor a in `"`$@`"; do echo `"ARG `$a`"; done`necho READY`ncat`necho EOF`n")
        & chmod +x $fake
        $env:PATH = $bin + [IO.Path]::PathSeparator + $savedPath
        $p = Start-ThornswoodRemote -Target 'nobody@box.invalid' -SshArgs @('-o', 'BatchMode=yes') -Script "'hi there'"
        $first = @()
        while ($null -ne ($l = $p.StandardOutput.ReadLine())) { if ($l -eq 'READY') { break }; $first += $l }
        $p.StandardInput.WriteLine('a line in')
        $p.StandardInput.Close()
        $rest = @($p.StandardOutput.ReadToEnd() -split '\r?\n' | Where-Object { $_ })
        $p.WaitForExit()
        $want = @('ARG -o', 'ARG BatchMode=yes', 'ARG -o', 'ARG StrictHostKeyChecking=yes', 'ARG nobody@box.invalid',
            ('ARG pwsh -NoProfile -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("'hi there'"))))
        Yes 'ssh is handed its words whole, host key checking on, the script on the command line' (($first -join '|') -eq ($want -join '|'))
        Yes 'and the far side reads its input until it is closed, then ends' (($rest -join '|') -eq 'a line in|EOF' -and $p.ExitCode -eq 0)
    } finally {
        $env:PATH = $savedPath
        Remove-Item -LiteralPath $bin -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---- 3. run as on the box, under PowerShell 7 ------------------------------
. (Join-Path $PSScriptRoot 'Windows.ps1')

# A keeper as the box runs one: PowerShell 7, the script on the
# command line, its standard input and output pipes, an end event of its own.
# Start-Keeper reads up to its MADE line; Stop-Keeper sets its event from
# another PowerShell, as the second ssh session does on the box, and
# reads what it says after. Each read gives up after a minute, so a keeper
# that never answers fails the check rather than holding the build.
function Read-KeeperLine($p) {
    $t = $p.StandardOutput.ReadLineAsync()
    if (-not $t.Wait(60000)) { $p.Kill(); throw 'a keeper said nothing for a minute' }
    return $t.Result
}
function Set-End([string]$End) {
    return @(& $boxPs -NoProfile -NonInteractive -EncodedCommand ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Get-ThornswoodOnBoxEndScript -End $End)))) 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
}
function Start-Keeper([string]$Run, [string]$End = (New-End)) {
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $boxPs
    $psi.Arguments = '-NoProfile -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Get-ThornswoodOnBoxKeepScript -Run $Run -End $End)))
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $p = [Diagnostics.Process]::Start($psi)
    $said = @()
    while ($null -ne ($l = Read-KeeperLine $p)) {
        $said += $l.Trim()
        if ($l.Trim() -like 'MADE *' -or $l.Trim() -like 'TAKEN *') { break }
    }
    # What it said, so a red check here names its cause in the log.
    foreach ($l in $said) { Write-Host ('  keeper: ' + $l) }
    return [pscustomobject]@{ P = $p; Said = $said; End = $End }
}
function Stop-Keeper($k) {
    $set = @(Set-End $k.End)
    $said = @($set)
    while ($null -ne ($l = Read-KeeperLine $k.P)) { if ($l.Trim()) { $said += $l.Trim() } }
    $k.P.WaitForExit()
    foreach ($l in $said) { Write-Host ('  keeper: ' + $l) }
    return $said
}
$py = Get-Command py -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $OnWindows) {
    Write-Host 'SKIP  the run as on the box: its keeper waits on a Global\ named event and writes through kernel32, which only Windows has (the Windows runner runs it)'
} elseif (-not $py) {
    Write-Host 'SKIP  the run as on the box: no py on this machine (the Windows runner runs it)'
} else {
    $boxPs = Get-BoxPowerShell
    $work = Join-Path ([IO.Path]::GetTempPath()) ('ts-2899-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    try {
        $server = Join-Path $work 'server'
        $plugins = Join-Path $server 'plugins'
        $run = Join-Path $work 'thornswood-onbox-0123456789ab'
        New-Item -ItemType Directory -Force -Path $plugins | Out-Null
        # The run's folder, made and held by its keeper as on the box.
        $runKeeper = Start-Keeper $run
        Yes 'the keeper makes the run''s folder and holds its lock' (($runKeeper.Said -contains ('MADE ' + $run)) -and (Test-Path -LiteralPath $run) -and (Test-Path -LiteralPath ($run + '.lock')))
        [IO.File]::WriteAllText((Join-Path $plugins 'Skyrim.esm'), 'vanilla')
        [IO.File]::WriteAllText((Join-Path $plugins 'Thornswood-Content.esp'), 'server copy')
        $store = Join-Path $work 'store'
        New-Item -ItemType Directory -Force -Path $store | Out-Null
        $archive = Join-Path $store 'Skyrim - Interface.bsa'
        [IO.File]::WriteAllText($archive, 'archive bytes')
        New-Item -ItemType Directory -Force -Path (Join-Path $store 'Strings') | Out-Null
        $table = Join-Path $store 'Strings\RaceCompatibility_English.STRINGS'
        [IO.File]::WriteAllText($table, 'table bytes')
        $roFile = Join-Path $work 'ro.ps1'
        [IO.File]::WriteAllText($roFile, ((Get-ThornswoodArchiveReadOnlyScript) + "`r`nSet-ThornswoodArchiveReadOnly '" + $archive + "'`r`n'RO'"), (New-Object Text.UTF8Encoding($true)))
        $ro = @(& $boxPs -NoProfile -ExecutionPolicy Bypass -File $roFile 2>&1 | ForEach-Object { "$_" })
        Yes 'the read-only rule goes on under PowerShell 7' ($ro -contains 'RO')

        # The stand-in artifact: a tool, our own plugin and a table.
        $src = Join-Path $work 'src'
        New-Item -ItemType Directory -Force -Path (Join-Path $src 'scripts\mods'), (Join-Path $src 'game\content'), (Join-Path $src 'game\data') | Out-Null
        [IO.File]::WriteAllText((Join-Path $src 'game\content\Thornswood-Content.esp'), 'repo copy')
        [IO.File]::WriteAllText((Join-Path $src 'game\data\keep.json'), '{"a":1}')
        [IO.File]::WriteAllText((Join-Path $src 'game\data\same.json'), '{"b":2}')
        $tool = @'
import os, sys
data = sys.argv[2]
print('ARGS ' + '|'.join(sys.argv[1:]))
print('ENV ' + os.environ.get('THORNSWOOD_DATA', ''))
print('CONTENT ' + open(os.path.join(data, 'Thornswood-Content.esp')).read())
open(os.path.join(data, 'Skyrim.esm'), 'w').write('written by the tool')
print('ARCHIVE ' + open(os.path.join(data, 'Skyrim - Interface.bsa')).read())
print('TABLE ' + open(os.path.join(data, 'Strings', 'racecompatibility_english.strings')).read())
try:
    open(os.path.join(data, 'Skyrim - Interface.bsa'), 'w').write('changed')
    print('ARCHIVE WRITE went through')
except PermissionError:
    print('ARCHIVE WRITE refused')
open(os.path.join('game', 'data', 'keep.json'), 'w').write('{"a":2}')
open(os.path.join('game', 'data', 'new.json'), 'w').write('{"c":3}')
open(os.path.join('scripts', 'mods', 'stray.txt'), 'w').write('not ours to bring back')
sys.stderr.write('to stderr\n')
sys.exit(3)
'@
        [IO.File]::WriteAllText((Join-Path $src 'scripts\mods\t.py'), $tool)
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::CreateFromDirectory($src, (Join-Path $run 'tools.zip'))

        $text = Get-ThornswoodOnBoxScript -Run $run -ServerRoot $server -Tool 'scripts/mods/t.py' -Arguments @('--data', '{data}', 'it''s here') -ArchiveStore $store
        $file = Join-Path $work 'far.ps1'
        # As Send-Script.ps1 sends a long script: UTF-8 with a byte order mark.
        [IO.File]::WriteAllText($file, $text, (New-Object Text.UTF8Encoding($true)))
        $lines = @(& $boxPs -NoProfile -ExecutionPolicy Bypass -File $file 2>&1 | ForEach-Object { "$_" })
        # What the far side said, so a red check here names its cause in the log.
        Write-Host '  the far side said:'
        foreach ($l in $lines) { Write-Host ('    ' + $l) }
        Write-Host ('  as ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name + ', elevated: ' + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
        $data = Join-Path $run 'data'
        Yes 'the data folder holds the server''s plugins, our own from the commit' (
            ($lines -match '^data\s+2 plugin\(s\)').Count -eq 1 -and
            [IO.File]::ReadAllText((Join-Path $data 'Thornswood-Content.esp')) -eq 'repo copy' -and
            ($lines -contains 'CONTENT repo copy'))
        Yes '{data} reaches the tool as the data folder, and THORNSWOOD_DATA names it' (
            ($lines -contains ('ARGS --data|' + $data + '|it''s here')) -and ($lines -contains ('ENV ' + $data)))
        Yes 'Skyrim''s archives in the store are linked into the data folder' (($lines -match '^archives\s+1 from ').Count -eq 1 -and ($lines -contains 'ARCHIVE archive bytes'))
        Yes 'the loose string tables in the store are linked into the data folder''s Strings' (($lines -match '^strings\s+1 loose string table').Count -eq 1 -and ($lines -contains 'TABLE table bytes'))
        Yes 'a tool opening an archive to write is refused, and the store keeps its bytes' (($lines -contains 'ARCHIVE WRITE refused') -and [IO.File]::ReadAllText($archive) -eq 'archive bytes')
        Yes 'a tool writing into the data folder leaves the server''s own files as they were' (
            [IO.File]::ReadAllText((Join-Path $plugins 'Skyrim.esm')) -eq 'vanilla' -and
            [IO.File]::ReadAllText((Join-Path $plugins 'Thornswood-Content.esp')) -eq 'server copy')
        $changed = @($lines | Where-Object { $_ -like 'CHANGED *' })
        Yes 'only what changed under game/ and records/ is listed' (($changed -join ',') -eq 'CHANGED game/data/keep.json,CHANGED game/data/new.json')
        $back = Join-Path $run 'back.zip'
        $names = @()
        if (Test-Path -LiteralPath $back) { $z = [IO.Compression.ZipFile]::OpenRead($back); try { $names = @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() } }
        Yes 'and only that is zipped to come back' ((($names | Sort-Object) -join ',') -eq 'game/data/keep.json,game/data/new.json')
        Yes 'the tool''s output and its errors are shown' (($lines -contains 'to stderr') -and (($lines -match '^-------- scripts/mods/t.py --------$').Count -eq 1))
        Yes 'the tool''s exit code comes back' ($lines -contains 'EXIT 3')

        $gone = Stop-Keeper $runKeeper
        Yes 'the keeper removes the run''s folder and its lock when its end event is set, and the archive stays in the store' (
            ($gone -contains ('GONE ' + $run)) -and -not (Test-Path -LiteralPath $run) -and -not (Test-Path -LiteralPath ($run + '.lock')) -and [IO.File]::ReadAllText($archive) -eq 'archive bytes')

        # A PowerShell tool given the plugin list (#3100): the server's
        # loadOrder after the five masters, nothing else of its settings.
        $pwsh = (Get-Process -Id $PID).Path
        [IO.File]::WriteAllText((Join-Path $server 'server-settings.json'), '{"password":"not-for-the-run","loadOrder":["C:/s/plugins/Skyrim.esm","C:/s/plugins/Update.esm","C:/s/plugins/Mod A.esp","C:/s/plugins/Thornswood-Content.esp"]}')
        $run2 = Join-Path $work 'thornswood-onbox-ba9876543210'
        $runKeeper = Start-Keeper $run2
        $src2 = Join-Path $work 'src2'
        New-Item -ItemType Directory -Force -Path (Join-Path $src2 'scripts\mods'), (Join-Path $src2 'game\content'), (Join-Path $src2 'docs\systems') | Out-Null
        [IO.File]::WriteAllText((Join-Path $src2 'game\content\Thornswood-Content.esp'), 'repo copy')
        [IO.File]::WriteAllText((Join-Path $src2 'docs\systems\cut-items.json'), '[]')
        $psTool = @'
param([string]$Data, [string]$PluginsTxt)
'PLUGINS ' + ([IO.File]::ReadAllLines($PluginsTxt) -join '|')
'SHELL ' + $PSVersionTable.PSEdition
$top = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Content -LiteralPath (Join-Path $top 'docs\systems\cut-items.json') -Value '["x"]'
New-Item -ItemType Directory -Force -Path (Join-Path $top 'tests\fixtures') | Out-Null
Set-Content -LiteralPath (Join-Path $top 'tests\fixtures\watched.json') -Value '{}'
Set-Content -LiteralPath (Join-Path $top 'tests\fixtures\not-watched.json') -Value '{}'
exit 0
'@
        [IO.File]::WriteAllText((Join-Path $src2 'scripts\mods\t.ps1'), $psTool)
        [IO.Compression.ZipFile]::CreateFromDirectory($src2, (Join-Path $run2 'tools.zip'))
        $text = Get-ThornswoodOnBoxScript -Run $run2 -ServerRoot $server -Tool 'scripts/mods/t.ps1' -Arguments @('-Data', '{data}', '-PluginsTxt', '{plugins}') -ArchiveStore $store -Watch @('game', 'records', 'docs/systems', 'tests/fixtures/watched.json')
        [IO.File]::WriteAllText($file, $text, (New-Object Text.UTF8Encoding($true)))
        $env:PATH = (Split-Path -Parent $pwsh) + [IO.Path]::PathSeparator + $env:PATH
        $lines = @(& $boxPs -NoProfile -ExecutionPolicy Bypass -File $file 2>&1 | ForEach-Object { "$_" })
        Write-Host '  the far side said:'
        foreach ($l in $lines) { Write-Host ('    ' + $l) }
        Yes 'a PowerShell tool runs under PowerShell 7 and gets the server''s loadOrder after the five masters as its plugin list' (
            ($lines -contains 'PLUGINS *Mod A.esp|*Thornswood-Content.esp') -and ($lines -contains 'SHELL Core') -and (($lines -match '^plugins\s+2 line\(s\)').Count -eq 1))
        Yes 'and nothing else of the server''s settings reaches the run' (-not @($lines | Where-Object { $_ -match 'not-for-the-run' }).Count -and
            -not @(Get-ChildItem -LiteralPath $run2 -Recurse -File | Where-Object { $_.Extension -ne '.esp' -and $_.Name -ne 'tools.zip' -and [IO.File]::ReadAllText($_.FullName).Contains('not-for-the-run') }).Count)
        Yes 'what it wrote under docs\systems comes back, and a watched file outside them it made, and not one it was not asked to watch (#3425)' (
            (@($lines | Where-Object { $_ -like 'CHANGED *' }) -join ',') -eq 'CHANGED docs/systems/cut-items.json,CHANGED tests/fixtures/watched.json' -and ($lines -contains 'EXIT 0'))
        $gone = Stop-Keeper $runKeeper
        Yes 'and its keeper removes its folder' (($gone -contains ('GONE ' + $run2)) -and -not (Test-Path -LiteralPath $run2))
    } finally {
        if ($runKeeper -and -not $runKeeper.P.HasExited) { $runKeeper.P.Kill() }
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---- 5b. the keeper, as on the box, under PowerShell 7 -------------------
if (-not $OnWindows) {
    Write-Host 'SKIP  the keeper as on the box: it waits on a Global\ named event and writes through kernel32, which only Windows has (the Windows runner runs it)'
} else {
    $boxPs = Get-BoxPowerShell
    $top = Join-Path ([IO.Path]::GetTempPath()) ('ts-2999-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $held = @()
    $keepers = @()
    try {
        New-Item -ItemType Directory -Force -Path $top | Out-Null
        function Folder([string]$id) { Join-Path $top ('thornswood-onbox-' + $id) }
        function Hold([string]$d) { New-Object IO.FileStream(($d + '.lock'), 'OpenOrCreate', 'ReadWrite', 'ReadWrite') }
        $before = Folder 'aaaaaaaaaaaa'
        New-Item -ItemType Directory -Force -Path (Join-Path $before 'data') | Out-Null
        [IO.File]::WriteAllText((Join-Path $before 'data\Skyrim.esm'), 'left by a cut run')
        $orphan = Folder 'bbbbbbbbbbbb'
        [IO.File]::WriteAllText($orphan + '.lock', '')
        $busy = Folder 'cccccccccccc'
        New-Item -ItemType Directory -Force -Path $busy | Out-Null
        $busyHold = Hold $busy
        $held += $busyHold
        $other = Join-Path $top 'thornswood-onbox-notarun'
        New-Item -ItemType Directory -Force -Path $other | Out-Null

        $k = Start-Keeper (Folder 'dddddddddddd')
        $keepers += $k
        Yes 'a keeper removes a run folder from before the lock, which nobody holds' (($k.Said -contains ('GONE ' + $before)) -and -not (Test-Path -LiteralPath $before) -and -not (Test-Path -LiteralPath ($before + '.lock')))
        Yes 'and an orphaned lock' (($k.Said -contains ('GONE ' + $orphan)) -and -not (Test-Path -LiteralPath ($orphan + '.lock')))
        Yes 'and leaves a folder a run still holds, saying so' (@($k.Said | Where-Object { $_ -like ('HELD ' + $busy + ':*') }).Count -eq 1 -and (Test-Path -LiteralPath $busy))
        Yes 'and anything not named like a run''s folder' (Test-Path -LiteralPath $other)
        Yes 'then makes its own' (($k.Said[-1] -eq ('MADE ' + (Folder 'dddddddddddd'))) -and (Test-Path -LiteralPath (Folder 'dddddddddddd')))
        # On the box no close of its input arrives (#3063); here one does, and
        # it must not end the keeper either: only its event does.
        $k.P.StandardInput.Close()
        Yes 'its input closing does not end it, and its folder stays' (-not $k.P.WaitForExit(3000) -and (Test-Path -LiteralPath (Folder 'dddddddddddd')))
        $twin = Start-Keeper (Folder '999999999999') $k.End
        $keepers += $twin
        Yes 'a second keeper given an event already made refuses before it removes or makes anything' (
            ($twin.Said -contains ('TAKEN ' + $k.End)) -and $twin.P.WaitForExit(30000) -and $twin.P.ExitCode -eq 2 -and -not (Test-Path -LiteralPath (Folder '999999999999')) -and (Test-Path -LiteralPath $busy))
        $m = @(Stop-Keeper $k)
        Yes 'its end event set from another process ends it, and it removes its folder' (($m -contains 'END SET') -and ($m -contains ('GONE ' + (Folder 'dddddddddddd'))) -and -not (Test-Path -LiteralPath (Folder 'dddddddddddd')) -and $k.P.HasExited)
        Yes 'an end sent after that finds no keeper' ((@(Set-End $k.End) -join '|') -eq 'END GONE')

        # Its caller going away: the box ends the session and with it the
        # read end of the keeper's output, and its next write fails (#3063).
        $gone = Folder '777777777777'
        $k = Start-Keeper $gone
        $keepers += $k
        $k.P.StandardOutput.Close()
        Yes 'a keeper whose caller is gone removes its folder and its lock, and ends' (
            $k.P.WaitForExit(30000) -and -not (Test-Path -LiteralPath $gone) -and -not (Test-Path -LiteralPath ($gone + '.lock')))
        Yes 'and an end sent after that finds no keeper' ((@(Set-End $k.End) -join '|') -eq 'END GONE')

        # A keeper that is ended (the box restarting) can remove nothing.
        $cut = Folder 'eeeeeeeeeeee'
        $k = Start-Keeper $cut
        $keepers += $k
        $k.P.Kill()
        $k.P.WaitForExit()
        Yes 'a keeper that is ended leaves its folder' ((Test-Path -LiteralPath $cut))
        # A keeper whose run still holds the folder when its input closes.
        $still = Folder 'ffffffffffff'
        $k = Start-Keeper $still
        $keepers += $k
        Yes 'the next keeper removes the killed keeper''s folder' (($k.Said -contains ('GONE ' + $cut)) -and -not (Test-Path -LiteralPath $cut) -and -not (Test-Path -LiteralPath ($cut + '.lock')))
        $runHold = New-Object IO.FileStream(($still + '.lock'), 'Open', 'ReadWrite', 'ReadWrite')
        $held += $runHold
        $m = @(Stop-Keeper $k)
        Yes 'a keeper whose run still holds the folder leaves it when its event is set, and says so' (@($m | Where-Object { $_ -like ('HELD ' + $still + ':*') }).Count -eq 1 -and (Test-Path -LiteralPath $still))
        $runHold.Dispose()
        $busyHold.Dispose()

        $next = Folder '0123456789ab'
        $k = Start-Keeper $next
        $keepers += $k
        Yes 'the next keeper removes the ones whose runs have let go' (($k.Said -contains ('GONE ' + $still)) -and ($k.Said -contains ('GONE ' + $busy)) -and -not (Test-Path -LiteralPath $still) -and -not (Test-Path -LiteralPath $busy))

        # The run refuses a folder no keeper holds.
        $loose = Folder '123456789abc'
        New-Item -ItemType Directory -Force -Path $loose | Out-Null
        $file = Join-Path $top 'far.ps1'
        [IO.File]::WriteAllText($file, (Get-ThornswoodOnBoxScript -Run $loose -ServerRoot $top -Tool 'scripts/mods/t.py'), (New-Object Text.UTF8Encoding($true)))
        $lines = @(& $boxPs -NoProfile -ExecutionPolicy Bypass -File $file 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
        Yes 'the run stops in a folder no keeper holds, before anything is unpacked' ($code -eq 2 -and @($lines | Where-Object { $_ -like 'STOP. the run''s folder could not be held*' }).Count -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $loose 'repo')))
        Remove-Item -LiteralPath $loose -Recurse -Force

        $m = @(Stop-Keeper $k)
        $left = @(Get-ChildItem -LiteralPath $top -Force | Where-Object { $_.Name -ne 'far.ps1' } | ForEach-Object { $_.Name })
        Yes ('and when the last keeper is done, only what is not a run''s is left' + $(if ($left.Count -ne 1) { ': ' + ($left -join ', ') } else { '' })) (($m -contains ('GONE ' + $next)) -and ($left -join ',') -eq 'thornswood-onbox-notarun')
    } finally {
        foreach ($h in $held) { $h.Dispose() }
        foreach ($k in $keepers) { if (-not $k.P.HasExited) { $k.P.Kill() } }
        Remove-Item -LiteralPath $top -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
