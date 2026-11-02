# test-2019-collection-plugins.ps1
#
#     pwsh -NoProfile -File .\tests\test-2019-collection-plugins.ps1
#     powershell -NoProfile -File .\tests\test-2019-collection-plugins.ps1
#
# The full deploys hold the plugins they send to the collection's own bytes
# (#2019): records\collection-plugins.json, written by
# scripts\mods\New-CollectionPluginRecord.ps1 from a folder, and read by
# Assert-ThornswoodCollectionPlugins (scripts\deploy\CollectionPlugins.ps1)
# in Deploy-Server.ps1 and Deploy-DevGamemode.ps1 -LoadOrder.
# Offline: a fixture folder under TEMP, made and removed here. Nothing
# connects to anything and no real record is read or written.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\deploy\CollectionPlugins.ps1')
$gen = Join-Path $repo 'scripts\mods\New-CollectionPluginRecord.ps1'

$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Refusal([scriptblock]$b) { try { $null = & $b; return '' } catch { return $_.Exception.Message } }
function Put([string]$p, [byte[]]$b) { [IO.File]::WriteAllBytes($p, $b) }

# A [bracketed] & folder name, as the worktree root has, so -LiteralPath is exercised.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-2019 [x] & ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$col = Join-Path $tmp 'collection'; $mine = Join-Path $tmp 'mine'
$null = New-Item -ItemType Directory -Path $col; $null = New-Item -ItemType Directory -Path $mine
try {
    Put (Join-Path $col '3BBB.esp') ([byte[]](1..200 | ForEach-Object { $_ % 256 }))
    Put (Join-Path $col 'B Mod.esm') ([Text.Encoding]::ASCII.GetBytes('TES4 b'))
    Put (Join-Path $col 'a.esl') ([Text.Encoding]::ASCII.GetBytes('TES4 a'))
    Put (Join-Path $col 'Thornswood-Content.esp') ([Text.Encoding]::ASCII.GetBytes('ours'))
    Put (Join-Path $col 'readme.txt') ([Text.Encoding]::ASCII.GetBytes('not a plugin'))

    # ---- (a)+(b) the generator and the format
    $rec = Join-Path $tmp 'out [r]\collection-plugins.json'
    & $gen -Data $col -Out $rec -Collection 7essxf -Revision 2 *> $null
    Yes 'the generator writes the record, making its folder' (Test-Path -LiteralPath $rec)
    $raw = [IO.File]::ReadAllBytes($rec)
    $text = [Text.Encoding]::UTF8.GetString($raw)
    Yes '  with no byte order mark and LF only' ($raw[0] -eq [byte][char]'{' -and -not $text.Contains("`r"))
    $doc = ConvertFrom-ThornswoodJson $text $rec
    Yes '  version 1, builtBy, collection and revision' ($doc.version -eq 1 -and $doc.builtBy -eq 'scripts/mods/New-CollectionPluginRecord.ps1' -and $doc.collection -eq '7essxf' -and $doc.revision -eq 2)
    $names = @($doc.plugins | ForEach-Object { $_.name })
    Yes '  every .esp/.esm/.esl, sorted by name, not ours and not other files' (($names -join '|') -eq '3BBB.esp|a.esl|B Mod.esm')
    $row = @($doc.plugins | Where-Object { $_.name -eq '3BBB.esp' })[0]
    $want = (Get-FileHash -LiteralPath (Join-Path $col '3BBB.esp') -Algorithm SHA256).Hash.ToLowerInvariant()
    Yes '  each row has name, size and the sha256 of the file' ($row.size -eq 200 -and $row.sha256 -eq $want -and @($row.PSObject.Properties).Count -eq 3)
    Yes '  and the deploy reader takes it' ((Read-ThornswoodCollectionPluginRecord $rec).Count -eq 3)
    $again = Join-Path $tmp 'again.json'
    & $gen -Data $col -Out $again -Collection 7essxf -Revision 2 *> $null
    Yes 'the same folder gives the same bytes' ([Convert]::ToBase64String($raw) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($again)))
    $edition = if ($PSVersionTable.PSEdition -eq 'Core') { 'powershell' } else { 'pwsh' }
    if (Get-Command $edition -ErrorAction SilentlyContinue) {
        $other = Join-Path $tmp 'other.json'
        # -ExecutionPolicy Bypass for this one child: on a machine whose
        # Windows PowerShell policy is Restricted (One, 12 Oct) it refused
        # to run the generator at all, so nothing was written to compare.
        & $edition -NoProfile -ExecutionPolicy Bypass -Command "& '$($gen.Replace("'", "''"))' -Data '$($col.Replace("'", "''"))' -Out '$($other.Replace("'", "''"))' -Collection 7essxf -Revision 2" *> $null
        Yes "  and the other edition ($edition) writes it byte for byte" ((Test-Path -LiteralPath $other) -and [Convert]::ToBase64String($raw) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($other)))
    }
    $only = Join-Path $tmp 'only.json'
    & $gen -Data $col -Out $only -Plugins '3BBB.esp' *> $null
    Yes '-Plugins writes only those' (@((ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $only -Raw) $only).plugins).Count -eq 1)
    Yes '  and refuses one the folder does not have, named' ((Refusal { & $gen -Data $col -Out $only -Plugins 'Nope.esp' *> $null }) -match 'Nope\.esp')
    Yes 'a folder that is not there is refused' ((Refusal { & $gen -Data (Join-Path $tmp 'none') -Out $only *> $null }) -match 'no folder')
    Yes 'the generator reads files only, never the Vortex app' (-not ((Get-Content -LiteralPath $gen -Raw) -match '(?i)vortex\.exe|Start-Process|nxm:'))

    # ---- (c) the refusal
    Copy-Item -LiteralPath (Join-Path $col '3BBB.esp') -Destination (Join-Path $mine 'same.esp')
    Rename-Item -LiteralPath (Join-Path $mine 'same.esp') -NewName '3BBB.esp'
    $good = @((Join-Path $mine '3BBB.esp'))
    Yes 'the collection''s own bytes pass' ((Refusal { Assert-ThornswoodCollectionPlugins -RecordPath $rec -Files $good }) -eq '')
    Yes 'nothing to send passes, whatever the record' ((Refusal { Assert-ThornswoodCollectionPlugins -RecordPath (Join-Path $tmp 'none.json') -Files @() }) -eq '')
    # A file of its own named in another case: a path with its case changed
    # finds the file only where the file system ignores case, which Linux's
    # does not (#2989).
    $lower = Join-Path $tmp 'lower'
    New-Item -ItemType Directory -Path $lower -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $col 'B Mod.esm') -Destination (Join-Path $lower 'b mod.esm')
    Yes 'names compare without case, as Windows does' ((Refusal { Assert-ThornswoodCollectionPlugins -RecordPath $rec -Files @((Join-Path $lower 'b mod.esm')) }) -eq '')
    Put (Join-Path $mine 'small\3BBB.esp' | ForEach-Object { $null = New-Item -ItemType Directory -Path (Split-Path $_) -Force; $_ }) ([byte[]](1..50))
    $why = Refusal { Assert-ThornswoodCollectionPlugins -RecordPath $rec -Files @((Join-Path $mine 'small\3BBB.esp')) -What 'the full deploy' }
    Yes 'another size is refused, naming the plugin and both sizes' ($why -match '^Refused: the full deploy would send 1 plugin' -and $why.Contains('3BBB.esp  (this machine''s is 50 bytes, the collection''s is 200)') -and $why -match 'Nothing was sent')
    $same = [byte[]](1..200 | ForEach-Object { $_ % 256 }); $same[10] = 99
    $null = New-Item -ItemType Directory -Path (Join-Path $mine 'edit') -Force
    Put (Join-Path $mine 'edit\3BBB.esp') $same
    $why = Refusal { Assert-ThornswoodCollectionPlugins -RecordPath $rec -Files @((Join-Path $mine 'edit\3BBB.esp')) }
    Yes 'the same size with other bytes is refused, by sha256' ($why.Contains('3BBB.esp  (sha256 ') -and $why.Contains($want.Substring(0, 12)))
    Put (Join-Path $mine 'Stray.esp') ([byte[]](7, 7))
    $why = Refusal { Assert-ThornswoodCollectionPlugins -RecordPath $rec -Files @($good + (Join-Path $mine 'Stray.esp') + (Join-Path $mine 'edit\3BBB.esp')) }
    Yes 'a plugin not in the record is refused, and every bad one is named, the good one not' ($why -match 'would send 2 plugin' -and $why.Contains('Stray.esp  (not in the collection''s record)') -and $why.Contains('3BBB.esp  (sha256'))
    Put (Join-Path $mine 'Thornswood-Content.esp') ([byte[]](1))
    Yes 'Thornswood-Content.esp is ours and never held to the record' ((Refusal { Assert-ThornswoodCollectionPlugins -RecordPath $rec -Files @((Join-Path $mine 'Thornswood-Content.esp')) }) -eq '')
    $why = Refusal { Assert-ThornswoodCollectionPlugins -RecordPath (Join-Path $tmp 'none.json') -Files $good }
    Yes 'no record refuses a deploy that would send a collection plugin, naming it and the generator' ($why -match '^Refused: this deploy would send 1 plugin\(s\) \(3BBB\.esp\)' -and $why -match 'New-CollectionPluginRecord')
    Yes '  but not one that sends only ours' ((Refusal { Assert-ThornswoodCollectionPlugins -RecordPath (Join-Path $tmp 'none.json') -Files @((Join-Path $mine 'Thornswood-Content.esp')) }) -eq '')
    $badRec = Join-Path $tmp 'bad.json'
    [IO.File]::WriteAllText($badRec, '')
    Yes 'an empty record is refused, named, through ConvertFrom-ThornswoodJson' ((Refusal { Assert-ThornswoodCollectionPlugins -RecordPath $badRec -Files $good }) -match 'bad\.json is empty')
    [IO.File]::WriteAllText($badRec, '{"version":1,"plugins":[{"name":"x.esp","size":1}]}')
    Yes 'a row without a sha256 is refused' ((Refusal { Assert-ThornswoodCollectionPlugins -RecordPath $badRec -Files $good }) -match 'without a name, a size and a sha256')
    [IO.File]::WriteAllText($badRec, '{"version":2,"plugins":[]}')
    Yes 'another version is refused' ((Refusal { Assert-ThornswoodCollectionPlugins -RecordPath $badRec -Files $good }) -match 'not a version 1')
    [IO.File]::WriteAllText($badRec, '{"version":1,"plugins":[{"name":"a.esp","size":1,"sha256":"' + ('0' * 64) + '"},{"name":"A.esp","size":1,"sha256":"' + ('0' * 64) + '"}]}')
    Yes 'a plugin listed twice is refused' ((Refusal { Assert-ThornswoodCollectionPlugins -RecordPath $badRec -Files $good }) -match 'twice')
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- where the deploys ask
foreach ($d in @(
    @{ File = 'scripts\deploy\Deploy-Server.ps1'; Send = 'plugin(s) will go up before the restart' },
    @{ File = 'scripts\deploy\Deploy-DevGamemode.ps1'; Send = 'plugin(s) will go up before the restart' })) {
    $src = [IO.File]::ReadAllText((Join-Path $repo $d.File)).Replace("`r`n", "`n")
    $leaf = Split-Path -Leaf $d.File
    $loop = $src.IndexOf('$changed += (''{0}  {1:N0} -> {2:N0} bytes''')
    # The last ask, the full deploy's: -FromRecord's (#4069) asks earlier,
    # of the plugins it takes from the store (test-4069-main-move.ps1).
    $ask = $src.LastIndexOf('Assert-ThornswoodCollectionPlugins -RecordPath')
    $after = $src.IndexOf($d.Send, [Math]::Max($ask, 0))
    Yes "$leaf holds the plugins it sends to the collection's record" ($ask -gt 0 -and $src.Contains("records\collection-plugins.json") -and $src.Contains('-Files $sendPlugins'))
    Yes '  once it knows what it would send, and before it says or sends anything' ($loop -gt 0 -and $ask -gt $loop -and $after -gt $ask)
}
$dd = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Deploy-DevGamemode.ps1')).Replace("`r`n", "`n")
# The top-level -LoadOrder block: an if at the start of a line that ends the
# line (the one-line if above it only adds a file to the list). Its first line
# inside has changed (#2334 opens it with the read of what the dev box holds),
# so it is found by the if alone; a block that is gone is a FAIL, not a throw.
$m = [regex]::Match($dd, '(?m)^if \(\$LoadOrder\) \{\n')
$lo = if ($m.Success) { $m.Index } else { -1 }
$ask = $dd.IndexOf('Assert-ThornswoodCollectionPlugins -RecordPath')
$end = if ($lo -ge 0) { $dd.IndexOf("`n}`n", $lo) } else { -1 }
Yes 'Deploy-DevGamemode asks only under -LoadOrder, which is when it sends plugins' ($lo -gt 0 -and $ask -gt $lo -and $ask -lt $end)

# ---- the committed record (collection 7essxf revision 7, #4603; revision 6 from #3649; revision 5 from #3206, revision 2 from 11 Oct before that)
$real = Join-Path $repo 'records\collection-plugins.json'
$realTable = Read-ThornswoodCollectionPluginRecord $real
Yes 'records\collection-plugins.json is there and the deploys'' reader takes it' ($null -ne $realTable -and $realTable.Count -ge 100)
$realDoc = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $real -Raw) $real
Yes '  it pins collection 7essxf revision 7' ($realDoc.collection -eq '7essxf' -and $realDoc.revision -eq 7)
Yes '  it holds the collection''s 3BBB.esp, 20,257 bytes (#2019)' ($realTable.ContainsKey('3BBB.esp') -and $realTable['3BBB.esp'].Size -eq 20257 -and $realTable['3BBB.esp'].Sha256 -eq 'ce4f554616458a10b4809f705828f9d3e3e2d1457abe73ee32fe5f8f044a8549')
Yes '  and not our own plugin, which goes up from the repo' (-not $realTable.ContainsKey('Thornswood-Content.esp'))
Yes '  and was written by the generator, in its format, whatever the line endings' ([IO.File]::ReadAllText($real).Replace([string][char]13, '').StartsWith('{' + [char]10 + '  "version": 1,' + [char]10 + '  "builtBy": "scripts/mods/New-CollectionPluginRecord.ps1",'))

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
