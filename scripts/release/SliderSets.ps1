<#
  SliderSets.ps1

  What BodySlide's slider set files in a layout say, as metadata only (#5888).
  Install-NexusRevision.ps1 dot-sources this and writes slidersets.json beside
  a layout's other records: for each .osp the layout places under
  Data\CalienteTools\BodySlide\SliderSets, its path, its sha256 and size
  (files.txt's, from the file's own bytes), the Nexus file it came from, and
  each slider set in it with its name, OutputPath, OutputFile and GenWeights.
  No .osp is copied or kept: the sets are read while the unpacked copy is
  there, and only what is said above goes in the record.

  GenWeights is read as the launcher reads it (launcher\app\Generated.cs):
  true only when OutputFile's GenWeights attribute is "true".
#>

# A slider set file's path in Data, the way the mod plan gives it.
$script:SliderSetRel = '^(?i)CalienteTools\\BodySlide\\SliderSets\\[^\\]+\.osp$'

function Test-SliderSetRel([string]$Rel) { return ($Rel -match $script:SliderSetRel) }

# The slider sets one .osp holds, in file order. Throws, naming the file, on
# a file that is not a SliderSetInfo or a set with no name. No DTD and no
# outside reference is read.
function Read-SliderSetFile([string]$Path, [string]$Name) {
  $settings = New-Object Xml.XmlReaderSettings
  $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $doc = New-Object Xml.XmlDocument
  $doc.XmlResolver = $null
  $reader = [Xml.XmlReader]::Create($Path, $settings)
  try { $doc.Load($reader) }
  catch { throw ($Name + ' is not XML BodySlide reads: ' + $_.Exception.Message) }
  finally { $reader.Dispose() }
  if (-not $doc.DocumentElement -or $doc.DocumentElement.Name -ne 'SliderSetInfo') { throw ($Name + ' is not a slider set file: its first element is not SliderSetInfo.') }
  $sets = New-Object System.Collections.Generic.List[object]
  foreach ($s in $doc.SelectNodes('/SliderSetInfo/SliderSet')) {
    $nm = $s.GetAttribute('name')
    if (-not $nm) { throw ($Name + ' has a slider set with no name.') }
    $op = $s.SelectSingleNode('OutputPath')
    $of = $s.SelectSingleNode('OutputFile')
    $sets.Add([ordered]@{
        name       = $nm
        outputPath = $(if ($op) { $op.InnerText.Trim() } else { '' })
        outputFile = $(if ($of) { $of.InnerText.Trim() } else { '' })
        genWeights = [bool]($of -and $of.GetAttribute('GenWeights') -eq 'true')
      })
  }
  return , $sets
}

# The record: every placed slider set file, by path ignoring case. $Placed is
# what the deployment placed (Rel, Full, Entry, Size, Sha256), $Read the sets
# read from each unpacked copy by its path, $Entries the collection's entries
# by index.
function New-SliderSetRecord([string]$Slug, $Revision, $Placed, $Read, $Entries) {
  $rows = New-Object 'System.Collections.Generic.List[object]'
  foreach ($x in $Placed) {
    if ($x.Rel -notmatch '^Data\\(.+)$' -or -not (Test-SliderSetRel $Matches[1])) { continue }
    if (-not $Read.ContainsKey($x.Full)) { throw ($x.Rel + ' was not read before its unpacked copy went, so its slider sets are not known.') }
    $e = $Entries[$x.Entry]
    $sets = [object[]]@($Read[$x.Full] | ForEach-Object { $_ })
    $row = [ordered]@{}
    $row['path'] = [string]$x.Rel
    $row['sha256'] = [string]$x.Sha256
    $row['size'] = [long]$x.Size
    $row['modId'] = [long]$e.ModId
    $row['fileId'] = [long]$e.FileId
    $row['sets'] = $sets
    $rows.Add($row)
  }
  $rows.Sort([Comparison[object]] { param($a, $b) [StringComparer]::OrdinalIgnoreCase.Compare($a.path, $b.path) })
  $out = [ordered]@{}
  $out['schema'] = 1
  $out['tool'] = 'scripts\release\Install-NexusRevision.ps1'
  $out['collection'] = $Slug
  $out['revision'] = $Revision
  $out['files'] = [object[]]$rows.ToArray()
  return $out
}
