<#
.SYNOPSIS
  Opens the engine pin pull request from engine-pin/next, or brings the open
  one's title and body up to the branch's head commit.

.DESCRIPTION
  Issue #5148, the last step of .github\workflows\engine-pin.yml. The title
  and body are the head commit's own message (Update-EnginePin.ps1 wrote
  them), so the pull request always says what its head is.

  It needs a token that may write pull requests (GH_TOKEN, through gh).
  engine-pin.yml gives it the pin robot's App token (#5256), so the pull
  request it opens starts its checks like anybody's; a pull request the
  run's own token opened waited for a person to approve its checks after the
  move to ThornswoodRP. When GitHub refuses it stops saying why.

  Exit 0: open, with its number printed. 1: why not.

.EXAMPLE
  pwsh scripts/release/Open-EnginePinPr.ps1
#>
[CmdletBinding()]
param(
    [string]$Gh = 'gh'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ForkEngineBuild.ps1')
. (Join-Path $PSScriptRoot 'EnginePin.ps1')
$repo = $EnginePinThornswood
$owner = $repo.Split('/')[0]
function Stop-Here($m) { Write-Host "::error title=Engine pin::$m"; Write-Host "STOP. $m"; exit 1 }
function Invoke-Gh([string[]]$GhArgs) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = @(& $Gh @GhArgs 2>&1 | ForEach-Object { [string]$_ }); $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Code = $code; Text = ($out -join "`n") }
}

$c = Invoke-Gh @('api', "repos/$repo/commits/$([uri]::EscapeDataString($EnginePinBranch))")
if ($c.Code -ne 0) { Stop-Here "there is no $EnginePinBranch to open a pull request from: $($c.Text)" }
$k = $c.Text | ConvertFrom-Json
$msg = ([string]$k.commit.message) -replace "`r`n", "`n"
$cut = $msg.IndexOf("`n")
$title = if ($cut -lt 0) { $msg.Trim() } else { $msg.Substring(0, $cut).Trim() }
$body = if ($cut -lt 0) { '' } else { $msg.Substring($cut + 1).Trim() + "`n" }
if (-not $title.StartsWith('The engine pin moves to')) { Stop-Here "$EnginePinBranch's head $($k.sha) is not a pin commit Update-EnginePin.ps1 made ('$title')" }

$open = Invoke-Gh @('api', "repos/$repo/pulls?state=open&head=$($owner):$([uri]::EscapeDataString($EnginePinBranch))")
if ($open.Code -ne 0) { Stop-Here "the open pull requests could not be read: $($open.Text)" }
$prs = @($open.Text | ConvertFrom-Json | ForEach-Object { $_ })
$file = Join-Path ([IO.Path]::GetTempPath()) ('engine-pin-pr-' + [Guid]::NewGuid().ToString('N') + '.json')
[IO.File]::WriteAllText($file, (([ordered]@{ title = $title; body = $body } | ConvertTo-Json -Compress)), (New-Object Text.UTF8Encoding($false)))
try {
    if ($prs.Count) {
        $n = $prs[0].number
        $r = Invoke-Gh @('api', '-X', 'PATCH', "repos/$repo/pulls/$n", '--input', $file)
        if ($r.Code -ne 0) { Stop-Here "pull request #$n could not be brought up to $($k.sha): $($r.Text)" }
        Write-Host ("pull request #{0} ({1}) is at {2}: {3}" -f $n, $prs[0].html_url, $k.sha.Substring(0, 12), $title)
        exit 0
    }
    [IO.File]::WriteAllText($file, (([ordered]@{ title = $title; body = $body; head = $EnginePinBranch; base = 'main'; maintainer_can_modify = $true } | ConvertTo-Json -Compress)), (New-Object Text.UTF8Encoding($false)))
    $r = Invoke-Gh @('api', '-X', 'POST', "repos/$repo/pulls", '--input', $file)
    if ($r.Code -ne 0) { Stop-Here "GitHub refused the pull request: $($r.Text)" }
    $p = $r.Text | ConvertFrom-Json
    Write-Host ("opened pull request #{0} ({1}) at {2}: {3}" -f $p.number, $p.html_url, $k.sha.Substring(0, 12), $title)
    exit 0
} finally {
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
}
