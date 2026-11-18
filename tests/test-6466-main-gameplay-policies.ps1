$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/ops/MainGameplayPolicies.ps1')
. (Join-Path $PSScriptRoot '../scripts/vps/gate/GateRules.ps1')
$tmp = Join-Path $PSScriptRoot ('../temp/policies-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory $tmp -Force
$passed = 0
function Yes($what, $ok) { if (-not $ok) { throw $what }; $script:passed++; Write-Host "PASS $what" }
function Fixture {
    $root = Join-Path $tmp ([guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory $root
    $s = [ordered]@{ thornswoodServer='main'; port=7777; bannedEspmCharacterRaceIds=@(); dataDir='data'; discordAuth=@{secret='keep me'}; maxPlayers=30; nested=@{array=@(1,2)} }
    $s | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $root 'server-settings.json')
    @{source=@{commit='b0b869cb31667738c791b97067b693e8f5b59b00'}} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $root 'server-build.json')
    return $root
}
function RefusesUnchanged($root, $what) {
    $file = Join-Path $root 'server-settings.json'
    $before = [IO.File]::ReadAllText($file)
    $threw = $false
    try { Invoke-ThornswoodMainGameplayPolicies $root } catch { $threw=$true }
    Yes $what ($threw -and [IO.File]::ReadAllText($file) -ceq $before)
}
try {
    $root = Fixture
    $file = Join-Path $root 'server-settings.json'
    if ($IsWindows) {
        $acl=Get-Acl $file
        $acl.SetAccessRuleProtection($true,$false)
        $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow'))
        Set-Acl -LiteralPath $file -AclObject $acl
    }
    $before = [IO.File]::ReadAllText($file)
    $beforeHash=(Get-FileHash $file).Hash
    $result = Invoke-ThornswoodMainGameplayPolicies $root
    $after = Get-Content $file -Raw | ConvertFrom-Json -AsHashtable
    Yes 'stages the two approved policies' ($result -eq 'staged' -and $after.thornswoodLoadOrderRefuse -eq $true -and ($after.bannedEspmCharacterRaceIds -join ',') -eq '1078794')
    $original = $before | ConvertFrom-Json -AsHashtable
    $after.Remove('thornswoodLoadOrderRefuse'); $after.bannedEspmCharacterRaceIds=@()
    Yes 'preserves every other key including secrets, capacity and nested arrays' (($after | ConvertTo-Json -Depth 30 -Compress) -ceq ($original | ConvertTo-Json -Depth 30 -Compress))
    Yes 'backs up exact original bytes' ((Get-FileHash ($file+'.before-6466')).Hash -ceq $beforeHash)
    if ($IsWindows) { Yes 'retains the settings access rules' ((Get-Acl $file).Sddl -ceq (Get-Acl ($file+'.before-6466')).Sddl) }
    $hash = (Get-FileHash $file).Hash
    Yes 'repeat is a no-op' ((Invoke-ThornswoodMainGameplayPolicies $root) -eq 'unchanged' -and (Get-FileHash $file).Hash -eq $hash)
    foreach ($bad in @(@{thornswoodServer='dev'}, @{thornswoodServer=@()}, @{thornswoodServer=@('main')}, @{port=7779}, @{port=@()}, @{port=@(7777)}, @{bannedEspmCharacterRaceIds=@(42)}, @{bannedEspmCharacterRaceIds=@('1078794')}, @{thornswoodLoadOrderRefuse=$false}, @{thornswoodLoadOrderRefuse='True'})) {
        $root = Fixture; $file = Join-Path $root 'server-settings.json'
        $s = Get-Content $file -Raw | ConvertFrom-Json -AsHashtable
        foreach ($k in $bad.Keys) { $s[$k]=$bad[$k] }
        $s | ConvertTo-Json -Depth 20 | Set-Content $file
        RefusesUnchanged $root ('refuses unexpected '+($bad.Keys -join ','))
    }
    $root=Fixture; '{broken' | Set-Content (Join-Path $root 'server-settings.json'); RefusesUnchanged $root 'refuses malformed settings'
    $root=Fixture; '{"source":{"commit":"different"}}' | Set-Content (Join-Path $root 'server-build.json'); RefusesUnchanged $root 'refuses another source engine'
    foreach ($commitValue in @('[]','["b0b869cb31667738c791b97067b693e8f5b59b00"]')) {
        $root=Fixture; ('{"source":{"commit":'+$commitValue+'}}') | Set-Content (Join-Path $root 'server-build.json'); RefusesUnchanged $root 'refuses non-scalar engine source'
    }
    Assert-ThornswoodMainPolicyDeployment ([pscustomobject]@{commit='dd4c7c336131b0d741327db31a6cffc1a5c7c949';name='build-1.3.93'})
    foreach ($badRecord in @(@{commit=@();name='build-1.3.93'}, @{commit='dd4c7c336131b0d741327db31a6cffc1a5c7c949';name=@()}, @{commit=@('dd4c7c336131b0d741327db31a6cffc1a5c7c949');name='build-1.3.93'}, @{commit='different';name='build-1.3.93'})) {
        $threw=$false; try { Assert-ThornswoodMainPolicyDeployment ([pscustomobject]$badRecord) } catch { $threw=$true }
        Yes 'refuses malformed or different deployment record' $threw
    }
    $root=Fixture; 'existing backup' | Set-Content (Join-Path $root 'server-settings.json.before-6466'); RefusesUnchanged $root 'does not overwrite an existing migration backup'
    $root=Fixture; $file=Join-Path $root 'server-settings.json'
    $raw=[IO.File]::ReadAllText($file).Replace('"maxPlayers": 30', '"maxPlayers": 30, "precise": 123456789012345678901234567890')
    [IO.File]::WriteAllText($file,$raw)
    $null=Invoke-ThornswoodMainGameplayPolicies $root
    Yes 'preserves large unrelated JSON numbers exactly' ([IO.File]::ReadAllText($file).Contains('123456789012345678901234567890'))
    $verbs=Read-ThornswoodGateVerbs (Join-Path $PSScriptRoot '../scripts/vps/gate/verbs.json')
    $commit='a'*40
    $ok=Test-ThornswoodGateRequest -Line "Stage-MainGameplayPolicies -Build $commit" -Verbs $verbs
    Yes 'gate requires an exact Main commit' ($ok.Ok -and $ok.Build -eq $commit -and -not (Test-ThornswoodGateRequest -Line 'Stage-MainGameplayPolicies' -Verbs $verbs).Ok)
    Yes 'gate accepts no arbitrary path or policy payload' (-not (Test-ThornswoodGateRequest -Line "Stage-MainGameplayPolicies -Build $commit -Root test" -Verbs $verbs).Ok)
    Write-Host "$passed passed"
} finally { Remove-Item -LiteralPath $tmp -Recurse -Force }
