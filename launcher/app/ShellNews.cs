using System;
using System.Threading;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;

namespace Thornswood
{
    // The news list page. It lives apart from Shell.cs because it is one
    // self-contained page slice, and Shell.cs was long enough (#500).
    static partial class Shell
    {
        static StackPanel newsList;

        // What main is on, for the dev header (#2434). The header used to name
        // mainVersion out of the dev feed as it was at the launcher's last
        // update check (pendingDoc), so a dev launcher open since before a main
        // Ship named the old main for as long as it stayed open: Patrick, 12
        // Oct, "dev says main is on 1.2.3 even tho it's on 1.2.4". Now the tab
        // asks main's own feed when it is shown (Updater.MainLauncherVersion,
        // MainVersion.cs), and the dev feed's copy is the answer only while
        // main's feed has not answered, or could not be read.
        //
        // All four are only touched on the window's thread. newsHead is the
        // header line, so an answer can be put in without rebuilding the list
        // under somebody reading it.
        static TextBlock newsHead;
        static string mainLive = "";
        static bool mainReading;
        static bool mainFailSaid;

        static string DevHeadText()
        {
            string mine = (pendingDoc != null && pendingDoc.launcherVersion != null) ? pendingDoc.launcherVersion : "";
            string on = mine.Length == 0 ? "This is the dev build." : "This is the dev build, on " + mine + ".";
            if (mainLive.Length > 0) return on + " Main is on " + mainLive + ".";
            string fed = (pendingDoc != null && pendingDoc.mainVersion != null) ? pendingDoc.mainVersion : "";
            if (fed.Length == 0) return on;
            return on + " Main was on " + fed + " when the launcher last checked for updates.";
        }

        static void ReadMainVersion()
        {
            if (mainReading) return;
            mainReading = true;
            ThreadPool.QueueUserWorkItem(delegate
            {
                string got = null, why = null;
                try { got = Updater.MainLauncherVersion(cfg); }
                catch (Exception ex) { why = ex.Message; }
                Dispatcher.UIThread.Post(delegate { MainVersionRead(got, why); });
            });
        }

        /// <summary>
        /// The answer from main's feed, on the window's thread. A read that
        /// failed puts the header back on the dev feed's copy, worded as what
        /// it is, and says why once a session in launcher.log.
        /// </summary>
        static void MainVersionRead(string got, string why)
        {
            mainReading = false;
            if (got != null)
            {
                mainLive = got;
            }
            else
            {
                mainLive = "";
                if (!mainFailSaid)
                {
                    mainFailSaid = true;
                    LogOnly("The News tab could not read what main is on from " + Updater.MainFeed + " (" + why +
                            "), so it names what the dev feed said at the last update check. This is said once a session.");
                }
            }
            if (newsHead != null) newsHead.Text = DevHeadText();
        }

        // ------------------------------------------------------------- news
        static void BuildNews()
        {
            newsList.Children.Clear();
            newsHead = null;
            NewsItem[] items = (pendingDoc != null && pendingDoc.news != null) ? pendingDoc.news : new NewsItem[0];

            if (items.Length == 0)
            {
                var empty = new TextBlock();
                empty.Text = cfg.IsDev
                    ? "Nothing posted yet. The notes of each release turn up here once the dev server runs it."
                    : "Nothing posted yet. The notes of each release turn up here once the live server runs it.";
                empty.Foreground = Res("Faint"); empty.FontSize = 12.5;
                empty.TextWrapping = TextWrapping.Wrap;
                newsList.Children.Add(empty);
                return;
            }

            // What this build has that main does not.
            //
            // The dev tab is main's whole history with the dev notes on top,
            // so the tab used to read as one long list with no seam in it. The
            // seam is the useful part: it is the difference between the build
            // in front of you and the build everybody plays, which is the list
            // of what wants testing before this one becomes that one.
            int ahead = 0;
            for (int i = 0; i < items.Length; i++) { if (items[i].IsDev) ahead++; }

            if (cfg.IsDev)
            {
                var head = new StackPanel();

                var ht = new TextBlock();
                ht.Text = DevHeadText();
                ht.FontSize = 13.5; ht.FontWeight = FontWeight.SemiBold;
                ht.Foreground = Res("Ink"); ht.TextWrapping = TextWrapping.Wrap;
                head.Children.Add(ht);
                newsHead = ht;

                // Main's version from main's own feed, each time the tab is
                // shown (#2434). BuildNews also runs when a check lands and
                // after a theme change; the read goes out only while the tab is
                // the page in front of somebody.
                if (pages != null && pages[PageNews].IsVisible) ReadMainVersion();

                var hb = new TextBlock();
                if (ahead == 0)
                {
                    hb.Text = "Nothing below is dev only. Everything here has gone out on main as well, so there is nothing waiting to be tested.";
                }
                else
                {
                    hb.Text = (ahead == 1 ? "One note below is marked DEV. It is" : ahead + " notes below are marked DEV. They are")
                            + " on this build and not on main yet, so that is what wants testing before dev goes over.";
                }
                hb.FontSize = 12; hb.Foreground = Res("Muted");
                hb.TextWrapping = TextWrapping.Wrap; hb.LineHeight = 18;
                hb.Margin = new Thickness(0, 6, 0, 0);
                head.Children.Add(hb);

                var hc = new Border();
                hc.Background = Res("Card");
                hc.BorderBrush = Res("Accent");
                hc.BorderThickness = new Thickness(2, 0, 0, 0);
                hc.Padding = new Thickness(16, 14, 16, 14);
                hc.Margin = new Thickness(0, 0, 0, 24);
                hc.Child = head;
                newsList.Children.Add(hc);
            }

            foreach (NewsItem n in items)
            {
                var sp = new StackPanel();

                if (!string.IsNullOrEmpty(n.DateText) || n.IsDev)
                {
                    var stamp = new StackPanel();
                    stamp.Orientation = Orientation.Horizontal;
                    stamp.Margin = new Thickness(0, 0, 0, 6);

                    if (!string.IsNullOrEmpty(n.DateText))
                    {
                        var d = new TextBlock();
                        d.Text = n.DateText.ToUpperInvariant();
                        d.FontSize = 9.5; d.FontWeight = FontWeight.SemiBold;
                        d.Foreground = Res("Accent");
                        d.VerticalAlignment = VerticalAlignment.Center;
                        stamp.Children.Add(d);
                    }

                    // Only a dev launcher ever has one of these, on the notes of
                    // the Releases main's Deployment has not reached yet.
                    if (n.IsDev)
                    {
                        var ct = new TextBlock();
                        ct.Text = "DEV";
                        ct.FontSize = 8.5; ct.FontWeight = FontWeight.Bold;
                        ct.Foreground = Res("Warn");

                        var chip = new Border();
                        chip.BorderBrush = Res("Warn");
                        chip.BorderThickness = new Thickness(1);
                        chip.CornerRadius = new CornerRadius(3);
                        chip.Padding = new Thickness(5, 1, 5, 1);
                        chip.Margin = new Thickness(string.IsNullOrEmpty(n.DateText) ? 0 : 8, 0, 0, 0);
                        chip.VerticalAlignment = VerticalAlignment.Center;
                        chip.Child = ct;
                        stamp.Children.Add(chip);
                    }

                    sp.Children.Add(stamp);
                }

                var t = new TextBlock();
                t.Text = n.title; t.FontSize = 15; t.FontWeight = FontWeight.SemiBold;
                t.Foreground = Res("Ink"); t.TextWrapping = TextWrapping.Wrap;
                sp.Children.Add(t);

                if (!string.IsNullOrEmpty(n.body))
                {
                    var bd = new TextBlock();
                    bd.Text = n.body; bd.FontSize = 12.5; bd.Foreground = Res("Muted");
                    bd.TextWrapping = TextWrapping.Wrap; bd.LineHeight = 20;
                    bd.Margin = new Thickness(0, 7, 0, 0);
                    sp.Children.Add(bd);
                }

                if (n.details != null && n.details.Length > 0)
                {
                    var box = new StackPanel();
                    box.Margin = new Thickness(0, 12, 0, 0);
                    for (int i = 0; i < n.details.Length; i++)
                    {
                        string line = n.details[i];
                        if (string.IsNullOrEmpty(line)) continue;

                        var row = new StackPanel();
                        row.Orientation = Orientation.Horizontal;
                        row.Margin = new Thickness(0, 0, 0, 4);

                        var dot = new TextBlock();
                        dot.Text = "\u2022";
                        dot.FontSize = 12;
                        dot.Foreground = Res("Accent");
                        dot.Margin = new Thickness(0, 0, 8, 0);
                        row.Children.Add(dot);

                        var dt = new TextBlock();
                        dt.Text = line;
                        dt.FontSize = 11.5;
                        dt.Foreground = Res("Faint");
                        dt.TextWrapping = TextWrapping.Wrap;
                        dt.MaxWidth = 520;
                        row.Children.Add(dt);

                        box.Children.Add(row);
                    }
                    if (box.Children.Count > 0) sp.Children.Add(box);
                }

                var b = new Border();
                b.BorderBrush = Res("Line");
                b.BorderThickness = new Thickness(0, 0, 0, 1);
                b.Padding = new Thickness(0, 0, 0, 20);
                b.Margin = new Thickness(0, 0, 0, 20);
                b.Child = sp;
                newsList.Children.Add(b);
            }
        }
    }
}
