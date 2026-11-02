using System;
using Avalonia;
using Avalonia.Controls;

namespace Thornswood
{
    /// <summary>
    /// The launcher's window, compiled from MainWindow.axaml (#4823). Its named
    /// controls are generated fields (win.BtnPlay and the rest), so a control
    /// renamed in the markup and not in the code is a build error.
    ///
    /// Shell drives it: there is no logic here beyond the two moments Shell
    /// and its other files wait for, which Avalonia's Window does not name the
    /// way WPF's did.
    /// </summary>
    public partial class MainWindow : Window
    {
        public MainWindow()
        {
            InitializeComponent();
            Opened += delegate
            {
                // The window has been shown; the next frame is the first one
                // drawn with everything on it, which is the moment WPF called
                // ContentRendered.
                RequestAnimationFrame(delegate
                {
                    EventHandler drawn = ContentRendered;
                    ContentRendered = null;
                    if (drawn != null) drawn(this, EventArgs.Empty);
                });
            };
        }

        /// <summary>
        /// Once, when the window has first drawn its content: the start line in
        /// the log, the self update's way back, and the work that waits until
        /// the launcher is on screen hang off this (launcher\app\ARCHITECTURE.md
        /// section 1). Subscribing after it has fired does nothing, as in WPF.
        /// </summary>
        public event EventHandler ContentRendered;

        /// <summary>
        /// Minimised, maximised or back to normal. The title video, the music
        /// and the Play spotlight stop while nobody can see them and start again
        /// when somebody can.
        /// </summary>
        public event EventHandler StateChanged;

        protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
        {
            base.OnPropertyChanged(change);
            if (change.Property == WindowStateProperty)
            {
                EventHandler changed = StateChanged;
                if (changed != null) changed(this, EventArgs.Empty);
            }
        }
    }
}
