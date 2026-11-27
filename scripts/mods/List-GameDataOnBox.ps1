<#
.SYNOPSIS
  The deploy gate's List-GameData verb (#5736): runs one of the repository's read-only listers of Skyrim's own data on the box, where the masters are, and prints what it found.

.DESCRIPTION
  The deploy gate's List-GameData verb (#5736): runs one of the repository's
  read-only listers of Skyrim's own data on the box, where the masters are,
  and prints what it found.

      pwsh scripts/vps/Box-Run.ps1 -Line 'List-GameData -Lister KillMoveIdles'
      pwsh scripts/vps/Box-Run.ps1 -Line 'List-GameData -Lister ToolRecords -Server dev'

  WHY. The listers in scripts\dev (List-KillMoveIdles.py for #4507,
  List-ToolRecords.py, List-ArmourMaterials.py for #4650) measure the game's records, which are in the game
  servers' plugins folders on the box and nowhere a cloud session can read.
  They ran through Run-OnBox.ps1 from a machine with ssh to the box, and no
  verb of the gate ran one, so a cloud thread or a Bot could not start one
  and #4507's engine work waited on One (#5754). The killmove fix has to
  follow the IDLE records' conditions as the masters hold them, not form
  ids from memory.

  WHAT RUNS. Only a lister named here, by its short name, never a path: the
  gate's rule for -Lister is the same list. Each is run by Run-OnBox.ps1
  with --data '{data}', so it reads a copy of the chosen server's plugins in
  a run folder of its own under C:\Windows\Temp, which its keeper removes
  (OnBox.ps1). A lister writes nothing, so nothing comes back into this
  checkout and nothing of the box is changed but that run folder.

  WHAT COMES BACK. Every line the lister printed, then "the tool exited N".
  The gate seals the run's output to the session that asked (Box-Run.ps1).

  Exits with the lister's own code, or 1 when it could not be run.
#>
[CmdletBinding()]
param(
    # Which lister, by the end of its name: scripts/dev/List-<Lister>.py.
    [Parameter(Mandatory = $true)]
    [ValidateSet('ArmourMaterials', 'KillMoveIdles', 'ToolRecords')]
    [string]$Lister,

    # Whose plugins: the live server's or the dev server's.
    [ValidateSet('dev', 'main')]
    [string]$Server = 'main',

    # The script the lister is run by. A test gives a stand-in; on the box it
    # is Run-OnBox.ps1.
    [string]$Runner = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Runner) { $Runner = Join-Path $Here 'Run-OnBox.ps1' }

# The lister and what it is run with. Each reads the data folder it is given
# and writes nothing (its own header says so).
$Listers = @{
    'ArmourMaterials' = @('scripts/dev/List-ArmourMaterials.py', '--data', '{data}', '--plugins', '{plugins}')
    'KillMoveIdles' = @('scripts/dev/List-KillMoveIdles.py', '--data', '{data}')
    'ToolRecords'   = @('scripts/dev/List-ToolRecords.py', '--data', '{data}')
}
$run = $Listers[$Lister]
Write-Host ("listing with $($run[0]) against the $Server server's plugins")
& $Runner -Script $run[0] -Arguments ([string[]]$run[1..($run.Count - 1)]) -Server $Server
exit $LASTEXITCODE
