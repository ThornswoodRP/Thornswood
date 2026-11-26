using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Text.RegularExpressions;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Controls.Presenters;
using Avalonia.Controls.Shapes;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace Thornswood.Tests
{
    /// <summary>
    /// The install window as Windows asks for it to look (#4409), for
    /// launcher\tests\test-4409-setup-look.ps1. It drew in Forge with every
    /// text size fixed, whatever Windows said: a contrast theme changed
    /// nothing in it and neither did Windows' text size.
    ///
    /// The real window, out of the launcher's own Thornswood.dll, on
    /// Avalonia's headless platform, handed a planted SystemLook: a contrast
    /// theme whose colours no palette in the launcher or in Fluent has, so a
    /// brush left over from either cannot pass by chance, and Windows' text
    /// sizes up to 225%. On Windows it also reads this machine's own look.
    /// One PASS or FAIL line a check.
    /// </summary>
    static class SetupLook
    {
        static int fails;
        static Type winType, lookType;
        static ConstructorInfo make;
        const BindingFlags Any = BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;

        static readonly Dictionary<string, string> Planted = new Dictionary<string, string>
        {
            { "Window", "#102030" }, { "WindowText", "#F0E040" }, { "Highlight", "#30F0A0" }, { "HighlightText", "#200010" },
            { "ButtonFace", "#182838" }, { "ButtonText", "#F8E848" }, { "GrayText", "#A0A0F0" }, { "HotLight", "#F080F0" },
        };

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
            Assembly launcher = typeof(App).Assembly;
            winType = launcher.GetType("Thornswood.InstallWindow", false);
            lookType = launcher.GetType("Thornswood.SystemLook", false);
            Check("the launcher has its install window", () =>
            {
                if (winType == null) throw new InvalidOperationException("there is no Thornswood.InstallWindow");
            });
            Check("the install window is handed what Windows asks of its look (Thornswood.SystemLook)", () =>
            {
                if (lookType == null)
                    throw new InvalidOperationException("there is no SystemLook: nothing reads Windows' contrast theme or its text size, so the window draws in Forge at fixed sizes whatever Windows says");
                make = winType == null ? null : winType.GetConstructor(Any, null, new Type[] { lookType }, null);
                if (make == null) throw new InvalidOperationException("InstallWindow takes no SystemLook");
            });
            if (make == null) return Done();

            Pure();
            ReadOnWindows();
            Forge();
            Contrast();
            Sizes();
            Fits();
            return Done();
        }

        static int Done()
        {
            Console.WriteLine(fails == 0 ? "the setup window follows Windows' look" : fails + " check(s) failed");
            return fails == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------ the read

        static object Call(string name, params object[] args)
        {
            MethodInfo m = lookType.GetMethod(name, Any);
            if (m == null) throw new InvalidOperationException("SystemLook has no " + name);
            return m.Invoke(null, args);
        }

        static void Pure()
        {
            Check("Windows' text size, kept as a percentage, is read as 1 to 2.25, and nothing else as more than 100%", () =>
            {
                var want = new List<(object, double)> { (100, 1.0), (125, 1.25), (150, 1.5), (225, 2.25), (null, 1.0), ("150", 1.0), (90, 1.0), (300, 1.0) };
                foreach (var (given, scale) in want)
                {
                    double got = (double)Call("Scale", new object[] { given });
                    if (Math.Abs(got - scale) > 1e-9) throw new InvalidOperationException((given ?? "nothing") + " read as " + got + ", not " + scale);
                }
            });
            Check("a Windows colour, 0x00BBGGRR, is read as #RRGGBB", () =>
            {
                string got = (string)Call("Hex", new object[] { 0x00332211u });
                if (got != "#112233") throw new InvalidOperationException("0x00332211 read as " + got);
            });
        }

        static void ReadOnWindows()
        {
            if (!OperatingSystem.IsWindows())
            {
                Console.WriteLine("      not Windows, so SystemLook.Read is not run here; every window below is handed a planted look");
                return;
            }
            Check("on this Windows, SystemLook.Read gives a text size of 100% to 225% and every colour as #RRGGBB", () =>
            {
                object look = Call("Read", new object[0]);
                double scale = (double)lookType.GetField("TextScale").GetValue(look);
                bool contrast = (bool)lookType.GetField("HighContrast").GetValue(look);
                var colours = (Dictionary<string, string>)lookType.GetField("Colours").GetValue(look);
                if (scale < 1 || scale > 2.25) throw new InvalidOperationException("the text size read as " + scale);
                foreach (string n in Planted.Keys)
                    if (!colours.TryGetValue(n, out string c) || !Regex.IsMatch(c, "^#[0-9A-F]{6}$"))
                        throw new InvalidOperationException(n + " read as " + (c ?? "nothing"));
                Console.WriteLine("      this machine: contrast theme " + (contrast ? "on" : "off") + ", text size " + Percent(scale));
            });
        }

        // ------------------------------------------------------------ the window

        static object Look(bool contrast, double scale)
        {
            object look = Activator.CreateInstance(lookType, true);
            lookType.GetField("HighContrast").SetValue(look, contrast);
            lookType.GetField("TextScale").SetValue(look, scale);
            var colours = (Dictionary<string, string>)lookType.GetField("Colours").GetValue(look);
            foreach (var kv in Planted) colours[kv.Key] = kv.Value;
            return look;
        }

        static Window Open(object look, double width, double height)
        {
            Window w;
            try { w = (Window)make.Invoke(new object[] { look }); }
            catch (TargetInvocationException e) { ExceptionDispatchInfo.Capture(e.InnerException).Throw(); throw; }
            w.Width = width;
            w.Height = height;
            w.Show();
            Settle(w);
            return w;
        }

        static void Settle(Window w)
        {
            for (int i = 0; i < 4; i++)
            {
                Dispatcher.UIThread.RunJobs();
                w.UpdateLayout();
            }
            Dispatcher.UIThread.RunJobs();
        }

        static object Field(Window w, string name)
        {
            FieldInfo f = winType.GetField(name, Any);
            if (f == null) throw new InvalidOperationException("InstallWindow has no " + name);
            return f.GetValue(w);
        }

        /// <summary>The window as it is once Install is pressed: the log, the bar and the status line.</summary>
        static void Installing(Window w)
        {
            ((Control)Field(w, "rootBox")).IsVisible = false;
            ((Control)Field(w, "ownBox")).IsVisible = false;
            var log = (TextBox)Field(w, "txtLog");
            log.IsVisible = true;
            log.Text = string.Join("\n", Enumerable.Range(1, 40).Select(i =>
                "Copying Data\\Thornswood-Content.esp, line " + i + " of what the install says, long enough to wrap at a large text size"));
            var bar = (ProgressBar)Field(w, "bar");
            bar.IsVisible = true;
            bar.Value = 400;
            ((TextBlock)Field(w, "txtStat")).Text = "Copying C:\\Thornswood\\Profile\\Payload\\Data\\Thornswood-Content.esp into the game folder, 412 of 1,024 MB";
            ((TextBlock)Field(w, "txtBody")).Text = "Installing. What it is doing shows below, and Thornswood opens by itself when it is done.";
            Settle(w);
        }

        static void Forge()
        {
            Check("with no contrast theme on, the window is Forge as before", () =>
            {
                Window w = Open(Look(false, 1.0), 700, 800);
                try { Expect(Hex(w.Background), "#FF100D0A", "its ground"); }
                finally { w.Close(); }
            });
        }

        // ------------------------------------------------------------ contrast

        static void Contrast()
        {
            Window w = null;
            Check("with a contrast theme on, the window is made and shown", () => w = Open(Look(true, 1.0), 700, 800));
            if (w == null) return;
            var allowed = new HashSet<string>(Planted.Values.Select(v => "#FF" + v.Substring(1).ToUpperInvariant()));
            try
            {
                Check("its ground is the contrast theme's Window colour", () => Expect(Hex(w.Background), "#FF102030", "its ground"));
                Check("as it opens, every brush drawn in it is one of the contrast theme's colours", () => OnlyThese(w, allowed));
                Check("with every box ticked, the pointer on Install and a button pressed, still only the theme's colours", () =>
                {
                    ((CheckBox)Field(w, "chkAge")).IsChecked = true;
                    foreach (CheckBox c in (CheckBox[])Field(w, "agree")) c.IsChecked = true;
                    Settle(w);
                    var go = (Button)Field(w, "btnGo");
                    if (!go.IsEnabled) throw new InvalidOperationException("Install stayed off with every box ticked");
                    ((IPseudoClasses)go.Classes).Add(":pointerover");
                    ((IPseudoClasses)((Button)Field(w, "btnPick")).Classes).Add(":pressed");
                    Settle(w);
                    OnlyThese(w, allowed);
                });
                Check("while it installs, the log, the bar and the status line are in the theme's colours too", () =>
                {
                    Installing(w);
                    OnlyThese(w, allowed);
                });
            }
            finally { w.Close(); }
        }

        /// <summary>Every brush on screen in the window, by what draws it, is one of these or clear.</summary>
        static void OnlyThese(Window w, HashSet<string> allowed)
        {
            var off = new List<string>();
            int seen = 0;
            foreach (Visual v in Descendants(w))
            {
                if (!v.IsEffectivelyVisible) continue;
                foreach (var (what, brush) in Drawn(v))
                {
                    if (brush == null) continue;
                    seen++;
                    string why = NotThese(brush, allowed);
                    if (why != null) off.Add(Name(v) + " " + what + " " + why);
                }
            }
            if (seen < 20) throw new InvalidOperationException("only " + seen + " brushes were found to look at");
            if (off.Count > 0)
                throw new InvalidOperationException(off.Count + " not the theme's: " + string.Join("; ", off.Distinct().Take(30)));
        }

        static IEnumerable<(string, IBrush)> Drawn(Visual v)
        {
            if (v is Border b)
            {
                yield return ("background", b.Background);
                if (Some(b.BorderThickness)) yield return ("border", b.BorderBrush);
            }
            else if (v is ContentPresenter cp)
            {
                yield return ("background", cp.Background);
                if (Some(cp.BorderThickness)) yield return ("border", cp.BorderBrush);
            }
            else if (v is Panel p) yield return ("background", p.Background);
            else if (v is TextBlock tb)
            {
                yield return ("text", tb.Foreground);
                yield return ("background", tb.Background);
            }
            else if (v is TextPresenter tp) yield return ("text", tp.GetValue(TextElement.ForegroundProperty));
            else if (v is Shape s)
            {
                yield return ("fill", s.Fill);
                if (s.StrokeThickness > 0) yield return ("stroke", s.Stroke);
            }
        }

        static bool Some(Thickness t)
        {
            return t.Left > 0 || t.Top > 0 || t.Right > 0 || t.Bottom > 0;
        }

        /// <summary>It, or something it is drawn inside, is at opacity 0.</summary>
        static bool Unseen(Visual v)
        {
            for (Visual p = v; p != null; p = p.GetVisualParent())
                if (p.Opacity <= 0) return true;
            return false;
        }

        static string NotThese(IBrush brush, HashSet<string> allowed)
        {
            if (brush.Opacity == 0) return null;
            if (!(brush is ISolidColorBrush sb)) return "is a " + brush.GetType().Name;
            if (sb.Color.A == 0) return null;
            string h = Hex(sb.Color);
            return allowed.Contains(h) && brush.Opacity == 1 ? null : "is " + h + (brush.Opacity == 1 ? "" : " at opacity " + brush.Opacity);
        }

        // ------------------------------------------------------------ text size

        static List<(string, double)> FontSizes(Window w)
        {
            var list = new List<(string, double)>();
            foreach (Visual v in Descendants(w))
            {
                if (v is TextBlock tb) list.Add((Name(v), tb.FontSize));
                else if (v is TextBox tx) list.Add((Name(v), tx.FontSize));
            }
            return list;
        }

        static void Sizes()
        {
            List<(string, double)> at100 = null;
            Check("at 100%, the window's text sizes are read", () =>
            {
                Window w = Open(Look(false, 1.0), 700, 800);
                try { at100 = FontSizes(w); }
                finally { w.Close(); }
                if (at100.Count < 20) throw new InvalidOperationException("only " + at100.Count + " were found");
            });
            if (at100 == null) return;
            foreach (double s in new double[] { 1.25, 1.5, 2.25 })
            {
                Check("at Windows' text size " + Percent(s) + ", every text in the window is " + Percent(s) + " of its size at 100%", () =>
                {
                    Window w = Open(Look(false, s), 700, 800);
                    List<(string, double)> got;
                    try { got = FontSizes(w); }
                    finally { w.Close(); }
                    if (got.Count != at100.Count) throw new InvalidOperationException(got.Count + " texts here, " + at100.Count + " at 100%");
                    var off = new List<string>();
                    for (int i = 0; i < got.Count; i++)
                        if (Math.Abs(got[i].Item2 - at100[i].Item2 * s) > 0.01)
                            off.Add(at100[i].Item1 + " is " + got[i].Item2 + ", and " + at100[i].Item2 + " at 100%");
                    if (off.Count > 0) throw new InvalidOperationException(off.Count + " did not grow: " + string.Join("; ", off.Distinct().Take(20)));
                });
            }
        }

        // ------------------------------------------------------------ the fit

        static void Fits()
        {
            foreach (double s in new double[] { 1.0, 1.5, 2.25 })
                foreach (var (width, height) in new (double, double)[] { (700, 800), (560, 520) })
                    foreach (bool installing in new bool[] { false, true })
                    {
                        Check("at " + Percent(s) + " in a window " + width + " by " + height + (installing ? ", installing" : "") + ", nothing is cut off", () =>
                        {
                            Window w = Open(Look(false, s), width, height);
                            try
                            {
                                if (installing) Installing(w);
                                NothingCut(w);
                            }
                            finally { w.Close(); }
                        });
                    }
            Check("at 100% in its usual 700 by 800, the head and the foot hold still, only the middle scrolls, and the window is filled", () =>
            {
                Window w = Open(Look(false, 1.0), 700, 800);
                try
                {
                    var whole = (ScrollViewer)Field(w, "whole");
                    if (whole.Extent.Height > whole.Viewport.Height + 0.5)
                        throw new InvalidOperationException("the window scrolls as a whole: " + whole.Extent.Height + " of it in " + whole.Viewport.Height);
                    // And the frame fills the window, so the foot sits at its bottom.
                    var frame = (Control)Field(w, "frame");
                    if (Math.Abs(frame.Bounds.Height - whole.Viewport.Height) > 0.5)
                        throw new InvalidOperationException("the frame is " + frame.Bounds.Height + " tall in a window " + whole.Viewport.Height + " tall");
                }
                finally { w.Close(); }
            });
        }

        /// <summary>
        /// Everything on screen sits inside what holds it: the content of the
        /// nearest scroll viewer, which can be scrolled to, or the window
        /// itself. Nothing is given less room than it asked for, no text is
        /// cut short with dots, and no text runs past its own edges.
        /// </summary>
        static void NothingCut(Window w)
        {
            var off = new List<string>();
            foreach (Visual v in Descendants(w))
            {
                if (ReferenceEquals(v, w) || !v.IsEffectivelyVisible || !(v is Control c)) continue;
                // Drawn at opacity 0, as Fluent's scroll bar arrows are until
                // the pointer is on the bar: nothing of it is seen to be cut.
                if (Unseen(v)) continue;

                Visual box = w;
                Size room = w.ClientSize;
                ScrollViewer sv = v.GetVisualAncestors().OfType<ScrollViewer>().FirstOrDefault();
                if (sv != null)
                {
                    // What a scroll viewer holds, itself included, scrolls: it
                    // is measured against itself, not against the viewport.
                    if (sv.Content is Visual content && (ReferenceEquals(content, v) || content.IsVisualAncestorOf(v))) { box = content; room = content.Bounds.Size; }
                    else { box = sv; room = sv.Bounds.Size; }
                }
                // Where it is drawn: its whole rectangle through every transform
                // between it and the box, Fluent's scaled scroll bar thumb
                // included, not its corner moved and its size unscaled.
                Matrix? to = c.TransformToVisual(box);
                if (to == null) continue;
                Rect r = new Rect(c.Bounds.Size).TransformToAABB(to.Value);
                if (r.X < -0.5 || r.Right > room.Width + 0.5) off.Add(Name(c) + " runs off the side, " + Fmt(r) + " in " + Fmt(room));
                if (r.Y < -0.5 || r.Bottom > room.Height + 0.5) off.Add(Name(c) + " runs off the bottom, " + Fmt(r) + " in " + Fmt(room));

                if (!(c is ScrollViewer) && !(c is ScrollContentPresenter))
                {
                    double wantW = c.DesiredSize.Width - c.Margin.Left - c.Margin.Right;
                    double wantH = c.DesiredSize.Height - c.Margin.Top - c.Margin.Bottom;
                    if (c.Bounds.Width + 0.5 < wantW || c.Bounds.Height + 0.5 < wantH)
                        off.Add(Name(c) + " was given " + Fmt(c.Bounds.Size) + " of the " + Fmt(new Size(wantW, wantH)) + " it needs");
                }

                if (c is TextBlock tb && !string.IsNullOrEmpty(tb.Text) && tb.TextLayout != null)
                {
                    if (tb.TextLayout.TextLines.Any(l => l.HasCollapsed)) off.Add(Name(c) + " is cut short with dots");
                    if (tb.TextLayout.Width > tb.Bounds.Width + 0.5 || tb.TextLayout.Height > tb.Bounds.Height + 0.5)
                        off.Add(Name(c) + " needs " + Fmt(new Size(tb.TextLayout.Width, tb.TextLayout.Height)) + " and has " + Fmt(tb.Bounds.Size));
                }
            }
            if (off.Count > 0) throw new InvalidOperationException(off.Count + " cut: " + string.Join("; ", off.Distinct().Take(20)));
        }

        // ------------------------------------------------------------ helpers

        static void Expect(string got, string want, string what)
        {
            if (got != want) throw new InvalidOperationException(what + " is " + got + ", not " + want);
        }

        static string Hex(IBrush b)
        {
            return b is ISolidColorBrush sb ? Hex(sb.Color) : b == null ? "nothing" : b.GetType().Name;
        }

        static string Hex(Color c)
        {
            return "#" + c.A.ToString("X2", CultureInfo.InvariantCulture) + c.R.ToString("X2", CultureInfo.InvariantCulture)
                       + c.G.ToString("X2", CultureInfo.InvariantCulture) + c.B.ToString("X2", CultureInfo.InvariantCulture);
        }

        static string Percent(double s)
        {
            return (s * 100).ToString("0", CultureInfo.InvariantCulture) + "%";
        }

        static string Fmt(Rect r)
        {
            return "(" + r.X.ToString("0.#", CultureInfo.InvariantCulture) + ", " + r.Y.ToString("0.#", CultureInfo.InvariantCulture) + ") " + Fmt(r.Size);
        }

        static string Fmt(Size s)
        {
            return s.Width.ToString("0.#", CultureInfo.InvariantCulture) + " by " + s.Height.ToString("0.#", CultureInfo.InvariantCulture);
        }

        /// <summary>What a visual is, enough to find it: its type, its name, what it is a part of, and the start of its text.</summary>
        static string Name(Visual v)
        {
            string s = v.GetType().Name;
            if (v is StyledElement e)
            {
                if (!string.IsNullOrEmpty(e.Name)) s += "#" + e.Name;
                object part = e.TemplatedParent;
                if (part != null) s += " in " + part.GetType().Name;
            }
            if (v is TextBlock tb && !string.IsNullOrEmpty(tb.Text))
                s += " \"" + (tb.Text.Length > 24 ? tb.Text.Substring(0, 24) + "..." : tb.Text) + "\"";
            return s;
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
