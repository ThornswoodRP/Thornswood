using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;

namespace Thornswood
{
    /// <summary>
    /// Profile\accepted.json, the same file the install window writes when the
    /// terms, the privacy policy and the rules are ticked (issue #1009).
    ///
    /// An install made before that lock has no file, and nothing else in the
    /// install says the three were accepted, so a later run of the launcher
    /// cannot treat silence as a yes. This asks the setup window's three
    /// questions once, when the record is missing, and writes that same
    /// record. Declining writes nothing. After that a page is asked again
    /// only when its text has changed since it was accepted, and then only
    /// that page (Patrick, 16 Oct 2026, #2616): nothing is asked on an update
    /// or a start when nothing changed.
    ///
    /// launcher\tests\test-prior-acceptance.ps1 compiles this file and runs the decision
    /// without a window, a Skyrim install, or C:\Thornswood.
    /// </summary>
    public static class Acceptance
    {
        public const string FileName = "accepted.json";
        public const string Site = "https://thornswood.net";

        /// <summary>The setup window's three pages, in its order.</summary>
        public static readonly string[] Pages = new string[] { "terms", "privacy", "rules" };

        /// <summary>The words on the setup window's three boxes.</summary>
        public static readonly string[] Words = new string[] {
            "I have read and accept the Terms and Conditions",
            "I have read and accept the Privacy Policy",
            "I have read and agree to the Rules"
        };

        /// <summary>The words on the setup window's three links, in page order.</summary>
        public static readonly string[] LinkWords = new string[] { "Read them", "Read it", "Read them" };

        public static string PathOf(string profileDir)
        {
            return Path.Combine(profileDir ?? "", FileName);
        }

        /// <summary>The file's text, or null when it is missing or unreadable.</summary>
        public static string Read(string profileDir)
        {
            try
            {
                string path = PathOf(profileDir);
                if (!File.Exists(path)) return null;
                return File.ReadAllText(path);
            }
            catch (Exception)
            {
                // Unreadable is the same as missing: the three questions are asked.
                return null;
            }
        }

        /// <summary>
        /// True when the record is missing, not the three pages, or a stored
        /// hash is not the page as served now. A current hash that is null
        /// (nobody has asked the site) only fails a record that is not the
        /// three pages. An empty stored hash means the site did not answer
        /// when it was written, so a hash that can be read now is a change.
        /// An empty current hash means the site did not answer now, and that
        /// is not a reason to ask again.
        /// </summary>
        public static bool NeedsAsk(string json, string[] current)
        {
            for (int i = 0; i < Pages.Length; i++)
            {
                string stored = StoredSha(json, Pages[i]);
                if (stored == null) return true;
                if (current == null) continue;
                string now = i < current.Length && current[i] != null ? current[i] : "";
                if (now.Length == 0) continue;
                if (stored.Length == 0 || !string.Equals(stored, now, StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        /// <summary>
        /// Asks when NeedsAsk says so. ask returns true only when all three
        /// boxes were ticked. A decline writes nothing and returns false. A
        /// record that is already current returns true without asking.
        /// </summary>
        public static bool Settle(string profileDir, string[] current, Func<bool> ask)
        {
            if (!NeedsAsk(Read(profileDir), current)) return true;
            if (ask == null || !ask()) return false;
            return Write(profileDir, DateTime.UtcNow, current);
        }

        /// <summary>
        /// Startup, before the window. A complete record returns at once and
        /// does not wait on the site. A missing one is fetched, asked, and
        /// written, or the launcher stays closed.
        /// </summary>
        public static bool Ensure(string profileDir)
        {
            if (!NeedsAsk(Read(profileDir), null)) return true;
            return Settle(profileDir, FetchShas(), delegate { return Ask(null); });
        }

        /// <summary>
        /// Which of the three pages changed since they were accepted: the
        /// page's stored hash is not the one served now. A page the site did
        /// not answer for now has not changed; a stored hash that is empty
        /// (the site did not answer when it was written) and can be read now
        /// counts as changed, as in NeedsAsk.
        /// </summary>
        public static bool[] Changed(string json, string[] current)
        {
            var changed = new bool[Pages.Length];
            for (int i = 0; i < Pages.Length; i++)
            {
                string stored = StoredSha(json, Pages[i]);
                string now = current != null && i < current.Length && current[i] != null ? current[i] : "";
                if (stored == null || now.Length == 0) continue;
                changed[i] = stored.Length == 0 || !string.Equals(stored, now, StringComparison.OrdinalIgnoreCase);
            }
            return changed;
        }

        /// <summary>The record to write after the changed pages were ticked: their new hash, and the stored one for the rest.</summary>
        public static string[] Merge(string json, string[] current, bool[] changed)
        {
            var shas = new string[Pages.Length];
            for (int i = 0; i < Pages.Length; i++)
            {
                bool took = changed != null && i < changed.Length && changed[i];
                shas[i] = took ? (current != null && i < current.Length ? current[i] : "") : (StoredSha(json, Pages[i]) ?? "");
            }
            return shas;
        }

        static bool Any(bool[] flags)
        {
            if (flags == null) return false;
            foreach (bool f in flags) if (f) return true;
            return false;
        }

        /// <summary>
        /// A record already on disk (Patrick, 16 Oct 2026, #2616): asked again
        /// only when a page's text has changed since it was accepted, and then
        /// only that page. Nothing changed asks nothing, whatever the update or
        /// start. ask is shown only the changed pages and returns true when
        /// they were all ticked; a decline writes nothing and returns false.
        /// The caller runs this off the window thread and shows Ask on it.
        /// </summary>
        public static bool Recheck(string profileDir, Func<bool[], bool> ask)
        {
            string json = Read(profileDir);
            if (NeedsAsk(json, null)) return true;   // no complete record: Ensure asks at start
            string[] current = FetchShas();
            bool[] changed = Changed(json, current);
            if (!Any(changed)) return true;
            if (ask == null || !ask(changed)) return false;
            return Write(profileDir, DateTime.UtcNow, Merge(json, current, changed));
        }

        public static bool Write(string profileDir, DateTime at, string[] shas)
        {
            string path = PathOf(profileDir);
            Directory.CreateDirectory(profileDir);
            File.WriteAllText(path, ToJson(at, shas), new UTF8Encoding(false));
            return File.Exists(path);
        }

        /// <summary>The setup window's shape: accepted, pages, about. No name, no machine.</summary>
        public static string ToJson(DateTime at, string[] shas)
        {
            string[] hex = Hexes(shas);
            var sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append("  \"accepted\": \"" + at.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'",
                      System.Globalization.CultureInfo.InvariantCulture) + "\",\n");
            sb.Append("  \"pages\": {\n");
            for (int i = 0; i < Pages.Length; i++)
            {
                sb.Append("    \"" + Pages[i] + "\": { \"url\": \"" + Site + "/" + Pages[i] +
                          "\", \"sha256\": \"" + hex[i] + "\" }" + (i < Pages.Length - 1 ? "," : "") + "\n");
            }
            sb.Append("  },\n");
            sb.Append("  \"about\": \"Ticked in the Thornswood launcher. sha256 is of each page's text as " +
                      Site + "/api/page/<name> served it then, and is empty when the site did not answer.\"\n");
            sb.Append("}\n");
            return sb.ToString();
        }

        /// <summary>
        /// The boxes and links: all three when only is null (no record yet),
        /// otherwise just the pages only marks (those that changed). True only
        /// when every box shown was ticked.
        /// </summary>
        public static bool Ask(bool[] only)
        {
            return Ask(only, null);
        }

        /// <summary>
        /// The same, over owner when it is on screen, so the question blocks
        /// the launcher behind it. At startup there is no window yet and the
        /// question stands on its own.
        ///
        /// Synchronous, as WPF's ShowDialog was: the window's messages keep
        /// moving until this window closes, then the answer is returned, so
        /// Ensure and Recheck read it on their next line.
        /// </summary>
        public static bool Ask(bool[] only, Window owner)
        {
            bool yes = false;
            var boxes = new CheckBox[Pages.Length];
            var w = new Window();
            w.Title = "Thornswood";
            w.Width = 560;
            w.SizeToContent = SizeToContent.Height;
            w.CanResize = false;
            w.WindowStartupLocation = owner != null && owner.IsVisible
                ? WindowStartupLocation.CenterOwner : WindowStartupLocation.CenterScreen;
            w.Content = Build(boxes, only, delegate
            {
                if (!AllTicked(boxes)) return;
                yes = true;
                w.Close();
            }, delegate { w.Close(); });
            using (var closed = new CancellationTokenSource())
            {
                w.Closed += delegate { closed.Cancel(); };
                if (owner != null && owner.IsVisible) w.ShowDialog(owner);
                else w.Show();
                Dispatcher.UIThread.MainLoop(closed.Token);
            }
            return yes;
        }

        /// <summary>
        /// The browser, on one of the three pages and nothing else. The one
        /// Process.Start this class has.
        /// </summary>
        public static bool OpenPage(string url)
        {
            if (!IsPage(url)) return false;
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                return true;
            }
            catch (Exception)
            {
                // The link is still in the window. A browser that will not
                // open does not tick a box and does not write a record.
                return false;
            }
        }

        static bool IsPage(string url)
        {
            if (string.IsNullOrEmpty(url)) return false;
            for (int i = 0; i < Pages.Length; i++)
            {
                if (string.Equals(url, Site + "/" + Pages[i], StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        /// <summary>What the window says above the boxes: no record yet, or which page changed.</summary>
        public static string Saying(bool[] only)
        {
            if (only == null)
                return "This install has no note that the terms, the privacy policy and the rules were accepted. Thornswood stays closed until all three are ticked.";
            var names = new System.Collections.Generic.List<string>();
            string[] nice = new string[] { "the Terms and Conditions", "the Privacy Policy", "the Rules" };
            for (int i = 0; i < Pages.Length; i++) if (i < only.Length && only[i]) names.Add(nice[i]);
            string list = names.Count == 1 ? names[0]
                        : names.Count == 2 ? names[0] + " and " + names[1]
                        : string.Join(", ", names.GetRange(0, names.Count - 1).ToArray()) + " and " + names[names.Count - 1];
            return (list.Length > 0 ? char.ToUpper(list[0]) + list.Substring(1) : list) +
                   (names.Count == 1 ? " has" : " have") +
                   " changed since you accepted " + (names.Count == 1 ? "it" : "them") +
                   ". Read what changed and tick to carry on. Thornswood stays closed until " +
                   (names.Count == 1 ? "it is" : "they are") + " ticked.";
        }

        static Control Build(CheckBox[] boxes, bool[] only, Action goOn, Action notNow)
        {
            var root = new StackPanel();
            root.Margin = new Thickness(22);

            var say = new TextBlock();
            say.TextWrapping = TextWrapping.Wrap;
            say.Margin = new Thickness(0, 0, 0, 14);
            say.Text = Saying(only);
            root.Children.Add(say);

            var go = new Button();
            go.Content = "Continue";
            go.MinWidth = 110;
            go.Margin = new Thickness(0, 0, 8, 0);
            go.IsEnabled = false;
            go.IsDefault = true;
            go.Click += delegate { goOn(); };

            for (int i = 0; i < Pages.Length; i++)
            {
                // Only the pages that changed, when there is a record already.
                if (only != null && !(i < only.Length && only[i])) continue;
                string pageUrl = Site + "/" + Pages[i];
                var row = new WrapPanel();
                row.Margin = new Thickness(0, 0, 0, 8);
                var box = new CheckBox();
                box.Content = Words[i];
                box.VerticalAlignment = VerticalAlignment.Center;
                int closed = i;
                box.IsCheckedChanged += delegate { go.IsEnabled = AllTicked(boxes); };
                boxes[closed] = box;
                row.Children.Add(box);

                // The theme's own link, as the WPF Hyperlink was. No
                // NavigateUri: OpenPage opens it, so the page is checked
                // against the three first.
                var link = new HyperlinkButton();
                link.Content = LinkWords[i];
                link.Margin = new Thickness(10, 0, 0, 0);
                link.VerticalAlignment = VerticalAlignment.Center;
                link.Click += delegate { OpenPage(pageUrl); };
                row.Children.Add(link);
                root.Children.Add(row);
            }

            var buttons = new StackPanel();
            buttons.Orientation = Orientation.Horizontal;
            buttons.HorizontalAlignment = HorizontalAlignment.Right;
            buttons.Margin = new Thickness(0, 10, 0, 0);
            var no = new Button();
            no.Content = "Not now";
            no.MinWidth = 110;
            no.IsCancel = true;
            no.Click += delegate { notNow(); };
            buttons.Children.Add(no);
            buttons.Children.Add(go);
            root.Children.Add(buttons);
            return root;
        }

        /// <summary>Every box that is shown is ticked, and at least one is shown. A page not shown has no box.</summary>
        static bool AllTicked(CheckBox[] boxes)
        {
            if (boxes == null) return false;
            int shown = 0;
            for (int i = 0; i < boxes.Length; i++)
            {
                if (boxes[i] == null) continue;
                shown++;
                if (boxes[i].IsChecked != true) return false;
            }
            return shown > 0;
        }

        /// <summary>The page's sha256 when its url is the site's page, or null when that page is not in the record.</summary>
        public static string StoredSha(string json, string page)
        {
            if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(page)) return null;
            Match m = Regex.Match(json, "\"" + Regex.Escape(page) + "\"\\s*:\\s*\\{[^}]*\\}", RegexOptions.IgnoreCase);
            if (!m.Success) return null;
            Match url = Regex.Match(m.Value, "\"url\"\\s*:\\s*\"([^\"]*)\"", RegexOptions.IgnoreCase);
            Match sha = Regex.Match(m.Value, "\"sha256\"\\s*:\\s*\"([^\"]*)\"", RegexOptions.IgnoreCase);
            if (!url.Success || !sha.Success) return null;
            if (!string.Equals(url.Groups[1].Value, Site + "/" + page, StringComparison.OrdinalIgnoreCase))
                return null;
            return sha.Groups[1].Value;
        }

        static string[] Hexes(string[] shas)
        {
            var hex = new string[Pages.Length];
            for (int i = 0; i < Pages.Length; i++)
            {
                string s = shas != null && i < shas.Length && shas[i] != null ? shas[i] : "";
                hex[i] = IsHex(s) ? s.ToLowerInvariant() : "";
            }
            return hex;
        }

        static bool IsHex(string s)
        {
            if (s == null || s.Length != 64) return false;
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                bool ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
                if (!ok) return false;
            }
            return true;
        }

        public static string[] FetchShas()
        {
            var shas = new string[Pages.Length];
            for (int i = 0; i < Pages.Length; i++)
            {
                try { shas[i] = PageSha(FetchPage(Pages[i])); }
                catch (Exception)
                {
                    // The site did not answer. An empty hash is what the setup
                    // program writes in that case, and it is not a version.
                    shas[i] = "";
                }
            }
            return shas;
        }

        // The site's three pages, eight seconds for the answer and eight for
        // the text, as the HttpWebRequest this replaced was given.
        static readonly HttpClient web = new HttpClient() { Timeout = Timeout.InfiniteTimeSpan };

        static string FetchPage(string name)
        {
            using (var req = new HttpRequestMessage(HttpMethod.Get, Site + "/api/page/" + name))
            using (var answer = new CancellationTokenSource(8000))
            {
                req.Headers.TryAddWithoutValidation("User-Agent", "ThornswoodLauncher");
                using (HttpResponseMessage resp = web.Send(req, HttpCompletionOption.ResponseHeadersRead, answer.Token))
                using (var read = new CancellationTokenSource(8000))
                {
                    // A refusal throws, as GetResponse did, and FetchShas
                    // takes it as the site not answering.
                    resp.EnsureSuccessStatusCode();
                    // Read with the token, so the eight seconds hold for the
                    // whole text and not only for its start.
                    byte[] text = resp.Content.ReadAsByteArrayAsync(read.Token).GetAwaiter().GetResult();
                    using (var r = new StreamReader(new MemoryStream(text), new UTF8Encoding(false)))
                        return JsonString(r.ReadToEnd(), "md");
                }
            }
        }

        static string PageSha(string md)
        {
            if (md == null) return "";
            using (var h = SHA256.Create())
            {
                byte[] d = h.ComputeHash(new UTF8Encoding(false).GetBytes(md));
                var sb = new StringBuilder();
                foreach (byte b in d) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        /// <summary>A JSON string's value by its key, unescaped, or null. The site's page answer is {"md":"...","html":"..."}.</summary>
        static string JsonString(string doc, string key)
        {
            if (doc == null) return null;
            string head = "\"" + key + "\":";
            int i = doc.IndexOf(head, StringComparison.Ordinal);
            if (i < 0) return null;
            i += head.Length;
            while (i < doc.Length && char.IsWhiteSpace(doc[i])) i++;
            if (i >= doc.Length || doc[i] != '"') return null;
            var sb = new StringBuilder();
            for (i++; i < doc.Length; i++)
            {
                char c = doc[i];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                if (++i >= doc.Length) return null;
                char e = doc[i];
                if (e == 'n') sb.Append('\n');
                else if (e == 'r') sb.Append('\r');
                else if (e == 't') sb.Append('\t');
                else if (e == 'b') sb.Append('\b');
                else if (e == 'f') sb.Append('\f');
                else if (e == 'u')
                {
                    if (i + 4 >= doc.Length) return null;
                    sb.Append((char)Convert.ToInt32(doc.Substring(i + 1, 4), 16));
                    i += 4;
                }
                else sb.Append(e);
            }
            return null;
        }
    }
}
