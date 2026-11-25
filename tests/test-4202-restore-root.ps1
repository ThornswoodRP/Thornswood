<#
  #4202: exercise the real restore's not-running guard with stand-in process
  and UDP reads. Never runs a server, opens a backup or reaches the box.
  A sibling dev path must not block live; live must still block the restore,
  including the port-owner and parent paths used for a relative start.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$text = Get-Content -LiteralPath (Join-Path $repo 'scripts/vps/Restore-Server.ps1') -Raw
$start = $text.IndexOf("Head 'Is its server running'")
$end = $text.IndexOf("Head 'Opening the backup'", $start)
if ($start -lt 0 -or $end -le $start) { throw 'Restore guard boundaries missing' }
$guard = [scriptblock]::Create($text.Substring($start, $end - $start))
# Load only the path helper, if present. Main has none; its real guard still runs.
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Restore script does not parse' }
foreach ($fn in @($ast.FindAll({ param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Test-RestoreProcessRoot' }, $true))) {
    . ([scriptblock]::Create($fn.Extent.Text))
}
function Head($m) {}
function Say($m, $c) {}
function Die($m) { throw ('REFUSED: ' + $m) }
function Join-Path($Path, $ChildPath) { return ($Path.TrimEnd('\', '/') + '\' + $ChildPath) }
function Test-Path { return $script:portCheck }
function Get-Content { return '{"port":7777}' }
function Get-NetUDPEndpoint { return @([pscustomobject]@{ OwningProcess = 200 }) }
function Get-CimInstance($ClassName, $Filter) {
    if ($script:failRead) { throw 'Process list unavailable' }
    if ($Filter) {
        if ($Filter -eq 'ProcessId = 200') { return $script:owner }
        if ($Filter -eq 'ProcessId = 201') { return $script:parent }
        return $null
    }
    return $script:processes
}
function Proc($line, $name = 'node.exe', $id = 200) {
    return [pscustomobject]@{ ProcessId = $id; ParentProcessId = 201; Name = $name; CommandLine = $line }
}
$script:pass = 0; $script:fail = 0
function Case($name, $line, $wantRefused, $root = 'C:\Thornswood-Server', $viaPort = $false, $viaParent = $false) {
    $Root = $root
    $script:portCheck = $viaPort
    $script:processes = @()
    $script:owner = Proc 'node server.js'
    $script:parent = $null
    if ($viaParent) { $script:parent = Proc $line 'cmd.exe' 201 }
    elseif ($viaPort) { $script:owner = Proc $line }
    else { $script:processes = @(Proc $line) }
    $refused = $false
    try { & $guard } catch {
        if ($_.Exception.Message -notlike 'REFUSED:*') { throw }
        $refused = $true
    }
    if ($refused -eq $wantRefused) { $script:pass++; Write-Host "PASS $name" }
    else { $script:fail++; Write-Host "FAIL $name (refused=$refused, wanted=$wantRefused)" }
}
Case 'dev executable is not live' 'node "C:\Thornswood-Server-Dev\skymp5-server.js"' $false
Case 'live executable blocks live' 'node "C:\Thornswood-Server\skymp5-server.js"' $true
Case 'unquoted live path blocks live' 'node C:\Thornswood-Server\skymp5-server.js' $true
Case 'live match ignores case' 'node "c:\THORNSWOOD-server\skymp5-server.js"' $true
Case 'forward slash live path blocks live' 'node "C:/Thornswood-Server/skymp5-server.js"' $true
Case 'quoted working folder blocks live' 'node server.js --cwd "C:\Thornswood-Server"' $true
Case 'longer sibling name is not live' 'node "C:\Thornswood-Server2\skymp5-server.js"' $false
Case 'suffix of another path is not live' 'node "D:\copies\C:\Thornswood-Server\skymp5-server.js"' $false
Case 'root with spaces and regex punctuation blocks its server' 'node "C:\Server (live)\skymp5-server.js"' $true 'C:\Server (live)'
Case 'root with trailing separator blocks its server' 'node "C:\Thornswood-Server\skymp5-server.js"' $true 'C:\Thornswood-Server\'
Case 'dev UDP owner is not live' 'node "C:\Thornswood-Server-Dev\skymp5-server.js"' $false 'C:\Thornswood-Server' $true
Case 'live UDP owner blocks live' 'node "C:\Thornswood-Server\skymp5-server.js"' $true 'C:\Thornswood-Server' $true
Case 'relative dev start parent is not live' 'cmd /c cd /d "C:\Thornswood-Server-Dev" && node skymp5-server.js' $false 'C:\Thornswood-Server' $true $true
Case 'relative live start parent blocks live' 'cmd /c cd /d "C:\Thornswood-Server" && node skymp5-server.js' $true 'C:\Thornswood-Server' $true $true
$script:failRead = $true
Case 'an unreadable process list refuses the restore' 'node server.js' $true
$script:failRead = $false
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
