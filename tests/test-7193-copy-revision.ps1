<#
  test-7193-copy-revision.ps1

      pwsh -NoProfile -File .\tests\test-7193-copy-revision.ps1

  Copy-NexusRevision.ps1 (#7193) against the stand-in Nexus on this machine's
  loopback address (tests\fixtures\nexus-standin.js), never the real one.

  WHY. Main and Dev had one collection, so every revision published for Dev
  was offered to main's testers as an update before main ran it. Dev gets a
  collection of its own, made from main's newest revision, and main's
  collection takes each Dev revision only when a build carrying it is
  promoted. Both are this one copy.

  WHAT IT HOLDS:
    1. -WhatIf downloads and builds the copy and writes nothing to Nexus;
    2. -New makes a collection with POST /v3/collections, publishes its
       revision 1, names it with the page record's Dev name and summary, and
       says "copied <from> <n> to <slug> 1" last; every mod entry, rule and
       file of the archive is the source revision's;
    3. -To a collection copies into it as its next revision and publishes it,
       named with main's name again, or with Dev's when records\collection.json's
       "dev" names that collection;
    4. -Number that is not the next revision stops before anything is sent;
       so does a draft waiting in the collection it goes to, a revision of
       the source that is not published, a mod whose page the permission
       record has not read, and -New with -To or neither;
    5. nexus-collection.js --copy changes nothing but the page's text, the
       name and the summary, and collection-page.js holds the "dev" name and
       summary to their shape;
    6. the verb is in nexus-verbs.json, with no parameter that names a file;
    7. records\collection.json's "dev" { collection, offset } is held to its
       shape and written back as it was; the newest revision is the Dev
       collection's plus the offset (Get-NewestRecordedRevision), and a
       release on the records' newest passes Get-ShipNewestRevisionProblem;
       the merge publishes to Dev and names everything it hands on in the
       records' numbers (Publish-CollectionRecord.ps1); a Release names the
       Dev revision beside the records' (New-SignedManifest.ps1), and the
       launcher sends a dev install to it (VeloUpdate.cs);
    8. Promote-Collection.ps1 copies every revision the main collection
       lacks from Dev, as the main collection's revision of the same number,
       once, says so for a Release with no Dev collection, and stops before
       anything is sent on a manifest the records do not agree with.

  Needs node and 7-Zip, and says SKIP without 7-Zip. Everything it writes is
  under its own temp folder, which it removes.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$rel = Join-Path $repo 'scripts\release'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Skip([string]$what) { Write-Host "SKIP  $what" }
$script:standin = $null
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-7193-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
function Done {
    if ($script:standin -and -not $script:standin.HasExited) { $script:standin.Kill() }
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}
function Q([string]$s) { return '"' + (($s -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"' }

$node = Get-Command node -ErrorAction SilentlyContinue
Yes 'node is on PATH, for the stand-in Nexus' ($null -ne $node)
if ($null -eq $node) { Done }
trap { $script:fail++; Write-Host ('FAIL  the harness itself stopped: ' + $_.Exception.Message) -ForegroundColor Red; Done }
$pwsh = (Get-Process -Id $PID).Path

# ---- 6: the verb ----------------------------------------------------------------
$verbs = Get-Content -Raw -LiteralPath (Join-Path $rel 'nexus-verbs.json') | ConvertFrom-Json
$v = $verbs.verbs.'Copy-NexusRevision'
Yes '6. Copy-NexusRevision is a Nexus-Run verb of scripts/release/Copy-NexusRevision.ps1' ($null -ne $v -and $v.script -eq 'scripts/release/Copy-NexusRevision.ps1')
$vp = if ($v) { @($v.params.PSObject.Properties.Name) } else { @() }
Yes '6. its parameters are the collections, the revisions and the switches, none a file' (($vp | Sort-Object) -join ',' -eq 'Game,New,Number,Revision,Slug,To,WaitSeconds,WhatIf')

# ---- 7: the record's "dev", and the newest revision -------------------------------
. (Join-Path $rel 'CollectionRecord.ps1')
. (Join-Path $rel 'CollectionRevision.ps1')
$real = Read-CollectionRecord (Join-Path $repo 'records\collection.json')
function Shape($dev, [int]$revision = 13) {
    $r = $real | ConvertTo-Json -Depth 12 | ConvertFrom-Json
    $r.revision = $revision
    if ($null -ne $dev) { $r | Add-Member -NotePropertyName dev -NotePropertyValue $dev -Force }
    elseif ($r.PSObject.Properties['dev']) { $r.PSObject.Properties.Remove('dev') }
    return @(Get-CollectionRecordShapeProblems $r)
}
Yes '7. the record passes with no "dev" and with a Dev collection and offset' (@(Shape $null).Count -eq 0 -and @(Shape ([pscustomobject]@{ collection = 'dv1abc'; offset = 12 })).Count -eq 0)
Yes '7. a "dev" that is main''s own collection is refused' ([bool](@(Shape ([pscustomobject]@{ collection = [string]$real.collection; offset = 12 })) -match 'main''s own collection'))
Yes '7. so are an offset that is not a count, a field it does not know, and a revision not past the offset' (
    [bool](@(Shape ([pscustomobject]@{ collection = 'dv1abc'; offset = 'x' })) -match 'not a revision count') -and
    [bool](@(Shape ([pscustomobject]@{ collection = 'dv1abc'; offset = 1; slug = 'x' })) -match 'does not know: slug') -and
    [bool](@(Shape ([pscustomobject]@{ collection = 'dv1abc'; offset = 13 }) 13) -match 'not past dev\.offset'))
$withDev = $real | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$withDev | Add-Member -NotePropertyName dev -NotePropertyValue ([pscustomobject]@{ collection = 'dv1abc'; offset = 12 }) -Force
# The writer reads fields a plugin leaves out, as its callers do, with no strict mode.
$text = & { Set-StrictMode -Off; ConvertTo-CollectionRecordText $withDev }
$back = $text | ConvertFrom-Json
$again = & { Set-StrictMode -Off; ConvertTo-CollectionRecordText $back }
Yes '7. the record''s text keeps "dev" after the revision, and reads back to the same text' ($text -match '"revision": \d+,\n  "dev": \{ "collection": "dv1abc", "offset": 12 \},\n' -and $again -ceq $text)
$fake = Join-Path $T 'fake-repo'
Put (Join-Path $fake 'records\collection-plugins.json') ('{"version":1,"collection":"7essxf","revision":14,"plugins":[{"name":"A.esp","size":12,"sha256":"' + ('0' * 64) + '"}]}')
Yes '7. with no records\collection.json there is no Dev collection' ($null -eq (Get-DevCollection $fake))
Put (Join-Path $fake 'records\collection.json') '{"collection":"7essxf","revision":14,"dev":{"collection":"dv1abc","offset":12}}'
$dc = Get-DevCollection $fake
Yes '7. Get-DevCollection reads the slug and offset' ($dc -and $dc.Slug -eq 'dv1abc' -and $dc.Offset -eq 12)
Yes '7. a release on the records'' newest passes, given the number' ((Get-ShipNewestRevisionProblem -RepoDir $fake -Published 14) -eq '')
$why = Get-ShipNewestRevisionProblem -RepoDir $fake -Published 13
Yes '7. one ahead of Dev''s newest names Dev''s numbers and the -Slug to publish with' ($why -match "the Dev collection dv1abc's revision 2" -and $why -match 'newest revision published there is 1' -and $why -match '-Slug dv1abc -Publish 2')
Put (Join-Path $fake 'records\collection.json') '{"collection":"7essxf","revision":14,"dev":{"collection":"Not A Slug","offset":12}}'
Yes '7. a "dev" with no slug is a problem, never a guess' ((Get-ShipNewestRevisionProblem -RepoDir $fake -Published 14) -match 'no Dev collection slug')
$pubText = Get-Content -Raw -LiteralPath (Join-Path $rel 'Publish-CollectionRecord.ps1')
Yes '7. the merge publishes to the record''s Dev collection, in its own numbers' ($pubText.Contains('$nx = if ($hasDev) { [string]$want.dev.collection } else { [string]$want.collection }') -and
    $pubText.Contains("NexusPublished.ps1') -Slug `$nx") -and $pubText.Contains('$pubRec = $published + $off') -and $pubText.Contains('Publish = $draft; Slug = $nx') -and $pubText -notmatch '(?<!Record)Slug = \[string\]\$want\.collection')
Yes '7. and lays it out and hands it on in the records'' numbers, keeping "dev"' ($pubText.Contains('$layParams.RecordSlug = [string]$want.collection; $layParams.RecordRevision = $draftRec') -and
    $pubText.Contains('$got.revision = $draftRec') -and $pubText.Contains("Add-Member -NotePropertyName dev -NotePropertyValue `$want.dev") -and $pubText.Contains('"published=$draftRec') -and $pubText.Contains('revision = $draftRec; dropped'))
$manText = Get-Content -Raw -LiteralPath (Join-Path $rel 'New-SignedManifest.ps1')
Yes '7. a build Release names the Dev revision beside the records''' ($manText.Contains("`$m['devCollection'] = [ordered]@{ slug = `$devc.Slug; revision = `$dn }") -and $manText.Contains('$dn = [int]$m[''collectionRevision''] - $devc.Offset'))
$vu = Get-Content -Raw -LiteralPath (Join-Path $repo 'launcher\app\VeloUpdate.cs')
Yes '7. a dev launcher is held to and sent to the Dev collection''s revision, main''s to the main collection''s' ($vu.Contains('bool devOwn = channel == "dev" && devc != null') -and
    $vu.Contains('ServerCollectionSlug = devOwn ? devc.Slug : "";') -and $vu.Contains('ServerCollectionRevision = devOwn ? devc.Revision : record.CollectionRevision;'))
$ck = Get-Content -Raw -LiteralPath (Join-Path $repo 'launcher\app\Checks.cs')
Yes '7. and its Mod Organizer 2 revision, in the records'' numbers, is compared in Dev''s' ($ck.Contains('Updater.ServerRecordRevision - Updater.ServerCollectionRevision') -and $ck.Contains('return mods > 0 ? mods - offset : mods;'))

# ---- 5: the copy in node, and the page's shape -----------------------------------
New-Item -ItemType Directory -Force -Path $T | Out-Null
$js = Join-Path $rel 'nexus-collection.js'
$pageRec = Join-Path $T 'collection-page.json'
Put $pageRec '{"version":1,"collection":"7essxf","revision":2,"name":"Thornswood","dev":{"name":"Thornswood Dev","summary":"The dev server''s mod list."},"summary":"A made-up collection.","description":"## About\n\nA made-up collection for the harness.","installInstructions":"Add it in Vortex.","notSaid":[]}'
$fixture = [ordered]@{
    info = [ordered]@{ author = 'EvilPatrick06'; authorUrl = ''; name = 'Thornswood'; summary = 'Old summary.'; description = 'Old text.'; installInstructions = 'Old steps.'; domainName = 'skyrimspecialedition'; gameVersions = @('1.6.1170.0') }
    mods = @(
        [ordered]@{ name = 'Thornswood Content'; version = '1.2'; optional = $false; domainName = 'skyrimspecialedition'
            source = [ordered]@{ type = 'nexus'; modId = 192001; fileId = 811029; md5 = 'ee881bf2a869d0810113a82ca1405445'; fileSize = 660022; logicalFilename = 'Thornswood Content'; updatePolicy = 'exact'; tag = 'QXsOYonzPMT' }
            patches = [ordered]@{ 'Thornswood-Content.esp' = '023593E0' }; author = 'EvilPatrick06'; details = [ordered]@{ category = 'Miscellaneous'; type = '' }; phase = 0 }
    )
    modRules = @(); tools = @(); plugins = @([ordered]@{ name = 'Thornswood-Content.esp'; enabled = $true }); pluginRules = [ordered]@{ plugins = @(); groups = @() }
    collectionConfig = [ordered]@{ recommendNewProfile = $true; referenceTagScheme = 'v1' }
}
$fx = Join-Path $T 'fixture'
Put (Join-Path $T 'fixture-in.json') ($fixture | ConvertTo-Json -Depth 8)
& $node.Source -e "const fs=require('fs');fs.mkdirSync(process.argv[2],{recursive:true});fs.writeFileSync(process.argv[2]+'/collection.json', JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1],'utf8')), undefined, 2))" (Join-Path $T 'fixture-in.json') $fx
Put (Join-Path $fx 'patches\Thornswood Content\Thornswood-Content.esp.diff') 'BSDIFF40'
$o1 = Join-Path $T 'copy-collection.json'; $o2 = Join-Path $T 'copy-payload.json'
& $node.Source $js --copy (Join-Path $fx 'collection.json') $pageRec dev $o1 $o2 | Out-Null
$c = if (Test-Path -LiteralPath $o1) { Get-Content -Raw -LiteralPath $o1 | ConvertFrom-Json } else { $null }
Yes '5. --copy to dev gives the Dev name and summary and the page''s text' ($LASTEXITCODE -eq 0 -and $c -and $c.info.name -eq 'Thornswood Dev' -and $c.info.summary -eq 'The dev server''s mod list.' -and $c.info.installInstructions -eq 'Add it in Vortex.')
Yes '5. and leaves every entry and the rest of info as they were' ($c -and ($c.mods | ConvertTo-Json -Depth 8 -Compress) -eq ($fixture.mods | ConvertTo-Json -Depth 8 -Compress) -and $c.info.author -eq 'EvilPatrick06')
& $node.Source $js --copy $o1 $pageRec main (Join-Path $T 'back.json') (Join-Path $T 'back-payload.json') | Out-Null
$b = Get-Content -Raw -LiteralPath (Join-Path $T 'back.json') | ConvertFrom-Json
Yes '5. --copy to main names it Thornswood again, with main''s summary' ($LASTEXITCODE -eq 0 -and $b.info.name -eq 'Thornswood' -and $b.info.summary -eq 'A made-up collection.')
$p = Get-Content -Raw -LiteralPath $o2 | ConvertFrom-Json
Yes '5. its payload is the mapping of the copy, named as Dev' ($p.collection_manifest.info.name -eq 'Thornswood Dev' -and @($p.collection_manifest.mods).Count -eq 1)
Put (Join-Path $T 'bad-page.json') '{"version":1,"collection":"7essxf","revision":2,"name":"Thornswood","dev":{"name":"Thornswood","summary":"x"},"summary":"s","description":"## A\n\nb.","installInstructions":"","notSaid":[]}'
$rec = Join-Path $T 'record.json'
Put $rec '{"collection":"7essxf","revision":2,"mods":[]}'
$said = & $node.Source (Join-Path $rel 'collection-page.js') (Join-Path $T 'bad-page.json') $rec
Yes '5. a Dev name that is main''s is refused by collection-page.js' ($LASTEXITCODE -eq 1 -and (($said -join ' ') -match 'dev\.name is the same as name'))
& $node.Source $js --copy (Join-Path $fx 'collection.json') (Join-Path $T 'bad-page.json') beta (Join-Path $T 'x.json') (Join-Path $T 'y.json') 2>$null | Out-Null
Yes '5. a channel that is not main or dev is refused' ($LASTEXITCODE -eq 1)
$real = & $node.Source (Join-Path $rel 'collection-page.js')
Yes '5. records/collection-page.json holds, with its name and Dev''s' ($LASTEXITCODE -eq 0 -and (Get-Content -Raw (Join-Path $repo 'records\collection-page.json') | ConvertFrom-Json).dev.name -eq 'Thornswood Dev')

# ---- the stand-in -----------------------------------------------------------------
. (Join-Path $rel 'Nexus.ps1')
$sz = Find-SevenZip
if (-not $sz) { Skip '1-4: 7-Zip is not on this machine (pwsh scripts/release/Get-SevenZip.ps1 fetches it)'; Done }
$archive = Join-Path $T 'collection_7essxf_2_.7z'
Push-Location $fx; & $sz a -t7z -y $archive 'collection.json' 'patches' | Out-Null; Pop-Location

New-Item -ItemType Directory -Force -Path (Join-Path $T 'save'), (Join-Path $T 'scratch') | Out-Null
$KEY = 'standin-' + [Guid]::NewGuid().ToString('N')
$psi = New-Object Diagnostics.ProcessStartInfo
$psi.FileName = $node.Source; $psi.Arguments = Q (Join-Path $repo 'tests\fixtures\nexus-standin.js')
$psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
$psi.EnvironmentVariables['NEXUS_STANDIN_KEY'] = $KEY
$psi.EnvironmentVariables['NEXUS_STANDIN_SAVE'] = (Join-Path $T 'save')
$script:standin = [Diagnostics.Process]::Start($psi)
$first = $script:standin.StandardOutput.ReadLineAsync()
$heard = if ($first.Wait(15000)) { [string]$first.Result } else { '' }
$pm = [regex]::Match($heard, '^\[nexus\] listening on 127\.0\.0\.1:(\d+)$')
$port = if ($pm.Success) { [int]$pm.Groups[1].Value } else { 0 }
Yes "the stand-in Nexus listens on its own port ($port)" ($port -gt 0)
if (-not $port) { Done }
$null = $script:standin.StandardOutput.ReadToEndAsync()
$null = $script:standin.StandardError.ReadToEndAsync()
$base = 'http://127.0.0.1:' + $port
function State { return (Invoke-RestMethod -Uri ($base + '/_requests')) }
function Control($h) { [void](Invoke-RestMethod -Method Post -Uri ($base + '/_control') -ContentType 'application/json' -Body ($h | ConvertTo-Json -Compress -Depth 5)) }
function Writes { return @(@((State).requests) | Where-Object { $_.method -ne 'GET' -and -not ($_.path -eq '/v2/graphql' -and -not ([string]$_.json.query).StartsWith('mutation')) }) }
$env:THORNSWOOD_NEXUS_STANDIN = $base
$env:THORNSWOOD_NEXUS_STANDIN_KEY = $KEY
$env:THORNSWOOD_NEXUS_API_KEY = $null
$env:THORNSWOOD_SCRATCH_ROOT = (Join-Path $T 'scratch')
Control @{ addRevision = @{ n = 2; id = 801014; status = 'published'; archive = $archive } }

$perm = Join-Path $T 'collection-permissions.json'
Put $perm '{"version":1,"collection":"7essxf","revision":2,"mods":[{"modId":192001,"name":"Thornswood Content","author":"EvilPatrick06","files":[{"fileId":1,"name":"f","version":"1"}],"plugins":[],"page":"https://www.nexusmods.com/skyrimspecialedition/mods/192001?tab=description","ours":true,"reading":null}]}'
function Run([string[]]$arguments, [string]$permission = $perm) {
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $pwsh
    $all = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Q (Join-Path $rel 'Copy-NexusRevision.ps1'))) + @(@($arguments) + @('-PageRecord', $pageRec, '-Permissions', $permission, '-NoPause') | ForEach-Object { Q $_ })
    $psi.Arguments = $all -join ' '
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $p = [Diagnostics.Process]::Start($psi)
    $e = $p.StandardError.ReadToEndAsync()
    $o = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    return [pscustomobject]@{ Code = $p.ExitCode; Out = ($o + $e.Result) }
}
function YesR([string]$what, [bool]$cond, $r) { Yes $what $cond; if (-not $cond) { Write-Host (($r.Out -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 12) -join "`n") -ForegroundColor DarkGray } }

# ---- 4: refusals before anything is written ---------------------------------------
$r = Run @('-Slug', '7essxf', '-Revision', '2')
YesR '4. neither -To nor -New is refused' ($r.Code -eq 1 -and $r.Out -match 'Say where the revision goes') $r
$r = Run @('-Slug', '7essxf', '-Revision', '2', '-New', '-To', 'abc')
YesR '4. both -To and -New are refused' ($r.Code -eq 1) $r
$r = Run @('-Slug', '7essxf', '-Revision', '3', '-New')
YesR '4. a revision that is not published is refused' ($r.Code -eq 1 -and $r.Out -match 'is not published') $r
Put (Join-Path $T 'no-perm.json') '{"version":1,"collection":"7essxf","revision":2,"mods":[]}'
$r = Run @('-Slug', '7essxf', '-Revision', '2', '-New') (Join-Path $T 'no-perm.json')
YesR '4. a mod whose page has not been read is refused' ($r.Code -eq 1 -and $r.Out -match 'may not go out') $r
Yes '4. and none of them wrote anything to Nexus' (@(Writes).Count -eq 0)

# ---- 1: -WhatIf ----------------------------------------------------------------------
$r = Run @('-Slug', '7essxf', '-Revision', '2', '-New', '-WhatIf')
YesR '1. -WhatIf builds the copy, names POST /v3/collections and writes nothing' ($r.Code -eq 0 -and $r.Out -match 'POST /v3/collections  ' -and $r.Out -match 'Nothing was written to Nexus' -and @(Writes).Count -eq 0) $r

# ---- 2: -New, the Dev collection ------------------------------------------------------
$r = Run @('-Slug', '7essxf', '-Revision', '2', '-New')
$st = State
$dev = @($st.others) | Select-Object -First 1
YesR '2. -New makes a collection with POST /v3/collections and publishes its revision 1' ($r.Code -eq 0 -and $dev -and $dev.latest -eq 1 -and $null -eq $dev.draft -and @(Writes | Where-Object { $_.path -eq '/v3/collections' }).Count -eq 1) $r
$last = @($r.Out -split "`r?`n" | Where-Object { $_.Trim() }) | Select-Object -Last 1
Yes '2. and its last line says what was copied where' ($dev -and $last -eq ('copied 7essxf 2 to ' + $dev.slug + ' 1'))
$sent = if ($dev) { $dev.revisions.'1'.data.collection_manifest } else { $null }
Yes '2. named Thornswood Dev, with the Dev summary' ($sent -and $sent.info.name -eq 'Thornswood Dev' -and $sent.info.summary -eq 'The dev server''s mod list.')
Yes '2. with the source''s mod entry as it was' ($sent -and @($sent.mods).Count -eq 1 -and $sent.mods[0].source.file_id -eq 811029)
Yes '2. and 7essxf is left on revision 2' ($st.collection.latest -eq 2 -and $null -eq $st.collection.draft)

# ---- 3: -To, back to main's, and -Number --------------------------------------------
$n0 = @(Writes).Count
$r = Run @('-Slug', $dev.slug, '-Revision', '1', '-To', '7essxf', '-Number', '5')
YesR '4. -Number that is not the next revision stops before anything is sent' ($r.Code -eq 1 -and $r.Out -match 'has to be 5' -and @(Writes).Count -eq $n0) $r
$r = Run @('-Slug', $dev.slug, '-Revision', '1', '-To', '7essxf', '-Number', '3')
$st = State
YesR '3. -To copies Dev''s revision 1 into 7essxf as revision 3 and publishes it' ($r.Code -eq 0 -and $st.collection.latest -eq 3 -and $null -eq $st.collection.draft) $r
Yes '3. named Thornswood again, with main''s summary' ($st.collection.revisions.'3'.data.collection_manifest.info.name -eq 'Thornswood' -and $st.collection.revisions.'3'.data.collection_manifest.info.summary -eq 'A made-up collection.')
$colRec = Join-Path $T 'collection.json'
Put $colRec ('{"collection":"7essxf","revision":3,"dev":{"collection":"' + $dev.slug + '","offset":2}}')
$r = Run @('-Slug', '7essxf', '-Revision', '3', '-To', $dev.slug, '-Number', '2', '-CollectionRecord', $colRec)
$d2 = @((State).others) | Where-Object { $_.slug -eq $dev.slug } | Select-Object -First 1
YesR '3. a copy into the collection the record''s "dev" names is named as Dev' ($r.Code -eq 0 -and $d2.latest -eq 2 -and $d2.revisions.'2'.data.collection_manifest.info.name -eq 'Thornswood Dev') $r

# ---- 8: the promotion ----------------------------------------------------------------
# Dev now has 1 and 2, the records' 3 and 4 (offset 2), and 7essxf is on 3.
function Promote([string]$manifest, [switch]$WhatIf) {
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $pwsh
    $all = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Q (Join-Path $rel 'Promote-Collection.ps1'))) + @(@('-Manifest', $manifest, '-CollectionRecord', $colRec, '-PageRecord', $pageRec, '-Permissions', $perm) | ForEach-Object { Q $_ })
    if ($WhatIf) { $all += '-WhatIf' }
    $psi.Arguments = $all -join ' '
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $p = [Diagnostics.Process]::Start($psi)
    $e = $p.StandardError.ReadToEndAsync()
    $o = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    return [pscustomobject]@{ Code = $p.ExitCode; Out = ($o + $e.Result) }
}
$mOld = Join-Path $T 'manifest-old.json'
Put $mOld '{"schema":1,"tag":"build-1.3.1","collectionRevision":3,"parts":{}}'
$n0 = @(Writes).Count
$r = Promote $mOld
YesR '8. a Release from before the Dev collection copies nothing' ($r.Code -eq 0 -and $r.Out -match 'names no Dev collection' -and @(Writes).Count -eq $n0) $r
$mOff = Join-Path $T 'manifest-off.json'
Put $mOff ('{"schema":1,"tag":"build-1.3.2","collectionRevision":4,"devCollection":{"slug":"' + $dev.slug + '","revision":1},"parts":{}}')
$r = Promote $mOff
YesR '8. a manifest whose offset the records do not have stops before anything is sent' ($r.Code -eq 1 -and $r.Out -match 'at offset 3' -and @(Writes).Count -eq $n0) $r
$mNew = Join-Path $T 'manifest-new.json'
Put $mNew ('{"schema":1,"tag":"build-1.3.3","collectionRevision":4,"devCollection":{"slug":"' + $dev.slug + '","revision":2},"parts":{}}')
$r = Promote $mNew -WhatIf
YesR '8. -WhatIf names the copy and sends nothing' ($r.Code -eq 0 -and $r.Out -match ('would copy the Dev collection ' + $dev.slug + '''s revision 2 to the main collection 7essxf as revision 4') -and @(Writes).Count -eq $n0) $r
$r = Promote $mNew
$st = State
YesR '8. it copies Dev''s revision 2 to 7essxf as revision 4 and publishes it' ($r.Code -eq 0 -and $st.collection.latest -eq 4 -and $null -eq $st.collection.draft -and $r.Out -match ('copied ' + $dev.slug + ' 2 to 7essxf 4')) $r
Yes '8. named Thornswood, with main''s summary' ($st.collection.revisions.'4'.data.collection_manifest.info.name -eq 'Thornswood' -and $st.collection.revisions.'4'.data.collection_manifest.info.summary -eq 'A made-up collection.')
$n0 = @(Writes).Count
$r = Promote $mNew
YesR '8. promoted again, the main collection on that revision is left as it is' ($r.Code -eq 0 -and $r.Out -match 'on revision 4 already' -and @(Writes).Count -eq $n0) $r
$r = Promote $mOld
YesR '8. going back to an older Release says the newer revision stays the newest' ($r.Code -eq 0 -and @(Writes).Count -eq $n0) $r
Put $mOld ('{"schema":1,"tag":"build-1.3.1","collectionRevision":3,"devCollection":{"slug":"' + $dev.slug + '","revision":1},"parts":{}}')
$r = Promote $mOld
YesR '8.   with Dev''s revision named too' ($r.Code -eq 0 -and $r.Out -match 'past the 3 main is going back to' -and @(Writes).Count -eq $n0) $r

Control @{ addRevision = @{ n = 5; id = 900005; status = 'draft'; archive = $archive } }
$n0 = @(Writes).Count
$r = Run @('-Slug', $dev.slug, '-To', '7essxf')
YesR '4. a draft waiting in the collection it goes to stops it before anything is sent' ($r.Code -eq 1 -and $r.Out -match 'is a draft waiting' -and @(Writes).Count -eq $n0) $r
Yes 'the key went only to the API, with the application headers' (@((State).violations).Count -eq 0)

Done
