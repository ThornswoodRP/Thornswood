<#
  Read-NexusFile.ps1

  Reads one file of a Nexus mod with Patrick's Nexus API key and says what a
  change to records\collection.json needs from it (#5189):

      pwsh scripts/release/Nexus-Run.ps1 -Line 'Read-NexusFile -Mod 9141 -FileId 23215'
      pwsh scripts/release/Read-NexusFile.ps1 -Mod 9141 -FileId 23215

  WHY. Adding a mod to the collection is a pull request to the record
  (docs\COLLECTION-CHANGES.md). The record needs each plugin's line, read from
  the plugin's own header, and for a mod with a FOMOD installer the answers
  Vortex gives its questions (the mod's "choices"). Until now both were read
  from the mod as Vortex had downloaded it on One, and One is retired. This
  reads them from the file itself, on GitHub's runner through Nexus-Run.ps1,
  so a cloud thread can write the change.

  WHAT IT SAYS:
    - the mod (name, author, category) and the file (name, version, its
      category on the Files tab), its md5 and size;
    - which installer Vortex would run for it, and for one with no questions
      the plugins it puts in Data;
    - for a FOMOD, every step, group and option in the order Vortex shows
      them, with the idx a collection's choices give each option and the
      files each one installs (Fomod.Describe in NexusLayout.cs). The choices
      are written from this, as docs\COLLECTION-CHANGES.md says;
    - every plugin in the archive, where it sits, and its line for the
      record's plugins (New-CollectionRecord.ps1 -Plugin), with "after" left
      for the change to fill in.
  The archive and everything unpacked from it are deleted before it ends: the
  files are the mod author's, read and never kept.

  Writes nothing anywhere. Exit 0 when the file was read, 1 when it stopped.

.PARAMETER Mod
  The mod's number on the website.

.PARAMETER FileId
  The file id, the number in the file's download link on the mod's Files tab.

.PARAMETER Game
  The game's domain on Nexus. skyrimspecialedition unless said otherwise.

.PARAMETER NoPause
  Does not wait for Enter at the end or on a stop.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Mod,
    [Parameter(Mandatory = $true)][string]$FileId,
    [string]$Game = 'skyrimspecialedition',
    [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Nexus.ps1')
. (Join-Path $Here 'NexusModPlan.ps1')
. (Join-Path $Here 'CollectionRecord.ps1')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
$script:Scratch = ''
function Clear-Read {
    if ($script:Scratch -and (Test-Path -LiteralPath $script:Scratch)) {
        if ('Thornswood.Layout.NexusLayout' -as [type]) { [Thornswood.Layout.NexusLayout]::Forget((Join-Path $script:Scratch 'unpacked')) }
        Remove-Item -LiteralPath $script:Scratch -Recurse -Force
    }
}
function Die($m) {
    Write-Host ''
    Write-Host "STOP. $m" -ForegroundColor Red
    Clear-Read
    if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
    exit 1
}
function Step([scriptblock]$b) { try { return (& $b) } catch { Die $_.Exception.Message } }

Write-Host ''
Write-Host '  THORNSWOOD  -  one file of a Nexus mod, for the collection record' -ForegroundColor White
if ($Mod -notmatch '^\d{1,9}$') { Die ('-Mod ' + $Mod + ' is not a mod number.') }
if ($FileId -notmatch '^\d{1,12}$') { Die ('-FileId ' + $FileId + ' is not a file id.') }
if ($Game -notmatch '^[a-z0-9]+$') { Die ('-Game ' + $Game + ' is not a game domain.') }
if ($PSVersionTable.PSVersion.Major -lt 7) { Die 'This needs PowerShell 7 (pwsh): NexusLayout.cs reads JSON with System.Text.Json.' }
[void](Step { Read-NexusKey })
Say ('  key from ' + $script:NexusKeyFrom) 'DarkGray'
$sz = Find-SevenZip
if (-not $sz) { Die '7-Zip is not on this machine (7z.exe in Program Files, or 7z, 7zz or 7za on PATH), and mod archives are unpacked with it.' }

# The mod and the file, as New-NexusRevision.ps1 -Add reads them.
$lq = '{ legacyModsByDomain(ids: [{gameDomain: "' + $Game + '", modId: ' + $Mod + '}]) { nodes { modId name author modCategory { name } } } }'
$modNode = @(Get-NexusField (Get-NexusField (Step { Invoke-NexusGraph $lq $null ('Reading mod ' + $Mod) }) 'legacyModsByDomain') 'nodes') | Select-Object -First 1
if (-not $modNode) { Die ('Nexus has no mod ' + $Mod + ' on ' + $Game + '.') }
$info = Step { Get-NexusField (Invoke-NexusApi 'GET' ('/v3/games/' + $Game + '/mods/' + $Mod) '' ('Reading mod ' + $Mod)) 'data' }
$uid = [string](Get-NexusField $info 'id')
$v = Step { Get-NexusField (Invoke-NexusApi 'GET' ('/v3/games/' + $Game + '/mod-file-versions/' + $FileId) '' ('Reading file id ' + $FileId)) 'data' }
$vFile = [string](Get-NexusField (Get-NexusField $v 'file') 'id')
$files = @(@(Get-NexusField (Get-NexusField (Step { Invoke-NexusApi 'GET' ('/v3/mods/' + $uid + '/files') '' ('Reading the files of mod ' + $Mod) }) 'data') 'mod_files') | Where-Object { $_ })
if (-not @($files | Where-Object { [string](Get-NexusField $_ 'id') -eq $vFile }).Count) { Die ('File id ' + $FileId + ' is not a file of mod ' + $Mod + '.') }
Head ('Mod ' + $Mod + ', file ' + $FileId)
Say ('  "' + (Get-NexusField $modNode 'name') + '" by ' + (Get-NexusField $modNode 'author') + ', ' + (Get-NexusField (Get-NexusField $modNode 'modCategory') 'name'))
Say ('  file "' + (Get-NexusField $v 'name') + '" ' + (Get-NexusField $v 'version') + ', ' + (Get-NexusField $v 'category'))

$script:Scratch = Join-Path (& (Join-Path $Here 'Get-ScratchDir.ps1') ('nexus-file-' + $Mod)) $FileId
Clear-Read
New-Item -ItemType Directory -Force -Path $script:Scratch | Out-Null
$got = Step { Get-NexusFileArchive $Game $FileId $script:Scratch }
Say ('  ' + $got.Name + ', ' + $got.Size.ToString('N0') + ' bytes, md5 ' + $got.Md5Hex) 'DarkGray'

$mp = Step { Get-NexusModPlan -SevenZip $sz -Archive $got.Path -Work $script:Scratch -Choices $null }
Remove-Item -LiteralPath $got.Path -Force

Head 'How Vortex installs it'
if ($mp.Fomod) {
    Say '  a FOMOD script, so the collection gives its answers as the mod''s "choices":'
    foreach ($line in (Get-NexusFomodQuestions $mp)) { Say ('  ' + $line) }
}
elseif ($mp.Plan.Stop) { Say ('  not unattended: ' + $mp.Plan.Stop) 'Yellow' }
else {
    Say ('  ' + $(if ($mp.Plan.Installer) { $mp.Plan.Installer } else { 'the basic installer' }) + ', no questions; it puts these plugins in Data:')
    foreach ($p in (Get-NexusPlanPlugins $mp)) { Say ('    ' + $p.Name) }
}

Head 'Every plugin in the archive, with its line for the record'
$all = @(Get-ChildItem -LiteralPath $mp.Unpacked -Recurse -File | Where-Object { $_.Name -match '\.(esp|esm|esl)$' } | Sort-Object FullName)
if (-not $all.Count) { Say '  none' }
foreach ($f in $all) {
    Say ('  ' + $f.FullName.Substring($mp.Unpacked.Length + 1).Replace('/', '\'))
    $line = ConvertTo-CollectionPluginLine $f.FullName
    Say $(if ($line) { $line } else { '    (no TES4 header: placed by its name alone)' }) 'DarkGray'
}

Clear-Read
Write-Host ''
Say 'Read. The archive and what was unpacked from it are deleted.' 'Green'
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit 0
