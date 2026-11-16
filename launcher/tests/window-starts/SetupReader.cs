using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.ExceptionServices;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Automation.Peers;
using Avalonia.Automation.Provider;
using Avalonia.Controls;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace Thornswood.Tests
{
    /// <summary>
    /// The install window as a screen reader finds it (#4693), for
    /// launcher\tests\test-4693-setup-reader.ps1. Its drive buttons were
    /// read as their letter alone, as plain buttons, the chosen one was shown
    /// by colour only, the bar and the log had no name, two links were both
    /// "Read them", and the status line changed with nothing told to Windows.
    ///
    /// The real window, out of the launcher's own Thornswood.dll, on
    /// Avalonia's headless platform, read through the same automation peers
    /// Windows' UI Automation reads on a PC. One PASS or FAIL line a check.
    /// </summary>
    static class SetupReader
    {
        static int fails;
        static Type winType;
        const BindingFlags Any = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        static void Check(string what, Action run)
        {
            try { run(); Console.WriteLine("PASS  " + what); }
            catch (Exception e)
            {
                if (e is TargetInvocationException t && t.InnerException != null) e = t.InnerException;
                fails++;
                // The reason on the FAIL line itself, so the gate's annotation,
                // which keeps only FAIL lines, says why and not just what.
                string why = (e.GetType().FullName + ": " + e.Message).Replace("\r", " ").Replace("\n", " ");
                if (why.Length > 1500) why = why.Substring(0, 1500) + "...";
                Console.WriteLine("FAIL  " + what + " | " + why);
            }
        }

        public static int Run()
        {
            winType = typeof(App).Assembly.GetType("Thornswood.InstallWindow", false);
            Check("the launcher has its install window", () =>
            {
                if (winType == null) throw new InvalidOperationException("there is no Thornswood.InstallWindow");
            });
            if (winType != null)
            {
                Window w = null;
                Check("the install window is made and shown", () => w = Open());
                if (w != null)
                {
                    try
                    {
                        TheseDrives(w);
                        PlantedDrives(w);
                        Links(w);
                        Installing(w);
                    }
                    finally { w.Close(); }
                }
            }
            Console.WriteLine(fails == 0 ? "a screen reader can use the setup window" : fails + " check(s) failed");
            return fails == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------ drives

        /// <summary>The drive buttons the window made from this machine's own drives.</summary>
        static void TheseDrives(Window w)
        {
            var drives = ((System.Collections.IEnumerable)Field(w, "driveButtons")).Cast<Button>().ToList();
            if (drives.Count == 0)
            {
                Console.WriteLine("      this machine has no fixed drive the window lists; the planted drives below stand in");
                return;
            }
            Check("each of this machine's drive buttons is a radio button named by its letter and free space, not by its parts (" + drives.Count + ")", () =>
            {
                var off = new List<string>();
                foreach (Button b in drives)
                {
                    string letter = ((string)b.Tag).TrimEnd('\\');
                    AutomationPeer p = Peer(b);
                    string name = p.GetName();
                    if (!name.StartsWith(letter, StringComparison.Ordinal) || !name.Contains(" free") || name.Contains("Avalonia."))
                        off.Add(letter + " is named \"" + name + "\"");
                    if (p.GetAutomationControlType() != AutomationControlType.RadioButton)
                        off.Add(letter + " is a " + p.GetAutomationControlType());
                }
                if (off.Count > 0) throw new InvalidOperationException(string.Join("; ", off));
            });
        }

        /// <summary>
        /// Two planted drives: this machine's own root, where the window can
        /// install, and Skyrim's, planted beside it. Choosing is the window's
        /// own SetRoot, as a drive's button and Another folder call it.
        /// </summary>
        static void PlantedDrives(Window w)
        {
            MethodInfo add = winType.GetMethod("AddDrive", Any);
            Check("the window makes a drive's button in one place (InstallWindow.AddDrive)", () =>
            {
                if (add == null) throw new InvalidOperationException("there is no AddDrive: a drive's button is made inline in BuildDrives, with no name of its own for a screen reader");
            });
            if (add == null) return;

            string here = Path.GetPathRoot(Path.GetFullPath(Path.GetTempPath()));
            const string other = "Q:\\";
            ((Panel)Field(w, "driveRow")).Children.Clear();
            ((System.Collections.IList)Field(w, "driveButtons")).Clear();
            Set(w, "skyrimDrive", other);
            Button a = null, q = null;
            AutomationPeer pa = null, pq = null;
            var said = new List<string>();

            Check("a planted drive with 812.3 GB free is read as its letter and that, and Skyrim's drive says Skyrim is here", () =>
            {
                a = (Button)Invoke(w, add, here, 812300000000L);
                q = (Button)Invoke(w, add, other, 5000000000L);
                Settle(w);
                pa = Peer(a);
                pq = Peer(q);
                pa.PropertyChanged += (s, e) => { if (e.Property == SelectionItemPatternIdentifiers.IsSelectedProperty) said.Add("here " + e.NewValue); };
                pq.PropertyChanged += (s, e) => { if (e.Property == SelectionItemPatternIdentifiers.IsSelectedProperty) said.Add("Q " + e.NewValue); };
                string na = pa.GetName(), nq = pq.GetName();
                if (!na.StartsWith(here.TrimEnd('\\'), StringComparison.Ordinal) || !na.Contains("GB free") || na.Contains("Skyrim"))
                    throw new InvalidOperationException("this machine's drive is named \"" + na + "\"");
                if (!nq.StartsWith("Q:", StringComparison.Ordinal) || !nq.Contains("GB free") || !nq.EndsWith("Skyrim is here", StringComparison.Ordinal))
                    throw new InvalidOperationException("Skyrim's drive is named \"" + nq + "\"");
            });
            if (pa == null) return;

            Check("each drive's button is a radio button with the selection pattern", () =>
            {
                foreach (AutomationPeer p in new[] { pa, pq })
                {
                    if (p.GetAutomationControlType() != AutomationControlType.RadioButton) throw new InvalidOperationException(p.GetName() + " is a " + p.GetAutomationControlType());
                    if (p.GetProvider<ISelectionItemProvider>() == null) throw new InvalidOperationException(p.GetName() + " has no selection pattern");
                }
            });
            if (pa.GetProvider<ISelectionItemProvider>() == null) return;

            MethodInfo setRoot = winType.GetMethod("SetRoot", Any);
            Check("installing on this machine's drive, that drive reads as selected and Q: as not, and Windows is told", () =>
            {
                Invoke(w, setRoot, Path.Combine(here, "Thornswood"));
                Settle(w);
                Selected(pa, true);
                Selected(pq, false);
                if (!said.Contains("here True")) throw new InvalidOperationException("no selection change was raised; raised: " + string.Join(", ", said));
            });
            Check("a folder on no listed drive leaves none selected, and Windows is told this one was let go", () =>
            {
                said.Clear();
                Invoke(w, setRoot, "C:\\Thornswood\0planted");
                Settle(w);
                Selected(pa, false);
                Selected(pq, false);
                if (!said.Contains("here False")) throw new InvalidOperationException("no selection change was raised; raised: " + string.Join(", ", said));
            });
            Check("Select from a screen reader presses the drive's button, as a click does", () =>
            {
                pa.GetProvider<ISelectionItemProvider>().Select();
                Settle(w);
                Selected(pa, true);
            });
            Check("a drive's button still looks like the window's other buttons (Button's own template)", () =>
            {
                if (a.StyleKey != typeof(Button)) throw new InvalidOperationException("it is styled as " + a.StyleKey.Name);
                if (!a.GetVisualDescendants().Any()) throw new InvalidOperationException("it has no template");
            });
        }

        static void Selected(AutomationPeer p, bool want)
        {
            bool got = p.GetProvider<ISelectionItemProvider>().IsSelected;
            if (got != want) throw new InvalidOperationException(p.GetName() + " reads as " + (got ? "selected" : "not selected"));
        }

        // ------------------------------------------------------------ links

        static void Links(Window w)
        {
            Check("each of the three links is named by the page it opens, and no two by the same words", () =>
            {
                var links = Descendants(w).OfType<HyperlinkButton>().Where(l => l.TemplatedParent == null).ToList();
                if (links.Count != 3) throw new InvalidOperationException(links.Count + " links, not 3");
                var names = links.Select(l => Peer(l).GetName()).ToList();
                string[] pages = { "Terms and Conditions", "Privacy Policy", "Rules" };
                for (int i = 0; i < 3; i++)
                    if (!names[i].Contains(pages[i])) throw new InvalidOperationException("link " + (i + 1) + " is named \"" + names[i] + "\", not for the " + pages[i]);
                if (names.Distinct().Count() != 3) throw new InvalidOperationException("two links share a name: " + string.Join(", ", names));
            });
        }

        // ------------------------------------------------------------ installing

        static void Installing(Window w)
        {
            var bar = (ProgressBar)Field(w, "bar");
            var log = (TextBox)Field(w, "txtLog");
            var stat = (TextBlock)Field(w, "txtStat");
            Check("the progress bar is a progress bar named for the install", () =>
            {
                AutomationPeer p = Peer(bar);
                if (p.GetAutomationControlType() != AutomationControlType.ProgressBar) throw new InvalidOperationException("it is a " + p.GetAutomationControlType());
                if (p.GetName().IndexOf("install", StringComparison.OrdinalIgnoreCase) < 0) throw new InvalidOperationException("it is named \"" + p.GetName() + "\"");
            });
            Check("the bar's value changes are told to Windows as the install moves", () =>
            {
                AutomationPeer p = Peer(bar);
                var values = new List<object>();
                p.PropertyChanged += (s, e) => { if (e.Property == RangeValuePatternIdentifiers.ValueProperty) values.Add(e.NewValue); };
                bar.IsVisible = true;
                Invoke(w, winType.GetMethod("Progress", Any), 0.4);
                Settle(w);
                if (!values.Any(v => v is double d && Math.Abs(d - 400) < 0.001)) throw new InvalidOperationException("no value change was raised for 40%: " + string.Join(", ", values));
            });
            Check("the install's log is named for what it holds", () =>
            {
                string name = Peer(log).GetName();
                if (string.IsNullOrWhiteSpace(name)) throw new InvalidOperationException("it has no name");
            });
            Check("the status line is a live region, so each line of the install is said as it comes", () =>
            {
                AutomationPeer p = Peer(stat);
                if (p.GetLiveSetting() == AutomationLiveSetting.Off) throw new InvalidOperationException("its live setting is Off: Windows is never told it changed");
                var names = new List<object>();
                p.PropertyChanged += (s, e) => { if (e.Property == AutomationElementIdentifiers.NameProperty) names.Add(e.NewValue); };
                Invoke(w, winType.GetMethod("Line", Any), "Copying Thornswood-Content.esp");
                Settle(w);
                if (!names.Contains("Copying Thornswood-Content.esp")) throw new InvalidOperationException("the new line was not raised: " + string.Join(", ", names));
            });
        }

        // ------------------------------------------------------------ helpers

        static AutomationPeer Peer(Control c)
        {
            return ControlAutomationPeer.CreatePeerForElement(c);
        }

        static Window Open()
        {
            Window w;
            try { w = (Window)Activator.CreateInstance(winType, true); }
            catch (TargetInvocationException e) { ExceptionDispatchInfo.Capture(e.InnerException).Throw(); throw; }
            w.Show();
            Settle(w);
            return w;
        }

        static void Settle(Window w)
        {
            for (int i = 0; i < 4; i++)
            {
                Dispatcher.UIThread.RunJobs();
                if (w.IsVisible) w.UpdateLayout();
            }
            Dispatcher.UIThread.RunJobs();
        }

        static object Invoke(Window w, MethodInfo m, params object[] args)
        {
            if (m == null) throw new InvalidOperationException("InstallWindow has no such method");
            try { return m.Invoke(w, args); }
            catch (TargetInvocationException e) { ExceptionDispatchInfo.Capture(e.InnerException).Throw(); throw; }
        }

        static object Field(Window w, string name)
        {
            FieldInfo f = winType.GetField(name, Any);
            if (f == null) throw new InvalidOperationException("InstallWindow has no " + name);
            return f.GetValue(w);
        }

        static void Set(Window w, string name, object value)
        {
            FieldInfo f = winType.GetField(name, Any);
            if (f == null) throw new InvalidOperationException("InstallWindow has no " + name);
            f.SetValue(w, value);
        }

        static IEnumerable<Visual> Descendants(Visual root)
        {
            var stack = new Stack<Visual>();
            stack.Push(root);
            while (stack.Count > 0)
            {
                Visual v = stack.Pop();
                yield return v;
                foreach (Visual child in v.GetVisualChildren().Reverse()) stack.Push(child);
            }
        }
    }
}
