using Avalonia;
using Avalonia.Markup.Xaml;

namespace Thornswood
{
    /// <summary>
    /// The Avalonia application. Shell.Run makes the window and owns the
    /// startup order (launcher\app\ARCHITECTURE.md); this only loads the
    /// compiled App.axaml.
    /// </summary>
    public partial class App : Application
    {
        public override void Initialize() { AvaloniaXamlLoader.Load(this); }
    }
}
