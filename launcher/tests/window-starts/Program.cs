using System;
using System.Collections.Generic;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Styling;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace Thornswood.Tests
{
    /// <summary>
    /// Starts the launcher's window with no screen and draws it, the way it is
    /// drawn at start, then asks for every style and theme the window and the
    /// app hold, so one only a hidden page uses is built too. Prints a PASS or
    /// FAIL line per check and exits 1 on any failure.
    ///
    /// Why (2 Nov 2026): a scroll bar theme with two /template/ steps in one
    /// selector compiled, and every check passed, but Avalonia refused it the
    /// first time a scroll bar was drawn, so the launcher stopped at start
    /// with "ControlTemplate styles cannot contain multiple template
    /// selectors". Avalonia builds a theme only when something first asks for
    /// it, so nothing short of building them finds that.
    /// </summary>
    static class Program
    {
        static int fails;

        static void Check(string what, Action run)
        {
            try { run(); Console.WriteLine("PASS  " + what); }
            catch (Exception e)
            {
                fails++;
                Console.WriteLine("FAIL  " + what);
                Console.WriteLine("      " + e.GetType().FullName + ": " + e.Message);
            }
        }

        static int Main()
        {
            AppBuilder.Configure<App>()
                .UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = true })
                .SetupWithoutStarting();

            MainWindow win = null;
            Check("the window is made from its markup", () => win = new MainWindow());
            if (win == null) return 1;
            Check("the window is shown and laid out, as at start", () =>
            {
                win.Show();
                Dispatcher.UIThread.RunJobs();
                win.UpdateLayout();
                Dispatcher.UIThread.RunJobs();
            });

            var hosts = new List<(string, IResourceHost)> { ("the app", Application.Current), ("the window", win) };
            foreach (var (name, host) in hosts)
            {
                var keys = new List<object>();
                IResourceDictionary own = host is Application a ? a.Resources : ((StyledElement)host).Resources;
                Collect(own, keys);
                foreach (object key in keys)
                {
                    Check(name + "'s resource " + key + " is built", () =>
                    {
                        if (!host.TryFindResource(key, out object value))
                            throw new InvalidOperationException("it is listed but not found");
                        if (value is ControlTheme theme) BuildTheme(theme);
                    });
                }
            }

            // Every page and panel, not only the first one shown: each control
            // in the window is made visible in turn and laid out again.
            Check("every part of the window lays out when shown", () =>
            {
                foreach (Visual v in Descendants(win))
                {
                    if (v is Control c && !c.IsVisible) { c.IsVisible = true; }
                }
                win.UpdateLayout();
                Dispatcher.UIThread.RunJobs();
            });

            win.Close();
            Console.WriteLine(fails == 0 ? "the window starts" : fails + " check(s) failed");
            return fails == 0 ? 0 : 1;
        }

        // A theme's own styles and those it is based on, each attached as
        // Avalonia attaches them when a control first uses the theme.
        static void BuildTheme(ControlTheme theme)
        {
            for (ControlTheme t = theme; t != null; t = t.BasedOn)
            {
                foreach (IStyle child in t.Children) { _ = child.Children; }
            }
            Type target = theme.TargetType;
            if (target != null && typeof(Control).IsAssignableFrom(target) && !target.IsAbstract &&
                target.GetConstructor(Type.EmptyTypes) != null)
            {
                var host = new Window { Content = (Control)Activator.CreateInstance(target) };
                ((Control)host.Content).Theme = theme;
                host.Show();
                Dispatcher.UIThread.RunJobs();
                host.UpdateLayout();
                host.Close();
            }
        }

        static void Collect(IResourceDictionary d, List<object> keys)
        {
            foreach (object k in d.Keys) keys.Add(k);
            foreach (IResourceProvider m in d.MergedDictionaries)
                if (m is IResourceDictionary md) Collect(md, keys);
            foreach (var pair in d.ThemeDictionaries)
                if (pair.Value is IResourceDictionary td) Collect(td, keys);
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
