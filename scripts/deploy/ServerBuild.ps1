<#
  ServerBuild.ps1

  Which server files come from the fork, and whether a folder, a zip or a
  stage holds the build records\server-build.json names. Dot-sourced by
  New-ServerBuildRecord.ps1, Export-ServerPayload.ps1, Publish-Server.ps1,
  Deploy-Server.ps1, Check-ShipReady.ps1 and Install-ThornswoodServer.ps1 (on
  the box, from beside it: Publish-Server.ps1 sends the three together).
  Deploy-Server also sends this file's text to the box in front of Swap.ps1's
  $checkBlock, so the stage is held to the record there.

  WHY, issues #1200 and #1214. The record named one file, scam_native.node.
  The server is more than that: the fork's build also writes the JavaScript
  half the server runs (dist_back\skymp5-server.js, from skymp5-server\ts),
  its source map, and the compiled Papyrus the server's script machine loads.
  Nothing recorded those, so on 29 September nobody could say which fork
  commit the JavaScript running on dev was built from, and a publish would
  have sent any one it found beside the recorded binary.

  THE FILES, by where the fork's CMake writes them into build\dist\server:
    scam_native.node                 skymp5-server, the Node addon
    dist_back\skymp5-server.js       skymp5-server-ts (yarn build-ts, esbuild),
    dist_back\skymp5-server.js.map   which skymp5-server depends on
    package.json, yarn.lock          skymp5-server's post-build step, copied
                                     from skymp5-server
    launch_server.bat                skymp5-server's post-build step
    data\scripts\*                   skymp5-scripts' post-build step, the
                                     fork's compiled Papyrus
  Not these: scam_native.pdb (symbols, never shipped), and gamemode.js and
  server-settings.json, which the fork writes as placeholders and our own
  scripts replace (Deploy-Gamemode.ps1, Publish-Server.ps1).

  THE RECORD lists every one under files, each with its sha256, its size and
  the fork commit it was built from, which is the record's one commit
  (source.commit). sha256 at the top stays the binary's. A folder holds the
  record when every listed file is there with its hash, and no other file of
  those kinds is: a second addon, or a script in dist_back or data\scripts
  that the build did not record, is a server file from somewhere else.

  Keep it ASCII. It runs on the box, in PowerShell 7.
#>

# Every one of these is in every record. data\scripts is by folder: the files
# in it are whatever the fork compiles.
$ThornswoodServerForkFiles = @('scam_native.node', 'dist_back/skymp5-server.js', 'dist_back/skymp5-server.js.map', 'package.json', 'yarn.lock', 'launch_server.bat')
$ThornswoodServerForkFolders = @('dist_back', 'data/scripts')

# A path as the record writes it: forward slashes, no leading one.
function ConvertTo-ThornswoodServerRel([string]$Rel) {
    return $Rel.Replace('\', '/').TrimStart('/')
}

# Whether a file, by its path in the server folder, is one the fork's build
# makes and the record must name.
function Test-ThornswoodServerForkFile([string]$Rel) {
    $r = ConvertTo-ThornswoodServerRel $Rel
    if ($ThornswoodServerForkFiles -contains $r) { return $true }
    if ($r -notmatch '/' -and $r -like '*.node') { return $true }
    foreach ($f in $ThornswoodServerForkFolders) { if ($r -like ($f + '/*')) { return $true } }
    return $false
}

# rel -> sha256 of every fork file in a folder, for Get-ThornswoodServerBuildProblems.
function Get-ThornswoodServerFolderSums([string]$Dir) {
    $sums = @{}
    if (-not (Test-Path -LiteralPath $Dir)) { return $sums }
    $full = (Get-Item -LiteralPath $Dir).FullName.TrimEnd('\')
    foreach ($f in @(Get-ChildItem -LiteralPath $full -Recurse -File -Force -ErrorAction SilentlyContinue)) {
        $rel = ConvertTo-ThornswoodServerRel ($f.FullName.Substring($full.Length))
        if (-not (Test-ThornswoodServerForkFile $rel)) { continue }
        $sums[$rel] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    return $sums
}

# A member of a parsed record, or $null, without tripping strict mode on one
# that is not there.
function Get-ThornswoodServerRecordValue($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    if ($Object -is [Collections.IDictionary]) { if ($Object.Contains($Name)) { return $Object[$Name] } else { return $null } }
    $p = $Object.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

# The record's files, as an ordered rel -> entry, or $null when it lists none.
function Get-ThornswoodServerRecordFiles($Record) {
    $files = Get-ThornswoodServerRecordValue $Record 'files'
    if ($null -eq $files) { return $null }
    $out = [ordered]@{}
    if ($files -is [Collections.IDictionary]) {
        foreach ($k in @($files.Keys)) { $out[(ConvertTo-ThornswoodServerRel ([string]$k))] = $files[$k] }
    } else {
        foreach ($p in $files.PSObject.Properties) { $out[(ConvertTo-ThornswoodServerRel $p.Name)] = $p.Value }
    }
    return $out
}

# Every way the files in $Sums (rel -> sha256, for a folder, a zip or a stage)
# are not the build $Record names, as sentences. Empty when they are. $Where
# says where the files are, $RecordName which record, for the sentences.
function Get-ThornswoodServerBuildProblems($Record, $Sums, [string]$Where = 'the build', [string]$RecordName = 'server-build.json') {
    $out = @()
    if ($null -eq $Record) { return @("there is no $RecordName, so nothing says which build the server files are") }
    $files = Get-ThornswoodServerRecordFiles $Record
    if ($null -eq $files -or $files.Count -eq 0) {
        return @("$RecordName lists no server files, only a binary, so nothing says which build the JavaScript half and the rest are. Make it again with .\scripts\release\New-ServerBuildRecord.ps1")
    }
    $commit = ([string](Get-ThornswoodServerRecordValue (Get-ThornswoodServerRecordValue $Record 'source') 'commit')).ToLowerInvariant()
    if (-not $commit) { $out += "$RecordName names no fork commit (source.commit)" }
    foreach ($n in $ThornswoodServerForkFiles) {
        if (-not $files.Contains($n)) { $out += "$RecordName does not list $n" }
    }
    if ($files.Contains('scam_native.node') -and
        ([string](Get-ThornswoodServerRecordValue $files['scam_native.node'] 'sha256')).ToLowerInvariant() -ne ([string](Get-ThornswoodServerRecordValue $Record 'sha256')).ToLowerInvariant()) {
        $out += "$RecordName names one scam_native.node at the top and another under files"
    }
    foreach ($rel in @($files.Keys)) {
        $e = $files[$rel]
        $want = ([string](Get-ThornswoodServerRecordValue $e 'sha256')).ToLowerInvariant()
        $from = ([string](Get-ThornswoodServerRecordValue $e 'commit')).ToLowerInvariant()
        if ($want -notmatch '^[0-9a-f]{64}$') { $out += "$RecordName names no sha256 for $rel"; continue }
        if ($commit -and $from -ne $commit) {
            $out += ("$RecordName says $rel was built from " + $(if ($from) { $from.Substring(0, [Math]::Min(8, $from.Length)) } else { 'no commit' }) +
                     ', and the server from ' + $commit.Substring(0, [Math]::Min(8, $commit.Length)))
        }
        if (-not $Sums.ContainsKey($rel)) { $out += "$rel is not in $Where"; continue }
        $have = ([string]$Sums[$rel]).ToLowerInvariant()
        if ($have -ne $want) {
            $out += ("$rel in $Where is not the build $RecordName records (it is " + $have.Substring(0, [Math]::Min(12, $have.Length)) + ', the record says ' + $want.Substring(0, 12) + ')')
        }
    }
    foreach ($rel in @($Sums.Keys)) {
        $r = ConvertTo-ThornswoodServerRel $rel
        if ((Test-ThornswoodServerForkFile $r) -and -not $files.Contains($r)) {
            $out += "$r in $Where is a server file $RecordName does not list, so it is from another build"
        }
    }
    return $out
}

<#
  Which build a running server is, for a deploy that sends no server files
  (Deploy-Server.ps1 -GamemodeOnly, issue #1089). The box keeps the record the
  last full deploy sent beside the files, as $Root\server-build.json, and a
  gamemode-only deploy goes ahead only when that is the record the commit
  being deployed holds, so the gamemode comes from a commit whose recorded
  server build is the one running.

  Byte for byte, once each CR LF is read as LF. The record is a text file in
  git (git ls-files --eol, 5 Oct: i/lf w/crlf), so a machine with
  core.autocrlf true checks it out with CR LF and one without checks it out
  with LF, and a full deploy sends whichever the deploying machine has. Both
  are the same commit's record; any other difference is another record.

  Kept as text as well, because Deploy-Server puts it in front of the scripts
  it runs on the box, where this file is not.
#>
$ThornswoodRecordSumText = @'
function Get-ThornswoodRecordSum([byte[]]$Bytes) {
    $l1 = [Text.Encoding]::GetEncoding(28591)
    $b = $l1.GetBytes($l1.GetString($Bytes).Replace("`r`n", "`n"))
    $h = [Security.Cryptography.SHA256]::Create()
    try { return (($h.ComputeHash($b) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
}
'@
. ([scriptblock]::Create($ThornswoodRecordSumText))

<#
  Whether a gamemode may go onto a server that runs the build whose record
  sums to $BoxSum, given the record its commit holds ($RecordSum, from
  records\server-build.json at that commit). $null when it may; otherwise the
  sentence that says why not. A gamemode is written for the engine its commit
  records: #1719 took drop handling out of the gamemode because engine 9fd1f69b
  keeps the extra, so that gamemode on the earlier engine loses it. Deploy-Server
  -GamemodeOnly makes the same comparison for live (#1089); Deploy-DevGamemode
  uses this for dev (#2076).
#>
function Get-ThornswoodBoxBuildProblem([string]$BoxSum, [string]$BoxCommit, [string]$RecordSum, [string]$RecordCommit, [string]$Server, [string]$PutThere) {
  $ours = $RecordCommit
  if ($ours.Length -gt 8) { $ours = $ours.Substring(0, 8) }
  if (-not $BoxSum) { return ('the ' + $Server + ' did not say which server build it runs') }
  if ($BoxSum -eq 'none') { return ('the ' + $Server + ' has no server-build.json, so nothing says which server build it runs. ' + $PutThere + ' puts one there.') }
  if ($BoxSum -ne $RecordSum) {
    $theirs = 'an unreadable one'
    if ($BoxCommit) { $theirs = 'commit ' + $BoxCommit.Substring(0, [Math]::Min(8, $BoxCommit.Length)) }
    return ('the ' + $Server + ' runs another server build (' + $theirs + ') than the one records\server-build.json holds at this commit (commit ' +
            $ours + '). This gamemode is written for that build: put it on first (' + $PutThere + '), then send the gamemode.')
  }
  return $null
}

<#
  A RECORDED BUILD OUT OF THE BOX'S STORE (#459). Since #2467 every
  Publish-Server.ps1 and full Deploy-Server.ps1 keeps the server build it sends
  in the box's store, C:\Thornswood-Deploys\server, as
  server-<fork commit 12>-<zip hash 16>.zip with its .json (ServerArtifact.ps1
  makes them). Publish-Server.ps1 -FromStore and Deploy-Server.ps1 -FromStore
  put the build records\server-build.json names onto a server from there, so a
  machine with no engine build can deploy one. This runs on the box, in the
  installer's stage or Deploy-Server's, and puts that build's files into
  $Into, held to the record exactly as a build sent from a machine is:

    - the store's .json for the record's commit whose recordSha256 is the
      record's own sum (Get-ThornswoodRecordSum, so CR LF and LF are one
      record), and exactly one: the same record and build always make the
      same zip (ServerArtifact.ps1), so two would be a store that lies;
    - the zip's sha256 is its .json's and begins as its name says;
    - the zip holds the record's files and server-build.json, nothing else;
      each file's sha256 is the record's, and the server-build.json in it
      sums to the record;
    - written into $Into, the files are read again and held to the record
      with Get-ThornswoodServerBuildProblems, the check every stage gets.

  Returns Name (the zip's, '' when nothing was taken), Said (lines to print)
  and Problem ('' or why nothing was taken). Only the record's files are
  written; on a problem some may be there, and the caller clears its stage.
  A store .json for the commit that does not read is a problem too: the store
  then cannot say which build it keeps. It reads them with
  ConvertFrom-ThornswoodJson, so the caller has Read-JsonFile.ps1 loaded: the
  installer does, and Deploy-Server sends its text in front of this file's.
#>
function Expand-ThornswoodStoredServerBuild([string]$Store, $Record, [string]$RecordSum, [string]$Into) {
    $r = [pscustomobject]@{ Name = ''; Said = @(); Problem = '' }
    $commit = ([string](Get-ThornswoodServerRecordValue (Get-ThornswoodServerRecordValue $Record 'source') 'commit')).ToLowerInvariant()
    $files = Get-ThornswoodServerRecordFiles $Record
    if ($commit -notmatch '^[0-9a-f]{40}$' -or $null -eq $files -or $files.Count -eq 0) {
        $r.Problem = 'server-build.json names no fork commit or no server files, so no build in the store can be held to it'
        return $r
    }
    $RecordSum = ([string]$RecordSum).ToLowerInvariant()
    $short = $commit.Substring(0, 12)
    $mine = @()
    $others = @()
    if (Test-Path -LiteralPath $Store) {
        foreach ($j in @(Get-ChildItem -LiteralPath $Store -Filter ('server-' + $short + '-*.json') -File -ErrorAction SilentlyContinue)) {
            $meta = $null
            try { $meta = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($j.FullName)) $j.FullName }
            catch {
                $r.Problem = ('the store cannot say which build it keeps for ' + $commit.Substring(0, 8) + ': ' + $_.Exception.Message)
                return $r
            }
            $sum = ''
            if ($null -ne $meta) { $sum = ([string](Get-ThornswoodServerRecordValue $meta 'recordSha256')).ToLowerInvariant() }
            if ($sum -and $sum -eq $RecordSum -and ([string](Get-ThornswoodServerRecordValue $meta 'commit')).ToLowerInvariant() -eq $commit) { $mine += [pscustomobject]@{ Json = $j.FullName; Meta = $meta } }
            else { $others += $j.BaseName }
        }
    }
    if ($mine.Count -eq 0) {
        $r.Problem = ('the store (' + $Store + ') holds no server build of ' + $commit.Substring(0, 8) + ' with this record' +
                      $(if ($others.Count) { '; it has ' + ($others -join ', ') + ', built from the same commit with another record' } else { '' }) +
                      '. A Publish-Server.ps1 or full Deploy-Server.ps1 from a machine with that build puts it there, or -ServerBuild sends one CI made')
        return $r
    }
    if ($mine.Count -gt 1) {
        $r.Problem = ('the store holds ' + $mine.Count + ' server builds for one record (' + (($mine | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Json) }) -join ', ') +
                      '), and one record makes one zip, so the store is not what its records say')
        return $r
    }
    $zip = [IO.Path]::ChangeExtension($mine[0].Json, '.zip')
    $name = [IO.Path]::GetFileName($zip)
    $r.Name = $name
    if (-not (Test-Path -LiteralPath $zip)) { $r.Problem = ($name + ' is named in the store and is not there'); return $r }
    $m = [regex]::Match($name, '^server-([0-9a-f]{12})-([0-9a-f]{16})\.zip$')
    $have = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    $want = ([string](Get-ThornswoodServerRecordValue $mine[0].Meta 'sha256')).ToLowerInvariant()
    if (-not $m.Success -or $have -ne $want -or -not $have.StartsWith($m.Groups[2].Value)) {
        $r.Problem = ($name + ' is not the zip its name and its .json say (its sha256 is ' + $have.Substring(0, 16) + ')')
        return $r
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $why = @()
    $za = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        $seen = @{}
        foreach ($ze in $za.Entries) {
            if (-not $ze.Name) { continue }
            $rel = ConvertTo-ThornswoodServerRel $ze.FullName
            $seen[$rel] = $true
            $ms = New-Object IO.MemoryStream
            $zs = $ze.Open()
            try { $zs.CopyTo($ms) } finally { $zs.Dispose() }
            $bytes = $ms.ToArray()
            if ($rel -eq 'server-build.json') {
                if ((Get-ThornswoodRecordSum $bytes) -ne $RecordSum) { $why += 'its server-build.json is not this record' }
                continue
            }
            if (-not $files.Contains($rel)) { $why += ($rel + ' is in it and the record does not list it'); continue }
            $h = [Security.Cryptography.SHA256]::Create()
            try { $sum = (($h.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
            if ($sum -ne ([string](Get-ThornswoodServerRecordValue $files[$rel] 'sha256')).ToLowerInvariant()) { $why += ($rel + ' in it is not the build the record names'); continue }
            $to = Join-Path $Into ($rel -replace '/', '\')
            $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $to))
            [IO.File]::WriteAllBytes($to, $bytes)
        }
        foreach ($rel in @($files.Keys)) { if (-not $seen.ContainsKey($rel)) { $why += ($rel + ' is listed in the record and not in it') } }
        if (-not $seen.ContainsKey('server-build.json')) { $why += 'it carries no server-build.json' }
    } finally { $za.Dispose() }
    if (-not $why.Count) { $why = @(Get-ThornswoodServerBuildProblems $Record (Get-ThornswoodServerFolderSums $Into) 'the stage' 'server-build.json') }
    if ($why.Count) { $r.Problem = ($name + ': ' + ($why -join '; ')); return $r }
    $r.Said = @(('the server build ' + $name + ' out of the store: ' + $files.Count + ' files, each the build server-build.json names, from ' + $commit.Substring(0, 8)))
    return $r
}

<#
  Deploy-Server.ps1 -FromStore's half on the box (#459): the build the staged
  server-build.json names, out of the store into the stage, by
  Expand-ThornswoodStoredServerBuild above. Read-JsonFile.ps1's and
  RecordShape.ps1's text and this file's go in front of it, and $Root, $Stage
  and $Store in the lines before it. Ends with
  STORED <zip name> or STORE REFUSED, the stage cleared.
#>
$ThornswoodStoreExpandBlock = @'
$ProgressPreference = 'SilentlyContinue'
$stageDir = Join-Path $Root $Stage
$rp = Join-Path $stageDir 'server-build.json'
$rec = $null
$why = ''
try { $rec = Read-ThornswoodRecord -Path $rp -Kind server-build } catch { $why = ('the staged server-build.json cannot be trusted, so nothing says which build to take out of the store: ' + $_.Exception.Message) }
$got = $null
if (-not $why) {
  $got = Expand-ThornswoodStoredServerBuild -Store $Store -Record $rec -RecordSum (Get-ThornswoodRecordSum ([IO.File]::ReadAllBytes($rp))) -Into $stageDir
  $why = $got.Problem
}
if ($why) {
  'REFUSED: ' + $why
  Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
  'the stage is cleared and the server was not touched'
  'STORE REFUSED'
} else {
  foreach ($l in $got.Said) { $l }
  'STORED ' + $got.Name
}
'@
