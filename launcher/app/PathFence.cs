using System;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// Is this path really inside that folder? The one rule both exes fence
    /// their writes and deletes with.
    ///
    /// A plain StartsWith is not enough, and it matters most in the places
    /// that write and delete. "C:\Thornswood2\anything" starts with
    /// "C:\Thornswood", so a pack whose file list contained ..\Thornswood2
    /// would pass a prefix test and be treated as ours. Comparing against
    /// the folder plus its separator is the whole fix.
    ///
    /// Setup.csproj compiled this file into the setup program as well (#3561:
    /// its unpack compared against the scratch folder with a bare StartsWith
    /// while the launcher already had this rule) until #4824 retired that
    /// program, which is why it uses nothing else from launcher\app. It compares text and resolves neither
    /// side, so every caller passes a path from Path.GetFullPath.
    /// tests\test-updater.ps1 and installer\tests\test-3561-setup-unpack-fence.ps1 run it.
    /// </summary>
    static class PathFence
    {
        internal static bool Inside(string full, string folder)
        {
            if (string.IsNullOrEmpty(full) || string.IsNullOrEmpty(folder)) return false;
            string fence = folder.TrimEnd(Path.DirectorySeparatorChar,
                                          Path.AltDirectorySeparatorChar)
                         + Path.DirectorySeparatorChar;
            return full.StartsWith(fence, StringComparison.OrdinalIgnoreCase);
        }
    }
}
