<#
  NexusModPlan.ps1

  What Vortex would install from one mod archive, worked out the way
  Install-NexusRevision.ps1 lays a whole revision out (NexusLayout.cs), for a
  mod the collection does not carry yet (#5189):

      . .\scripts\release\NexusModPlan.ps1
      $plan = Get-NexusModPlan -SevenZip $sz -Archive <archive> -Work <empty folder> -Choices $choices
      Get-NexusPlanPlugins $plan          the plugins it puts at the top of Data
      Get-NexusFomodQuestions $plan       what its FOMOD script asks, a line each

  WHY. New-NexusRevision.ps1 -Add refused every archive with a FOMOD
  installer, because the installer's answers were Vortex's to work out on
  One. One is retired, and NexusLayout.cs already runs a FOMOD script with a
  collection's choices exactly as Vortex does when it installs a revision. So
  a mod with an installer is added with its choices written down
  (records\collection.json, a mod's "choices"), and the plugins those
  choices put in Data are worked out here, before the revision is drafted,
  from the same code that lays the draft out after.

  Get-NexusModPlan unpacks the archive into -Work, which the caller clears,
  and returns
    { Plan; Unpacked; Fomod }
  Plan is NexusLayout's ModPlan (Stop says why Vortex would not install it
  unattended), Fomod the path of its fomod\ModuleConfig.xml, or '' when it
  has none. -Choices is a collection's choices object as Vortex writes it,
  { type: "fomod", options: [ { name, groups: [ { name, choices: [ { name, idx } ] } ] } ] },
  or $null.

  A FOMOD's questions about the game are answered from
  records\skyrim-files.json, as Install-NexusRevision.ps1 answers them
  (New-NexusFomodWorld).

  Needs PowerShell 7: NexusLayout.cs reads JSON with System.Text.Json.
#>

$script:NexusModPlanHere = $PSScriptRoot
if (-not $script:NexusModPlanHere) { $script:NexusModPlanHere = Split-Path -Parent $MyInvocation.MyCommand.Definition }

function Use-NexusLayout {
    if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'This needs PowerShell 7 (pwsh): NexusLayout.cs reads JSON with System.Text.Json, which Windows PowerShell 5.1 does not have.' }
    if (-not ('Thornswood.Layout.NexusLayout' -as [type])) { Add-Type -LiteralPath (Join-Path $script:NexusModPlanHere 'NexusLayout.cs') | Out-Null }
}

# The game as a FOMOD script sees it while a collection installs: the game's
# own plugins, all active, and its build (records\skyrim-files.json).
function New-NexusFomodWorld([string]$SkyrimRecord) {
    Use-NexusLayout
    if (-not $SkyrimRecord) { $SkyrimRecord = Join-Path $script:NexusModPlanHere '..\..\records\skyrim-files.json' }
    if (-not (Test-Path -LiteralPath $SkyrimRecord -PathType Leaf)) { throw ('There is no ' + $SkyrimRecord + ', and it is what a FOMOD''s questions about the game are answered from.') }
    $world = New-Object Thornswood.Layout.Fomod+World
    $sky = Get-Content -Raw -LiteralPath $SkyrimRecord | ConvertFrom-Json
    foreach ($p in $sky.files.PSObject.Properties.Name) {
        if ($p -match '^Data\\([^\\]+\.(esm|esp|esl))$') { [void]$world.Present.Add($Matches[1]); [void]$world.Active.Add($Matches[1]) }
    }
    $world.GameVersion = [string]$sky.build
    if (([string]$sky.build).Split('.').Count -eq 3) { $world.GameVersion = [string]$sky.build + '.0' }
    return $world
}

# A collection's choices object held to the shape Vortex writes, one
# sentence per thing wrong with it.
function Get-NexusChoicesProblems($Choices) {
    $out = New-Object Collections.Generic.List[string]
    if ($null -eq $Choices) { $out.Add('there are no choices'); return $out.ToArray() }
    if ([string]$Choices.type -cne 'fomod') { $out.Add('choices.type is "' + $Choices.type + '", not "fomod"') }
    if (-not ($Choices.options -is [array]) -or -not @($Choices.options).Count) { $out.Add('choices.options is not a list of steps'); return $out.ToArray() }
    foreach ($s in @($Choices.options)) {
        if (-not ($s.name -is [string])) { $out.Add('a step in choices has no name') ; continue }
        if (-not ($s.groups -is [array])) { $out.Add('step "' + $s.name + '" has no list of groups'); continue }
        foreach ($g in @($s.groups)) {
            if (-not ($g.name -is [string])) { $out.Add('a group of step "' + $s.name + '" has no name'); continue }
            if (-not ($g.choices -is [array])) { $out.Add('group "' + $g.name + '" of step "' + $s.name + '" has no list of choices'); continue }
            foreach ($c in @($g.choices)) {
                if (-not ($c.name -is [string]) -or -not ($c.idx -is [int] -or $c.idx -is [long]) -or $c.idx -lt 0) { $out.Add('a choice in group "' + $g.name + '" of step "' + $s.name + '" is not { name, idx }') }
            }
        }
    }
    return $out.ToArray()
}

function ConvertTo-NexusPresetSteps($Choices) {
    $steps = New-Object 'System.Collections.Generic.List[Thornswood.Layout.PresetStep]'
    foreach ($s in @($Choices.options)) {
        $ps = New-Object Thornswood.Layout.PresetStep
        $ps.Name = [string]$s.name
        foreach ($g in @($s.groups)) {
            $pg = New-Object Thornswood.Layout.PresetGroup
            $pg.Name = [string]$g.name
            foreach ($c in @($g.choices)) {
                $pc = New-Object Thornswood.Layout.PresetChoice
                $pc.Name = [string]$c.name; $pc.Idx = [long]$c.idx
                $pg.Choices.Add($pc)
            }
            $ps.Groups.Add($pg)
        }
        $steps.Add($ps)
    }
    return , $steps
}

function Get-NexusModPlan([string]$SevenZip, [string]$Archive, [string]$Work, $Choices, $World) {
    Use-NexusLayout
    if (-not $World) { $World = New-NexusFomodWorld }
    $u = Join-Path $Work 'unpacked'
    if (Test-Path -LiteralPath $u) { [Thornswood.Layout.NexusLayout]::Forget($u); Remove-Item -LiteralPath $u -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $u | Out-Null
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $SevenZip
    foreach ($a in @('x', '-y', '-ssc-', ('-o' + $u), $Archive)) { $psi.ArgumentList.Add($a) }
    $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $p = [Diagnostics.Process]::Start($psi)
    $err = $p.StandardError.ReadToEndAsync()
    [void]$p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { throw ('7-Zip could not unpack ' + $Archive + ', exit ' + $p.ExitCode + ': ' + ($err.Result.Trim() -replace '\s+', ' ')) }
    [void][Thornswood.Layout.NexusLayout]::SplitBackslashNames($u)
    # Off Windows the walk names a folder the archive spells two ways as its
    # first entry does, as Install-NexusRevision.ps1 gives it (FileList).
    $order = $null
    if (-not $IsWindows) {
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = $SevenZip
        foreach ($a in @('l', '-slt', $Archive)) { $psi.ArgumentList.Add($a) }
        $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
        $p = [Diagnostics.Process]::Start($psi)
        $err = $p.StandardError.ReadToEndAsync()
        $listed = $p.StandardOutput.ReadToEnd()
        $p.WaitForExit()
        if ($p.ExitCode -ne 0) { throw ('7-Zip could not list ' + $Archive + ', exit ' + $p.ExitCode + ': ' + ($err.Result.Trim() -replace '\s+', ' ')) }
        $after = $false
        $paths = New-Object Collections.Generic.List[string]
        foreach ($line in ($listed -split "`r?`n")) {
            if ($line -eq '----------') { $after = $true; continue }
            if ($after -and $line.StartsWith('Path = ')) { $paths.Add($line.Substring(7)) }
        }
        $order = $paths.ToArray()
    }
    $files = [Thornswood.Layout.NexusLayout]::FileList($u, [string[]]$order)
    $e = New-Object Thornswood.Layout.Entry
    $e.Name = [IO.Path]::GetFileName($Archive)
    if ($null -ne $Choices) { $e.ChoicesType = [string]$Choices.type; $e.Choices = ConvertTo-NexusPresetSteps $Choices }
    $plan = [Thornswood.Layout.NexusLayout]::PlanMod($e, $u, $files, $World)
    $fomod = @($files | Where-Object { $_ -match '(^|\\)fomod\\moduleconfig\.xml$' }) | Select-Object -First 1
    return [pscustomobject]@{ Plan = $plan; Unpacked = $u; Fomod = $(if ($fomod) { [Thornswood.Layout.NexusLayout]::OnDisk($u, $fomod) } else { '' }) }
}

# The plugins a plan puts at the top of the mod's folder, which is Data for
# a mod of the default type: name (as the installer spells it) and the file
# that holds its bytes.
function Get-NexusPlanPlugins($ModPlan) {
    return @($ModPlan.Plan.Files.Values | Where-Object { $_.Rel -match '^[^\\]+\.(esp|esm|esl)$' } | Sort-Object { $_.Rel.ToLowerInvariant() } | ForEach-Object { [pscustomobject]@{ Name = $_.Rel; Full = $_.Full } })
}

function Get-NexusFomodQuestions($ModPlan) {
    if (-not $ModPlan.Fomod) { return @() }
    return @([Thornswood.Layout.Fomod]::Describe($ModPlan.Fomod))
}
