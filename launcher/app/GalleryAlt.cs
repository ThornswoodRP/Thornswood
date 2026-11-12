using System.Text;

namespace Thornswood
{
    /// <summary>
    /// The short description each gallery picture is sent with (#4575): what
    /// the site gives a screen reader as the picture's alt text, and what staff
    /// read at Accept. Until then nothing asked for one, so every picture said
    /// only "Skyrim scene shared by" and a name.
    ///
    /// The rule is the site's own for `alt` on /api/gallery/submit, agreed with
    /// it: each control character and line break becomes a space, the ends are
    /// trimmed, and what is left is 1 to Most characters of plain text. The
    /// site refuses anything else and keeps nothing, so the launcher asks the
    /// same before a byte is read or sent.
    ///
    /// Nothing from Avalonia or the network, so tests\test-4575-gallery-alt.ps1
    /// can compile this on its own.
    /// </summary>
    static class GalleryAlt
    {
        public const int Most = 200;

        /// <summary>
        /// The description as it is sent, or null with why saying what to
        /// change.
        /// </summary>
        public static string Clean(string raw, out string why)
        {
            why = null;
            var sb = new StringBuilder(raw == null ? 0 : raw.Length);
            if (raw != null)
                foreach (char c in raw) sb.Append(char.IsControl(c) ? ' ' : c);
            string text = sb.ToString().Trim();
            if (text.Length == 0)
            {
                why = "Say in a few words what the picture shows. It is what someone using a screen reader hears in its place.";
                return null;
            }
            if (text.Length > Most)
            {
                why = "Keep the description to " + Most + " characters. It has " + text.Length + ".";
                return null;
            }
            return text;
        }
    }
}
