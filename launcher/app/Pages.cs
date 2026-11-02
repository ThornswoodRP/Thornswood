using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;
using Ellipse = Avalonia.Controls.Shapes.Ellipse;

namespace Thornswood
{
    // Diagnostics: what the launcher can see about this machine, and the
    // report it builds. It lives apart from Shell.cs because it shares
    // nothing with the pages that do work, and Shell.cs was long enough. The
    // other read-only pages, Server and What is installed, were cut with
    // the rest of what #599 had taken off the rail (#3146), and the controls
    // page went into the game as Settings (#3126).
    static partial class Shell
    {
        static TextBlock txtDiagNote, txtDiagHolds, txtThemeNote;
        static StackPanel diagReadings, diagCollection, diagAddons;
        static Button btnDiagBundle, btnDiagOpen;

        // The last server test: its round trip in ms, -1 when nothing
        // answered, -2 before the first. The Server page drew the last forty
        // as bars; Diagnostics names only the last (#3146).
        static long lastPing = -2;
        static bool serverUp;
        static int pingTicks;

        static void BindPages()
        {
            txtDiagNote = win.TxtDiagNote; txtDiagHolds = win.TxtDiagHolds; txtThemeNote = win.TxtThemeNote;
            diagReadings = win.DiagReadings;
            diagCollection = win.DiagCollection;
            diagAddons = win.DiagAddons;
            btnDiagBundle = win.BtnDiagBundle; btnDiagOpen = win.BtnDiagOpen;
        }

        static void WirePages()
        {
            txtDiagHolds.Text = Diag.WhatTheReportHolds();
            btnDiagOpen.Click += delegate
            {
                Directory.CreateDirectory(Diag.ReportDir);
                Open(Diag.ReportDir);
            };
            btnDiagBundle.Click += delegate { MakeReport(); };
        }

        // serving: the resources port accepted a connection, which is the only
        // thing that proves a server is actually running rather than the host
        // merely being switched on.
        static bool serverServing;

        static void RecordPing(long ms, bool serving)
        {
            lastPing = ms;
            serverUp = ms >= 0;
            serverServing = serving;
        }

        // ------------------------------------------------------- diagnostics
        static void BuildDiag()
        {
            if (diagReadings == null) return;

            // Scan and Fix and Ready to launch share one Verify.Run(cfg).
            // When a server-aware LastIssues is already in hand (Scan, Fix,
            // Play, or a finished Vortex bring-up-to-date), paint from that
            // instead of Waiting on another full Run: opening Diagnostics to
            // press a button there was paying the server
            // round trip every time after #709. Fresh Run only when there is
            // no shared truth yet.
            if (Verify.LastUsedServer && Verify.LastIssues != null)
                ShowVerify(Verify.LastIssues, false);
            else
                RunScan();

            if (diagCollection != null)
            {
                diagCollection.Children.Clear();
                // After the last Ready to launch row, before Bring it up to
                // date from Vortex. Used to sit in DiagReadings under What the
                // launcher can see right now, which put it under the Vortex
                // section.
                diagCollection.Children.Add(CollectionStatusCard());
            }

            // The optional packs, under the collection card (#1170).
            DrawAddons();

            DrawReadings();
            // Voice is asked again whenever the page opens, the way its card
            // on the Server page was; the answer redraws the readings.
            CheckVoice();

            string newest = "";
            try
            {
                if (Directory.Exists(Diag.ReportDir))
                {
                    var files = Directory.GetFiles(Diag.ReportDir, "*.zip");
                    Array.Sort(files);
                    if (files.Length > 0) newest = Path.GetFileName(files[files.Length - 1]);
                }
            }
            catch (Exception ex) { Swallow.Note("Pages.BuildDiag, newest report", ex); }
            txtDiagNote.Text = newest.Length > 0
                ? "Last report: " + newest + ", in Profile, Reports."
                : "No report built yet.";
        }

        /// <summary>What the launcher can see right now, one row each.</summary>
        static void DrawReadings()
        {
            if (diagReadings == null) return;
            diagReadings.Children.Clear();

            string ping = lastPing >= 0 ? lastPing + " ms" : "not measured";

            foreach (Reading r in Diag.Readings(cfg, serverUp, serverServing, ping, voiceUp, VoiceKey()))
                diagReadings.Children.Add(ReadingRow(r));
        }

        // The key the voice reading names, as Thornswood.ini has it bound, or
        // "" when it cannot be read.
        static string VoiceKey()
        {
            try
            {
                foreach (Keys.Binding b in Keys.All())
                    if (b.Id == "ptt") return b.Value ?? "";
            }
            catch (Exception ex) { Swallow.Note("Pages.VoiceKey", ex); }
            return "";
        }

        static void MakeReport()
        {
            btnDiagBundle.IsEnabled = false;
            Log("Gathering logs.");
            ThreadPool.QueueUserWorkItem(delegate
            {
                string path = null, err = null;
                try { path = Diag.Report(cfg, Updater.Version); }
                catch (Exception ex) { err = ex.Message; }

                Dispatcher.UIThread.Post(delegate
                {
                    btnDiagBundle.IsEnabled = true;
                    if (err != null) { Log("Could not build the report: " + err); return; }
                    BuildDiag();
                    Log("Report written to " + path);
                    Reveal(path);
                });
            });
        }

        static Control ReadingRow(Reading r)
        {
            var g = new Grid();
            var c0 = new ColumnDefinition(); c0.Width = GridLength.Auto;
            var c1 = new ColumnDefinition(); c1.Width = new GridLength(1, GridUnitType.Star);
            g.ColumnDefinitions.Add(c0); g.ColumnDefinitions.Add(c1);

            var dot = new Ellipse();
            dot.Width = 9; dot.Height = 9;
            dot.VerticalAlignment = VerticalAlignment.Top;
            dot.Margin = new Thickness(0, 5, 15, 0);
            dot.Fill = Res(r.Level == 0 ? "Ok" : r.Level == 1 ? "Warn" : "Bad");
            Grid.SetColumn(dot, 0); g.Children.Add(dot);

            var sp = new StackPanel();
            var t = new TextBlock();
            t.Text = r.Title; t.FontSize = 13.5; t.FontWeight = FontWeight.SemiBold;
            t.Foreground = Res("Ink"); t.TextWrapping = TextWrapping.Wrap;
            sp.Children.Add(t);

            var d = new TextBlock();
            d.Text = r.Detail; d.FontSize = 12.5; d.Foreground = Res("Muted");
            d.TextWrapping = TextWrapping.Wrap; d.LineHeight = 19;
            d.Margin = new Thickness(0, 4, 0, 0);
            sp.Children.Add(d);

            Grid.SetColumn(sp, 1); g.Children.Add(sp);

            var card = new Border();
            card.Theme = Look("Slab");
            card.Margin = new Thickness(0, 0, 0, 8);
            card.Child = g;
            return card;
        }

        /// <summary>
        /// One of the window's looks by its key in MainWindow.axaml (Slab,
        /// Ghost, Solid, Eyebrow, Body and the rest), for a control built
        /// here in code. They are control themes, the Avalonia form of the
        /// keyed styles the WPF window had, so a control takes one the way it
        /// took a Style before.
        /// </summary>
        static ControlTheme Look(string key)
        {
            return (ControlTheme)win.FindResource(key);
        }
    }
}
