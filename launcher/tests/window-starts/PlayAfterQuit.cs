using System;
using System.IO;
using System.Text.RegularExpressions;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.Threading;

namespace Thornswood.Tests
{
    /// <summary>
    /// A key pressed as the game closes does not start it again (#4550), for
    /// launcher\tests\test-4550-play-after-quit.ps1.
    ///
    /// On One on 26 Nov 2026 the game closed at 21:02:04Z and Space pressed
    /// Play 0.4 s later, so the game started again by itself
    /// (Profile\launcher.log, "Play pressed by the keyboard (last key Space,
    /// 0 ms ago) ... 0.4 s after the last game closed"). The window keeps the
    /// last control that had focus and gives it back when it is active again;
    /// Play had it from the press that started the game, and the launcher
    /// comes back to the front when the game closes.
    ///
    /// The real window, out of the launcher's own Thornswood.dll, on
    /// Avalonia's headless platform. Play is clicked with the mouse, the game
    /// "runs" as Shell runs it (Play turned off, the window minimised and
    /// another window active), and the game "closes" as Shell.Wire ends it
    /// (Play on again, the window restored and activated). Then Space and
    /// Enter are pressed. Once as the launcher does it at the start, with
    /// MainWindow.FocusOffButtons, and once without, which is how it was
    /// before, to show the harness sees the restart. One PASS or FAIL line a
    /// check.
    /// </summary>
    static class PlayAfterQuit
    {
        static int fails;

        static void Check(string what, Func<string> run)
        {
            string why;
            try { why = run(); }
            catch (Exception e) { why = e.GetType().FullName + ": " + e.Message; }
            if (why == null) { Console.WriteLine("PASS  " + what); return; }
            fails++;
            Console.WriteLine("FAIL  " + what + " | " + why.Replace("\r", " ").Replace("\n", " "));
        }

        public static int Run(string repo)
        {
            Session withFix = Play(true);
            Check("Play clicked with the mouse starts the game once and takes the focus, as on One", () =>
                withFix.ClicksAtStart == 1 && withFix.FocusAtStart == "BtnPlay" ? null
                    : "clicks " + withFix.ClicksAtStart + ", focus on " + withFix.FocusAtStart);
            Check("as the game starts the keyboard goes onto the window's frame", () =>
                withFix.Moved && withFix.FocusInGame == "WindowFrame" ? null
                    : "FocusOffButtons gave " + withFix.Moved + ", focus on " + withFix.FocusInGame);
            Check("when the game closes the window is back in front, with no button focused", () =>
                withFix.ActiveAfter && withFix.FocusAfter == "WindowFrame" ? null
                    : "active " + withFix.ActiveAfter + ", focus on " + withFix.FocusAfter);
            Check("Space as the game closes does not press Play", () =>
                withFix.ClicksAfterSpace == 0 ? null : "Play was pressed " + withFix.ClicksAfterSpace + " time(s)");
            Check("nor does Enter", () =>
                withFix.ClicksAfterEnter == 0 ? null : "Play was pressed " + withFix.ClicksAfterEnter + " time(s)");
            Check("Tab still reaches a button from there", () =>
                withFix.FocusAfterTab != null && withFix.FocusAfterTab != "WindowFrame" && withFix.FocusAfterTabIsButton ? null
                    : "Tab went to " + (withFix.FocusAfterTab ?? "nothing"));
            Check("and Play still starts the game when it is clicked again", () =>
                withFix.ClicksAfterClick == 1 ? null : "Play was pressed " + withFix.ClicksAfterClick + " time(s)");

            Session before = Play(false);
            Check("without it, which is how it was, the window gives Play back the focus when it comes back", () =>
                before.FocusAfter == "BtnPlay" ? null : "focus on " + before.FocusAfter);
            Check("and Space as the game closes starts the game again, the restart on One", () =>
                before.ClicksAfterSpace == 1 ? null : "Play was pressed " + before.ClicksAfterSpace + " time(s)");

            // The call is where the game starts, before Play turns off: once
            // Play is off the window has already let go of it and nothing
            // moves what it gives back.
            string play = File.ReadAllText(Path.Join(repo, "launcher", "app", "ShellPlay.cs"));
            Check("ShellPlay moves the keyboard off the buttons as the game starts, before it turns Play off", () =>
                Regex.IsMatch(play, @"playing = true;[\s\S]{0,400}?win\.FocusOffButtons\(\)[\s\S]{0,300}?btnPlay\.IsEnabled = false;") ? null
                    : "no win.FocusOffButtons() between playing = true and btnPlay.IsEnabled = false in launcher\\app\\ShellPlay.cs");
            string wire = File.ReadAllText(Path.Join(repo, "launcher", "app", "Shell.cs"));
            Check("and the window still comes back to the front when the game closes, which this stands in for", () =>
                Regex.IsMatch(wire, @"win\.WindowState = WindowState\.Normal;\s*win\.Activate\(\);") ? null
                    : "launcher\\app\\Shell.cs no longer restores and activates the window when the game closes; this harness should follow it");

            Console.WriteLine(fails == 0 ? "a key as the game closes does not start it again" : fails + " check(s) failed");
            return fails == 0 ? 0 : 1;
        }

        sealed class Session
        {
            public int ClicksAtStart, ClicksAfterSpace, ClicksAfterEnter, ClicksAfterClick;
            public string FocusAtStart, FocusInGame, FocusAfter, FocusAfterTab;
            public bool Moved, ActiveAfter, FocusAfterTabIsButton;
        }

        static Session Play(bool asTheLauncherDoes)
        {
            var s = new Session();
            var win = new MainWindow();
            var other = new Window { Width = 200, Height = 200, Title = "the game" };
            try
            {
                win.Show();
                Settle(win);
                Button play = win.FindControl<Button>("BtnPlay") ?? throw new InvalidOperationException("the window has no BtnPlay");
                int clicks = 0;
                play.Click += delegate { clicks++; };
                play.IsVisible = true;
                play.IsEnabled = true;
                Settle(win);

                Click(win, play);
                s.ClicksAtStart = clicks;
                s.FocusAtStart = Name(win.FocusManager?.GetFocusedElement());

                // The game starts: ShellPlay.PlayAsync.
                if (asTheLauncherDoes) s.Moved = win.FocusOffButtons();
                play.IsEnabled = false;
                Settle(win);
                s.FocusInGame = Name(win.FocusManager?.GetFocusedElement());
                win.WindowState = WindowState.Minimized;
                other.Show();
                other.Activate();
                Settle(other);
                Settle(win);

                // The game closes: Shell.Wire.
                play.IsEnabled = true;
                win.WindowState = WindowState.Normal;
                win.Activate();
                Settle(win);
                s.ActiveAfter = win.IsActive;
                s.FocusAfter = Name(win.FocusManager?.GetFocusedElement());

                int was = clicks;
                Press(win, PhysicalKey.Space);
                s.ClicksAfterSpace = clicks - was;
                was = clicks;
                Press(win, PhysicalKey.Enter);
                s.ClicksAfterEnter = clicks - was;

                Press(win, PhysicalKey.Tab);
                object tabbed = win.FocusManager?.GetFocusedElement();
                s.FocusAfterTab = Name(tabbed);
                s.FocusAfterTabIsButton = tabbed is Button;

                was = clicks;
                Click(win, play);
                s.ClicksAfterClick = clicks - was;
            }
            finally
            {
                other.Close();
                win.Close();
                Dispatcher.UIThread.RunJobs();
            }
            return s;
        }

        static void Click(Window w, Control c)
        {
            Point p = c.TranslatePoint(new Point(c.Bounds.Width / 2, c.Bounds.Height / 2), w)
                      ?? throw new InvalidOperationException(c.Name + " is not in the window");
            w.MouseDown(p, MouseButton.Left);
            w.MouseUp(p, MouseButton.Left);
            Settle(w);
        }

        /// <summary>A key pressed and let go, the way a keyboard sends it.</summary>
        static void Press(Window w, PhysicalKey key)
        {
            w.KeyPressQwerty(key, RawInputModifiers.None);
            Settle(w);
            w.KeyReleaseQwerty(key, RawInputModifiers.None);
            Settle(w);
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
            if (o is StyledElement e && !string.IsNullOrEmpty(e.Name)) return e.Name;
            return o.GetType().Name;
        }
    }
}
