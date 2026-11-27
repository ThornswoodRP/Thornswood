using System;
using System.Diagnostics;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Threading;

namespace Thornswood
{
    // The mods installed by the launcher itself into its own Mod Organizer 2
    // (#6244): the card on Diagnostics that starts the install, shows how it
    // goes and stops it, and the Nexus sign in beside it. The install is
    // ModlistSetup.FromRelease, the modlist of the Release this channel is on;
    // the game folder takes its mods from there once it starts (OwnGame.FromMods),
    // and the collection bar's button runs it from then on (OpenCollection).
    // Vortex's own path stays as it was until a fresh machine has installed,
    // played and updated this way (Ops issues/6244.md, step 6).
    static partial class Shell
    {
        static bool modlistRunning;
        static volatile bool modlistStop;
        static string modlistLine = "";

        /// <summary>The collection's cards on Diagnostics, drawn again as the install goes.</summary>
        static void DrawCollectionCards()
        {
            if (diagCollection == null) return;
            diagCollection.Children.Clear();
            diagCollection.Children.Add(CollectionStatusCard());
            if (!OwnGame.FromMods) diagCollection.Children.Add(ModlistOfferCard());
        }

        /// <summary>
        /// A collection card (CollectionCard) with what the launcher's own
        /// install adds: a button of its own in place of the collection
        /// button when <paramref name="label"/> is given, and the Nexus
        /// account it downloads with under the words.
        /// </summary>
        static Control ModlistCard(Control card, string label = null, Action click = null)
        {
            var grid = (Grid)((Border)card).Child;
            var left = (StackPanel)grid.Children[0];
            Control nexus = NexusRow();
            if (nexus != null) left.Children.Add(nexus);
            if (label != null)
            {
                var b = new Button { Content = label, Theme = Look("Solid"), VerticalAlignment = VerticalAlignment.Center, MinWidth = 96 };
                Grid.SetColumn(b, 1);
                grid.Children.Add(b);
                b.Click += delegate { click(); };
            }
            return card;
        }

        /// <summary>
        /// The card for mods that come from Mod Organizer 2: the revision its
        /// last whole install put in against the server's, and the one button
        /// that installs, updates, goes on with or stops the install.
        /// </summary>
        static Control ModlistStatusCard()
        {
            if (modlistRunning)
                return ModlistCard(CollectionCard("Installing the mods", (modlistLine.Length > 0 ? modlistLine + ". " : "") +
                    "Press Stop to stop after the file it is on; what it has is kept, and Install goes on from there."));
            int have = OwnGame.ModsRevision();
            // The modlist's own numbering, the records' (#7193).
            int wants = Updater.ServerRecordRevision > 0 ? Updater.ServerRecordRevision : Updater.ServerCollectionRevision;
            string where = "Mod Organizer 2 in " + OwnGame.ModsFolder;
            if (have <= 0)
                return ModlistCard(CollectionCard("Your mods: not all installed yet",
                    "The install into " + where + " has not finished. Press Install to go on from where it stopped; every file it has is kept."));
            if (wants > 0 && have < wants)
                return ModlistCard(CollectionCard("Your mods need updating",
                    where + " has collection revision " + have + " and the server was built against revision " + wants +
                    ". Update installs revision " + wants + " in its place and keeps each mod settings file you changed."));
            if (wants > 0 && have > wants)
                return ModlistCard(CollectionCard("Your mods are ahead of the server",
                    where + " has collection revision " + have + " and the server was built against revision " + wants +
                    ". Nothing is wrong with your install and nothing needs installing; Play opens once the server is rebuilt on your revision.", false));
            return ModlistCard(CollectionCard("Your mods: collection revision " + have,
                where + " has the Thornswood collection installed" +
                (wants > 0 ? ", the same revision the server was built against. Check the mods holds every file to the modlist again and puts back what is missing."
                           : ". The server's revision was not known just now, so it was not compared.")));
        }

        /// <summary>
        /// Beside Vortex's card while the mods still come from Vortex: the
        /// launcher's own install, which needs no Vortex. Starting it is what
        /// moves this install over.
        /// </summary>
        static Control ModlistOfferCard()
        {
            var card = ModlistCard(CollectionCard("Or install the mods without Vortex",
                "The launcher can install the collection's mods itself, into its own Mod Organizer 2 in " + OwnGame.ModsFolder +
                ", from Nexus. A Nexus Premium account downloads them by itself; any other account presses Manual Download once for each file " +
                "as the launcher opens its page, and a file already on this PC is not downloaded again. Once it starts, Thornswood takes its mods " +
                "from there and not from Vortex, and Vortex itself is left as it is.", false), "Install with Mod Organizer 2", InstallModlist);
            return card;
        }

        /// <summary>
        /// The collection button for mods that come from Mod Organizer 2, and
        /// the offer card's: starts the install, or stops the one running.
        /// The window stays usable while it goes; each step is said in the
        /// log and on the card.
        /// </summary>
        static async void InstallModlist()
        {
            if (modlistRunning)
            {
                modlistStop = true;
                Log("Stopping the install after the file it is on. What it has is kept.");
                return;
            }
            modlistRunning = true;
            modlistStop = false;
            modlistLine = "Starting";
            Log("Installing Thornswood's mods into Mod Organizer 2 in " + OwnGame.ModsFolder + ".");
            DrawCollectionCards();
            RefreshCollectionButton();

            var steps = new ModlistSetup.Steps();
            steps.Say = delegate (string line)
            {
                try { Dispatcher.UIThread.Post((Action)delegate { modlistLine = line; Log(line); DrawCollectionCards(); }); }
                catch (Exception ex) { Swallow.Note("Shell.InstallModlist, saying " + line, ex); }
            };
            steps.Open = delegate (string page)
            {
                try { Process.Start(new ProcessStartInfo(page) { UseShellExecute = true }); }
                catch (Exception ex) { throw new ModlistStop("Nexus's page could not be opened in your browser: " + Failure.Why("Shell.InstallModlist, opening " + page, ex) + "."); }
            };
            steps.Stop = () => modlistStop;

            string done;
            try
            {
                int written = 0;
                Velopack.SemanticVersion on = Updater.ChannelOn;
                await Task.Run(() => { written = ModlistSetup.FromRelease(on, steps); });
                done = "The mods are installed: collection revision " + OwnGame.ModsRevision() + " in Mod Organizer 2, " + written +
                       " file" + (written == 1 ? "" : "s") + " written. Thornswood's game folder takes them at the next Play.";
            }
            catch (ModlistStop stop) { done = Failure.Say("Shell.InstallModlist", stop); }
            catch (Exception ex) { done = "The mods could not be installed. " + Failure.Say("Shell.InstallModlist", ex); }
            modlistRunning = false;
            modlistLine = "";
            Log(done);
            DrawCollectionCards();
            DrawStatus();
            RefreshCollectionButton();
        }

        /// <summary>The collection bar's button, worded for the install as it is now.</summary>
        static void RefreshCollectionButton()
        {
            if (collectionBarUp && btnInstallNow != null) InstallLabel(CollectionButtonText());
        }

        /// <summary>
        /// The collection button's words while the mods come from Mod
        /// Organizer 2: Stop while the install runs, Update when the server is
        /// on a later revision, Install when no whole install is there yet.
        /// </summary>
        static string ModlistButtonText(int mine)
        {
            if (modlistRunning) return "Stop";
            int wants = Updater.ServerCollectionRevision;
            if (mine <= 0) return "Install";
            return wants > mine ? "Update" : "Check the mods";
        }

        /// <summary>
        /// The Nexus account the install downloads with, under the card, once
        /// this launcher is registered with Nexus (Nexus.ClientId). Until then
        /// there is nothing to sign in to, and every file is downloaded by hand.
        /// </summary>
        static Control NexusRow()
        {
            if (string.IsNullOrEmpty(Nexus.ClientId)) return null;
            Nexus.Account who = Nexus.Who;
            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0) };
            var said = new TextBlock
            {
                Text = who == null ? "Not signed in to Nexus: each file is downloaded by hand."
                     : "Signed in to Nexus as " + who.Name + (who.Premium ? ", Premium: the files download by themselves." : ": each file is downloaded by hand, as a free account's are."),
                FontSize = 11.5,
                Foreground = Res("Faint"),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 10, 0),
            };
            row.Children.Add(said);
            var b = new Button { Content = who == null ? "Sign in to Nexus" : "Sign out of Nexus", Theme = Look("Ghost") };
            b.Click += async delegate
            {
                if (Nexus.Who != null)
                {
                    try { Nexus.SignOut(); Log("Signed out of Nexus."); }
                    catch (ModlistStop stop) { Log(Failure.Say("Shell.NexusRow, signing out", stop)); }
                    DrawCollectionCards();
                    return;
                }
                Log("Signing in to Nexus in your browser.");
                string done;
                try
                {
                    Nexus.Account a = null;
                    await Task.Run(() => { a = Nexus.SignIn(delegate (string page) { Process.Start(new ProcessStartInfo(page) { UseShellExecute = true }); }, TimeSpan.FromMinutes(5)); });
                    done = "Signed in to Nexus as " + a.Name + (a.Premium ? ", a Premium account." : ".");
                }
                catch (ModlistStop stop) { done = Failure.Say("Shell.NexusRow, signing in", stop); }
                catch (Exception ex) { done = "The Nexus sign in did not finish. " + Failure.Say("Shell.NexusRow, signing in", ex); }
                Log(done);
                DrawCollectionCards();
            };
            row.Children.Add(b);
            return row;
        }
    }
}
