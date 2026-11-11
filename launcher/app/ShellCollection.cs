using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;

namespace Thornswood
{
    // The collection card that names where the mods come from, drawn on
    // Diagnostics (#1170). It lives apart from Shell.cs because it is one
    // self-contained page slice, and Shell.cs was long enough (#500). The
    // optional add-on packs that shared this file were read from the old
    // update feed and went with it (#5608).
    static partial class Shell
    {
        /// <summary>
        /// The collection card for the Diagnostics page (Djinn, 2 Oct): where
        /// the mods come from, a way to get there, and what the launcher found.
        /// Since #599 took the Mods page off the rail, the Mods page's card was
        /// the only way to the collection and nobody could reach it.
        ///
        /// Built here rather than in the window's XAML, from when the window
        /// was read at run time: a named control the C# looked up and the
        /// xaml did not have came back null and took the whole page with it,
        /// and this is the one row that must not be the thing that breaks.
        /// MainWindow.axaml is compiled now, so a missing name is a build
        /// error instead, and the card stays here because nothing needs it
        /// moved.
        /// </summary>
        static Control CollectionStatusCard()
        {
            int have = 0;
            try { have = Checks.CollectionRevision(cfg); }
            catch (Exception ex) { Swallow.Note("Shell.CollectionStatusCard", ex); }
            int wants = Updater.ServerCollectionRevision;
            if (have <= 0)
                return CollectionCard("Your mods: not confirmed",
                    "The launcher could not read which revision of the Thornswood collection " +
                    "Vortex has installed, so it cannot confirm your mods. If you have not " +
                    "installed the collection, or are not sure, open it and let Vortex install " +
                    "or update it.");
            if (wants > 0 && have < wants)
                return CollectionCard("Your mods need updating",
                    "Vortex has collection revision " + have + " and the server was built against " +
                    "revision " + wants + ". In Vortex, press Update on the Thornswood collection, which puts revision " +
                    wants + " in its place. Installing revision " + wants + " from Nexus instead adds a second copy beside it.");
            // No button for ahead (#4115): nothing needs installing, and the
            // collection's pages lead to the same revision or a newer one.
            if (wants > 0 && have > wants)
                return CollectionCard("Your mods are ahead of the server",
                    "Vortex has collection revision " + have + " and the server was built against " +
                    "revision " + wants + ". Nothing is wrong with your install and nothing needs " +
                    "installing; Play opens once the server is rebuilt on your revision.", false);
            return CollectionCard("Your mods: collection revision " + have,
                "Vortex has the Thornswood collection installed" +
                (wants > 0 ? ", the same revision the server was built against."
                           : ". The server's revision was not known just now, so it was not compared."));
        }

        static Control CollectionCard(string title, string body, bool button = true)
        {
            var g = new Grid();
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var left = new StackPanel();
            Grid.SetColumn(left, 0); g.Children.Add(left);

            var name = new TextBlock();
            name.Text = title;
            name.FontSize = 13.5;
            name.Foreground = Res("Ink");
            left.Children.Add(name);

            var note = new TextBlock();
            note.Text = body;
            note.FontSize = 11.5;
            note.Foreground = Res("Faint");
            note.TextWrapping = TextWrapping.Wrap;
            note.Margin = new Thickness(0, 3, 12, 0);
            left.Children.Add(note);

            if (button)
            {
                var b = new Button();
                // The revision the server was built against, not the
                // collection's front page, which is always its newest (#4115).
                b.Content = CollectionButtonText();
                b.Theme = Look("Solid");
                b.VerticalAlignment = VerticalAlignment.Center;
                b.MinWidth = 96;
                Grid.SetColumn(b, 1); g.Children.Add(b);

                b.Click += delegate { OpenCollection(); };
            }

            // Open to everybody (#428): anyone can download in the alpha, and
            // the same link is on the public Downloads page. It used to say
            // "Apply first" until Discord was linked, which kept nothing from
            // anybody. The application in the Discord unlocks Play, not this.

            var card = new Border();
            card.Padding = new Thickness(14, 12, 14, 12);
            card.Background = Res("Panel");
            card.Margin = new Thickness(0, 0, 8, 10);
            card.Child = g;
            return card;
        }
    }
}
