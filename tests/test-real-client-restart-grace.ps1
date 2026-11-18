<#
  Executes the real launcher's restart-wait block with process and clock
  doubles. No apps start, no window APIs run, and no real sleeps occur.
#>
$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot '..\scripts\dev\Run-RealClient.ps1'
$code=[IO.File]::ReadAllText($path)
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($code,[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
$loop=$ast.Find({param($n) $n -is [Management.Automation.Language.WhileStatementAst] -and $n.Condition.Extent.Text -eq '-not $pressed'},$true)
if(-not $loop){throw 'Actual Play wait loop was not found'}
$begin=$loop.Body.Extent.StartOffset+1
$end=$code.IndexOf('$launcher.Refresh()',$begin)
if($end -lt $begin -or $end -ge $loop.Body.Extent.EndOffset){throw 'Actual restart-wait boundary was not found'}
$prefix=$code.Substring($begin,$end-$begin)
function Get-Date { $script:fixtureNow }
function Get-Process { param($Name,$ErrorAction) $script:fixtureNext }
function Start-Sleep { param($Milliseconds) $script:fixtureSleeps++ }
function Say { param($text) $script:fixtureNotes.Add($text) }
$template=@'
param($ticks,$exitTime)
$launcher=[pscustomobject]@{Id=1;HasExited=$true;ExitCode=$null;ExitTime=$exitTime}
$launcherExe='X:\fixture\Thornswood.exe'
$launcherGoneSince=$null
$deadline=[DateTime]::MaxValue
$toldWaiting=$true
$script:fixtureSleeps=0
$script:fixtureNotes=[Collections.Generic.List[string]]::new()
$stoppedAt=$null;$why='';$alive=0
foreach($tick in $ticks){
    $script:fixtureNow=([DateTime]'2026-11-17T12:00:00').AddSeconds($tick.at)
    $script:fixtureNext=$tick.next
    if($tick.ContainsKey('alive')){$launcher.HasExited=-not $tick.alive}
    try{
__PREFIX__
        $alive++
    }catch{$stoppedAt=$tick.at;$why=$_.Exception.Message;break}
}
[pscustomobject]@{StoppedAt=$stoppedAt;Why=$why;Id=$launcher.Id;Sleeps=$script:fixtureSleeps;Notes=$script:fixtureNotes.ToArray();Alive=$alive}
'@
$run=[ScriptBlock]::Create($template.Replace('__PREFIX__',$prefix))
$script:failed=0;$script:passed=0
function Yes([string]$label,[bool]$ok){if($ok){$script:passed++;Write-Host "PASS $label"}else{$script:failed++;Write-Host "FAIL $label"}}
$r=& $run @(@{at=0},@{at=119}) $null
Yes 'unavailable exit metadata does not expire a newly observed restart' ($null -eq $r.StoppedAt -and $r.Sleeps -eq 2)
$r=& $run @(@{at=0},@{at=119}) ([DateTime]::MinValue)
Yes 'old process metadata cannot shorten the observed grace' ($null -eq $r.StoppedAt)
$r=& $run @(@{at=0},@{at=119},@{at=120}) $null
Yes 'a missing replacement still fails after two elapsed minutes' ($r.StoppedAt -eq 120 -and $r.Why -match 'two minutes')
$replacement=[pscustomobject]@{Id=2;Path='X:\fixture\Thornswood.exe';HasExited=$true;ExitTime=$null;ExitCode=$null}
$r=& $run @(@{at=0},@{at=60;next=$replacement},@{at=61},@{at=180},@{at=181}) $null
Yes 'the matching replacement is followed' ($r.Id -eq 2 -and $r.Notes.Count -eq 1)
Yes 'a second restart gets its own full grace' ($r.StoppedAt -eq 181)
$r=& $run @(@{at=0},@{at=100;alive=$true},@{at=200;alive=$false},@{at=319},@{at=320}) $null
Yes 'seeing the launcher alive resets the previous restart wait' ($r.Alive -eq 1 -and $r.StoppedAt -eq 320)
Write-Host "$script:passed passed, $script:failed failed"
if($script:failed){exit 1}
