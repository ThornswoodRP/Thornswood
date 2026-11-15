using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Threading;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace Thornswood.Tests
{
    /// <summary>
    /// The install window from the keyboard (#4459), for
    /// launcher\tests\test-4459-setup-keys.ps1. It placed focus nowhere when
    /// it opened, Enter and Esc did nothing of the window's own, and when an
    /// install stopped nothing moved to Close, so a person on the keyboard or
    /// a screen reader had to hunt for every step.
    ///
    /// The real window, out of the launcher's own Thornswood.dll, on
    /// Avalonia's headless platform, worked with key presses the way a
    /// keyboard works it. The stop is planted: an install folder no path can
    /// be made of (it holds a NUL), so the install's own thread stops at its
    /// first step and says why in this window, as every stop does, and
    /// nothing is written anywhere. One PASS or FAIL line a check.
    /// </summary>
    static class SetupKeys
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
                Opens();
                EscCloses();
                EnterInstallsAndStops();
            }
            Console.WriteLine(fails == 0 ? "the setup window works from the keyboard" : fails + " check(s) failed");
            return fails == 0 ? 0 : 1;
        }

        // ------------------------------------------------------------ opening

        static void Opens()
        {
            Check("as it opens, focus is on its first control, top to bottom", () =>
            {
                Window w = Open();
                try
                {
                    Control first = Descendants(w).OfType<Control>().FirstOrDefault(Acts);
                    if (first == null) throw new InvalidOperationException("the window has no button or box to act on");
                    object now = Focused(w);
                    if (!ReferenceEquals(now, first))
                        throw new InvalidOperationException("focus is on " + Name(now) + ", and the first control is " + Name(first));
                }
                finally { w.Close(); }
            });
        }

        static void EscCloses()
        {
            Check("Esc does what Not now does: the window closes, with no install", () =>
            {
                Window w = Open();
                Task<string> done = Done(w);
                try
                {
                    Press(w, PhysicalKey.Escape);
                    if (!done.IsCompleted) throw new InvalidOperationException("the window is still open");
                    if (done.Result != null) throw new InvalidOperationException("it closed with a folder, " + done.Result);
                }
                finally { if (!done.IsCompleted) w.Close(); }
            });
        }

        // ------------------------------------------------- Install, and a stop

        static void EnterInstallsAndStops()
        {
            Window w = null;
            bool started = false;
            Check("with every box ticked, Enter on a tick box starts the install, as Install does", () =>
            {
                w = Open();
                // Skyrim's drive is cleared, so no question about another
                // drive is asked, and the folder is the planted one.
                Set(w, "skyrimDrive", "");
                Set(w, "installRoot", "C:\\Thornswood\0planted");
                var age = (CheckBox)Field(w, "chkAge");
                age.IsChecked = true;
                foreach (CheckBox c in (CheckBox[])Field(w, "agree")) c.IsChecked = true;
                Settle(w);
                if (!((Button)Field(w, "btnGo")).IsEnabled) throw new InvalidOperationException("Install stayed off with every box ticked");
                if (!age.Focus(NavigationMethod.Tab)) throw new InvalidOperationException("the tick box took no focus");
                Settle(w);
                Press(w, PhysicalKey.Enter);
                started = ((Control)Field(w, "txtLog")).IsVisible;
                if (age.IsChecked != true) throw new InvalidOperationException("Enter unticked the box instead");
                if (!started) throw new InvalidOperationException("the install did not start: its log is not shown");
            });
            if (w == null) return;
            try
            {
                Check("once the install has started, focus is on what it is doing, not on nothing", () =>
                {
                    if (!started) throw new InvalidOperationException("the install never started");
                    object now = Focused(w);
                    if (!ReferenceEquals(now, Field(w, "txtLog")) && !ReferenceEquals(now, Field(w, "btnClose")))
                        throw new InvalidOperationException("focus is on " + Name(now));
                });
                Check("when the install stops, focus moves to Close", () =>
                {
                    if (!started) throw new InvalidOperationException("the install never started");
                    // The stop comes from the install's own thread, posted to
                    // this one: run what is posted until it has come.
                    DateTime until = DateTime.UtcNow.AddSeconds(30);
                    while (!(bool)Field(w, "finished"))
                    {
                        if (DateTime.UtcNow > until) throw new InvalidOperationException("the planted stop never reached the window");
                        Thread.Sleep(20);
                        Dispatcher.UIThread.RunJobs();
                    }
                    Settle(w);
                    var close = (Button)Field(w, "btnClose");
                    if (!close.IsEnabled) throw new InvalidOperationException("Close is still off");
                    object now = Focused(w);
                    if (!ReferenceEquals(now, close)) throw new InvalidOperationException("focus is on " + Name(now));
                });
                Check("after the stop, Esc closes the window", () =>
                {
                    if (!started) throw new InvalidOperationException("the install never started");
                    Task<string> done = Done(w);
                    Press(w, PhysicalKey.Escape);
                    if (!done.IsCompleted) throw new InvalidOperationException("the window is still open");
                });
            }
            finally { if (!Done(w).IsCompleted && !(bool)Field(w, "installing")) w.Close(); }
        }

        // ------------------------------------------------------------ helpers

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

        /// <summary>A key pressed and let go, the way a keyboard sends it.</summary>
        static void Press(Window w, PhysicalKey key)
        {
            w.KeyPressQwerty(key, RawInputModifiers.None);
            Dispatcher.UIThread.RunJobs();
            if (w.IsVisible) w.KeyReleaseQwerty(key, RawInputModifiers.None);
            Dispatcher.UIThread.RunJobs();
        }

        static object Focused(Window w)
        {
            return w.FocusManager?.GetFocusedElement();
        }

        static Task<string> Done(Window w)
        {
            return (Task<string>)winType.GetProperty("Done", Any).GetValue(w);
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

        /// <summary>A control a person acts on with the keyboard: a button, a link or a box, shown and on, and not a part of another control.</summary>
        static bool Acts(Control c)
        {
            return (c is Button || c is TextBox) && c.TemplatedParent == null && c.Focusable && c.IsTabStop
                   && c.IsEffectivelyVisible && c.IsEffectivelyEnabled;
        }

        static string Name(object o)
        {
            if (o == null) return "nothing";
            string s = o.GetType().Name;
            if (o is StyledElement e && !string.IsNullOrEmpty(e.Name)) s += "#" + e.Name;
            if (o is ContentControl cc && cc.Content is string text) s += " \"" + text + "\"";
            return s;
        }

        /// <summary>Top to bottom, in the order the window lays them out.</summary>
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
