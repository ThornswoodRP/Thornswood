using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Threading;

namespace Thornswood
{
    /// <summary>
    /// The install, in the launcher's first start (issue #4824).
    ///
    /// WHERE THE INSTALL RUNS, and why here. Velopack's Setup.exe installs the
    /// launcher and Thornswood's own game files and then starts the launcher.
    /// Until then Thornswood-Setup.exe (installer\setup\Bootstrap.cs) asked
    /// the questions and ran installer\Setup-Thornswood.ps1 hidden in its
    /// window. The questions and the steps now live in the launcher itself,
    /// shown before anything else on a start that finds no install recorded
    /// (InstallPlace.Recorded): one program, one install path, and nothing for
    /// Velopack's Setup.exe to run but the launcher it just put down. A second
    /// small program would have been one more exe to sign, update and keep in
    /// step with the launcher's own Steam, own folder and agreement code,
    /// which this uses directly.
    ///
    /// Shell's start calls it: when InstallPlace.Recorded() is null (and no
    /// -root was given), it shows this window as the main window and awaits
    /// Done. Null means the person closed it, or the install stopped and they
    /// closed it after reading why: the launcher then exits. A folder means
    /// it installed there: Shell runs Paths.Init on it, shows its own main
    /// window, and then closes this one. This window never closes itself
    /// after a finished install, so the app is never without a window.
    ///
    /// What the window asks is Thornswood-Setup.exe's, with its words: the
    /// drive, starting on Skyrim's (issue #473); Thornswood's own Skyrim
    /// folder (#906); and the four boxes that lock Install (#1009). Its
    /// colours are the launcher's Forge (#2851), so it holds no colour of its
    /// own. The steps are InstallSteps, on a thread of their own, every line
    /// of them in the window and in Profile\setup-log.txt, with the bar on the
    /// bytes copied.
    /// </summary>
    sealed class InstallWindow : Window
    {
        const string Title_ = "Thornswood Setup";

        readonly TaskCompletionSource<string> done = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);

        /// <summary>The install folder once it is installed; null when closed without one.</summary>
        public Task<string> Done { get { return done.Task; } }

        TextBlock txtBody, txtRoot, txtRoom, txtSkyrim, txtOwn, txtStat;
        WrapPanel driveRow;
        Border rootBox, ownBox;
        TextBox txtLog;
        ProgressBar bar;
        Button btnGo, btnClose, btnPick, btnVortexPick, btnVortexForget;
        CheckBox chkOwn, chkAge;
        CheckBox[] agree;
        readonly List<Button> driveButtons = new List<Button>();

        string installRoot;
        string vortexGame = "";
        readonly string steamRoot, skyrimPath, skyrimDrive;

        // Once the steps are moving files, stopping half way leaves half of
        // them moved. Nothing in them waits for ever: their one question,
        // Skyrim still running, comes to this window, so they end by
        // themselves.
        volatile bool installing;
        bool finished;
        StreamWriter logFile;
        readonly object logLock = new object();

        public InstallWindow()
        {
            Title = Title_;
            Width = 700;
            Height = 800;
            MinWidth = 560;
            MinHeight = 520;
            CanResize = true;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            FontFamily = new FontFamily("Segoe UI");

            // Every colour is the launcher's, by its name in Themes.cs (Ink,
            // Faint, Bad and the rest), never a literal: the window is drawn
            // in Forge from there (#2851), so the first window a new tester
            // sees reaches the launcher's 4.5 to 1 text and cannot fall
            // behind it.
            Themes.Apply(this, "Forge");

            steamRoot = Steam.Path_();
            skyrimPath = Steam.SkyrimPath();
            skyrimDrive = InstallPlace.DriveOf(skyrimPath);
            installRoot = InstallPlace.StartRoot(skyrimDrive);

            Content = Build();
            Background = B("Bg");

            BuildDrives();
            SetRoot(installRoot);
            SayOwnGame();
            Gate();

            Bitmap art = Emblem();
            if (art != null) Icon = new WindowIcon(art);

            Opened += delegate
            {
                // Message boxes sit over this window and block it.
                Avalonia.Platform.IPlatformHandle h = TryGetPlatformHandle();
                if (h != null) Ask.Owner = h.Handle;
                KeepOnScreen();
            };
            Closing += OnClosing;
            Closed += delegate { done.TrySetResult(null); };
        }

        IBrush B(string name)
        {
            object v;
            if (this.TryFindResource(name, out v) && v is IBrush b) return b;
            throw new InvalidOperationException("Themes.Apply left no colour named " + name + ".");
        }

        // ---------------------------------------------------------------- layout

        Control Build()
        {
            var outer = new Grid { RowDefinitions = new RowDefinitions("Auto,*,Auto") };

            // The head: the emblem, Setup, Thornswood and the accent rule.
            var head = new Border { Background = B("Panel"), BorderBrush = B("Line"), BorderThickness = new Thickness(0, 0, 0, 1) };
            var headRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(36, 24, 36, 22) };
            Bitmap logo = Emblem();
            if (logo != null) headRow.Children.Add(new Image { Source = logo, Width = 78, Height = 78, Margin = new Thickness(0, 0, 22, 0), VerticalAlignment = VerticalAlignment.Center });
            var names = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            names.Children.Add(new TextBlock { Text = "Setup", Foreground = B("Faint"), FontSize = 13, FontFamily = new FontFamily("Constantia, Georgia"), Margin = new Thickness(1, 0, 0, 4) });
            names.Children.Add(new TextBlock { Text = "Thornswood", Foreground = B("Ink"), FontSize = 30, FontFamily = new FontFamily("Constantia, Georgia") });
            names.Children.Add(new Border { Height = 2, Width = 42, Background = B("Accent"), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(2, 12, 0, 0) });
            headRow.Children.Add(names);
            head.Child = headRow;
            Grid.SetRow(head, 0);
            outer.Children.Add(head);

            var middle = new Grid { Margin = new Thickness(36, 24, 36, 0), RowDefinitions = new RowDefinitions("*,Auto") };
            // Everything above the progress bar scrolls. On a short screen, or
            // once the drive warning wraps to three lines, the boxes ran off
            // the bottom of a window that could not be scrolled.
            var scroll = new ScrollViewer { VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled, Padding = new Thickness(0, 0, 6, 0) };
            var body = new StackPanel();

            txtBody = new TextBlock
            {
                Foreground = B("Muted"), FontSize = 13, LineHeight = 21, TextWrapping = TextWrapping.Wrap,
                Text = "This puts Thornswood's own content on your PC. With Thornswood's own Skyrim folder chosen below, it does not install into the Skyrim you already have on Steam, and that copy is left as it is, for you to play and mod however you like. Without it, Thornswood's own content goes into that copy until you turn the folder on in the launcher, which then takes it back out.\n\n" +
                       "Thornswood runs from its own game folder. The launcher builds it out of your Steam copy and what Vortex has deployed there, most of it as hard links that take no extra space, and copies of the few files other programs rewrite. Hard links only work inside one drive, so Thornswood goes on the same drive as Skyrim.\n\n" +
                       "The mods themselves come from a collection on Nexus. Vortex installs them into a profile of their own, so switching back to your usual profile and running Purge Mods leaves your Skyrim where you started. The launcher has the link and walks you through it.\n\n" +
                       "Nothing of Bethesda's is renamed or deleted. You need Steam running and Skyrim on build 1.6.1170.",
            };
            body.Children.Add(txtBody);

            // Install to: the folder, Another folder, the drive buttons, and
            // the lines on Skyrim's drive and the room.
            var rootStack = new StackPanel();
            var rootHead = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
            var rootNames = new StackPanel();
            rootNames.Children.Add(Caption("Install to"));
            txtRoot = new TextBlock { Foreground = B("Ink"), FontSize = 14, FontFamily = new FontFamily("Cascadia Mono, Consolas"), TextTrimming = TextTrimming.CharacterEllipsis };
            rootNames.Children.Add(txtRoot);
            rootHead.Children.Add(rootNames);
            btnPick = SmallButton("Another folder");
            btnPick.VerticalAlignment = VerticalAlignment.Bottom;
            btnPick.Click += async delegate { await PickFolder(); };
            Grid.SetColumn(btnPick, 1);
            rootHead.Children.Add(btnPick);
            rootStack.Children.Add(rootHead);
            driveRow = new WrapPanel { Margin = new Thickness(0, 13, 0, 0) };
            rootStack.Children.Add(driveRow);
            txtSkyrim = Small(new Thickness(0, 11, 0, 0));
            rootStack.Children.Add(txtSkyrim);
            txtRoom = Small(new Thickness(0, 8, 0, 0));
            rootStack.Children.Add(txtRoom);
            rootBox = Card(rootStack, new Thickness(0, 20, 0, 0));
            body.Children.Add(rootBox);

            // Thornswood's own Skyrim folder, offered here as well as in the
            // launcher's Settings, Maintenance (issue #906), in that panel's
            // own words, so the two say the same thing.
            var ownStack = new StackPanel();
            ownStack.Children.Add(Caption("Thornswood's own Skyrim folder"));
            ownStack.Children.Add(new TextBlock
            {
                Foreground = B("Muted"), FontSize = 11.5, LineHeight = 18, TextWrapping = TextWrapping.Wrap,
                Text = "Runs Thornswood from a Skyrim folder of its own, made from what Vortex has deployed while the Thornswood profile is on. Any other Vortex profile can then use the Steam copy without reaching Thornswood, and switching profiles in Vortex no longer takes Thornswood's mods away. The big files are links to Vortex's copies, so the collection is not on the disk twice. When Vortex deploys a newer Thornswood collection, the launcher brings it in by itself the next time it starts.",
            });
            chkOwn = Box("Give Thornswood a Skyrim folder of its own", new Thickness(0, 12, 0, 0));
            chkOwn.IsCheckedChanged += delegate { SayOwnGame(); };
            ownStack.Children.Add(chkOwn);
            txtOwn = Small(new Thickness(0, 8, 0, 0));
            txtOwn.LineHeight = 18;
            ownStack.Children.Add(txtOwn);
            var hint = Small(new Thickness(0, 12, 0, 0));
            hint.LineHeight = 18;
            hint.Text = "The launcher finds the folder Vortex deploys into when it is in a Steam library. If it is somewhere else, choose it here: in Vortex, Mods, Open, Open Game Folder shows which one. Only the files Vortex lists in it are used, and the game itself always comes from the Steam copy.";
            ownStack.Children.Add(hint);
            var vortexRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 9, 0, 0) };
            btnVortexPick = SmallButton("Choose Vortex's folder");
            btnVortexPick.Margin = new Thickness(0, 0, 8, 0);
            btnVortexPick.Click += async delegate { await PickVortexFolder(); };
            btnVortexForget = SmallButton("Forget the chosen folder");
            btnVortexForget.IsVisible = false;
            btnVortexForget.Click += delegate { vortexGame = ""; SayOwnGame(); };
            vortexRow.Children.Add(btnVortexPick);
            vortexRow.Children.Add(btnVortexForget);
            ownStack.Children.Add(vortexRow);
            ownBox = Card(ownStack, new Thickness(0, 14, 0, 0));
            body.Children.Add(ownBox);

            // What the install says, shown here in place of the two boxes
            // above once it starts.
            txtLog = new TextBox
            {
                Margin = new Thickness(0, 16, 0, 0), Height = 330, IsVisible = false, IsReadOnly = true,
                TextWrapping = TextWrapping.Wrap, FontFamily = new FontFamily("Cascadia Mono, Consolas"), FontSize = 11.5,
                Padding = new Thickness(10, 8), Background = B("Deep"), Foreground = B("Muted"), BorderBrush = B("Line"), BorderThickness = new Thickness(1),
            };
            body.Children.Add(txtLog);

            scroll.Content = body;
            middle.Children.Add(scroll);

            var statStack = new StackPanel { VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 4) };
            bar = new ProgressBar { Height = 5, Minimum = 0, Maximum = 1000, Foreground = B("Accent"), Background = B("Deep"), Margin = new Thickness(0, 20, 0, 0), IsVisible = false };
            statStack.Children.Add(bar);
            txtStat = new TextBlock { Foreground = B("Faint"), FontSize = 11.5, FontFamily = new FontFamily("Cascadia Mono, Consolas"), Margin = new Thickness(0, 11, 0, 0), TextTrimming = TextTrimming.CharacterEllipsis };
            statStack.Children.Add(txtStat);
            Grid.SetRow(statStack, 1);
            middle.Children.Add(statStack);
            Grid.SetRow(middle, 1);
            outer.Children.Add(middle);

            // Install stays off until all four boxes are ticked (issue #1009
            // added the three pages). Each link opens that page on the site in
            // the browser, so what a person reads is the current text and
            // never a copy in here that goes stale. The link sits beside its
            // box, not inside it, so opening the page does not tick it.
            var foot = new Border { Background = B("Panel"), BorderBrush = B("Line"), BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(36, 18) };
            var footGrid = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto") };
            var boxes = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 24, 0) };
            chkAge = Box(InstallAgreements.AgeWords, new Thickness(0));
            chkAge.IsCheckedChanged += delegate { Gate(); };
            boxes.Children.Add(chkAge);
            agree = new CheckBox[InstallAgreements.Pages.Length];
            string[] linkWords = { "Read them", "Read it", "Read them" };
            for (int i = 0; i < agree.Length; i++)
            {
                string page = InstallAgreements.Pages[i];
                var row = new WrapPanel { Margin = new Thickness(0, 7, 0, 0) };
                agree[i] = Box(InstallAgreements.Words[i], new Thickness(0));
                agree[i].VerticalAlignment = VerticalAlignment.Center;
                agree[i].IsCheckedChanged += delegate { Gate(); };
                row.Children.Add(agree[i]);
                var link = new HyperlinkButton { Content = linkWords[i], Foreground = B("Accent"), FontSize = 12.5, Margin = new Thickness(10, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
                ToolTip.SetTip(link, "Opens thornswood.net/" + page + " in your browser");
                link.Click += delegate { OpenPage(InstallAgreements.Site + "/" + page); };
                row.Children.Add(link);
                boxes.Children.Add(row);
            }
            footGrid.Children.Add(boxes);
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom };
            btnClose = new Button { Content = "Not now", Background = B("Card"), BorderBrush = B("Line"), Foreground = B("Ink"), Margin = new Thickness(0, 0, 10, 0), Padding = new Thickness(26, 11), FontSize = 13 };
            btnClose.Click += delegate { Close(); };
            btnGo = new Button { Content = "Install", IsEnabled = false, Background = B("Accent"), BorderBrush = B("Accent"), Foreground = B("AccentInk"), FontWeight = FontWeight.SemiBold, Padding = new Thickness(26, 11), FontSize = 13 };
            btnGo.Click += delegate { Start(); };
            buttons.Children.Add(btnClose);
            buttons.Children.Add(btnGo);
            Grid.SetColumn(buttons, 1);
            footGrid.Children.Add(buttons);
            foot.Child = footGrid;
            Grid.SetRow(foot, 2);
            outer.Children.Add(foot);

            return new Border { BorderBrush = B("Line"), BorderThickness = new Thickness(1), Child = outer };
        }

        TextBlock Caption(string text)
        {
            return new TextBlock { Text = text, Foreground = B("Faint"), FontSize = 12, FontFamily = new FontFamily("Constantia, Georgia"), Margin = new Thickness(0, 0, 0, 6) };
        }

        TextBlock Small(Thickness margin)
        {
            return new TextBlock { Foreground = B("Faint"), FontSize = 11.5, TextWrapping = TextWrapping.Wrap, Margin = margin };
        }

        Border Card(Control child, Thickness margin)
        {
            return new Border { Margin = margin, Padding = new Thickness(17, 14), CornerRadius = new CornerRadius(2), Background = B("Card"), BorderBrush = B("Line"), BorderThickness = new Thickness(1), Child = child };
        }

        Button SmallButton(string text)
        {
            return new Button { Content = text, Padding = new Thickness(16, 7), FontSize = 12, Background = B("Deep"), BorderBrush = B("Line"), Foreground = B("Ink") };
        }

        CheckBox Box(string words, Thickness margin)
        {
            return new CheckBox
            {
                Margin = margin, Foreground = B("Ink"), IsChecked = false,
                Content = new TextBlock { Text = words, Foreground = B("Ink"), FontSize = 12.5, LineHeight = 18, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(4, 0, 0, 0) },
            };
        }

        /// <summary>The emblem, compiled into the launcher as a resource.</summary>
        static Bitmap Emblem()
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("logo.png"))
                return s == null ? null : new Bitmap(s);
        }

        /// <summary>
        /// No bigger than the screen's working area at any display scale,
        /// minimum included, so Install is never below its edge (#463).
        /// </summary>
        void KeepOnScreen()
        {
            Avalonia.Platform.Screen screen = Screens.ScreenFromWindow(this) ?? Screens.Primary;
            if (screen == null) return;
            double w = screen.WorkingArea.Width / screen.Scaling, h = screen.WorkingArea.Height / screen.Scaling;
            if (MinWidth > w) MinWidth = w;
            if (MinHeight > h) MinHeight = h;
            if (Width > w) Width = w;
            if (Height > h) Height = h;
        }

        // ---------------------------------------------------------------- the drive

        void BuildDrives()
        {
            driveRow.Children.Clear();
            driveButtons.Clear();
            foreach (DriveInfo d in DriveInfo.GetDrives())
            {
                long free;
                if (d.DriveType != DriveType.Fixed || !d.IsReady) continue;
                try { free = d.AvailableFreeSpace; }
                catch (IOException) { continue; }

                var sp = new StackPanel();
                sp.Children.Add(new TextBlock { Text = d.Name.TrimEnd('\\'), FontFamily = new FontFamily("Cascadia Mono, Consolas"), FontSize = 14, Foreground = B("Ink") });
                sp.Children.Add(new TextBlock { Text = InstallPlace.Gb(free) + " free", FontSize = 11, Foreground = B("Muted"), Margin = new Thickness(0, 3, 0, 0) });
                // The one drive this install can work on gets said so on the
                // button itself, not only in the line underneath, because the
                // buttons are what a person reads before pressing one.
                if (InstallPlace.SameDrive(d.Name, skyrimDrive))
                    sp.Children.Add(new TextBlock { Text = "Skyrim is here", FontSize = 11, Foreground = B("Accent"), Margin = new Thickness(0, 2, 0, 0) });

                string name = d.Name;
                var b = new Button
                {
                    Content = sp, Padding = new Thickness(15, 9), Margin = new Thickness(0, 0, 8, 8), MinWidth = 104,
                    HorizontalContentAlignment = HorizontalAlignment.Left, Tag = name,
                    BorderBrush = B("Line"), Background = B("Deep"), Foreground = B("Ink"),
                };
                b.Click += delegate { SetRoot(Path.Combine(name, "Thornswood")); };
                driveRow.Children.Add(b);
                driveButtons.Add(b);
            }
        }

        void SetRoot(string path)
        {
            if (string.IsNullOrEmpty(path)) return;
            installRoot = path.TrimEnd('\\');
            txtRoot.Text = installRoot;
            string root = InstallPlace.DriveOf(installRoot);
            foreach (Button b in driveButtons)
            {
                bool on = string.Equals((string)b.Tag, root, StringComparison.OrdinalIgnoreCase);
                b.Background = B(on ? "CardHover" : "Deep");
                b.BorderBrush = B(on ? "Accent" : "Line");
            }

            string colour;
            txtSkyrim.Text = InstallPlace.SaySkyrim(skyrimDrive, root, out colour);
            txtSkyrim.Foreground = B(colour);
            txtRoom.Text = InstallPlace.SayRoom(FreeOn(root), out colour);
            txtRoom.Foreground = B(colour);
            SayOwnGame();
        }

        static long FreeOn(string driveRoot)
        {
            if (string.IsNullOrEmpty(driveRoot)) return -1;
            try { return new DriveInfo(driveRoot).AvailableFreeSpace; }
            catch (Exception e) when (e is IOException || e is ArgumentException || e is UnauthorizedAccessException) { return -1; }
        }

        async Task PickFolder()
        {
            IReadOnlyList<IStorageFolder> got = await StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions
            {
                Title = "Where should Thornswood go? A folder called Thornswood is made inside whatever you pick.",
                AllowMultiple = false,
            });
            if (got.Count == 0) return;
            string chosen = got[0].TryGetLocalPath();
            if (string.IsNullOrEmpty(chosen)) return;
            SetRoot(InstallPlace.RootFromPick(chosen));
        }

        // --------------------------------------- Thornswood's own Skyrim folder
        //
        // Issue #906, Patrick on 28 September: "let's offer the own folder
        // during install as well". The launcher offers it in a box the first
        // time it opens and in Settings, Maintenance; this card asks the same
        // question with the same words before the launcher's own window opens.
        //
        // The folder is Root\Game, made by the launcher (OwnGame.Make) from
        // what Vortex has deployed, and nothing is deployed yet: the
        // collection is the step after this. So a tick is the launcher's own
        // question answered in advance, written into config.json as
        // MakeOwnGame, and the launcher then makes the folder without asking
        // once Vortex has deployed (ShellOwnGame.AskOwnGame). No tick is what
        // every install did before: the launcher asks. Thornswood will not
        // start out of a shared Skyrim either way (OwnGameRequired), which is
        // why the off line says Play asks for it too.
        //
        // The tick also decides where Thornswood's own files go (#1226,
        // Patrick, 29 Sep): ticked, Profile\Payload, and nothing is written
        // into the Steam copy; not ticked, the Steam copy, and the launcher
        // takes them back out once the folder is made (OwnGame.CleanSteamCopy).
        //
        // Choose Vortex's folder is the Settings button of the same name,
        // taken early: the same check as OwnGame.PointAt, saved into
        // config.json as the same VortexGame field.

        void SayOwnGame()
        {
            if (txtOwn == null) return;
            bool apart;
            txtOwn.Text = InstallPlace.SayOwnGame(chkOwn.IsChecked == true, installRoot, skyrimDrive, vortexGame, out apart);
            txtOwn.Foreground = B(apart ? "Bad" : "Faint");
            btnVortexForget.IsVisible = vortexGame.Length > 0;
        }

        async Task PickVortexFolder()
        {
            string start = vortexGame.Length > 0 ? vortexGame : skyrimPath;
            IStorageFolder from = start.Length > 0 && Directory.Exists(start) ? await StorageProvider.TryGetFolderFromPathAsync(start) : null;
            IReadOnlyList<IStorageFolder> got = await StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions
            {
                Title = "Choose the Skyrim folder Vortex deploys into. In Vortex, Mods, Open, Open Game Folder opens it.",
                AllowMultiple = false,
                SuggestedStartLocation = from,
            });
            if (got.Count == 0) return;
            string chosen = got[0].TryGetLocalPath() ?? "";
            string full;
            string why = InstallPlace.VortexFolderProblem(chosen, out full);
            if (why != null)
            {
                Ask.Tell(why, Title_, Ask.Icon.Info);
                return;
            }
            vortexGame = full;
            SayOwnGame();
        }

        // ---------------------------------------------------------------- the four boxes

        /// <summary>Install is on only while every box is ticked, looked at again on each tick and untick.</summary>
        void Gate()
        {
            if (btnGo == null || installing || finished) return;
            var all = new bool?[agree.Length + 1];
            all[0] = chkAge.IsChecked;
            for (int i = 0; i < agree.Length; i++) all[i + 1] = agree[i].IsChecked;
            btnGo.IsEnabled = InstallAgreements.AllTicked(all);
        }

        /// <summary>The browser, on one of the site's own pages and nothing else.</summary>
        static void OpenPage(string url)
        {
            if (!InstallAgreements.IsSitePage(url)) return;
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true })?.Dispose(); }
            catch (System.ComponentModel.Win32Exception)
            {
                Ask.Tell("Windows would not open your browser. The page is at " + url + ".", Title_, Ask.Icon.Info);
            }
        }

        // ---------------------------------------------------------------- closing

        void OnClosing(object sender, WindowClosingEventArgs e)
        {
            if (!installing) return;
            Ask.Tell("Thornswood is being installed and cannot be stopped part way, because that would leave it " +
                     "half moved. The launcher opens by itself when it is done.", Title_, Ask.Icon.Info);
            e.Cancel = true;
        }

        // ---------------------------------------------------------------- Install

        void Start()
        {
            string root = InstallPlace.DriveOf(installRoot);
            if (skyrimDrive.Length > 0 && !InstallPlace.SameDrive(skyrimDrive, root))
            {
                if (!Ask.YesNo(InstallPlace.OtherDriveQuestion(skyrimDrive, root), Title_, Ask.Icon.Warning)) return;
            }
            long free = FreeOn(root);
            if (free >= 0 && free < InstallPlace.Needed)
            {
                Ask.Tell("There is only " + InstallPlace.Gb(free) + " free on " + root + " and this needs about " +
                         InstallPlace.Gb(InstallPlace.Needed) + ".\n\nPick another drive.", Title_, Ask.Icon.Warning);
                return;
            }

            // What the window says now, read here on its own thread, for the
            // steps on theirs.
            var choice = new InstallChoice
            {
                Root = installRoot,
                MakeOwnGame = chkOwn.IsChecked == true,
                VortexGame = vortexGame,
                SteamRoot = steamRoot,
                SteamGame = skyrimPath,
                Package = AppContext.BaseDirectory.TrimEnd('\\', '/'),
            };
            // When the boxes were ticked and Install pressed, for the record
            // (issue #1009).
            DateTime acceptedAt = DateTime.UtcNow;

            installing = true;
            btnGo.IsEnabled = false;
            btnClose.IsEnabled = false;
            btnPick.IsEnabled = false;
            chkAge.IsEnabled = false;
            foreach (CheckBox c in agree) c.IsEnabled = false;
            chkOwn.IsEnabled = false;
            btnVortexPick.IsEnabled = false;
            btnVortexForget.IsEnabled = false;
            foreach (Button b in driveButtons) b.IsEnabled = false;
            rootBox.IsVisible = false;
            ownBox.IsVisible = false;
            txtLog.IsVisible = true;
            bar.IsVisible = true;
            bar.IsIndeterminate = true;
            txtBody.Text = "Installing. What it is doing shows below, and Thornswood opens by itself when it is done.";

            var t = new Thread(() => Work(choice, acceptedAt)) { IsBackground = true, Name = "Install" };
            t.Start();
        }

        void Work(InstallChoice choice, DateTime acceptedAt)
        {
            string profile = Path.Combine(choice.Root, "Profile");
            string log = Path.Combine(profile, "setup-log.txt");
            string why = null;
            try
            {
                Directory.CreateDirectory(profile);
                lock (logLock) logFile = new StreamWriter(log, false, new UTF8Encoding(false)) { AutoFlush = true };
                Log("Thornswood Setup, " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture));
                Log("Install to " + choice.Root + (choice.MakeOwnGame ? ", Thornswood's own Skyrim folder on" : "") +
                    (choice.VortexGame.Length > 0 ? ", Vortex's folder " + choice.VortexGame : "") + ", from " + choice.Package);

                int stopped = InstallSkyrim.Stop(q => Dispatcher.UIThread.Invoke(() => Ask.YesNo(q, Title_, Ask.Icon.Warning)));
                if (stopped > 0) Line("Closed " + stopped + " Skyrim process" + (stopped == 1 ? "" : "es") + " that was still open");

                // What was accepted, and when, before anything is installed.
                Line("Noting what you accepted");
                InstallAgreements.Record(profile, acceptedAt, Line);

                var steps = new InstallSteps(choice, Line, Progress);
                steps.Run();
                if (steps.Bad > 0)
                    why = steps.Bad + " check" + (steps.Bad == 1 ? "" : "s") + " failed. Send staff a screenshot of this window in the Discord.";
                else
                    InstallPlace.Record(choice.Root);
            }
            catch (InstallStop stop)
            {
                Line("");
                Line("STOP. " + stop.Message);
                why = stop.Message;
            }
            catch (Exception e)
            {
                // Anything else that went wrong is the end of this thread, and
                // an exception left to escape it ends the launcher with no
                // word. So it is said like a stop, in full in the log.
                Line("");
                Line("STOP. " + e.Message);
                Log(e.ToString());
                why = e.Message;
            }
            finally
            {
                installing = false;
                lock (logLock)
                {
                    logFile?.Dispose();
                    logFile = null;
                }
            }

            if (why == null)
            {
                Dispatcher.UIThread.Post(() =>
                {
                    finished = true;
                    bar.IsIndeterminate = false;
                    bar.Value = 1000;
                    done.TrySetResult(choice.Root);
                });
                return;
            }
            Dispatcher.UIThread.Post(() =>
            {
                finished = true;
                bar.IsVisible = false;
                txtBody.Text = why + "\n\nEverything it said is below, and saved in " + log +
                               ". Send staff a screenshot of this window, or that file, in the Discord.";
                txtStat.Text = "";
                btnClose.IsEnabled = true;
                btnClose.Content = "Close";
            });
        }

        void Log(string s)
        {
            lock (logLock)
            {
                if (logFile != null) logFile.WriteLine(s);
            }
        }

        /// <summary>One line from the install: to the log file and to the window.</summary>
        void Line(string s)
        {
            Log(s);
            string t = s.Trim();
            Dispatcher.UIThread.Post(() =>
            {
                txtLog.Text = (txtLog.Text ?? "") + s + "\n";
                txtLog.CaretIndex = txtLog.Text.Length;
                if (t.Trim('-').Length > 0) txtStat.Text = t;
            });
        }

        void Progress(double frac)
        {
            Dispatcher.UIThread.Post(() =>
            {
                if (frac < 0) { bar.IsIndeterminate = true; return; }
                bar.IsIndeterminate = false;
                bar.Value = frac * 1000;
            });
        }
    }
}
