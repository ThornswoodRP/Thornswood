<#
  Get-ScratchDir.ps1

      & (Join-Path $PSScriptRoot 'Get-ScratchDir.ps1') 'Thornswood-launcher-Thornswood'

  Says where a short-lived build scratch folder goes, so Ship and
  Install-Thornswood take their launcher build (and the CI setup stub)
  from one place instead of each calling [IO.Path]::GetTempPath().

  WHY. Patrick, 28 September: every build scratch root and temp file goes
  under one temps folder, never %TEMP%. Until this helper, Ship.ps1 and
  Install-Thornswood.ps1 both staged the launcher under GetTempPath(), so two
  Ships from two worktrees for the same Root shared one %TEMP% folder and
  could pick up each other's exe (issue #1272).

  WHERE. The repository's own temp folder, ignored by git (Patrick, 20 Oct,
  #2900: "temp files and folders and work trees should move into the repo
  folder and just be gitignored"). From a worktree it is the main checkout's
  temp, not one inside the worktree, so every checkout on the machine shares
  one temps folder as before and a path stays as short as it can. A broken
  worktree link stops with a sentence rather than guess another folder. Until #2900
  it was C:\ThornswoodTemps&Worktrees\temp on One.

  OVERRIDE. THORNSWOOD_SCRATCH_ROOT, when set, replaces the temps folder.
  scripts\tests\test-ship-dry-run.ps1 points it at its own sandbox so a dry run never
  writes beside the real temps tree. Outside a git checkout (a copy of the
  scripts with no repository round them), falls back to
  [IO.Path]::GetTempPath() so they still run.

  It makes the temps folder itself when it is not there yet (a fresh clone
  has none), so a caller can put a file straight into it as it could into
  the system's temp folder (#4264). It never makes the task's own folder, and
  prints nothing but the one path. Callers that write use -LiteralPath, so a
  folder with [ or & in its name still works.

.PARAMETER Task
  Folder name under the scratch root, for example
  Thornswood-launcher-Thornswood or Thornswood-setup-Thornswood.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Task
)

if (-not $Task) { throw 'Get-ScratchDir.ps1 needs a Task name.' }

$base = $env:THORNSWOOD_SCRATCH_ROOT
if (-not $base) {
    # The checkout this script is in, and from it the main checkout, read
    # from git's own files rather than by running git: in the main checkout
    # .git is a folder; in a worktree it is a file naming the worktree's
    # folder under the main .git\worktrees, and that folder's commondir file
    # names the main .git, relative to it.
    $checkout = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $dotGit = Join-Path $checkout '.git'
    $main = $null
    if (Test-Path -LiteralPath $dotGit -PathType Container) {
        $main = $checkout
    } elseif (Test-Path -LiteralPath $dotGit -PathType Leaf) {
        $m = [regex]::Match([IO.File]::ReadAllText($dotGit), '^gitdir:\s*(.+?)\s*$', 'Multiline')
        if (-not $m.Success) { throw "$dotGit does not say which git folder this worktree uses, so its temp folder is not known." }
        $gitDir = [IO.Path]::GetFullPath([IO.Path]::Combine($checkout, $m.Groups[1].Value))
        $commonFile = Join-Path $gitDir 'commondir'
        if (-not (Test-Path -LiteralPath $commonFile)) { throw "$commonFile is missing, so the main checkout of this worktree is not known." }
        $common = [IO.Path]::GetFullPath([IO.Path]::Combine($gitDir, ([IO.File]::ReadAllText($commonFile).Trim())))
        $main = Split-Path -Parent $common
    }
    if ($main) { $base = Join-Path $main 'temp' } else { $base = [IO.Path]::GetTempPath() }
}

[void][IO.Directory]::CreateDirectory($base)
Join-Path $base $Task
