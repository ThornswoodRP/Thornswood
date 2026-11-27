# Keyless fixture for the verified layout's server order. Never runs the publisher.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts/release/CollectionRecord.ps1')
$root = Join-Path ([IO.Path]::GetTempPath()) ('ts-5189-handoff-' + [guid]::NewGuid())
$records = Join-Path $root 'records'
$null = New-Item -ItemType Directory -Path $records
$path = Join-Path $records 'load-order.json'
$old = @($script:CollectionBaseMasters) + @('Old.esp', 'CBBE.esp', 'Thornswood-Last.esp')
$want = [pscustomobject]@{ collection = '7essxf'; game = 'skyrimspecialedition'; revision = 11; dropped = @(@{name='Old.esp'}) }
$got = [pscustomobject]@{ collection = '7essxf'; game = 'skyrimspecialedition'; revision = 12; plugins = @(
    @{name='New.esm';master=$true}, @{name='New.esp';master=$false}, @{name='CBBE.esp';master=$false;enabled=$false}, @{name='Unused.esp';master=$false;enabled=$false}
) }
$expected = @($script:CollectionBaseMasters) + @('New.esm', 'CBBE.esp', 'New.esp', 'Thornswood-Last.esp')
function Refuses($label, $reason) {
    $why = ''
    try { $null = Get-PublishedCollectionOrderText $root $want $got 12 } catch { $why = $_.Exception.Message }
    if ($why -notlike "*$reason*") { throw "${label}: expected $reason, got $why" }
    Write-Host "PASS $label"
}
try {
    Refuses 'missing server order stops the handoff' 'load-order.json'
    [IO.File]::WriteAllText($path, (Format-ThornswoodLoadOrderRecord -Slug '7essxf' -Revision 10 -Order $old))
    Refuses 'stale server order stops the handoff' 'revision 11'
    [IO.File]::WriteAllText($path, (Format-ThornswoodLoadOrderRecord -Slug '7essxf' -Revision 11 -Order $old))
    $got.revision = 13
    Refuses 'a different layout revision stops the handoff' 'verified layout'
    $got.revision = 12; $got.collection = 'other'
    Refuses 'a different collection stops the handoff' 'verified layout'
    $got.collection = '7essxf'
    $before = (Get-FileHash -LiteralPath $path).Hash
    # Execute the publisher's pure assignment and artifact write, not the
    # script that talks to Nexus. Also hold their positions in the real flow.
    $source = [IO.File]::ReadAllText((Join-Path $repo 'scripts/release/Publish-CollectionRecord.ps1'))
    $plan = [regex]::Match($source, '\$rebuildOrder = Get-PublishedCollectionOrderText[^\r\n}]+')
    $publish = $source.IndexOf('Head "Publishing revision $draft"')
    $write = [regex]::Match($source, '(?m)^\[IO\.File\]::WriteAllText\(\(Join-Path \$Out ''load-order.json''\), \$rebuildOrder, \$utf8\)')
    $signal = $source.IndexOf('"published=$draft')
    if (-not ($plan.Success -and $write.Success -and $plan.Index -lt $publish -and $publish -lt $write.Index -and $write.Index -lt $signal)) {
        throw 'The publisher must plan before publishing and write the order before signaling a complete handoff'
    }
    $Repo = $root; $draft = 12; $draftRec = 12; $Out = Join-Path $root 'artifact'; $utf8 = [Text.UTF8Encoding]::new($false)
    $null = New-Item -ItemType Directory -Path $Out
    . ([scriptblock]::Create($plan.Value))
    . ([scriptblock]::Create($write.Value))
    $text = [IO.File]::ReadAllText((Join-Path $Out 'load-order.json'))
    $result = $text | ConvertFrom-Json
    if ($result.collection -ne '7essxf' -or $result.revision -ne 12 -or ($result.loadOrder -join '|') -cne ($expected -join '|')) { throw 'The handoff did not carry the new revision and canonical server order' }
    if ((Get-FileHash -LiteralPath $path).Hash -ne $before) { throw 'The handoff modified its source' }
    Write-Host 'PASS revision 12 carries the server order, excluding the drop and the unused disabled plugin'
    # The rebuild consumes records after review, not the Vortex list or artifact directly.
    [IO.File]::WriteAllText($path, $text)
    [IO.File]::WriteAllText((Join-Path $records 'collection.json'), ($got | ConvertTo-Json -Depth 8))
    [IO.File]::WriteAllText((Join-Path $records 'collection-plugins.json'), ('{"version":1,"collection":"7essxf","revision":12,"plugins":[{"name":"Old.esp","size":12,"sha256":"' + ('0' * 64) + '"}]}'))
    $build = Get-ThornswoodContentOrder -Repo $root
    if ($build.Revision -ne 12 -or $build.Moved -or ($build.Names -join '|') -cne ($expected -join '|')) { throw 'The rebuild would use a different order' }
    Write-Host 'PASS the normal rebuild reader takes the same revision and order'
} finally { Remove-Item -LiteralPath $root -Recurse -Force }
