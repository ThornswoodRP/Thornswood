# Read the actual completion blocks without running either Nexus script.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$fail = 0
function Check-Next([string]$Script, [string]$Summary, [string]$Next) {
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $repo "scripts/release/$Script"), [ref]$tokens, [ref]$errors)
    if ($errors) { throw ($errors -join "`n") }
    $at = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and
        $n.GetCommandName() -eq 'Say' -and $n.Extent.Text.Contains($Summary) }, $true))
    if ($at.Count -ne 1) { throw "$Script has no unique completion summary for $Summary" }
    $block = $at[0].Parent.Parent
    $tail = @($block.Statements | Where-Object { $_.Extent.StartOffset -gt $at[0].Extent.EndOffset } |
        ForEach-Object { $_.Extent.Text }) -join "`n"
    if ($tail -match $Next -and $tail -match '(?m)^exit 0$') {
        Write-Host "PASS $Script after $Summary"
    } else {
        Write-Host "FAIL $Script after $Summary does not name its next step before success exit"
        $script:fail++
    }
}
Check-Next 'New-NexusRevision.ps1' 'is published: https://' '(?m)^Say ''  Next: update the collection records.*docs/COLLECTION-REVISIONS\.md.*''$'
Check-Next 'Install-NexusRevision.ps1' 'nothing placed' '(?m)^Say ''  Next: for a draft, compare the layout with the collection record.*docs/COLLECTION-REVISIONS\.md.*''$'
Check-Next 'Install-NexusRevision.ps1' 'linked from the unpacked archives' '(?m)^Say ''  Next: check a draft on Dev before publishing.*docs/COLLECTION-REVISIONS\.md.*''$'
if ($fail) { exit 1 }
