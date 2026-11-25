<#
  test-4210-site-change-checked.ps1

      pwsh -NoProfile -File scripts/tests/test-4210-site-change-checked.ps1

  Issue #4210. Rotate-ServerPassword.ps1, Set-Turnstile.ps1 and
  Deploy-Docs.ps1 -Password sent their change to the box and printed what
  came back without looking at it. When the box refused (nothing arrived,
  config.json would not read, the site did not come back, the form was told
  another key) or said nothing at all, they ended 0, and
  Rotate-ServerPassword said "Done" in green.

  The two scripts run whole, in a scratch copy of scripts\deploy, with the
  box, ssh and the secret prompt stood in. Deploy-Docs's -Password branch
  is lifted out of the script by the parser and run with the same stand-ins,
  since the rest of Deploy-Docs is the site's deploy. Nothing leaves this
  machine.
    1. Rotate-ServerPassword: config.json refused, nothing back, and the
       site not coming back each end 1, say FAILED, and say no "Done"
    2. Rotate-ServerPassword: written and restarted ends 0 and says Done
    3. Set-Turnstile -Off: a refusal and nothing back end 1 with FAILED
    4. Set-Turnstile -Off: the form told no key ends 0
    5. Set-Turnstile: the form told another key ends 1
    6. Deploy-Docs -Password: a refused password file and nothing back end
       1 with FAILED; written ends 0
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$src = Join-Path (Join-Path $Repo 'scripts') 'deploy'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4210-' + [Guid]::NewGuid().ToString('N'))
try {
    $dep = Join-Path (Join-Path $work 'scripts') 'deploy'
    $vps = Join-Path (Join-Path $work 'scripts') 'vps'
    $null = New-Item -ItemType Directory -Force -Path $dep, $vps
    foreach ($f in 'Rotate-ServerPassword.ps1', 'Set-Turnstile.ps1', 'SiteConfigSet.ps1', 'DocsPasswordFile.ps1') {
        Copy-Item -LiteralPath (Join-Path $src $f) -Destination $dep
    }
    $utf8 = New-Object Text.UTF8Encoding $false
    # What the box answers is TS4210_SAYS, lines split on |.
    [IO.File]::WriteAllText((Join-Path $vps 'Vps.ps1'), "function Get-ThornswoodVpsUser { 'x' }`nfunction Get-ThornswoodVpsAddress { '127.0.0.1' }`n", $utf8)
    $box = "@((`$env:TS4210_SAYS -split '\|') | Where-Object { `$_ })"
    [IO.File]::WriteAllText((Join-Path $vps 'Send-Script.ps1'), "function Invoke-ThornswoodRemote { param(`$Target, `$SshArgs, `$Script) $box }`n", $utf8)
    [IO.File]::WriteAllText((Join-Path $vps 'Send-Secret.ps1'), "function Invoke-ThornswoodSecretRemote { param(`$Target, `$SshArgs, `$Secret, `$Script) $box }`nfunction Read-ThornswoodSecret { param(`$Prompt) 'a-secret-typed-here' }`n", $utf8)
    [IO.File]::WriteAllText((Join-Path $vps 'Seal.ps1'), "`n", $utf8)

    $pwsh = (Get-Process -Id $PID).Path
    function Run([string]$file, [string[]]$params, [string]$says) {
        $env:TS4210_SAYS = $says
        try {
            $o = @(& $pwsh -NoProfile -File $file @params 2>&1 | ForEach-Object { "$_" })
            return [pscustomobject]@{ Code = $LASTEXITCODE; Said = ($o -join "`n") }
        } finally { Remove-Item Env:TS4210_SAYS -ErrorAction SilentlyContinue }
    }

    # ---- 1, 2: Rotate-ServerPassword -------------------------------------------
    $rot = Join-Path $dep 'Rotate-ServerPassword.ps1'
    $cases = [ordered]@{
        'config.json refused'     = 'CONFIG.JSON IS THERE AND WILL NOT READ AS JSON. Nothing written, the server password is unchanged.'
        'nothing back'            = ''
        'the site not coming back' = 'set serverPassword, 13 other setting(s) kept|SITE DID NOT COME BACK'
    }
    foreach ($k in $cases.Keys) {
        $r = Run $rot @('-Yes') $cases[$k]
        Yes "1. Rotate-ServerPassword, $k, ends 1 (exit $($r.Code))" ($r.Code -eq 1)
        Yes '   says FAILED and no Done' ($r.Said -match '(?m)^\s*FAILED' -and $r.Said -notmatch '(?m)^\s*Done\.')
    }
    $r = Run $rot @('-Yes') 'set serverPassword, 13 other setting(s) kept|site restarted'
    Yes "2. Rotate-ServerPassword written and restarted ends 0 and says Done (exit $($r.Code))" ($r.Code -eq 0 -and $r.Said -match '(?m)^\s*Done\.' -and $r.Said -notmatch 'FAILED')

    # ---- 3 to 5: Set-Turnstile ---------------------------------------------------
    $ts = Join-Path $dep 'Set-Turnstile.ps1'
    $r = Run $ts @('-Off') 'CONFIG.JSON IS THERE AND WILL NOT READ AS JSON. Nothing written, the turnstile keys is unchanged.'
    Yes "3. Set-Turnstile -Off, config.json refused, ends 1 with FAILED (exit $($r.Code))" ($r.Code -eq 1 -and $r.Said -match '(?m)^\s*FAILED')
    $r = Run $ts @('-Off') ''
    Yes "   and nothing back ends 1 with FAILED (exit $($r.Code))" ($r.Code -eq 1 -and $r.Said -match '(?m)^\s*FAILED')
    $offOk = 'set turnstileSiteKey, 12 other setting(s) kept|set turnstileSecret, 12 other setting(s) kept|site restarted|the report form is told no key: the check is off'
    $r = Run $ts @('-Off') $offOk
    Yes "4. Set-Turnstile -Off, the form told no key, ends 0 (exit $($r.Code))" ($r.Code -eq 0 -and $r.Said -notmatch 'FAILED')
    $r = Run $ts @('-PublicSiteKey', '0x4AAAAAAAtestkey00') 'set turnstileSiteKey, 12 other setting(s) kept|set turnstileSecret, 12 other setting(s) kept|site restarted|THE REPORT FORM IS TOLD ANOTHER KEY, so the check is not on'
    Yes "5. Set-Turnstile, the form told another key, ends 1 with FAILED (exit $($r.Code))" ($r.Code -eq 1 -and $r.Said -match '(?m)^\s*FAILED')

    # ---- 6: Deploy-Docs -Password ------------------------------------------------
    $ddPath = Join-Path $src 'Deploy-Docs.ps1'
    $ast = [Management.Automation.Language.Parser]::ParseFile($ddPath, [ref]$null, [ref]$null)
    $set = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -eq '$Password' -and $n.Extent.Text.Contains('Get-ThornswoodSiteConfigSet') }, $true))
    Yes 'Deploy-Docs has its -Password set branch' ($set.Count -eq 1)
    $child = Join-Path $work 'docs-password.ps1'
    [IO.File]::WriteAllText($child, @"
`$ErrorActionPreference = 'Stop'
. '$((Join-Path $vps 'Send-Script.ps1').Replace("'", "''"))'
. '$((Join-Path $vps 'Send-Secret.ps1').Replace("'", "''"))'
. '$((Join-Path $dep 'SiteConfigSet.ps1').Replace("'", "''"))'
. '$((Join-Path $dep 'DocsPasswordFile.ps1').Replace("'", "''"))'
`$Password = `$true; `$pwFromBox = `$true; `$PasswordFile = 'C:\Thornswood-Secrets\docs-site-password.txt'
`$rootWin = 'C:\Thornswood-Docs'; `$User = 'x'; `$Vps = '127.0.0.1'; `$ssh = @(); `$newPassword = ''
$($set[0].Extent.Text)
exit 0
"@, $utf8)
    $r = Run $child @() 'PASSWORD FILE UNSAFE: BUILTIN\Users is allowed in. Nothing written, the password is unchanged.'
    Yes "6. Deploy-Docs -Password, the password file refused, ends 1 with FAILED (exit $($r.Code))" ($r.Code -eq 1 -and $r.Said -match '(?m)^\s*FAILED')
    $r = Run $child @() ''
    Yes "   and nothing back ends 1 with FAILED (exit $($r.Code))" ($r.Code -eq 1 -and $r.Said -match '(?m)^\s*FAILED')
    $r = Run $child @() 'set password, 13 other setting(s) kept'
    Yes "   and written ends 0 (exit $($r.Code))" ($r.Code -eq 0 -and $r.Said -notmatch 'FAILED')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
