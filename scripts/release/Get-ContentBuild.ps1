<#
  Get-ContentBuild.ps1

  The merge release's side of the content build (#5191, stage 3). Nothing
  generated is committed (Patrick's B on #5191, 1 Nov 2026): the content
  plugin and every table read out of the load order are built on the box,
  where the whole load order is, and the box deploy agent puts each build on
  a draft Release named by its inputs, content-<server>-<key> (Patrick's B
  on q-5191-box-build-upload, 12 Nov 2026; docs/DEPLOY-AGENT.md, "The
  content build"). GitHub's runner has no game data, so it takes them from
  there.

      pwsh scripts/release/Get-ContentBuild.ps1 [-Ask]
      pwsh scripts/release/Get-ContentBuild.ps1 -Take

  FIND (the default). Works out the key of this checkout's commit
  (ContentPaths.ps1, the key Build-ContentOnBox.ps1 keeps the build by) and
  looks for its draft, whole: content.zip and content-build.json. Prints
  KEY <key>, then FOUND <tag> or MISSING. With -Ask, a missing build makes a
  Deployment to Content asking the agent for it; its status starts the
  merge release again (merge-release.yml, on deployment_status). Writes
  key= and found=yes|no to -Output (the step's GITHUB_OUTPUT).

  TAKE. Downloads the draft's two files, holds content-build.json to the key
  and the server, and every file in the zip to the sha256 it names (none
  more, none fewer, each at a repository path), then writes each over this
  checkout, so every part built after it carries the box's build. Prints
  TOOK <key> FROM <commit>. Stops, writing nothing, on any difference.

  NEWEST. The newest build a merge release on main took, from the artifact
  content-<server> it keeps (-Keep; merge-release.yml, "Keep what was
  taken"), whatever its key: what a harness or a developer's checkout reads
  now that the tables are not committed. Held and written the same way as
  TAKE, to the server but not to a key. Needs Actions read only, which every
  pull request's token has.

      pwsh scripts/release/Get-ContentBuild.ps1 -Newest

  It says whether that build is of this checkout's content inputs: SAME KEY,
  or OTHER KEY when the checkout changed one (a source, a builder, a script
  a builder loads), and writes same=yes|no, commit= (the commit the build
  was made of) and key= to -Output. Run-Gate.ps1's pick reads them (its
  -Content says why). -Keep keeps the two files it took, which the pick
  hands to the gate's shares, so every share of one run lays the build its
  pick measured, even when a merge release keeps a newer one meanwhile, and
  no share holds a token. -BuildKey holds the build to that key, as the
  merge release's content checks lay the one it took.

  IN A WORKFLOW (#6359) the build comes down through GitHub's own download
  step, never this script's: .github/actions/lay-content runs -Newest -Find,
  which names the newest kept build and writes artifact= and run= to -Output,
  then actions/download-artifact takes it, and -Newest -ArtifactDir lays it.
  On 16 Nov 2026 the script's own single request to GitHub's artifact store
  (an Azure storage account many of GitHub's customers share) was answered
  503 "Egress is over the account limit" twice, while every job that took the
  build through download-artifact had it. So under GITHUB_ACTIONS the script
  refuses to download a build itself; its own download is for a developer's
  or a cloud session's checkout.

      pwsh scripts/release/Get-ContentBuild.ps1 -Newest -Find

  -Keep <folder> keeps the two files TAKE took there, for the artifact.

  KEPT. On the box, the build Build-ContentOnBox.ps1 keeps for the key, with
  no GitHub: -Kept names where builds are kept (C:\Thornswood-ContentBuilds),
  and -Take lays <Kept>\<server>\<key>\files over this checkout, held to its
  build.json the same way. A box verb that sends a built file lays it so.

      pwsh scripts/release/Get-ContentBuild.ps1 -Take -Kept C:\Thornswood-ContentBuilds

  THE LAID RECORD. Every lay (TAKE, KEPT, NEWEST) writes temp\content-laid.json
  in this checkout: the build's server, key and commit, and each file it wrote
  with its sha256 (ContentPaths.ps1, THE LAID BUILD). A deploy sends a built
  file only from a laid build of its own commit's key that still holds
  (New-ThornswoodArtifact -Content).

  QUEUED (#6879, Patrick's A on 26 Nov 2026). In the merge queue's run the
  checkout is the queue's own merge, a commit on a gh-readonly-queue/main/
  branch that no merge release has built. -Queued finds its key's build
  under either name: content-<server>-<key>, the box's build of main at the
  same inputs, or content-queue-<server>-<key>, which the agent builds from
  the queued commit itself as the limited account (Build-ContentOnBox.ps1
  -Queued). With -Ask, when neither is there and no ask for the key is
  still open (a merge release asks for main's own), it makes a Deployment
  to Content whose payload names the queued commit; the agent answers asks
  oldest first, and merge-release.yml starts nothing on their statuses.
  -WaitMinutes then waits that long for either draft, and stops at once
  when the Deployment it waits on fails, with the agent's reason. -Take
  takes the one found, as above.

      pwsh scripts/release/Get-ContentBuild.ps1 -Queued -Ask -WaitMinutes 45 -Take -Keep <folder>

  A test hands -ArtifactsFile (the list of artifacts) or -ArtifactDir (the
  two files) for -Newest, -ReleasesFile (the list of Releases) and -AssetDir (the two
  files) for GitHub, and -DeploymentFile, where -Ask writes what it would
  send; for -Queued, -DeploymentsFile (the Deployments to Content, each with
  its statuses, read again at each look) and -PollSeconds.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [ValidateSet('dev', 'main')][string]$Server = 'dev',
    [switch]$Take,
    [switch]$Ask,
    [switch]$Newest,
    [switch]$Find,
    [string]$Keep = '',
    [string]$Repo = '',
    [string]$Commit = 'HEAD',
    [string]$GitHubRepo = $env:GITHUB_REPOSITORY,
    [string]$Output = $env:GITHUB_OUTPUT,
    [string]$ReleasesFile = '',
    [string]$AssetDir = '',
    [string]$DeploymentFile = '',
    [string]$ArtifactsFile = '',
    [string]$ArtifactDir = '',
    [string]$BuildKey = '',
    [string]$Kept = '',
    [switch]$Queued,
    [ValidateRange(0, 120)][int]$WaitMinutes = 0,
    [ValidateRange(0, 300)][int]$PollSeconds = 30,
    [string]$DeploymentsFile = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'MergeRelease.ps1')
. (Join-Path $Here '..\mods\ContentPaths.ps1')
if (-not $Repo) { $Repo = (Resolve-Path -LiteralPath (Join-Path $Here '..\..')).ProviderPath }
if (-not $GitHubRepo) { $GitHubRepo = 'ThornswoodRP/Thornswood' }

function Stop-Take([string]$Why) { Write-Host ('::error::' + $Why); Write-Host ('STOP. ' + $Why); exit 1 }
function Say-Output([string]$Line) { if ($Output) { Add-Content -LiteralPath $Output -Value $Line } }
function Get-Sha256Bytes([byte[]]$B) { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($B)).ToLowerInvariant() }

# Holds content-build.json (to the server, and to the key when one is given)
# and every file in content.zip to the sha256 it names, none more and none
# fewer, each at a repository path; then writes each over this checkout.
# Writes nothing unless everything held. -Keep keeps the two files it took.
function Use-ContentFiles([string]$Work, [string]$Key, [string]$From, [string[]]$Only = $null, [string]$FilesDir = '') {
    if ($Keep -and $FilesDir) { Stop-Take '-Keep keeps a draft''s two files; a build kept on the box is kept there already' }
    $recName = if ($FilesDir) { 'build.json' } else { 'content-build.json' }
    try { $rec = [IO.File]::ReadAllText((Join-Path $Work $recName)) | ConvertFrom-Json -AsHashtable } catch { Stop-Take "$recName in $From does not read: $($_.Exception.Message)" }
    if ([string]$rec.server -cne $Server) { Stop-Take "content-build.json in $From is for the $($rec.server) server, not $Server" }
    if ($Key -and [string]$rec.key -cne $Key) { Stop-Take "content-build.json in $From is for $($rec.server) $($rec.key), not $Server $Key" }
    if ([string]$rec.key -cnotmatch '^[0-9a-f]{64}$') { Stop-Take "content-build.json in $From names no key" }
    if ([string]$rec.commit -cnotmatch '^[0-9a-f]{40}$') { Stop-Take "content-build.json in $From names no commit" }
    $want = $rec.files
    if (-not ($want -is [Collections.IDictionary]) -or -not $want.Count) { Stop-Take "content-build.json in $From names no files" }

    $got = [ordered]@{}
    if ($FilesDir) {
        # A build kept on the box: files\ at repository paths, build.json beside.
        $root = (Resolve-Path -LiteralPath $FilesDir).ProviderPath.TrimEnd('\', '/')
        foreach ($f in @(Get-ChildItem -LiteralPath $root -Recurse -File -Force)) {
            $n = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
            if (-not $want.Contains($n)) { Stop-Take "the build in $From holds $n, which build.json does not name" }
            $b = [IO.File]::ReadAllBytes($f.FullName)
            if ((Get-Sha256Bytes $b) -cne [string]$want[$n]) { Stop-Take "$n in $From is not the sha256 build.json names" }
            $got[$n] = $b
        }
        $lack = @($want.Keys | Where-Object { -not $got.Contains($_) })
        if ($lack.Count) { Stop-Take ("the build in $From lacks " + ($lack -join ', ')) }
    } else {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead((Join-Path $Work 'content.zip'))
        try {
            foreach ($e in $z.Entries) {
                $n = $e.FullName
                if ($n.EndsWith('/')) { continue }
                if ($n.StartsWith('/') -or $n.Contains('\') -or $n.Contains(':') -or @($n.Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count) { Stop-Take "content.zip in $From holds $n, which is not a repository path" }
                if (-not $want.Contains($n)) { Stop-Take "content.zip in $From holds $n, which content-build.json does not name" }
                $s = $e.Open(); $m = New-Object IO.MemoryStream
                try { $s.CopyTo($m) } finally { $s.Dispose() }
                $b = $m.ToArray()
                if ((Get-Sha256Bytes $b) -cne [string]$want[$n]) { Stop-Take "$n in content.zip in $From is not the sha256 content-build.json names" }
                $got[$n] = $b
            }
        } finally { $z.Dispose() }
        $lack = @($want.Keys | Where-Object { -not $got.Contains($_) })
        if ($lack.Count) { Stop-Take ("content.zip in $From lacks " + ($lack -join ', ')) }
    }

    # Held whole, then written: nothing is written unless everything held.
    # With -Only (-Newest), only what this checkout's chain says a build
    # writes: an older build can carry a file a later change took out of the
    # chain (#6195: builds before 6d2cf9d carry gamemode code), and laying it
    # would put that file back as it was.
    if ($null -ne $Only) {
        # New previews still use the verified bytes of an older content build.
        # Fresh builds already name the tables under game/data (#6296).
        foreach ($name in 'FISHING-SPOTS.csv', 'HANGING-GAME-SPOTS.csv', 'HUNTING-SPOTS.csv') {
            $fromPath = "docs/$name"
            $toPath = "game/data/$name"
            if ($Only -ccontains $toPath -and $got.Contains($fromPath) -and -not $got.Contains($toPath)) {
                $got[$toPath] = $got[$fromPath]
                $want[$toPath] = $want[$fromPath]
            }
        }
        $left = @($got.Keys | Where-Object { $n = $_; -not @($Only | Where-Object { $n -ceq $_ -or $n.StartsWith($_ + '/') }).Count })
        foreach ($n in $left) { $got.Remove($n) }
        if ($left.Count) { Write-Host ("left $($left.Count) file(s) of the build that this checkout's chain does not write: " + (@($left | Select-Object -First 5) -join ', ') + $(if ($left.Count -gt 5) { ', ...' } else { '' })) }
    }
    foreach ($n in $got.Keys) {
        $to = Join-Path $Repo $n
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
        [IO.File]::WriteAllBytes($to, $got[$n])
    }
    # What was laid, for a reader outside the chain (ContentPaths.ps1, THE
    # LAID BUILD): a deploy sends these only while each is still its sha256.
    $laid = [ordered]@{}
    foreach ($n in $got.Keys) { $laid[$n] = [string]$want[$n] }
    Save-ThornswoodLaidBuild -Repo $Repo -Server $Server -Key ([string]$rec.key) -Commit ([string]$rec.commit) -From $From -Files $laid
    if ($Keep) {
        New-Item -ItemType Directory -Force -Path $Keep | Out-Null
        foreach ($n in 'content.zip', 'content-build.json') { Copy-Item -LiteralPath (Join-Path $Work $n) -Destination (Join-Path $Keep $n) -Force }
    }
    Write-Host "TOOK $($rec.key) FROM $($rec.commit): $($got.Count) files over this checkout"
    if ($env:GITHUB_STEP_SUMMARY) { Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value "The content plugin and tables are the box's build $(([string]$rec.key).Substring(0, 12)) of $($rec.commit) ($($got.Count) files), from $From." }
    return $rec
}

# ---- the newest build main took, for a harness or a developer's checkout ----
# The newest content-<server> build a run on main kept, from the list of
# artifacts: the merge release keeps it 90 days; newest first, main only.
function Get-NewestContentArtifact {
    $json = if ($ArtifactsFile) { [IO.File]::ReadAllText($ArtifactsFile) } else { (gh api "repos/$GitHubRepo/actions/artifacts?name=content-$Server&per_page=50") -join "`n" }
    if (-not $ArtifactsFile -and $LASTEXITCODE -ne 0) { Stop-Take "GitHub did not list the artifacts named content-$Server" }
    $list = @(($json | ConvertFrom-Json).artifacts | Where-Object { -not $_.expired -and [string]$_.workflow_run.head_branch -ceq 'main' } | Sort-Object { [DateTimeOffset]$_.created_at } -Descending)
    if (-not $list.Count) { Stop-Take "no merge release on main has kept a content-$Server build yet (merge-release.yml, Keep what was taken)" }
    return $list[0]
}

if ($Find) {
    if (-not $Newest -or $Take -or $Ask -or $Kept -or $ArtifactDir -or $Keep -or $BuildKey) { Stop-Take '-Find goes with -Newest alone: it names the newest kept build for actions/download-artifact and lays nothing' }
    $a = Get-NewestContentArtifact
    Write-Host "NEWEST artifact $($a.id) of run $($a.workflow_run.id)"
    Say-Output "artifact=$($a.id)"
    Say-Output "run=$($a.workflow_run.id)"
    exit 0
}

if ($Newest) {
    if ($Take -or $Ask -or $Kept) { Stop-Take '-Newest takes the newest build main released, whatever its key, so it goes without -Take, -Ask and -Kept' }
    # This checkout's key, from git, before anything is written over it.
    $sha = (& git -C $Repo rev-parse --verify ($Commit + '^{commit}') 2>$null) -join ''
    if ($LASTEXITCODE -ne 0 -or $sha -cnotmatch '^[0-9a-f]{40}$') { Stop-Take "there is no commit $Commit in $Repo" }
    $chain = Get-ThornswoodContentPaths -Repo $Repo -Tool 'scripts/mods/Add-ContentRecords.py'
    try { $mine = (Get-ThornswoodContentKey -Repo $Repo -Commit $sha -Server $Server -Paths $chain.Paths).Key } catch { Stop-Take $_.Exception.Message }
    # What a build of this checkout writes (Build-ContentOnBox.ps1): the
    # plugin, the catalogue built in the order before the chain, and every
    # path the chain writes.
    $writes = Get-ThornswoodBuiltPaths -Repo $Repo
    $work = Join-Path ([IO.Path]::GetTempPath()) ('content-newest-' + [Guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Path $work | Out-Null
    try {
        if ($ArtifactDir) { foreach ($n in 'content.zip', 'content-build.json') { Copy-Item -LiteralPath (Join-Path $ArtifactDir $n) -Destination (Join-Path $work $n) }; $from = "the folder $ArtifactDir" }
        else {
            $a = Get-NewestContentArtifact
            # A workflow takes it through actions/download-artifact (IN A
            # WORKFLOW, above, #6359); this download is for a checkout.
            if ($env:GITHUB_ACTIONS -eq 'true') { Stop-Take "in a workflow the content build comes down through actions/download-artifact, not this script: lay it with the action .github/actions/lay-content (#6359)" }
            $zip = Join-Path $work 'artifact.zip'
            # GitHub answers with a redirect to its file store, and
            # Invoke-WebRequest drops the token when it leaves the host. A
            # developer's checkout has no GH_TOKEN; gh's own sign-in serves.
            $tok = if ($env:GH_TOKEN) { $env:GH_TOKEN } else { (gh auth token) -join '' }
            try { Invoke-WebRequest -Uri "https://api.github.com/repos/$GitHubRepo/actions/artifacts/$($a.id)/zip" -OutFile $zip -Headers @{ Authorization = "Bearer $tok"; 'X-GitHub-Api-Version' = '2022-11-28' } | Out-Null }
            catch { Stop-Take "GitHub did not give artifact $($a.id): $($_.Exception.Message)" }
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [IO.Compression.ZipFile]::ExtractToDirectory($zip, (Join-Path $work 'a'))
            foreach ($n in 'content.zip', 'content-build.json') {
                $at = Join-Path (Join-Path $work 'a') $n
                if (-not (Test-Path -LiteralPath $at)) { Stop-Take "artifact $($a.id) has no $n" }
                Move-Item -LiteralPath $at -Destination (Join-Path $work $n)
            }
            $from = "artifact $($a.id) of run $($a.workflow_run.id)"
        }
        $rec = Use-ContentFiles $work $BuildKey $from $writes
        Say-Output "key=$($rec.key)"
        Say-Output "commit=$($rec.commit)"
        if ($rec.key -ceq $mine) { Write-Host "SAME KEY: the build is of this checkout's content inputs"; Say-Output 'same=yes' }
        else {
            Write-Host "OTHER KEY: this checkout's content inputs are $mine, and the build's $($rec.key) of $($rec.commit); a harness that holds a table to a source this checkout changed is held to the old table until the box builds these inputs"
            Say-Output 'same=no'
        }
    } finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
    exit 0
}

$sha = (& git -C $Repo rev-parse --verify ($Commit + '^{commit}') 2>$null) -join ''
if ($LASTEXITCODE -ne 0 -or $sha -cnotmatch '^[0-9a-f]{40}$') { Stop-Take "there is no commit $Commit in $Repo" }
$paths = (Get-ThornswoodContentPaths -Repo $Repo -Tool 'scripts/mods/Add-ContentRecords.py').Paths
try { $k = Get-ThornswoodContentKey -Repo $Repo -Commit $sha -Server $Server -Paths $paths } catch { Stop-Take $_.Exception.Message }
$key = $k.Key
$tag = "content-$Server-$key"
Write-Host "KEY $key"
Write-Host "inputs: $($k.Files) files at $sha, against the $Server server's plugins"
Say-Output "key=$key"

# ---- a build kept on the box -------------------------------------------------
if ($Kept) {
    if ($Ask -or $Newest) { Stop-Take '-Kept takes the box''s own build of this commit''s inputs, so it goes with -Take only' }
    $dir = Join-Path (Join-Path $Kept $Server) $key
    if (-not (Test-Path -LiteralPath (Join-Path $dir 'build.json') -PathType Leaf)) {
        Write-Host 'MISSING'
        Say-Output 'found=no'
        Stop-Take "the box keeps no build of these inputs for the $Server server in $Kept (Build-ContentOnBox.ps1 keeps each by its key); the Build-Content verb makes it"
    }
    Write-Host "FOUND $dir"
    Say-Output 'found=yes'
    if (-not $Take) { exit 0 }
    $null = Use-ContentFiles $dir $key "the box's build $key" $null (Join-Path $dir 'files')
    exit 0
}

if (($WaitMinutes -or $DeploymentsFile) -and -not $Queued) { Stop-Take '-WaitMinutes and -DeploymentsFile are for -Queued, the merge queue''s build' }
# The names a build of this key may be under: the box's build of main, and
# for a queued merge (#6879) the box's build of that commit as the limited
# account. Either is a build of these inputs, held to the key below.
$tags = if ($Queued) { @($tag, "content-queue-$Server-$key") } else { @($tag) }

# The whole draft of the first name that has one: $null, or its tag and its
# two files.
function Find-ContentDraft {
    try { $rels = @(Get-MergeReleaseList -Repo $GitHubRepo -ReleasesFile $ReleasesFile) } catch { Stop-Take $_.Exception.Message }
    foreach ($t in $tags) {
        $d = @($rels | Where-Object { $_.draft -and [string]$_.tag_name -ceq $t } | Select-Object -First 1)
        if (-not $d.Count) { continue }
        $z = @($d[0].assets | Where-Object { $_.name -ceq 'content.zip' } | Select-Object -First 1)
        $r = @($d[0].assets | Where-Object { $_.name -ceq 'content-build.json' } | Select-Object -First 1)
        if ($z.Count -and $r.Count) { return [pscustomobject]@{ Tag = $t; Zip = $z[0]; Rec = $r[0] } }
    }
    return $null
}

# The Deployments to Content, newest first, each with its statuses newest
# first: GitHub's, or -DeploymentsFile's (read again at each look, so a test
# can move it on).
function Get-ContentAsks {
    if ($DeploymentsFile) { return @([IO.File]::ReadAllText($DeploymentsFile) | ConvertFrom-Json) }
    $raw = gh api "repos/$GitHubRepo/deployments?environment=Content&per_page=30"
    if ($LASTEXITCODE -ne 0) { Stop-Take 'GitHub did not list the Deployments to Content' }
    $out = @()
    foreach ($d in @(($raw -join "`n") | ConvertFrom-Json)) {
        $st = gh api "repos/$GitHubRepo/deployments/$($d.id)/statuses?per_page=10"
        if ($LASTEXITCODE -ne 0) { Stop-Take "GitHub did not list the statuses of Deployment $($d.id)" }
        $out += [pscustomobject]@{ id = $d.id; payload = $d.payload; statuses = @(($st -join "`n") | ConvertFrom-Json) }
    }
    return $out
}
function Get-AskPayload($d) {
    $p = $d.payload
    if ($p -is [string]) { try { $p = $p | ConvertFrom-Json } catch { $p = $null } }
    return $p
}
# An ask still open: no status yet, or its newest is queued, pending or in
# progress.
function Test-AskOpen($d) {
    $s = @($d.statuses)
    return (-not $s.Count) -or ([string]$s[0].state -in @('queued', 'pending', 'in_progress'))
}

$found = Find-ContentDraft

# Asks the agent for this key's build by a Deployment to Content; says the
# Deployment's id ('asked' when -DeploymentFile takes what it would send).
# To main, not the commit: the agent builds main as it is, and a Deployment
# made with a branch keeps github.ref main for the run its status starts.
# Kept as a record (not transient), never live. A queued merge's ask names
# its commit (#6879): the agent builds that commit as the limited account
# and keeps it as content-queue-, and merge-release.yml starts nothing on
# its status.
function New-ContentAsk {
    $payload = [ordered]@{ content = $key; server = $Server; commit = $sha }
    if ($Queued) { $payload['queued'] = $sha }
    $body = [ordered]@{
        ref                    = 'main'
        environment            = 'Content'
        task                   = 'deploy'
        auto_merge             = $false
        required_contexts      = @()
        payload                = $payload
        description            = $(if ($Queued) { "Build the content plugin and tables for the merge queue's $($sha.Substring(0, 7)) on the box" } else { "Build the content plugin and tables for $($sha.Substring(0, 7)) on the box" })
        production_environment = $false
        transient_environment  = $false
    }
    $json = $body | ConvertTo-Json -Depth 4 -Compress
    if ($DeploymentFile) { [IO.File]::WriteAllText($DeploymentFile, $json); Write-Host "ASKED (written to $DeploymentFile)"; return 'asked' }
    $f = New-TemporaryFile
    try {
        [IO.File]::WriteAllText($f.FullName, $json)
        $id = gh api --method POST "repos/$GitHubRepo/deployments" --input $f.FullName --jq .id
        if ($LASTEXITCODE -ne 0 -or -not $id) { Stop-Take 'the Deployment to Content could not be made' }
    } finally { Remove-Item -LiteralPath $f.FullName -Force }
    Write-Host "ASKED deployment $id"
    Say-Output "deployment=$id"
    if ($env:GITHUB_STEP_SUMMARY) {
        $then = if ($Queued) { 'this run waits for it' } else { 'its status starts this release again' }
        Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value "The box has no content build for these inputs yet ($($key.Substring(0, 12))), so Deployment $id asks the deploy agent for one; $then."
    }
    return [string]$id
}

if (-not $found) {
    Write-Host 'MISSING'
    Say-Output 'found=no'
    $wait = $Queued -and $WaitMinutes
    if ($Take -and -not $wait) { Stop-Take "there is no whole draft $($tags -join ' or ') to take" }
    $waitOn = ''
    $mine = $false
    if ($Ask -and $Queued) {
        # An open ask for the same inputs (a merge release's for main, or an
        # earlier queue run's) is being answered already: wait on it, so the
        # box does not build the same inputs twice.
        $open = @(Get-ContentAsks | Where-Object { $p = Get-AskPayload $_; $p -and [string]$p.content -ceq $key -and [string]$p.server -ceq $Server -and (Test-AskOpen $_) } | Select-Object -First 1)
        if ($open.Count) { $waitOn = [string]$open[0].id; Write-Host "WAITING on deployment $waitOn, an open ask for these inputs"; Say-Output "deployment=$waitOn" }
    }
    if ($Ask -and -not $waitOn) { $waitOn = New-ContentAsk; $mine = $true }
    if (-not $wait) { exit 0 }

    # ---- wait for the queued merge's build (#6879) ---------------------------
    # The agent answers one ask at a time, oldest first, so a build may wait
    # behind others; -WaitMinutes is the most this run gives it. Either
    # draft ends the wait. Its own ask ending without a build ends it at
    # once, with the agent's reason: nothing puts the draft up after that,
    # and the queue drops the merge. Another's ask set aside (the agent
    # answers only main's newest, docs/DEPLOY-AGENT.md) is followed by an
    # ask of this run's own.
    $until = (Get-Date).AddMinutes($WaitMinutes)
    while (-not $found) {
        if ((Get-Date) -ge $until) { Stop-Take "the box put up no build of $($key.Substring(0, 12)) in $WaitMinutes minutes ($($tags -join ' or ')), so the content checks of this merge cannot run" }
        if ($PollSeconds) { Start-Sleep -Seconds $PollSeconds }
        $found = Find-ContentDraft
        if ($found -or -not $waitOn) { continue }
        $d = @(Get-ContentAsks | Where-Object { [string]$_.id -eq $waitOn } | Select-Object -First 1)
        if (-not ($d.Count -and @($d[0].statuses).Count)) { continue }
        $st = @($d[0].statuses)[0]
        $why = [string]$st.description
        switch ([string]$st.state) {
            { $_ -in @('failure', 'error') } { Stop-Take "the box did not build $($key.Substring(0, 12)) (deployment $waitOn): $why" }
            'inactive' {
                if ($mine -or -not $Ask) { Stop-Take "deployment $waitOn was set aside without a build: $why" }
                Write-Host "deployment $waitOn was set aside ($why), so this run asks for its own"
                $waitOn = New-ContentAsk; $mine = $true
            }
            'success' {
                # Its success is set after the draft is up, so the draft is
                # read once more before this says it is not there.
                $found = Find-ContentDraft
                if (-not $found) { Stop-Take "deployment $waitOn says the box built $($key.Substring(0, 12)), but neither $($tags -join ' nor ') is a whole draft" }
            }
        }
    }
}
$tag = $found.Tag
$zipAsset = @($found.Zip)
$recAsset = @($found.Rec)
Write-Host "FOUND $tag"
Say-Output 'found=yes'
Say-Output "tag=$tag"
if (-not $Take) { exit 0 }

# ---- take it ---------------------------------------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('content-take-' + [Guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    foreach ($a in @($zipAsset[0], $recAsset[0])) {
        $to = Join-Path $work $a.name
        if ($AssetDir) { Copy-Item -LiteralPath (Join-Path $AssetDir $a.name) -Destination $to }
        else {
            # GitHub answers with a redirect to its file store, and
            # Invoke-WebRequest drops the token when it leaves the host. A
            # machine with no GH_TOKEN (a deploy from a developer's PC) has
            # gh's own sign-in, which listed the draft above.
            $tok = if ($env:GH_TOKEN) { $env:GH_TOKEN } else { (gh auth token) -join '' }
            Invoke-WebRequest -Uri ([string]$a.url) -OutFile $to -Headers @{ Authorization = "Bearer $tok"; Accept = 'application/octet-stream'; 'X-GitHub-Api-Version' = '2022-11-28' } | Out-Null
        }
        if ((Get-Item -LiteralPath $to).Length -ne [long]$a.size) { Stop-Take "$($a.name) on $tag is not the $($a.size) bytes the Release says" }
    }
    $null = Use-ContentFiles $work $key "the draft $tag"
} finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
exit 0
