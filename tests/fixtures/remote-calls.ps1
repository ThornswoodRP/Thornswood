# The remote calls under scripts\ and the text each one owns (#2182, #2498).
# Dot-sourced by tests\test-remote-command-map.ps1; defines functions only.

$RemoteCallNames = @('Invoke-ThornswoodRemote', 'Invoke-ThornswoodSecretRemote', 'Invoke-ThornswoodArtifactRemote',
    'Send-ThornswoodArtifactFile', 'Start-ThornswoodRemote', 'Remote', 'ssh', 'scp', 'ssh-keyscan')

# How many source lines above a call count as its own, for an anchor when
# several calls in one scope send the same text (Remote @", Remote $sample).
$RemoteCallLinesAbove = 3

# Every remote call: Key (script|scope|via), Line, Own (the whole source lines
# the call spans) and Above (the $RemoteCallLinesAbove lines above it).
function Get-RemoteCalls([string]$Root) {
    $found = New-Object System.Collections.Generic.List[object]
    $files = Get-ChildItem -LiteralPath (Join-Path $Root 'scripts') -Recurse -File |
        Where-Object { $_.Extension -eq '.ps1' -or $_.Extension -eq '.psm1' } |
        # Not the scripts' own harnesses in scripts\tests (#5341): their calls go to stand-ins.
        Where-Object { $_.FullName.Substring($Root.Length) -notmatch '^[\\/]scripts[\\/]tests[\\/]' } | Sort-Object FullName
    foreach ($f in $files) {
        $tokens = $null; $errs = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errs)
        $src = [IO.File]::ReadAllText($f.FullName) -split "`r?`n"
        $rel = $f.FullName.Substring($Root.Length + 1).Replace('\', '/')
        $cmds = $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.CommandAst] }, $true) |
            Sort-Object { $_.Extent.StartOffset }
        foreach ($c in $cmds) {
            $n = $c.GetCommandName()
            if ($n) { $n = $n -replace '(?i)\.exe$', '' }
            $via = $null
            if ($n -and ($RemoteCallNames -contains $n)) { $via = $n }
            elseif ($c.CommandElements[0].Extent.Text -match 'Remote\.ps1') { $via = 'Remote.ps1' }
            if (-not $via) { continue }
            $scope = '<top>'
            $p = $c.Parent
            while ($p) {
                if ($p -is [System.Management.Automation.Language.FunctionDefinitionAst]) { $scope = $p.Name; break }
                $p = $p.Parent
            }
            $first = [Math]::Max(1, $c.Extent.StartLineNumber - $RemoteCallLinesAbove)
            $own = @($src[($c.Extent.StartLineNumber - 1)..($c.Extent.EndLineNumber - 1)])
            $above = @()
            if ($c.Extent.StartLineNumber -gt 1) { $above = @($src[($first - 1)..($c.Extent.StartLineNumber - 2)]) }
            $found.Add([pscustomobject]@{
                Key = $rel + '|' + $scope + '|' + $via; Script = $rel; Scope = $scope; Via = $via
                Line = $c.Extent.StartLineNumber; Own = $own; Above = $above
            })
        }
    }
    return , $found
}

# The calls of one script|scope|via an anchor names. A call's own lines come
# first: the lines above count only when no call of that key holds the anchor
# in its own lines, so a call's text never also names the call below it.
function Find-RemoteCallsByAnchor($Calls, [string]$Key, [string]$Anchor) {
    if (-not $Anchor.Trim()) { return @() }
    $same = @($Calls | Where-Object { $_.Key -eq $Key })
    $own = @($same | Where-Object { ($_.Own -join "`n").Contains($Anchor) })
    if ($own.Count) { return $own }
    return @($same | Where-Object { ($_.Above -join "`n").Contains($Anchor) })
}