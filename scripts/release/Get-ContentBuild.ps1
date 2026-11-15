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

  A test hands -ReleasesFile (the list of Releases) and -AssetDir (the two
  files) for GitHub, and -DeploymentFile, where -Ask writes what it would
  send.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    [ValidateSet('dev', 'main')][string]$Server = 'dev',
    [switch]$Take,
    [switch]$Ask,
    [string]$Repo = '',
    [string]$Commit = 'HEAD',
    [string]$GitHubRepo = $env:GITHUB_REPOSITORY,
    [string]$Output = $env:GITHUB_OUTPUT,
    [string]$ReleasesFile = '',
    [string]$AssetDir = '',
    [string]$DeploymentFile = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'MergeRelease.ps1')
. (Join-Path $Here '..\mods\ContentPaths.ps1')
if (-not $Repo) { $Repo = (Resolve-Path -LiteralPath (Join-Path $Here '..\..')).ProviderPath }

function Stop-Take([string]$Why) { Write-Host ('::error::' + $Why); Write-Host ('STOP. ' + $Why); exit 1 }
function Say-Output([string]$Line) { if ($Output) { Add-Content -LiteralPath $Output -Value $Line } }
function Get-Sha256Bytes([byte[]]$B) { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($B)).ToLowerInvariant() }

$sha = (& git -C $Repo rev-parse --verify ($Commit + '^{commit}') 2>$null) -join ''
if ($LASTEXITCODE -ne 0 -or $sha -cnotmatch '^[0-9a-f]{40}$') { Stop-Take "there is no commit $Commit in $Repo" }
$paths = (Get-ThornswoodContentPaths -Repo $Repo -Tool 'scripts/mods/Add-ContentRecords.py').Paths
try { $k = Get-ThornswoodContentKey -Repo $Repo -Commit $sha -Server $Server -Paths $paths } catch { Stop-Take $_.Exception.Message }
$key = $k.Key
$tag = "content-$Server-$key"
Write-Host "KEY $key"
Write-Host "inputs: $($k.Files) files at $sha, against the $Server server's plugins"
Say-Output "key=$key"

try { $rels = @(Get-MergeReleaseList -Repo $GitHubRepo -ReleasesFile $ReleasesFile) } catch { Stop-Take $_.Exception.Message }
$draft = @($rels | Where-Object { $_.draft -and [string]$_.tag_name -ceq $tag } | Select-Object -First 1)
$zipAsset = if ($draft.Count) { @($draft[0].assets | Where-Object { $_.name -ceq 'content.zip' } | Select-Object -First 1) } else { @() }
$recAsset = if ($draft.Count) { @($draft[0].assets | Where-Object { $_.name -ceq 'content-build.json' } | Select-Object -First 1) } else { @() }

if (-not ($zipAsset.Count -and $recAsset.Count)) {
    Write-Host 'MISSING'
    Say-Output 'found=no'
    if ($Take) { Stop-Take "there is no whole draft $tag to take" }
    if ($Ask) {
        # To main, not the commit: the agent builds main as it is, and a
        # Deployment made with a branch keeps github.ref main for the run
        # its status starts. Kept as a record (not transient), never live.
        $body = [ordered]@{
            ref                    = 'main'
            environment            = 'Content'
            task                   = 'deploy'
            auto_merge             = $false
            required_contexts      = @()
            payload                = [ordered]@{ content = $key; server = $Server; commit = $sha }
            description            = "Build the content plugin and tables for $($sha.Substring(0, 7)) on the box"
            production_environment = $false
            transient_environment  = $false
        }
        $json = $body | ConvertTo-Json -Depth 4 -Compress
        if ($DeploymentFile) { [IO.File]::WriteAllText($DeploymentFile, $json); Write-Host "ASKED (written to $DeploymentFile)"; exit 0 }
        $f = New-TemporaryFile
        try {
            [IO.File]::WriteAllText($f.FullName, $json)
            $id = gh api --method POST "repos/$GitHubRepo/deployments" --input $f.FullName --jq .id
            if ($LASTEXITCODE -ne 0 -or -not $id) { Stop-Take 'the Deployment to Content could not be made' }
        } finally { Remove-Item -LiteralPath $f.FullName -Force }
        Write-Host "ASKED deployment $id"
        if ($env:GITHUB_STEP_SUMMARY) { Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value "The box has no content build for these inputs yet ($($key.Substring(0, 12))), so Deployment $id asks the deploy agent for one; its status starts this release again." }
    }
    exit 0
}
Write-Host "FOUND $tag"
Say-Output 'found=yes'
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
            # Invoke-WebRequest drops the token when it leaves the host.
            Invoke-WebRequest -Uri ([string]$a.url) -OutFile $to -Headers @{ Authorization = "Bearer $env:GH_TOKEN"; Accept = 'application/octet-stream'; 'X-GitHub-Api-Version' = '2022-11-28' } | Out-Null
        }
        if ((Get-Item -LiteralPath $to).Length -ne [long]$a.size) { Stop-Take "$($a.name) on $tag is not the $($a.size) bytes the Release says" }
    }
    try { $rec = [IO.File]::ReadAllText((Join-Path $work 'content-build.json')) | ConvertFrom-Json -AsHashtable } catch { Stop-Take "content-build.json on $tag does not read: $($_.Exception.Message)" }
    if ([string]$rec.key -cne $key -or [string]$rec.server -cne $Server) { Stop-Take "content-build.json on $tag is for $($rec.server) $($rec.key), not $Server $key" }
    if ([string]$rec.commit -cnotmatch '^[0-9a-f]{40}$') { Stop-Take "content-build.json on $tag names no commit" }
    $want = $rec.files
    if (-not ($want -is [Collections.IDictionary]) -or -not $want.Count) { Stop-Take "content-build.json on $tag names no files" }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead((Join-Path $work 'content.zip'))
    $got = [ordered]@{}
    try {
        foreach ($e in $z.Entries) {
            $n = $e.FullName
            if ($n.EndsWith('/')) { continue }
            if ($n.StartsWith('/') -or $n.Contains('\') -or $n.Contains(':') -or @($n.Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count) { Stop-Take "content.zip on $tag holds $n, which is not a repository path" }
            if (-not $want.Contains($n)) { Stop-Take "content.zip on $tag holds $n, which content-build.json does not name" }
            $s = $e.Open(); $m = New-Object IO.MemoryStream
            try { $s.CopyTo($m) } finally { $s.Dispose() }
            $b = $m.ToArray()
            if ((Get-Sha256Bytes $b) -cne [string]$want[$n]) { Stop-Take "$n in content.zip on $tag is not the sha256 content-build.json names" }
            $got[$n] = $b
        }
    } finally { $z.Dispose() }
    $lack = @($want.Keys | Where-Object { -not $got.Contains($_) })
    if ($lack.Count) { Stop-Take ("content.zip on $tag lacks " + ($lack -join ', ')) }

    # Held whole, then written: nothing is written unless everything held.
    foreach ($n in $got.Keys) {
        $to = Join-Path $Repo $n
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
        [IO.File]::WriteAllBytes($to, $got[$n])
    }
    Write-Host "TOOK $key FROM $($rec.commit): $($got.Count) files over this checkout"
    if ($env:GITHUB_STEP_SUMMARY) { Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value "The content plugin and tables are the box's build $($key.Substring(0, 12)) of $($rec.commit) ($($got.Count) files), from the draft $tag." }
} finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
exit 0
