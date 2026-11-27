<#
  test-4346-one-secret-reader.ps1

      pwsh -NoProfile -File .\tests\test-4346-one-secret-reader.ps1

  Every script that asks for a secret asks through Read-ThornswoodSecret
  (scripts\vps\Send-Secret.ps1), and nothing else calls a hidden prompt of
  its own (issue #4346).

  WHY. With no keyboard (a cloud Desk, a pipe, a runner), PowerShell's hidden
  prompt, Read-Host -AsSecureString, ends the whole script on the spot with
  exit code 0 and prints nothing, so a run looks finished when nothing was
  sent (measured in PowerShell 7.6, #3216). Read-ThornswoodSecret reads one
  line of standard input then, and is hidden at a keyboard. Twelve prompts in
  eleven scripts asked on their own until #4346.

  HOW. Every .ps1 and .psm1 in the repository outside node_modules and .git is
  parsed, and each command in it is read: a Read-Host with -AsSecureString or
  -MaskInput, or a Get-Credential, anywhere but inside Read-ThornswoodSecret
  in Send-Secret.ps1, is named with its file and line. The same scan then runs
  over planted files, so it is known to catch each shape, and to pass a
  script that asks through the reader. Read only.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

# The hidden prompts in the scripts under $root, as 'path:line  text', with
# the one in Read-ThornswoodSecret left out.
function Find-HiddenPrompts([string]$root) {
    $skip = '[\\/](node_modules|\.git)[\\/]'
    $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -Include '*.ps1', '*.psm1' -ErrorAction SilentlyContinue |
               Where-Object { $_.FullName.Substring($root.Length) -notmatch $skip })
    $found = New-Object System.Collections.Generic.List[string]
    foreach ($f in $files) {
        $errs = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errs)
        $rel = $f.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
        foreach ($c in @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true))) {
            $name = [string]$c.GetCommandName()
            $hidden = $false
            if ($name -eq 'Get-Credential') { $hidden = $true }
            elseif ($name -eq 'Read-Host') {
                $hidden = @($c.CommandElements | Where-Object { $_ -is [System.Management.Automation.Language.CommandParameterAst] -and 'AsSecureString', 'MaskInput' -contains $_.ParameterName }).Count -gt 0
            }
            if (-not $hidden) { continue }
            $p = $c.Parent
            while ($p -and $p -isnot [System.Management.Automation.Language.FunctionDefinitionAst]) { $p = $p.Parent }
            if ($rel -eq 'scripts/vps/Send-Secret.ps1' -and $p -and $p.Name -eq 'Read-ThornswoodSecret') { continue }
            $found.Add(('{0}:{1}  {2}' -f $rel, $c.Extent.StartLineNumber, $c.Extent.Text))
        }
    }
    return $found.ToArray()
}

# ---- the repository
$found = @(Find-HiddenPrompts $repo)
Yes ('no script asks for a secret with a hidden prompt of its own' + $(if ($found.Count) { ': ' + ($found -join ' | ') } else { '' })) ($found.Count -eq 0)
$send = Get-Content -LiteralPath (Join-Path $repo 'scripts\vps\Send-Secret.ps1') -Raw
Yes 'Read-ThornswoodSecret reads standard input when there is no keyboard, and Read-Host -AsSecureString when there is' (
    $send -match '(?s)function Read-ThornswoodSecret\(.*?\[Console\]::IsInputRedirected.*?\[Console\]::In\.ReadLine\(\).*?Read-Host \$Prompt -AsSecureString')
$users = @(Get-ChildItem -LiteralPath (Join-Path $repo 'scripts') -Recurse -File -Include '*.ps1' |
           Where-Object { $_.FullName -notmatch '[\\/]tests[\\/]' -and (Get-Content -LiteralPath $_.FullName -Raw) -match 'Read-ThornswoodSecret ' } |
           ForEach-Object { $_.Name } | Sort-Object -Unique)
foreach ($n in 'Set-DevNews.ps1', 'Set-DiscordLogin.ps1', 'Rotate-BotToken.ps1', 'Apply-Discord.ps1', 'Set-DiscordOnboarding.ps1', 'Install-Bot.ps1',
               'Undo-DiscordBuild.ps1', 'Add-SkyrimUnbound.ps1', 'Set-NexusKey.ps1', 'Watch-Services.ps1', 'Setup-SshKey.ps1') {
    Yes "  $n asks through Read-ThornswoodSecret" ($users -contains $n)
}

# ---- planted
$plant = Join-Path ([IO.Path]::GetTempPath()) ('ts-4346-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $plant 'scripts\vps'), (Join-Path $plant 'node_modules\x')
    $shapes = [ordered]@{
        'a.ps1' = '$ss = Read-Host ''  Paste it'' -AsSecureString'
        'b.ps1' = '$p = Read-Host -AsSecureString ''x'''
        'c.ps1' = '$p = Read-Host ''x'' -MaskInput'
        'd.ps1' = '$c = Get-Credential'
        'e.psm1' = 'function Ask { Read-Host ''x'' -AsSecureString }'
    }
    foreach ($k in $shapes.Keys) { [IO.File]::WriteAllText((Join-Path $plant $k), $shapes[$k]) }
    [IO.File]::WriteAllText((Join-Path $plant 'fine.ps1'), ". (Join-Path `$PSScriptRoot 'scripts\vps\Send-Secret.ps1')`n`$t = Read-ThornswoodSecret '  Paste it'`n`$n = Read-Host 'Your name'")
    [IO.File]::WriteAllText((Join-Path $plant 'scripts\vps\Send-Secret.ps1'), "function Read-ThornswoodSecret([string]`$Prompt) { Read-Host `$Prompt -AsSecureString }`nfunction Other { Read-Host 'x' -AsSecureString }")
    [IO.File]::WriteAllText((Join-Path $plant 'node_modules\x\vendor.ps1'), 'Read-Host ''x'' -AsSecureString')
    $got = @(Find-HiddenPrompts $plant)
    foreach ($k in $shapes.Keys) { Yes ("the scan catches $k  " + $shapes[$k]) (@($got | Where-Object { $_ -like ($k + ':*') }).Count -eq 1) }
    Yes 'it passes a script that asks through the reader and reads a name in the open' (@($got | Where-Object { $_ -like 'fine.ps1:*' }).Count -eq 0)
    Yes 'in Send-Secret.ps1 it passes Read-ThornswoodSecret, and catches any other function there' (
        @($got | Where-Object { $_ -like 'scripts/vps/Send-Secret.ps1:1 *' }).Count -eq 0 -and @($got | Where-Object { $_ -like 'scripts/vps/Send-Secret.ps1:2 *' }).Count -eq 1)
    Yes 'and it does not read node_modules' (@($got | Where-Object { $_ -like 'node_modules/*' }).Count -eq 0)
} finally {
    Remove-Item -LiteralPath $plant -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
