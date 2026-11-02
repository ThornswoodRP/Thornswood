<#
  test-deployed-build.ps1

  After a successful server deploy, Deploy-Server.ps1 and Publish-Server.ps1
  write what the box actually runs (its own server-build.json) into the docs
  app's data\deployed-build.json, and site/server.js fills the credits page
  from it, for whichever servers the file names (#2303). This runs the far-side text of scripts\deploy\DeployedBuild.ps1 with
  Invoke-ThornswoodArtifactRemote stubbed to run it here, against scratch
  roots (no ssh, no box), then starts a copy of server.js on the scratch
  docs root and checks /credits names the deployed commit with no hand edit.
  Windows PowerShell 5.1 and PowerShell 7. Every temp folder is removed.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Repo = Split-Path -Parent $Here
# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot 'SiteFiles.ps1')
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

. (Join-Path $Repo 'scripts\deploy\DeployedBuild.ps1')
$script:sent = @()
function Invoke-ThornswoodArtifactRemote([string]$Target, [string[]]$SshArgs, [string]$Script) {
  $script:sent += , @($Target, $Script)
  return @(& ([scriptblock]::Create($Script)) | ForEach-Object { "$_".Trim() })
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-deployed-build-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$node = $null
function Wait-OwnLine($proc, $err, [string]$mark, [int]$port, [string]$what) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    $seen = New-Object 'System.Collections.Generic.List[string]'
    while ($true) {
        $left = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        $read = $proc.StandardOutput.ReadLineAsync()
        if (-not $read.Wait($left)) { return ('{0} did not say it was listening on port {1} within 20 seconds' -f $what, $port) }
        $got = $read.Result
        if ($null -eq $got) {
            [void]$proc.WaitForExit(5000)
            $said = ''
            if ($err.Wait(5000)) { $said = ([string]$err.Result).Trim() }
            $code = '?'
            if ($proc.HasExited) { $code = $proc.ExitCode }
            if ($said -match 'EADDRINUSE') {
                return ('something else already holds port {0}, so {1} stopped (exit {2}) before it was listening' -f $port, $what, $code)
            }
            return ('{0} stopped (exit {1}) before it was listening: {2} {3}' -f $what, $code, ($seen -join ' '), $said)
        }
        $seen.Add($got)
        if ($got.StartsWith($mark + ' listening on ') -and $got.EndsWith(':' + $port)) {
            # Drained from here on, so a chatty child never blocks on a full pipe.
            $null = $proc.StandardOutput.ReadToEndAsync()
            return ''
        }
    }
}
try {
  $live = Join-Path $tmp 'Thornswood-Server'
  $dev  = Join-Path $tmp 'Thornswood-Server-Dev'
  $docs = Join-Path $tmp 'Thornswood-Docs'
  New-Item -ItemType Directory -Force -Path $live, $dev, $docs | Out-Null
  $A = 'a' * 40; $B = 'b' * 40
  function Put-Record([string]$root, [string]$commit) {
    [IO.File]::WriteAllText((Join-Path $root 'server-build.json'),
      ('{ "binary": "scam_native.node", "sha256": "' + ('0' * 64) + '", "source": { "commit": "' + $commit + '" } }'))
  }
  $out = Join-Path $docs 'data\deployed-build.json'

  Yes 'the live root is the live channel' ((Get-ThornswoodDeployedChannel 'C:/Thornswood-Server') -eq 'live')
  Yes 'the dev root is the dev channel' ((Get-ThornswoodDeployedChannel 'C:/Thornswood-Server-Dev') -eq 'dev')
  Yes 'a trailing slash does not change the channel' ((Get-ThornswoodDeployedChannel 'C:\Thornswood-Server-Dev\') -eq 'dev')

  # #3398: the docs root is the folder beside the server root, never a default,
  # so a deploy to a scratch root writes nothing but scratch.
  Yes 'the docs root beside the live root is the box''s site' ((Get-ThornswoodDocsRootBeside 'C:/Thornswood-Server') -eq 'C:/Thornswood-Docs')
  Yes '  beside the dev root too, with backslashes and a trailing one' ((Get-ThornswoodDocsRootBeside 'C:\Thornswood-Server-Dev\') -eq 'C:/Thornswood-Docs')
  Yes '  and beside a scratch root, the scratch folder, never C:/Thornswood-Docs' ((Get-ThornswoodDocsRootBeside $live) -eq ($tmp.Replace('\', '/').TrimEnd('/') + '/Thornswood-Docs'))
  Yes '  and nothing for a root with no folder above it' ((Get-ThornswoodDocsRootBeside 'Thornswood-Server') -eq '')
  $threw = ''
  try { $null = Get-ThornswoodDeployedBuildScript 'C:/Thornswood-Server' '' } catch { $threw = $_.Exception.Message }
  Yes 'the box script refuses to be made with no docs root' ($threw -match 'no docs root')
  $before = $script:sent.Count
  $said = @(Save-ThornswoodDeployedBuild 'u@box' @() $live '')
  Yes '  and a deploy that names none writes nothing and sends nothing, and says so' ($script:sent.Count -eq $before -and [bool]@($said -match '^DEPLOYED BUILD NOT WRITTEN: .*no docs root').Count)
  foreach ($f in 'scripts\deploy\DeployedBuild.ps1', 'scripts\deploy\Deploy-Server.ps1', 'scripts\release\Publish-Server.ps1') {
    $t = [IO.File]::ReadAllText((Join-Path $Repo $f))
    Yes ('  ' + $f + ' gives the docs root no default') ($t -notmatch '\$DocsRoot\s*=\s*''C:')
  }

  Put-Record $live $A
  Remove-Item -LiteralPath $docs -Recurse -Force
  $said = @(Save-ThornswoodDeployedBuild 'u@box' @() $live $docs)
  Yes 'with no site at the docs root, nothing is written and no folder is made' ((-not (Test-Path -LiteralPath $docs)) -and ([bool]@($said -match 'there is no site').Count))
  New-Item -ItemType Directory -Force -Path $docs | Out-Null
  [IO.File]::WriteAllText((Join-Path $docs 'server.js'), '// the site')
  $script:sent = @()
  $said = @(Save-ThornswoodDeployedBuild 'u@box' @('-o', 'BatchMode=yes') $live $docs)
  Yes 'a live deploy goes through the one remote helper, to the target it was given' ($script:sent.Count -eq 1 -and $script:sent[0][0] -eq 'u@box')
  Yes 'a live deploy writes deployed-build.json' ((Test-Path -LiteralPath $out) -and ($said -contains ('DEPLOYED BUILD WRITTEN live ' + $A)))
  $j = Get-Content -LiteralPath $out -Raw | ConvertFrom-Json
  Yes 'it names the box record''s commit for live' ($j.live.commit -eq $A -and $j.live.binary -eq 'scam_native.node' -and ([IO.File]::ReadAllText($out) -match '"at":\s*"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"'))
  Yes 'it has no BOM (node JSON.parse reads it)' ([IO.File]::ReadAllBytes($out)[0] -eq [byte][char]'{')

  Put-Record $dev $B
  $null = Save-ThornswoodDeployedBuild 'u@box' @() $dev $docs
  $j = Get-Content -LiteralPath $out -Raw | ConvertFrom-Json
  Yes 'a dev deploy sets dev and keeps live' ($j.dev.commit -eq $B -and $j.live.commit -eq $A)
  Yes 'no .new file is left behind' (-not (Test-Path -LiteralPath ($out + '.new')))

  # #2711: a deployed-build.json that does not read was written over with no
  # word that the other server's entry had gone with it.
  foreach ($bad in @('{ not json', '')) {
    [IO.File]::WriteAllText($out, $bad)
    $said = @(Save-ThornswoodDeployedBuild 'u@box' @() $dev $docs)
    $j = Get-Content -LiteralPath $out -Raw | ConvertFrom-Json
    Yes ('a file that does not read (' + $(if ($bad) { 'not JSON' } else { 'empty' }) + ') is written with this server alone, and that is said') (
      ($said -contains ('DEPLOYED BUILD WRITTEN dev ' + $B)) -and $j.dev.commit -eq $B -and -not $j.PSObject.Properties['live'] -and
      @($said | Where-Object { $_ -like 'DEPLOYED BUILD NOTE: *did not read*written with the dev server alone' }).Count -eq 1)
  }
  $said = @(Save-ThornswoodDeployedBuild 'u@box' @() $dev $docs)
  Yes 'a file that reads gives no note' (-not @($said | Where-Object { $_ -like 'DEPLOYED BUILD NOTE*' }).Count)
  $null = Save-ThornswoodDeployedBuild 'u@box' @() $live $docs

  $before = [IO.File]::ReadAllText($out)
  [IO.File]::WriteAllText((Join-Path $live 'server-build.json'), '{ "source": { "commit": "nope" } }')
  $said = @(Save-ThornswoodDeployedBuild 'u@box' @() $live $docs)
  Yes 'a record with no real commit writes nothing and says why' (([IO.File]::ReadAllText($out) -eq $before) -and (@($said | Where-Object { $_ -like 'DEPLOYED BUILD NOT WRITTEN*' }).Count -eq 1))
  Remove-Item -LiteralPath (Join-Path $live 'server-build.json')
  $said = @(Save-ThornswoodDeployedBuild 'u@box' @() $live $docs)
  Yes 'a box with no record writes nothing' (([IO.File]::ReadAllText($out) -eq $before) -and ([bool]@($said -match 'there is no').Count))
  function Invoke-ThornswoodArtifactRemote { throw 'ssh said no' }
  $said = @(Save-ThornswoodDeployedBuild 'u@box' @() $live $docs)
  Yes 'a remote that throws does not throw out of a deploy that already succeeded' ([bool]@($said -match 'ssh said no').Count)
  function Invoke-ThornswoodArtifactRemote([string]$Target, [string[]]$SshArgs, [string]$Script) {
    return @(& ([scriptblock]::Create($Script)) | ForEach-Object { "$_".Trim() })
  }

  # The script that goes to the box: quoted paths, channel and stamp, nothing expanded early.
  $s = Get-ThornswoodDeployedBuildScript "C:/Thorn's-Server-Dev" 'C:/Thornswood-Docs' '2026-10-10T00:00:00Z'
  Yes 'the box script quotes paths with an apostrophe' ($s.Contains("'C:\Thorn''s-Server-Dev\server-build.json'"))
  Yes 'the box script writes to the docs data folder for the dev channel' ($s.Contains("'C:\Thornswood-Docs\data\deployed-build.json' 'dev' '2026-10-10T00:00:00Z'"))
  $err = $null; $null = [Management.Automation.PSParser]::Tokenize($s, [ref]$err)
  Yes 'the box script parses' ($err.Count -eq 0)

  # Deploy-Server.ps1 calls it after the swap, and after a put-back.
  $ds = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\deploy\Deploy-Server.ps1'))
  $err = $null; $null = [Management.Automation.PSParser]::Tokenize($ds, [ref]$err)
  Yes 'Deploy-Server.ps1 parses' ($err.Count -eq 0)
  Yes 'Deploy-Server.ps1 loads DeployedBuild.ps1' ($ds -match "\. \(Join-Path \`$Here 'DeployedBuild\.ps1'\)")
  $iSwap = $ds.IndexOf("if (`$swapOut -notcontains 'SWAP OK')")
  $iCur = $ds.IndexOf('Set-ThornswoodArtifactCurrent -Artifact $artifact')
  $iSave = $ds.IndexOf('Save-ThornswoodDeployedBuild "$User@$Vps" $ssh $Root (Get-ThornswoodDocsRootBeside $Root)', $iCur)
  Yes 'it writes the deployed build only after SWAP OK, beside the artifact record' ($iSwap -gt 0 -and $iCur -gt $iSwap -and $iSave -gt $iCur)
  $pb = $ds.Substring($ds.IndexOf('function Invoke-PutBack'))
  $pb = $pb.Substring(0, $pb.IndexOf("`n}") + 2)
  Yes 'a put-back writes it too, after the swap result passes, beside its root' ($pb.IndexOf('Save-ThornswoodDeployedBuild "$User@$Vps" $ssh $Root (Get-ThornswoodDocsRootBeside $Root)') -gt $pb.IndexOf('Show-SwapResult'))

  # Publish-Server.ps1 too (#2303): an engine reaches the dev server that way,
  # and on 11 Oct the file held live alone because only Deploy-Server wrote it.
  $ps = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\release\Publish-Server.ps1'))
  $err = $null; $null = [Management.Automation.PSParser]::Tokenize($ps, [ref]$err)
  Yes 'Publish-Server.ps1 parses' ($err.Count -eq 0)
  Yes 'Publish-Server.ps1 loads DeployedBuild.ps1' ($ps -match "\. \(Join-Path \`$Here '\.\.\\deploy\\DeployedBuild\.ps1'\)")
  $fn = $ps.Substring($ps.IndexOf('function Save-ServerRecords'))
  $fn = $fn.Substring(0, $fn.IndexOf("`n}") + 2)
  Yes 'its record step writes the deployed build for the root it installed, after the deploy record' (
    $fn.IndexOf('Save-ThornswoodDeployedBuild $target $ssh $VpsRoot (Get-ThornswoodDocsRootBeside $VpsRoot)') -gt $fn.IndexOf('Set-ThornswoodServerRecord') -and
    $fn.IndexOf('Save-ThornswoodDeployedBuild $target $ssh $VpsRoot (Get-ThornswoodDocsRootBeside $VpsRoot)') -gt $fn.IndexOf('Restore-ThornswoodServerRecord'))
  $iInst = $ps.IndexOf('Invoke-Installer $instArgs')
  Yes 'a publish runs that step only once the installer has said INSTALL OK' ($iInst -gt 0 -and $ps.IndexOf('Save-ServerRecords', $iInst) -gt $iInst)
  $iBack = $ps.IndexOf('-StartNow -PutBack -Wait $Wait"')
  Yes 'and a put-back runs it too, after its installer' ($iBack -gt 0 -and $ps.IndexOf('Save-ServerRecords -PutBack', $iBack) -gt $iBack)

  # End to end: the file the stubbed deploy wrote is what /credits shows.
  # First live alone, what the box held on 11 Oct (#2303), then both.
  Put-Record $live $A; Put-Record $dev $A
  Remove-Item -LiteralPath $out -Force
  $null = Save-ThornswoodDeployedBuild 'u@box' @() $live $docs
  $app = Join-Path $Repo 'site'
  New-Item -ItemType Directory -Force -Path (Join-Path $docs 'public'), (Join-Path $docs 'data\site') | Out-Null
  Copy-SiteProgram -To $docs -App $app
  Get-ChildItem -LiteralPath (Join-Path $app 'public') -File | Where-Object { $_.Name -eq 'home.html' -or $_.Name -like 'marked-*.js' } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $docs 'public') }
  Copy-Item -LiteralPath (Join-Path $app 'data\site\credits.md') -Destination (Join-Path $docs 'data\site')
  $l = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback, 0); $l.Start(); $port = $l.LocalEndpoint.Port; $l.Stop()
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command node).Source; $psi.Arguments = 'server.js'; $psi.WorkingDirectory = $docs
  $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.EnvironmentVariables['THORNSWOOD_DOCS_PORT'] = "$port"
  $psi.EnvironmentVariables['THORNSWOOD_DOCS_LOCAL'] = '1'
  $psi.EnvironmentVariables['THORNSWOOD_CHAT_DIR'] = (Join-Path $docs 'chat')
  $node = [Diagnostics.Process]::Start($psi)
  $err = $node.StandardError.ReadToEndAsync()
  $said = Wait-OwnLine $node $err '[thornswood-docs]' $port 'the site'
  Yes 'the site says it is listening on its port' ($said -eq '')
  function Credits { if ($said -ne '') { return $null }; try { return (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/credits" -TimeoutSec 10).Content } catch { return $null } }
  $body = Credits
  Yes 'with only live deployed, /credits names the main server''s commit' ($body -and $body.Contains('The main server runs') -and $body.Contains('tree/' + $A) -and -not $body.Contains('test server runs'))
  Yes '  and the hand sentence is gone' ($body -and -not $body.Contains('this page names it here once'))
  $null = Save-ThornswoodDeployedBuild 'u@box' @() $dev $docs
  $body = Credits
  Yes 'after the dev deploy too, /credits says both run the deployed commit' ($body -and $body.Contains('Both servers run') -and $body.Contains('tree/' + $A))
  Yes '  with credits.md untouched' (
    ([IO.File]::ReadAllText((Join-Path $docs 'data\site\credits.md')) -eq [IO.File]::ReadAllText((Join-Path $app 'data\site\credits.md'))))
} finally {
  if ($node -and -not $node.HasExited) { try { $node.Kill(); $node.WaitForExit(3000) | Out-Null } catch { } }
  Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
}
Yes 'the temp folder is gone' (-not (Test-Path -LiteralPath $tmp))
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
