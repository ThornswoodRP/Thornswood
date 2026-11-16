<#
  World.ps1

  Where a game server keeps its world, and how a tool works on it (#6237).
  Dot-source it; $ThornswoodWorld is the same functions as text, for a step
  that runs on the box (Windows PowerShell 5.1 or PowerShell 7), with
  world.js inside it, so a tool sent to the box carries the copy it was
  tested with.

  A server's server-settings.json says where its world is:
    databaseDriver "file" (or none)   <root>\<databaseName or world>\changeForms,
                                      one file per form, as before.
    databaseDriver "mongodb"          the changeForms collection of
                                      databaseName in the box's MongoDB,
                                      signed in to with databaseUriFile
                                      (C:\Thornswood-Mongo\access\<user>.uri,
                                      Mongo.ps1).

  A tool that changes a world does it the same way for both:

      $w = Open-ThornswoodWorld $Root $Stamp     # STOP|... on failure
      ... reads and changes the files in $w.Forms, moving what it throws
          away into $w.Forms\_discarded-<stamp> as it always has ...
      Save-ThornswoodWorld $w                    # WORLDSAVED|... or STOP|...

  For the file driver $w.Forms is the server's own folder and Save has
  nothing to do. For MongoDB, Open reads every form out (world.js export)
  into <root>\world-mongo-<stamp>\changeForms, laid out the way the file
  driver lays out a world, and Save writes back what the tool changed there
  (world.js apply, mode changes): a changed file replaces its form, a new
  one adds one, and one moved away takes its form out. What was moved away
  stays in that folder on disk, as it did beside the files, and nothing is
  taken out of the database before it is there. Once written, the forms read
  out go, so the only copies left are the ones set aside, which
  server-log.js deletes after 30 days and Delete-Person.ps1 reaches, as
  beside the files. The server must be stopped from Open to Save; Save
  refuses, with nothing written, when a form it would write changed in the
  database meanwhile, and leaves the folder as it is to be saved again.

  Every line these return is one a caller prints or reads:
    WORLD|<driver>|<forms folder>          what Open opened
    WORLDSAVED|<driver>|<written>|<added>|<removed>|<count after>
    STOP|<why>                             nothing was changed
#>

$ThornswoodWorldFunctions = @'
# ---- the world (scripts\deploy\World.ps1, #6237) ----
# The box's mongosh (Install-Mongo.ps1); THORNSWOOD_MONGOSH names another
# for a harness on a machine without one there.
$ThornswoodMongoShell = 'C:\Thornswood-Mongo\bin\mongosh.exe'
if ($env:THORNSWOOD_MONGOSH) { $ThornswoodMongoShell = $env:THORNSWOOD_MONGOSH }
# The settings a world is found by, or a STOP line.
function Get-ThornswoodWorld([string]$Root) {
  $settings = Join-Path $Root 'server-settings.json'
  $cfg = $null
  if (Test-Path -LiteralPath $settings) {
    try { $cfg = [IO.File]::ReadAllText($settings) -replace '^\uFEFF', '' | ConvertFrom-Json }
    catch { return @{ Stop = ($settings + ' will not read, so where the world is kept is not known: ' + $_.Exception.Message) } }
  }
  # Read by name, so a script in strict mode reads a setting that is not there as none.
  $get = { param($n) if ($cfg -and $cfg.PSObject.Properties[$n]) { [string]$cfg.PSObject.Properties[$n].Value } else { '' } }
  $driver = & $get 'databaseDriver'
  if (-not $driver) { $driver = 'file' }
  if ($driver -eq 'file') {
    $name = & $get 'databaseName'
    if (-not $name) { $name = 'world' }
    return @{ Stop = ''; Driver = 'file'; Root = $Root; Forms = (Join-Path (Join-Path $Root $name) 'changeForms') }
  }
  if ($driver -ne 'mongodb') { return @{ Stop = ($settings + ' names the database driver ' + $driver + ', which no tool here reads') } }
  $db = & $get 'databaseName'
  $uri = & $get 'databaseUriFile'
  if ($db -notmatch '^thornswood-[a-z]+$') { return @{ Stop = ($settings + ' names no world database (databaseName ' + $db + ')') } }
  if (-not $uri) { return @{ Stop = ($settings + ' names no databaseUriFile, the connection file a tool signs in with') } }
  return @{ Stop = ''; Driver = 'mongodb'; Root = $Root; Db = $db; UriFile = $uri; Forms = ''; Manifest = ''; Exported = 0 }
}
# Runs world.js with a plan, and hands back its lines. The plan names the
# connection file; the password is read inside mongosh and never printed.
function Invoke-ThornswoodWorldJs($Plan) {
  if (-not (Test-Path -LiteralPath $ThornswoodMongoShell)) { return @('WORLD FAILED: ' + $ThornswoodMongoShell + ' is not there; Install-Mongo puts it there') }
  $dir = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-world-' + [Guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($dir)
  $old = $env:THORNSWOOD_WORLD_PLAN
  try {
    $js = Join-Path $dir 'world.js'
    $planFile = Join-Path $dir 'plan.json'
    [IO.File]::WriteAllText($js, $ThornswoodWorldJs, (New-Object Text.UTF8Encoding $false))
    [IO.File]::WriteAllText($planFile, ($Plan | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
    $env:THORNSWOOD_WORLD_PLAN = $planFile
    $out = @(& $ThornswoodMongoShell --nodb --quiet --file $js 2>&1 | ForEach-Object { "$_" })
    if ($LASTEXITCODE -ne 0 -and -not @($out | Where-Object { $_ -like 'WORLD FAILED:*' }).Count) { $out += ('WORLD FAILED: mongosh exited with ' + $LASTEXITCODE) }
    return $out
  } finally {
    $env:THORNSWOOD_WORLD_PLAN = $old
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
function Open-ThornswoodWorld([string]$Root, [string]$Stamp) {
  $w = Get-ThornswoodWorld $Root
  if ($w.Stop) { return @{ Stop = $w.Stop } }
  if ($w.Driver -eq 'file') { return $w }
  $dir = Join-Path $Root ('world-mongo-' + $Stamp)
  $w.Forms = Join-Path $dir 'changeForms'
  $w.Manifest = Join-Path $dir 'export.json'
  $out = @(Invoke-ThornswoodWorldJs @{ op = 'export'; uri = $w.UriFile; db = $w.Db; to = $w.Forms; manifest = $w.Manifest })
  $done = @($out | Where-Object { $_ -like 'EXPORTED|*' })
  if (-not $done.Count) { return @{ Stop = ('the world in ' + $w.Db + ' could not be read out: ' + (($out | Where-Object { $_ }) -join ' ')) } }
  $w.Exported = [int](($done[0] -split '\|')[1])
  return $w
}
# What Save writes for MongoDB, said the same way for both drivers.
function Save-ThornswoodWorld($World) {
  if ($World.Driver -eq 'file') { return 'WORLDSAVED|file|0|0|0|0' }
  $out = @(Invoke-ThornswoodWorldJs @{ op = 'apply'; uri = $World.UriFile; db = $World.Db; from = $World.Forms; manifest = $World.Manifest; mode = 'changes' })
  $done = @($out | Where-Object { $_ -like 'APPLIED|*' })
  if (-not $done.Count) { return ('STOP|the changes in ' + $World.Forms + ' were not written to ' + $World.Db + ': ' + (($out | Where-Object { $_ }) -join ' ')) }
  # Written: the forms read out are what the database holds now, so that
  # copy goes, and what is left is what the tool set aside, as beside the
  # files (#2351: a person's deletion reaches every copy there is).
  foreach ($f in @(Get-ChildItem -LiteralPath $World.Forms -Filter *.json -File)) { Remove-Item -LiteralPath $f.FullName -Force }
  Remove-Item -LiteralPath $World.Manifest -Force
  return ('WORLDSAVED|mongodb|' + (($done[0] -split '\|', 2)[1]))
}
# The world as a restore puts it back: the database made to hold exactly
# the forms in $Forms. File-driver servers are restored by copying the
# folder, which the caller does.
function Restore-ThornswoodWorld($World, [string]$Forms) {
  $out = @(Invoke-ThornswoodWorldJs @{ op = 'apply'; uri = $World.UriFile; db = $World.Db; from = $Forms; mode = 'replace' })
  $done = @($out | Where-Object { $_ -like 'APPLIED|*' })
  if (-not $done.Count) { return ('STOP|' + $Forms + ' was not put into ' + $World.Db + ': ' + (($out | Where-Object { $_ }) -join ' ')) }
  return ('WORLDSAVED|mongodb|' + (($done[0] -split '\|', 2)[1]))
}
# The restore rehearsal's world or the load test's, emptied (world.js
# refuses any other): EMPTIED|<forms it held>, or STOP|<why>.
function Clear-ThornswoodScratchWorld($World) {
  $out = @(Invoke-ThornswoodWorldJs @{ op = 'empty'; uri = $World.UriFile; db = $World.Db })
  $done = @($out | Where-Object { $_ -like 'EMPTIED|*' })
  if (-not $done.Count) { return ('STOP|' + $World.Db + ' was not emptied: ' + (($out | Where-Object { $_ }) -join ' ')) }
  return $done[0]
}
# How many forms and characters a MongoDB world holds: COUNT|<forms>|<characters>.
function Get-ThornswoodWorldCount($World) {
  $out = @(Invoke-ThornswoodWorldJs @{ op = 'count'; uri = $World.UriFile; db = $World.Db })
  $done = @($out | Where-Object { $_ -like 'COUNT|*' })
  if (-not $done.Count) { return ('STOP|' + $World.Db + ' could not be counted: ' + (($out | Where-Object { $_ }) -join ' ')) }
  return $done[0]
}
'@

$ThornswoodWorldJsPath = Join-Path $PSScriptRoot '..\vps\world.js'
$ThornswoodWorldJs = [IO.File]::ReadAllText($ThornswoodWorldJsPath)
if ($ThornswoodWorldJs -match "(?m)^'@") { throw "world.js has a line starting with '@, which would end the text it is carried in" }
. ([scriptblock]::Create($ThornswoodWorldFunctions))
$ThornswoodWorld = $ThornswoodWorldFunctions + "`r`n`$ThornswoodWorldJs = @'`r`n" + $ThornswoodWorldJs + "`r`n'@`r`n# ---- end of the world ----`r`n"
