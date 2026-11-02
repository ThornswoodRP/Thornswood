<#
  test-459-publish-record.ps1

  A full server publish records what the box now runs, and a put-back records
  what came back (#459, #2303).

  WHY THIS EXISTS. Publish-Server.ps1 put a new server on the box and wrote no
  record of it. Measured 30 Sep on dev: with 32dea10d installed, the box's
  data\thornswood-deploy.json still named the gamemode artifact e445101a,
  because the installer carried that file from the old folder into the new
  one as if it were runtime data. On 1 Oct a fresh build installed with no
  thornswood-build.json at all. And only Deploy-Server.ps1 wrote the site's
  deployed-build.json, so on 11 Oct, with the engine on dev through
  Publish-Server, the file held live alone and the credits page kept a hand
  sentence naming the engine the main server had left.

  HOW. Each part is run, not read, where it can be, against scratch folders:
    1. Set-ThornswoodServerRecord (Artifact.ps1): its text for the box runs
       on Windows under PowerShell 7, the box's PowerShell since #5356, with
       Invoke-ThornswoodArtifactRemote stood in. A root
       whose gamemode.js and stamp are the artifact's is recorded, beside it
       and in the store, with a history line; a wrong gamemode.js, a missing
       or wrong stamp, no gamemode.js, or an artifact with no gamemode each
       record nothing and say why.
    2. Restore-ThornswoodServerRecord, after a put-back: a folder whose record
       the store's artifact confirms becomes current; a folder carrying a
       record that does not describe its gamemode.js, and one with none, are
       recorded as older copies with no commit; a store that is not there yet
       is made.
    3. The installer's Carry, lifted from Install-ThornswoodServer.ps1 and run:
       runtime data crosses, the deploy record stays with its folder, both
       ways.
    4. Export-ServerPayload.ps1 -Stamp, run on a scratch build: the payload's
       thornswood-build.json is the stamp it was given, and the build's own is
       left alone.
    5. Publish-Server.ps1, read: the artifact after the committed check, the
       gamemode from it, the stamp for the channel beside it, the payload held
       to both before anything is sent, and the records only once the
       installer has said INSTALL OK, a record not written stopping the run.

  Offline. PowerShell 7. Every temp folder is removed.
#>
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Repo = Split-Path -Parent $Here
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
  $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $path))
  [IO.File]::WriteAllText($path, $text, $utf8)
}
function Sha([string]$path) { return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
function TextSha([string]$text) {
  $h = [Security.Cryptography.SHA256]::Create()
  try { return (($h.ComputeHash($utf8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
}
function ReadJson([string]$path) { if (-not (Test-Path -LiteralPath $path)) { return $null }; return ([IO.File]::ReadAllText($path) | ConvertFrom-Json) }

. (Join-Path $Repo 'scripts\deploy\Artifact.ps1')

# The box's PowerShell: the text goes up as a file and runs under PowerShell
# 7, as Send-Script.ps1 has it run on the VPS since #5356. The far side's
# store is Windows paths (run on Linux it wrote a file named
# \tmp\...\thornswood-server-dev.json into the working folder), so sections
# 1 to 3 say SKIP off Windows.
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
$script:sent = @()
function Invoke-ThornswoodArtifactRemote([string]$Target, [string[]]$SshArgs, [string]$Script) {
  $script:sent += , @($Target, $Script)
  $f = Join-Path ([IO.Path]::GetTempPath()) ('ts-459-far-' + [Guid]::NewGuid().ToString('N') + '.ps1')
  [IO.File]::WriteAllText($f, $Script, (New-Object Text.UTF8Encoding($true)))
  try { return @(& $boxPs -NoProfile -ExecutionPolicy Bypass -File $f 2>&1 | ForEach-Object { "$_".Trim() }) }
  finally { Remove-Item -LiteralPath $f -Force -EA SilentlyContinue }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-459-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
  $store = Join-Path $tmp 'Thornswood-Deploys'
  $root = Join-Path $tmp 'Thornswood-Server-Dev'
  $gmText = '// the gamemode at the commit'
  $gmSha = TextSha $gmText
  # An artifact as New-ThornswoodArtifact hands one back, for the parts a
  # record is made from.
  function Fake-Artifact([string]$sha, [string]$commit = ('c' * 40), [string]$path = 'game/gamemode.js') {
    $zipSha = TextSha ('zip of ' + $sha)
    $name = 'gamemode-' + $commit.Substring(0, 12) + '-' + $zipSha.Substring(0, 16) + '.zip'
    return [pscustomobject]@{
      Component = 'gamemode'; Name = $name; Commit = $commit; Short = $commit.Substring(0, 12); Sha256 = $zipSha; Size = 123
      Record = [ordered]@{ component = 'gamemode'; name = $name; commit = $commit; sha256 = $zipSha; size = 123
                           files = @([ordered]@{ path = $path; size = 10; sha256 = $sha }) }
    }
  }
  # What Send-ThornswoodArtifact leaves in the store: the artifact's record.
  function Put-StoreRecord($a) { Put (Join-Path $store ('gamemode\' + $a.Name.Replace('.zip', '.json'))) (ConvertTo-Json -InputObject $a.Record -Depth 5) }
  function Put-Root([string]$dir, [string]$gm, [string]$stampSha) {
    Put (Join-Path $dir 'gamemode.js') $gm
    if ($stampSha) { Put (Join-Path $dir 'thornswood-build.json') ('{ "channel": "dev", "commit": "cccccccccccc", "gamemodeSha256": "' + $stampSha + '" }') }
    else { Remove-Item -LiteralPath (Join-Path $dir 'thornswood-build.json') -Force -EA SilentlyContinue }
  }
  $beside = Join-Path $root 'data\thornswood-deploy.json'
  $current = Join-Path $store 'current\thornswood-server-dev.json'
  $history = Join-Path $store 'history.log'

  # ---- 1. a publish ------------------------------------------------------------
  if (-not $OnWindows) {
      Write-Host 'SKIP  1 to 3, a publish, a put-back and the installer''s Carry: the far side writes the store on the box''s Windows paths, with \ between folders, so only Windows can run it'
  } else {
      Write-Host ''; Write-Host 'a publish that answered'
      New-Item -ItemType Directory -Force -Path (Join-Path $store 'current'), (Join-Path $store 'gamemode') | Out-Null
      $a1 = Fake-Artifact $gmSha
      Put-StoreRecord $a1
      Put-Root $root $gmText $gmSha
      $said = @(Set-ThornswoodServerRecord -Artifact $a1 -Target 'u@box' -SshArgs @() -Root $root -Store $store)
      Yes 'a root whose gamemode.js and stamp are the artifact''s is recorded' ($said -contains ('SERVER RECORDED ' + $a1.Name))
      $b = ReadJson $beside; $c = ReadJson $current
      Yes '  beside it, in data, naming the artifact and its commit' ($b -and $b.name -eq $a1.Name -and $b.commit -eq $a1.Commit -and $b.part -eq 'thornswood-server-dev' -and $b.component -eq 'gamemode')
      Yes '  and the store''s current record is the same' ($c -and [IO.File]::ReadAllText($current) -eq [IO.File]::ReadAllText($beside))
      Yes '  with no byte order mark (node reads it)' ([IO.File]::ReadAllBytes($beside)[0] -eq [byte][char]'{')
      Yes '  and a line in history.log' ((Test-Path -LiteralPath $history) -and ([IO.File]::ReadAllText($history) -match [regex]::Escape('thornswood-server-dev ' + $a1.Name + ' from ')))
      $err = $null; $null = [Management.Automation.PSParser]::Tokenize($script:sent[-1][1], [ref]$err)
      Yes '  through the one remote helper, to the target it was given, as text that parses' ($script:sent.Count -eq 1 -and $script:sent[-1][0] -eq 'u@box' -and $err.Count -eq 0)

      $before = [IO.File]::ReadAllText($beside)
      $a2 = Fake-Artifact (TextSha '// another gamemode') ('d' * 40)
      foreach ($case in @(
          @{ Label = 'a gamemode.js that is not the artifact''s'; Gm = '// something else'; Stamp = $gmSha; Why = 'is not the one in' },
          @{ Label = 'no stamp'; Gm = $gmText; Stamp = ''; Why = 'does not describe that gamemode' },
          @{ Label = 'a stamp for another gamemode'; Gm = $gmText; Stamp = ('e' * 64); Why = 'does not describe that gamemode' })) {
        Put-Root $root $case.Gm $case.Stamp
        $said = @(Set-ThornswoodServerRecord -Artifact $a1 -Target 'u@box' -SshArgs @() -Root $root -Store $store)
        Yes ($case.Label + ': nothing is recorded, and it says why') (
          @($said | Where-Object { $_ -like 'SERVER NOT RECORDED:*' -and $_ -match $case.Why }).Count -eq 1 -and -not @($said | Where-Object { $_ -like 'SERVER RECORDED *' }).Count)
        Yes '  and the record beside it and in the store is as it was' ([IO.File]::ReadAllText($beside) -eq $before -and [IO.File]::ReadAllText($current) -eq $before)
      }
      Remove-Item -LiteralPath (Join-Path $root 'gamemode.js') -Force
      $said = @(Set-ThornswoodServerRecord -Artifact $a1 -Target 'u@box' -SshArgs @() -Root $root -Store $store)
      Yes 'a root with no gamemode.js records nothing' ([bool]@($said | Where-Object { $_ -like 'SERVER NOT RECORDED: there is no gamemode.js*' }).Count)
      $n = $script:sent.Count
      $said = @(Set-ThornswoodServerRecord -Artifact (Fake-Artifact $gmSha ('c' * 40) 'game/other.js') -Target 'u@box' -SshArgs @() -Root $root -Store $store)
      Yes 'an artifact that lists no gamemode.js records nothing, and asks the box nothing' ($script:sent.Count -eq $n -and [bool]@($said | Where-Object { $_ -like 'SERVER NOT RECORDED:*lists no game/gamemode.js' }).Count)

      # ---- 2. a put-back -------------------------------------------------------------
      Write-Host ''; Write-Host 'a put-back'
      # The folder that came back carries the record it was written with.
      Put-Root $root $gmText $gmSha
      $said = @(Set-ThornswoodServerRecord -Artifact $a1 -Target 'u@box' -SshArgs @() -Root $root -Store $store)
      $own = [IO.File]::ReadAllText($beside)
      Put $current '{ "name": "what ran before the put-back" }'
      $said = @(Restore-ThornswoodServerRecord -Target 'u@box' -SshArgs @() -Root $root -Store $store)
      Yes 'a folder whose own record the store''s artifact confirms becomes current' ($said -contains ('SERVER RECORDED ' + $a1.Name) -and [IO.File]::ReadAllText($current) -eq $own)
      Yes '  and its record is left as it was' ([IO.File]::ReadAllText($beside) -eq $own)
      Yes '  and history.log says it was put back to it' ([IO.File]::ReadAllText($history) -match [regex]::Escape('thornswood-server-dev put back to ' + $a1.Name))

      # A folder installed before #459: the record in it is the one the folder
      # before it had, carried in, naming another gamemode.
      Put-StoreRecord $a2
      $stale = (ConvertFrom-Json $own); $stale.name = $a2.Name; $stale.commit = $a2.Commit
      Put $beside (ConvertTo-Json -InputObject $stale)
      $said = @(Restore-ThornswoodServerRecord -Target 'u@box' -SshArgs @() -Root $root -Store $store)
      $b = ReadJson $beside; $c = ReadJson $current
      Yes 'a folder whose record names another gamemode is recorded as an older copy, with no commit' (
        $said -contains 'SERVER RECORDED an older copy its record does not describe' -and $b.commit -eq '' -and $b.putBack -eq $true -and
        $b.name -eq 'an older copy its record does not describe' -and [IO.File]::ReadAllText($current) -eq [IO.File]::ReadAllText($beside))
      Yes '  and it is not named after the gamemode it does not run' (-not ([IO.File]::ReadAllText($current)).Contains($a2.Name))
      Remove-Item -LiteralPath $beside -Force
      $said = @(Restore-ThornswoodServerRecord -Target 'u@box' -SshArgs @() -Root $root -Store $store)
      $c = ReadJson $current
      Yes 'a folder with no record is recorded as one kept before deploys were recorded' (
        $said -contains 'SERVER RECORDED an older copy kept before deploys were recorded' -and $c.commit -eq '' -and $c.root -eq $root.Replace('\', '/') -and (Test-Path -LiteralPath $beside))
      # A box with no store yet: the put-back makes it, then records.
      $store2 = Join-Path $tmp 'Fresh-Deploys'
      $said = @(Restore-ThornswoodServerRecord -Target 'u@box' -SshArgs @() -Root $root -Store $store2)
      Yes 'a box with no store yet: it is made, and the put-back recorded in it' (
        [bool]@($said | Where-Object { $_ -like 'SERVER RECORDED *' }).Count -and (Test-Path -LiteralPath (Join-Path $store2 'current\thornswood-server-dev.json')))
      $err = $null; $null = [Management.Automation.PSParser]::Tokenize($script:sent[-1][1], [ref]$err)
      Yes '  and the text for the box parses' ($err.Count -eq 0)

      # ---- 3. the installer's Carry --------------------------------------------------
      Write-Host ''; Write-Host 'the installer carries runtime data and not the deploy record'
      $inst = Join-Path $Repo 'scripts\deploy\Install-ThornswoodServer.ps1'
      $ast = [Management.Automation.Language.Parser]::ParseFile($inst, [ref]$null, [ref]$null)
      $carryAst = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Carry' }, $true)
      Yes 'Install-ThornswoodServer.ps1 has its Carry' ($null -ne $carryAst)
      if ($carryAst) {
        function Say([string]$m, [string]$c) { }
        function MoveDir([string]$from, [string]$to) { try { [IO.Directory]::Move($from, $to); return $true } catch { return $false } }
        . ([scriptblock]::Create($carryAst.Extent.Text))
        $old = Join-Path $tmp 'carry-old'; $new = Join-Path $tmp 'carry-new'
        Put (Join-Path $old 'data\book.txt') 'the character book'
        Put (Join-Path $old 'data\thornswood-deploy.json') '{ "name": "the old folder''s gamemode" }'
        Put (Join-Path $new 'data\shipped.txt') 'shipped'
        Put (Join-Path $new '.payload-data.txt') 'shipped.txt'
        Carry $old $new $false
        Yes 'runtime data crosses to the new folder' ([IO.File]::ReadAllText((Join-Path $new 'data\book.txt')) -eq 'the character book')
        Yes '  and the old folder''s deploy record does not' (-not (Test-Path -LiteralPath (Join-Path $new 'data\thornswood-deploy.json')))
        # A put-back the other way: the folder coming back keeps its own record.
        Put (Join-Path $new 'data\thornswood-deploy.json') '{ "name": "the newer gamemode" }'
        Carry $new $old $false
        Yes 'a put-back leaves the record of the folder that came back alone' (
          [IO.File]::ReadAllText((Join-Path $old 'data\thornswood-deploy.json')) -eq '{ "name": "the old folder''s gamemode" }')
      }
  }

  # ---- 4. Export-ServerPayload.ps1 -Stamp ---------------------------------------
  Write-Host ''; Write-Host 'Export-ServerPayload.ps1 -Stamp'
  $dist = Join-Path $tmp 'dist'
  $rels = @('scam_native.node', 'dist_back/skymp5-server.js', 'dist_back/skymp5-server.js.map', 'package.json', 'yarn.lock', 'launch_server.bat', 'data/scripts/ActiveMagicEffect.pex')
  $files = [ordered]@{}
  foreach ($rel in $rels) {
    $p = Join-Path $dist ($rel -replace '/', '\')
    Put $p ('the recorded ' + $rel)
    $files[$rel] = [ordered]@{ sha256 = (Sha $p); bytes = (Get-Item -LiteralPath $p).Length; commit = ('a' * 40) }
  }
  $record = Join-Path $tmp 'server-build.json'
  Put $record (([ordered]@{ binary = 'scam_native.node'; sha256 = $files['scam_native.node'].sha256; bytes = $files['scam_native.node'].bytes
                            source = [ordered]@{ commit = ('a' * 40) }; files = $files }) | ConvertTo-Json -Depth 5)
  Put (Join-Path $dist 'gamemode.js') $gmText
  # And its tables (#5191), which the payload carries beside it.
  Put (Join-Path $dist 'gamemode-tables\WAY_OUT.json') '{}'
  Put (Join-Path $dist 'thornswood-build.json') '{ "channel": "main", "note": "the build''s own" }'
  $esp = (Join-Path $tmp 'plugins\ours.esp')
  Put $esp 'a plugin'
  Put (Join-Path $dist 'server-settings.json') (([ordered]@{ name = 'Thornswood'; port = 7777; thornswoodVoicePort = 7778; maxPlayers = 100
                                                             loadOrder = @($esp.Replace('\', '/')) }) | ConvertTo-Json -Depth 5)
  $stamp = Join-Path $tmp 'gamemode.dev-build.json'
  Put $stamp ('{ "channel": "dev", "gamemodeSha256": "' + $gmSha + '" }')
  $zip = Join-Path $tmp 'out\thornswood-server.zip'
  $export = Join-Path $Repo 'scripts\release\Export-ServerPayload.ps1'
  $shell = (Get-Process -Id $PID).Path
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $xo = @(& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $export -Dist $dist -Zip $zip -OutDir (Join-Path $tmp 'out\_payload') -Record $record -Channel dev -Stamp $stamp 2>&1 | ForEach-Object { "$_" }); $xc = $LASTEXITCODE }
  finally { $ErrorActionPreference = $eap }
  Yes ("Export-ServerPayload -Stamp packs a payload (exit {0})" -f $xc) ($xc -eq 0 -and (Test-Path -LiteralPath $zip))
  if ($xc -ne 0) { $xo | Select-Object -Last 8 | ForEach-Object { Write-Host "      $_" } }
  if (Test-Path -LiteralPath $zip) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
      $e = @($z.Entries | Where-Object { $_.FullName.Replace('\', '/') -eq 'thornswood-build.json' })
      $text = ''
      if ($e.Count) { $r = New-Object IO.StreamReader($e[0].Open()); try { $text = $r.ReadToEnd() } finally { $r.Dispose() } }
    } finally { $z.Dispose() }
    Yes '  its thornswood-build.json is the stamp it was given, for dev' ($text -eq [IO.File]::ReadAllText($stamp))
    Yes '  and the build''s own stamp is left as it was' ([IO.File]::ReadAllText((Join-Path $dist 'thornswood-build.json')) -match 'the build''s own')
  }
  $ErrorActionPreference = 'Continue'
  try { $null = @(& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $export -Dist $dist -Zip $zip -OutDir (Join-Path $tmp 'out\_payload') -Record $record -Channel dev -Stamp (Join-Path $tmp 'nowhere.json') 2>&1); $xc = $LASTEXITCODE }
  finally { $ErrorActionPreference = $eap }
  Yes 'a -Stamp that is not there packs nothing' ($xc -ne 0)

  # ---- 5. Publish-Server.ps1, read -------------------------------------------------
  Write-Host ''; Write-Host 'Publish-Server.ps1'
  $pubPath = Join-Path $Repo 'scripts\release\Publish-Server.ps1'
  $pub = [IO.File]::ReadAllText($pubPath)
  $past = [Management.Automation.Language.Parser]::ParseFile($pubPath, [ref]$null, [ref]$null)
  function At([string]$s, [int]$from = 0) { return $pub.IndexOf($s, $from) }
  function Cmd([string]$name) { return @($past.FindAll({ param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq $name }, $true) | Sort-Object { $_.Extent.StartOffset }) }
  $assert = Cmd 'Assert-ThornswoodCommitted'
  $build = Cmd 'New-ThornswoodArtifact'
  Yes 'it builds the gamemode artifact once, after the committed check' ($assert.Count -eq 1 -and $build.Count -eq 1 -and $build[0].Extent.StartOffset -gt $assert[0].Extent.StartOffset -and
    $build[0].Extent.Text -match "-Paths 'game/gamemode\.js'")
  Yes '  and the build''s gamemode.js is copied from the artifact''s, not the working tree' (
    (At "`$gmSrc = Join-Path `$artifact.Folder 'game\gamemode.js'") -gt 0 -and $pub -notmatch "Join-Path `\`$Here '\.\.\\\.\.\\game\\gamemode\.js'")
  $stampCmd = Cmd 'Save-ThornswoodBuildStamp'
  Yes '  the stamp is made for the channel, from the artifact, beside it and not in the build' (
    $stampCmd.Count -eq 1 -and $stampCmd[0].Extent.Text -match '-Channel \$Channel' -and $stampCmd[0].Extent.Text -match '-Artifact \$artifact' -and
    $stampCmd[0].Extent.Text -match '-Path \$stampPath' -and (At '$stampPath = [IO.Path]::ChangeExtension($artifact.Zip,') -gt 0)
  Yes '  and Export-ServerPayload packs it' ((At '-Record $Record -Stamp $stampPath') -gt 0)
  $firstZipScp = At 'scp @ssh $Zip "${target}:C:/thornswood-server.zip"'
  Yes '  the payload''s gamemode and stamp are held to the artifact before the zip is sent' (
    (At 'if ($zipGmSum -ne $gmSha)') -gt 0 -and (At 'if ($zipGmSum -ne $gmSha)') -lt $firstZipScp -and
    (At "if (`$stampSays -ne (`$gmSha + '/' + `$Channel))") -gt 0 -and (At "if (`$stampSays -ne (`$gmSha + '/' + `$Channel))") -lt $firstZipScp)
  $fn = $pub.Substring((At 'function Save-ServerRecords'))
  $fn = $fn.Substring(0, $fn.IndexOf("`n}") + 2)
  Yes 'its record step sends the artifact to the store before the box records it' (
    $fn.IndexOf('Send-ThornswoodArtifact -Artifact $artifact') -gt 0 -and $fn.IndexOf('Set-ThornswoodServerRecord') -gt $fn.IndexOf('Send-ThornswoodArtifact -Artifact $artifact'))
  Yes '  and stops the run when the box did not say SERVER RECORDED' ($fn -match "(?s)'SERVER RECORDED \*'.*?Die ")
  $iInst = At 'Invoke-Installer $instArgs'
  Yes 'a publish records only once the installer has said INSTALL OK, and before the dev door' (
    $iInst -gt 0 -and (At 'Save-ServerRecords' $iInst) -gt $iInst -and (At 'Save-ServerRecords' $iInst) -lt (At "Head 'The roster'"))
  $iBack = At '-StartNow -PutBack -Wait $Wait"'
  Yes 'a put-back records the folder that came back, before it says it is done' (
    $iBack -gt 0 -and (At 'Save-ServerRecords -PutBack' $iBack) -gt $iBack -and (At 'Save-ServerRecords -PutBack' $iBack) -lt (At 'exit 0' $iBack))
  Yes 'Invoke-Installer stops the run on anything but INSTALL OK, so no record follows a refused or rolled back install' (
    $pub -match "(?s)function Invoke-Installer.*?if \(\`$lines -contains 'INSTALL OK' -and \`$code -eq 0\) \{ return \}.*?Die ")
}
finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
}
Yes 'the temp folder is gone' (-not (Test-Path -LiteralPath $tmp))
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
