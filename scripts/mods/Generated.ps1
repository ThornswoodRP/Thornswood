<#
.SYNOPSIS
  Thornswood's animation and body files, for a script: what they are, what
  they were built from, whether the ones in a game folder are current, and
  the build itself. Dot-sourced by Build-Generated.ps1, Check-CoveredBodies.ps1
  and the harnesses.

.DESCRIPTION
  Issue #1247, and since 27 Oct 2026 #3715. The behavior files Pandora
  Behaviour Engine+ makes and the bodies BodySlide builds are built on each
  computer by the launcher, in Thornswood's own folder, from the collection's
  own Pandora, BodySlide and mods, and no release carries them (Patrick,
  option A: "The launcher makes all 45 files on each computer"). They are
  other people's work: the game's graphs with Precision's and True
  Directional Movement's patches merged in, and CBBE 3BA's, CBBE's and
  HIMBO's bodies (THIRD-PARTY.md).

  The code is the launcher's own, one copy: launcher\app\Generated.cs (the
  build list, the record and whether it is current), GeneratedBuild.cs (the
  build) and CoveredBodies.cs (the check that no body is nude, #405). This
  compiles those three, as Go.ps1 compiles FromGame*.cs, so a hand run, a
  harness and the launcher do the very same thing, and gives the functions
  the scripts and harnesses have always called. A refusal throws its
  sentence, as it always did.

  The record of a build, <Root>\Profile\OwnGame\generated.txt, is described
  in Generated.cs.
#>

# Compiles the launcher's three files once per session, with the Add-Type of
# pwsh 7, where every script runs (#5356), which has every assembly they use.
function Import-GeneratedTypes {
    if ('Thornswood.GeneratedBuild' -as [type]) { return }
    $app = Join-Path $PSScriptRoot '..\..\launcher\app'
    $files = @('Generated.cs', 'GeneratedBuild.cs', 'CoveredBodies.cs' | ForEach-Object { (Resolve-Path -LiteralPath (Join-Path $app $_)).Path })
    Add-Type -LiteralPath $files
}
Import-GeneratedTypes

# The sentence a refusal says, out of PowerShell's wrapping of the call that
# threw it.
function Get-GeneratedRefusal($ErrorRecord) {
    $e = $ErrorRecord.Exception
    while ($e -and -not ($e -is [Thornswood.GeneratedStop]) -and $e.InnerException) { $e = $e.InnerException }
    return $e.Message
}

function Get-GeneratedRecordPath([string]$Root) {
    return (Join-Path $Root 'Profile\OwnGame\generated.txt')
}

function Get-GeneratedFileSha([string]$Path) {
    return [Thornswood.Generated]::FileSha($Path)
}

# The record, or $null when there is none. Throws on a line it does not know,
# because a record read wrong would call a stale build current.
function Read-GeneratedRecord([string]$Path) {
    try { return [Thornswood.GeneratedRecord]::Read($Path) } catch { throw (Get-GeneratedRefusal $_) }
}

# Writes the record in one step (GeneratedRecord.Write, GeneratedOs.Replace:
# one MoveFileEx over the old record, #2586). Inputs and Files may be what the
# C# gives, or objects with the same names: Inputs.Sha and Inputs.Parts (in
# order), each file's Sha and Rel.
function Write-GeneratedRecord([string]$Path, [string]$Game, $Inputs, $Files) {
    $in = $Inputs
    if (-not ($in -is [Thornswood.GeneratedInputs])) {
        $in = New-Object Thornswood.GeneratedInputs
        $in.Sha = [string]$Inputs.Sha
        foreach ($k in @($Inputs.Parts.Keys)) { $in.Parts.Add((New-Object 'System.Collections.Generic.KeyValuePair[string,string]' ([string]$k), ([string]$Inputs.Parts[$k]))) }
    }
    $list = New-Object 'System.Collections.Generic.List[Thornswood.GeneratedFile]'
    foreach ($f in @($Files)) {
        $g = New-Object Thornswood.GeneratedFile
        $g.Sha = [string]$f.Sha
        $g.Rel = [string]$f.Rel
        $list.Add($g)
    }
    try { [Thornswood.GeneratedRecord]::Write($Path, $Game, $in, $list) } catch { throw (Get-GeneratedRefusal $_) }
}

# records\generated.json, checked. Throws with the sentence to show.
function Get-GeneratedBuildList([string]$Path) {
    try { return [Thornswood.GeneratedList]::Read($Path) } catch { throw (Get-GeneratedRefusal $_) }
}

# The files of Pandora's mod when Vortex deployed its archive loose into Data.
function Get-GeneratedLoosePandoraFiles([string]$Root) {
    try { return @([Thornswood.Generated]::LoosePandoraFiles($Root)) } catch { throw (Get-GeneratedRefusal $_) }
}

# The four parts a build depends on, each as a sha256, and all four together.
function Get-GeneratedInputs([string]$Root, [string]$ListPath) {
    try { return [Thornswood.Generated]::Inputs($Root, [Thornswood.GeneratedList]::Read($ListPath)) } catch { throw (Get-GeneratedRefusal $_) }
}

# Whether the generated files in <Root>\Game are current. Current is $true, or
# $false with Why saying each reason in plain words.
function Get-GeneratedState([string]$Root, [string]$ListPath) {
    try { return [Thornswood.Generated]::State($Root, [Thornswood.GeneratedList]::Read($ListPath)) } catch { throw (Get-GeneratedRefusal $_) }
}

# ------------------------------------------------------------ BodySlide sets

# One slider set, out of the .osp files in SliderSets. Throws when no .osp has
# it, or two do.
function Get-BodySlideSet([string]$SliderSetsDir, [string]$Name) {
    try { return [Thornswood.Generated]::Set($SliderSetsDir, $Name) } catch { throw (Get-GeneratedRefusal $_) }
}

# A set, as the C# takes it, from one or from an object with its names.
function ConvertTo-BodySlideSet($Set) {
    if ($Set -is [Thornswood.BodySlideSet]) { return $Set }
    $s = New-Object Thornswood.BodySlideSet
    $s.Name = [string]$Set.Name
    $s.OutputPath = [string]$Set.OutputPath
    $s.OutputFile = [string]$Set.OutputFile
    $s.GenWeights = [bool]$Set.GenWeights
    return $s
}

# Slider moves, as the C# takes them, from a hashtable of hashtables.
function ConvertTo-BodySlideMoves($Moves) {
    if ($null -eq $Moves) { return $null }
    if ($Moves -is [System.Collections.Generic.Dictionary[string, System.Collections.Generic.Dictionary[string, double]]]) { return $Moves }
    $d = New-Object 'System.Collections.Generic.Dictionary[string,System.Collections.Generic.Dictionary[string,double]]'
    foreach ($k in @($Moves.Keys)) {
        $one = New-Object 'System.Collections.Generic.Dictionary[string,double]'
        foreach ($size in @($Moves[$k].Keys)) { $one[[string]$size] = [double]$Moves[$k][$size] }
        $d[[string]$k] = $one
    }
    return , $d
}

# The files a slider set writes, under the game folder. An outfit that would
# write a body, or anything outside meshes, is refused (#2454).
function Get-BodySlideSetOutputs($Set) {
    try { return , @([Thornswood.Generated]::SetOutputs((ConvertTo-BodySlideSet $Set))) } catch { throw (Get-GeneratedRefusal $_) }
}

# Whether a path under the game folder is one of the bodies (#405 checks those).
function Test-GeneratedBodyPath([string]$Rel) {
    return [Thornswood.Generated]::IsBodyPath($Rel)
}

# Every slider of a set at the value it is built with.
function Get-BodySlideValues($Set, $Moves) {
    return , ([Thornswood.Generated]::Values($Set, (ConvertTo-BodySlideMoves $Moves)))
}

# What would break the body rules in a set built at these values (#1004, #405).
# Empty when the build keeps to the rules.
function Test-BodySlideRules($Set, $Values, $Moves) {
    return , ([Thornswood.Generated]::Rules($Set, $Values, (ConvertTo-BodySlideMoves $Moves)))
}
