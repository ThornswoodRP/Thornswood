# One-time migration for #6466. Internal filesystem operation, not a gate API.
# The gate entry supplies Main's fixed root; tests supply isolated fixtures.
function Assert-ThornswoodMainPolicyDeployment($Record) {
    if ($Record.commit -isnot [string] -or $Record.name -isnot [string] -or
        $Record.commit -cne 'dd4c7c336131b0d741327db31a6cffc1a5c7c949' -or $Record.name -cne 'build-1.3.93') {
        throw 'Main no longer runs the audited build-1.3.93 deployment. Nothing changed.'
    }
}

function Invoke-ThornswoodMainGameplayPolicies([string]$Root) {
    $file = Join-Path $Root 'server-settings.json'
    $text = [IO.File]::ReadAllText($file)
    try {
        $settings = ConvertFrom-Json -InputObject $text -AsHashtable -ErrorAction Stop
        $build = Get-Content -LiteralPath (Join-Path $Root 'server-build.json') -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    } catch { throw 'The settings or source build record do not read. Nothing changed.' }
    if ($settings -isnot [System.Collections.IDictionary] -or $settings.thornswoodServer -isnot [string] -or
        ($settings.port -isnot [long] -and $settings.port -isnot [int]) -or
        $settings.thornswoodServer -cne 'main' -or $settings.port -ne 7777) {
        throw 'This is not Main on its expected port. Nothing changed.'
    }
    if ($build.source.commit -isnot [string] -or $build.source.commit -cne 'b0b869cb31667738c791b97067b693e8f5b59b00') {
        throw 'This migration requires the source engine deployed with build-1.3.93. Nothing changed.'
    }
    # Refuse an operator's later policy rather than quietly replacing it.
    if ($settings.Contains('thornswoodLoadOrderRefuse') -and
        ($settings.thornswoodLoadOrderRefuse -isnot [bool] -or $settings.thornswoodLoadOrderRefuse -cne $true)) {
        throw 'Main has an unexpected load-order policy. Nothing changed.'
    }
    $races = $settings.bannedEspmCharacterRaceIds
    if (-not $settings.Contains('bannedEspmCharacterRaceIds') -or $races -isnot [array] -or
        ($races.Count -ne 0 -and ($races.Count -ne 1 -or
            ($races[0] -isnot [long] -and $races[0] -isnot [int]) -or $races[0] -cne 1078794))) {
        throw 'Main has an unexpected placed-NPC race policy. Nothing changed.'
    }
    if ($settings.thornswoodLoadOrderRefuse -ceq $true -and $races.Count -eq 1) { return 'unchanged' }
    $backup = $file + '.before-6466'
    if (Test-Path -LiteralPath $backup) { throw 'This migration already has a backup; reconcile it before another change. Nothing changed.' }
    # Keep unrelated JSON values as JsonElements, including exact large
    # numbers: a PowerShell object round-trip can change their precision.
    $document = [System.Text.Json.Nodes.JsonNode]::Parse($text)
    $document['thornswoodLoadOrderRefuse'] = [System.Text.Json.Nodes.JsonValue]::Create([bool]$true)
    $document['bannedEspmCharacterRaceIds'] = [System.Text.Json.Nodes.JsonNode]::Parse('[1078794]')
    $next = $document.ToJsonString([System.Text.Json.JsonSerializerOptions]::new())
    $stage = $file + '.6466-' + [guid]::NewGuid().ToString('N')
    try {
        # Give an empty stage the original's ACL before writing any secrets.
        $empty = [IO.File]::Open($stage, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $empty.Dispose()
        if ($IsWindows) { Set-Acl -LiteralPath $stage -AclObject (Get-Acl -LiteralPath $file) -ErrorAction Stop }
        [IO.File]::WriteAllText($stage, $next, [Text.UTF8Encoding]::new($false))
        if ([IO.File]::ReadAllText($file) -cne $text) { throw 'Settings changed while staging. Nothing changed.' }
        [IO.File]::Replace($stage, $file, $backup)
        return 'staged'
    } finally {
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Force }
    }
}
