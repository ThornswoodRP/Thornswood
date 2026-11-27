using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.ExceptionServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace Thornswood.Tests
{
    /// <summary>
    /// A greyed control's tooltip shows when it is hovered (#4708), for
    /// launcher\tests\test-4708-disabled-tooltips.ps1. The launcher puts the
    /// reason Play is greyed in Play's tooltip (Shell.cs), and some of those
    /// reasons are said nowhere else, but Avalonia shows no tooltip on a
    /// disabled control unless ToolTip.ShowOnDisabled says so, so hovering a
    /// greyed Play showed nothing.
    ///
    /// The real windows, out of the launcher's own Thornswood.dll, on
    /// Avalonia's headless platform, hovered with the pointer the way a mouse
    /// hovers them. One PASS or FAIL line a check.
    /// </summary>
    static class DisabledTips
    {
        static int fails;
        const BindingFlags Any = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        static void Check(string what, Action run)
        {
            try { run(); Console.WriteLine("PASS  " + what); }
            catch (Exception e)
            {
                if (e is TargetInvocationException t && t.InnerException != null) e = t.InnerException;
                fails++;
                string why = (e.GetType().FullName + ": " + e.Message).Replace("\r", " ").Replace("\n", " ");
                if (why.Length > 1500) why = why.Substring(0, 1500) + "...";
                Console.WriteLine("FAIL  " + what + " | " + why);
            }
        }

        public static int Run()
        {
            MainWindow win = null;
            Check("the main window is made and shown", () =>
            {
                win = new MainWindow();
                win.Show();
                Settle(win);
            });
            if (win != null)
            {
                Button play = null;
                Check("it has its Play button", () => play = win.FindControl<Button>("BtnPlay") ?? throw new InvalidOperationException("the window has no BtnPlay"));

                // The harness can open a tooltip at all: an enabled button's,
                // which showed before #4708 too, so a FAIL below is the
                // greyed case and not the hover.
                Check("hovering Play while it is on shows its tooltip (the hover itself works)", () =>
                {
                    play.IsEnabled = true;
                    Hover(win, play, "Play comes back when this is done.");
                });
                Check("hovering a greyed Play shows the tooltip that says why", () =>
                {
                    play.IsEnabled = false;
                    Hover(win, play, "Play comes back when this is done.");
                });

                // Every part of the window, the hidden pages too, then every
                // control in it: each greyed control with a tooltip shows it,
                // whichever one it is.
                Check("every control in the main window shows its tooltip when greyed", () =>
                {
                    foreach (Visual v in Descendants(win))
                        if (v is Control c && !c.IsVisible) c.IsVisible = true;
                    Settle(win);
                    Every(win, "the main window");
                });
                win.Close();
            }

            Type installType = typeof(App).Assembly.GetType("Thornswood.InstallWindow", false);
            Check("every control in the install window shows its tooltip when greyed", () =>
            {
                if (installType == null) throw new InvalidOperationException("there is no Thornswood.InstallWindow");
                Window w;
                try { w = (Window)Activator.CreateInstance(installType, true); }
                catch (TargetInvocationException e) { ExceptionDispatchInfo.Capture(e.InnerException).Throw(); throw; }
                try
                {
                    w.Show();
                    Settle(w);
                    Every(w, "the install window");
                    // Install is greyed until every box is ticked: with a
                    // tooltip, hovering it shows it.
                    var go = installType.GetField("btnGo", Any)?.GetValue(w) as Button ?? throw new InvalidOperationException("InstallWindow has no btnGo");
                    if (go.IsEnabled) throw new InvalidOperationException("Install is on before any box is ticked");
                    Hover(w, go, "a reason it is greyed");
                }
                finally { w.Close(); }
            });

            Check("a window the launcher makes in code shows a greyed control's tooltip too", () =>
            {
                var b = new Button { Content = "Greyed", IsEnabled = false, Width = 120, Height = 40 };
                var w = new Window { Content = b, Width = 300, Height = 200 };
                try
                {
                    w.Show();
                    Settle(w);
                    Hover(w, b, "why it is greyed");
                }
                finally { w.Close(); }
            });

            Console.WriteLine(fails == 0 ? "every greyed control shows its tooltip" : fails + " check(s) failed");
            return fails == 0 ? 0 : 1;
        }

        /// <summary>
        /// The pointer moved off the control and onto its middle, with the tip
        /// set and no wait before it shows. Throws unless the tooltip is open.
        /// </summary>
        static void Hover(Window w, Control c, string tip)
        {
            ToolTip.SetTip(c, tip);
            ToolTip.SetShowDelay(c, 0);
            w.MouseMove(new Point(1, 1));
            Dispatcher.UIThread.RunJobs();
            ToolTip.SetIsOpen(c, false);
            Settle(w);
            Point? at = c.TranslatePoint(new Point(c.Bounds.Width / 2, c.Bounds.Height / 2), w);
            if (at == null) throw new InvalidOperationException(Name(c) + " is not in the window");
            w.MouseMove(at.Value);
            Settle(w);
            bool open = ToolTip.GetIsOpen(c);
            w.MouseMove(new Point(1, 1));
            Settle(w);
            ToolTip.SetIsOpen(c, false);
            if (!open)
                throw new InvalidOperationException("hovering " + Name(c) + (c.IsEffectivelyEnabled ? " (on)" : " (greyed)") + " showed no tooltip");
        }

        /// <summary>Every control under the window would show its tooltip while greyed.</summary>
        static void Every(Window w, string which)
        {
            var missed = new List<string>();
            int seen = 0;
            foreach (Visual v in Descendants(w))
            {
                if (!(v is Control c)) continue;
                seen++;
                if (!ToolTip.GetShowOnDisabled(c)) missed.Add(Name(c));
            }
            if (seen == 0) throw new InvalidOperationException(which + " has no controls");
            if (missed.Count > 0)
                throw new InvalidOperationException(missed.Count + " of " + seen + " controls in " + which + " would show nothing while greyed, among them " +
                    string.Join(", ", missed.Distinct().Take(8)));
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

        static string Name(object o)
        {
            if (o == null) return "nothing";
            string s = o.GetType().Name;
            if (o is StyledElement e && !string.IsNullOrEmpty(e.Name)) s += "#" + e.Name;
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
                foreach (Visual child in v.GetVisualChildren()) stack.Push(child);
            }
        }
    }
}
