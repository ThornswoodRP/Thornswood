# test-5190-docs-agent-site.ps1
#
# Once the box deploy agent has the site (#5190), every merge's Release puts
# the site's app and public pages in, and Deploy-Docs.ps1 sends neither: two
# senders of the same files would each put back what the other put in.
# Deploy-Docs asks the box whether the agent's agent.json names the site.
#
# This lifts that question out of Deploy-Docs and runs it with
# Invoke-ThornswoodRemote standing in for ssh (the script it would send runs
# in Windows PowerShell 5.1 when this machine has it, as on the box, and in
# this shell otherwise), against a planted agent.json in a scratch folder:
#   - no agent.json, or one that does not name the site: the app goes as
#     before;
#   - one that names the site: the app and the public pages are not sent;
#   - one that does not read: it stops, nothing sent;
#   - -Site with the agent holding the site: refused, nothing sent.
# And it reads Deploy-Docs for the rest: the stage, the swap and the public
# pages wait on it, and the documents, -Password and the task do not.
# It touches nothing outside its scratch folder.
#
#   pwsh -File tests\test-5190-docs-agent-site.ps1
param([string]$Path)
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Path) { $Path = Join-Path $repo 'scripts\deploy\Deploy-Docs.ps1' }

$pass = 0; $fail = 0
function yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host ('PASS  ' + $what) }
    else { $script:fail++; Write-Host ('FAIL  ' + $what) }
}

$text = [IO.File]::ReadAllText($Path)
$start = $text.IndexOf('$agentSite = $false')
$end = $text.IndexOf('# What goes up is the site artifact')
yes 'Deploy-Docs.ps1 asks whether the agent has the site before the artifact is built or sent' ($start -ge 0 -and $end -gt $start)
if ($start -lt 0 -or $end -le $start) { Write-Host ''; Write-Host ("{0} passed, {1} failed" -f $pass, $fail); exit 1 }
$lines = $text.Substring($start, $end - $start)

. (Join-Path $PSScriptRoot 'Windows.ps1')
if ($OnWindows) { $shell = Get-WindowsPowerShell }
else {
    $shell = (Get-Process -Id $PID).Path
    Write-Host 'NOTE  the far side runs in this shell, not in Windows PowerShell 5.1 as on the box: this is not Windows'
}

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-5190-docs-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
try {
    $script:asked = 0
    function Invoke-ThornswoodRemote([string]$Target, [string[]]$SshArgs, [string]$Script) {
        $script:asked++
        return & $shell -NoProfile -NonInteractive -Command $Script 2>&1
    }
    $User = 'tw'; $Vps = '192.0.2.1'; $ssh = @()
    $AgentConfig = Join-Path $scratch 'agent.json'

    function Ask([bool]$site = $false, [bool]$putBack = $false) {
        $script:Site = [switch]$site; $script:PutBack = [switch]$putBack
        $script:agentSite = $null
        $out = [ordered]@{ Threw = $null; Said = '' }
        try { $out.Said = (& ([ScriptBlock]::Create($lines + "`n`$script:agentSite = `$agentSite")) 6>&1 | ForEach-Object { "$_" }) -join ' / ' }
        catch { $out.Threw = $_.Exception.Message }
        return [pscustomobject]$out
    }

    $r = Ask
    yes 'no agent.json: the agent does not have the site, and the app goes as before' (-not $r.Threw -and $script:agentSite -eq $false)

    [IO.File]::WriteAllText($AgentConfig, '{"repo":"ThornswoodRP/Thornswood","environments":{"dev":{}}}')
    $r = Ask
    yes 'an agent.json naming only dev: the app goes as before' (-not $r.Threw -and $script:agentSite -eq $false)

    [IO.File]::WriteAllText($AgentConfig, '{"repo":"ThornswoodRP/Thornswood","environments":{"dev":{},"site":{"logDir":"x"}}}')
    $r = Ask
    yes 'an agent.json naming the site: the app and the public pages are not sent, and it says so' (-not $r.Threw -and $script:agentSite -eq $true -and
        $r.Said -match 'deploy agent has the site')
    $r = Ask -site $true
    yes '-Site with the agent holding the site is refused, naming the way back by tag' ($r.Threw -match '-Site' -and $r.Threw -match 'Deploy-Release -Environment site -Tag' -and $r.Threw -match 'Nothing was sent')

    [IO.File]::WriteAllText($AgentConfig, '{ not json')
    $r = Ask
    yes 'an agent.json that does not read stops it before anything is sent' ($r.Threw -match 'did not say whether the deploy agent has the site' -and $r.Threw -match 'Nothing was sent')

    $script:asked = 0
    $r = Ask -putBack $true
    yes '-PutBack does not ask: it puts back the newest .prev, which the agent''s swap leaves the same way' (-not $r.Threw -and $script:asked -eq 0)
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

# The rest of Deploy-Docs, read.
yes 'the stage and the swap wait on it: with the agent holding the site the app counts as unchanged and nothing is staged' (
    $text.Contains('if ($agentSite) { $appUnchanged = $true }') -and $text.Contains('if (-not $PutBack -and -not $agentSite) {'))
$pages = $text.IndexOf('if (-not $agentSite) {')
yes 'and so do the public pages' ($pages -gt 0 -and $text.IndexOf("Get-ChildItem (Join-Path `$App 'data/site')", $pages) -gt $pages)
yes 'the documents, -Password and the task do not' ($text.IndexOf("Write-Host 'Documents...'") -gt $pages -and -not ($text -match 'if \(\$agentSite\)[^\n]*(Password|Documents)'))
yes 'the header says so' ($text.Contains('ONCE THE DEPLOY AGENT HAS THE SITE (#5190)'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $pass, $fail)
if ($fail) { exit 1 }
exit 0
