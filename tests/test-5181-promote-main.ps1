<#
  test-5181-promote-main.ps1

      pwsh -NoProfile -File .\tests\test-5181-promote-main.ps1

  Issue #5181. A main release is a Deployment of a Release dev ran, made only
  after Patrick approves it on GitHub (.github\workflows\promote-main.yml).
  The agent's side of it (who approved, dev ran it, one Deployment per run,
  the live port) is held by tools\DeployAgent.Tests; this holds the
  workflow and the agent's constants it must agree with:
    - started by hand on main only, with a tag that reaches the script
      through env;
    - the check job holds the tag to a published build Release with its
      signed manifest and a Deployment of it to Dev that ended in success,
      and builds nothing;
    - the check also finds main's launcher package (#4825): the one the
      Release runs with, through MergeRelease.ps1's Find-MainPackage (which
      tests\test-5179-merge-release.ps1 drives), and the artifact
      merge-release.yml kept it in;
    - the job that makes the Deployment waits in the Main environment, needs
      the check, has deployments: write, and contents: write and actions:
      read for main's package, nothing else, and names the Release and its
      own run in the payload, to Main;
    - once approved, and before the Deployment, it puts main's package out
      on main-<build tag>, the Release VeloRecord.MainRelease names, each
      file held to the signed record of the build that made it, from a draft
      published only when whole;
    - the agent names this workflow and the Main environment for main, and
      the gate never puts a tag on main.

  Read only. Exit 1 when any check fails.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

$wf = [IO.File]::ReadAllText((Join-Path $Repo '.github/workflows/promote-main.yml'))
$i = $wf.IndexOf("`n  promote:")
$check = if ($i -gt 0) { $wf.Substring(0, $i) } else { '' }
$promote = if ($i -gt 0) { $wf.Substring($i) } else { '' }

Yes 'promote-main.yml is started by hand only' ($wf -match '(?m)^on:\s*\n\s+workflow_dispatch:' -and $wf -notmatch '(?m)^\s+(push|pull_request|schedule|workflow_run):')
Yes '  on main only, one at a time' ($wf.Contains("if: `${{ github.ref == 'refs/heads/main' }}") -and $wf -match '(?m)^\s+cancel-in-progress: false\s*$')
Yes '  and the tag reaches the scripts through env, never pasted into them' ($wf.Contains('TAG: ${{ inputs.tag }}') -and -not ($wf -match '(?m)^\s+run:.*\$\{\{ inputs\.tag'))
Yes 'the check holds the tag to a build Release tag' ($check.Contains("'^build-\d{8}\.\d{1,9}$'"))
Yes '  published, with its signed manifest, naming itself' ($check.Contains('if ($rel.draft)') -and $check.Contains("'manifest.json'") -and $check.Contains("'manifest.cat'") -and $check.Contains('[string]$m.tag -ne $tag'))
Yes '  that dev ran: a Deployment of it to Dev ended in success' ($check.Contains('deployments?environment=Dev') -and $check.Contains("Where-Object state -eq 'success'") -and $check.Contains('dev has not run'))
Yes '  and reads only' ($check -match '(?m)^\s+deployments: read\s*$' -and $check -match '(?m)^\s+actions: read\s*$' -and $check -notmatch ':\s*write' -and $check -notmatch '--method POST' -and $check -notmatch 'gh release (create|upload|edit)')
Yes 'the check finds main''s launcher package before anybody is asked (#4825)' ($check.Contains('$pkg = Find-MainPackage -Tag $tag -Manifest $m -Repo $repo') -and
    $check.Contains('Select-MainPackageArtifact -Artifacts') -and $check.Contains('actions/artifacts?name=$($pkg.MainTag)') -and
    $check.Contains("[string]`$path -ne '.github/workflows/merge-release.yml'") -and $check.Contains('("main_run=" + $run)'))
Yes 'the promotion needs the check and waits in the Main environment' ($promote -match '(?m)^\s+needs: check\s*$' -and $promote -match '(?m)^\s+environment: Main\s*$')
Yes '  with deployments: write, and contents: write and actions: read for main''s package, nothing else' ($promote -match '(?m)^\s+permissions:\s*\n\s+deployments: write\s*\n\s+contents: write\s*\n\s+actions: read\s*\n\s+steps:')
Yes '  and makes a Deployment to Main of the Release, naming its own run' ($promote.Contains("environment = 'Main'") -and $promote.Contains('payload = [ordered]@{ release = $env:TAG; run = [long]$env:GITHUB_RUN_ID }') -and $promote.Contains('ref = $env:COMMIT'))
$pubAt = $promote.IndexOf("- name: Put main's launcher package out")
$depAt = $promote.IndexOf('- name: Ask the live server for it (a Deployment to Main)')
$pub = if ($pubAt -gt 0 -and $depAt -gt $pubAt) { $promote.Substring($pubAt, $depAt - $pubAt) } else { '' }
Yes 'once approved, main''s package goes out before the Deployment, only when the check found one to put out' ($pub.Length -gt 0 -and $pub.Contains("if: `${{ needs.check.outputs.main_run != '' }}"))
Yes '  from the artifact the check found, every file held to the signed record of the build that made it' ($pub.Contains('gh run download $env:MAIN_RUN -n $env:MAIN_TAG -D $dir -R $repo') -and
    $pub.Contains('[string]$record.tag -ne $env:MAIN_FROM -or [string]$record.commit -ne $env:MAIN_COMMIT') -and $pub.Contains('$why = Get-MainPackageProblem -Record $record -Have $have') -and
    $pub.Contains('if ($why) {'))
Yes '  on main-<build tag>, a draft published only once every file is on it' ($pub.Contains('gh release create $env:MAIN_TAG --draft --target $env:MAIN_COMMIT') -and
    $pub.IndexOf('gh release upload $env:MAIN_TAG') -gt $pub.IndexOf('gh release create') -and $pub.IndexOf('gh release edit $env:MAIN_TAG --draft=false') -gt $pub.IndexOf('gh release upload'))
$mr = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/release/MergeRelease.ps1'))
$vr = [IO.File]::ReadAllText((Join-Path $Repo 'launcher/app/VeloRecord.cs'))
Yes '  which is the Release a main launcher reads main''s files from (VeloRecord.MainRelease)' ($mr.Contains("`$mainTag = 'main-' + `$t") -and $vr -match 'return "main-" \+ buildTag;')
Yes 'no step in it builds or signs anything, and none takes a build Release''s own files' (-not ($wf -cmatch 'Build-[A-Z]|Sign-OnRunner|vpk |release download'))

$agent = [IO.File]::ReadAllText((Join-Path $Repo 'tools/DeployAgent/Agent.cs'))
$cfg = [IO.File]::ReadAllText((Join-Path $Repo 'tools/DeployAgent/AgentConfig.cs'))
Yes 'the agent holds a Main Deployment to a run of this workflow' ($agent.Contains('public const string PromoteWorkflow = ".github/workflows/promote-main.yml";') -and $agent.Contains('a.Environments.Any(x => x.Name == "Main")'))
Yes '  and main to the Main environment and the live port' ($cfg -match 'DefaultMain\(\) => new\(\)\s*\{\s*GitHubEnvironment = "Main",' -and $cfg.Contains('RequirePort = 7777,') -and $cfg.Contains('Approved = true,'))
$verbs = Get-Content -Raw (Join-Path $Repo 'scripts/vps/gate/verbs.json') | ConvertFrom-Json
$dr = $verbs.verbs.'Deploy-Release'
Yes 'the gate''s Deploy-Release never puts a tag on main' ($null -ne $dr -and -not ('main' -match $dr.params.Environment) -and ('dev' -match $dr.params.Environment) -and (@($dr.fixed) -notcontains 'main'))

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail -gt 0) { exit 1 }
exit 0
