using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;

namespace Thornswood.Tests {
static class MicrophoneChecks {
    const BindingFlags Any = BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public;
    static string Value(object choice) => (string)choice.GetType().GetProperty("Value").GetValue(choice);
    static object Choice(ComboBox box, string value) => box.ItemsSource.Cast<object>().Single(c => Value(c) == value);
    static void Require(bool ok, string why) { if (!ok) throw new InvalidOperationException(why); }
    static void Drain() { Dispatcher.UIThread.RunJobs(); }
    public static void Run(Action<string, Action> check) {
        MainWindow win = null;
        ComboBox box = null;
        Button refresh = null;
        check("Settings has a labelled microphone picker and refresh button", () => {
            win = new MainWindow();
            box = win.FindControl<ComboBox>("BoxMicrophone") ?? throw new InvalidOperationException("Settings has no microphone picker");
            refresh = win.FindControl<Button>("BtnRefreshMicrophones") ?? throw new InvalidOperationException("Settings has no microphone refresh");
            Require(AutomationProperties.GetName(box) == "Voice microphone", "The picker has no accessible label");
        });
        if (box == null || refresh == null) { win?.Close(); return; }
        var asm = typeof(App).Assembly;
        var shell = asm.GetType("Thornswood.Shell", true);
        var config = asm.GetType("Thornswood.Config", true);
        var paths = asm.GetType("Thornswood.Paths", true);
        var mic = config.GetField("MicrophoneName");
        var savedHook = config.GetField("Saved");
        var oldHook = savedHook.GetValue(null);
        var oldWin = shell.GetField("win", Any).GetValue(null);
        var oldConfig = shell.GetField("cfg", Any).GetValue(null);
        var oldPath = paths.GetField("CfgFile").GetValue(null);
        var folder = Path.Combine(Path.GetTempPath(), "thornswood-microphone-picker-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var file = Path.Combine(folder, "config.json");
        object cfg = Activator.CreateInstance(config, true);
        var inventory = new List<string> { "Input A", "Input B", "input a" };
        try {
            savedHook.SetValue(null, null);
            mic.SetValue(cfg, "Missing input");
            config.GetMethod("Save").Invoke(cfg, new object[] { file });
            shell.GetField("win", Any).SetValue(null, win);
            shell.GetField("cfg", Any).SetValue(null, cfg);
            paths.GetField("CfgFile").SetValue(null, file);
            byte[] before = File.ReadAllBytes(file);
            check("opening Settings preserves a saved unavailable microphone", () => {
                shell.GetMethod("BuildMicrophoneSettings", Any).Invoke(null, new object[] { new Func<List<string>>(() => inventory) });
                Drain();
                Require(Value(box.SelectedItem) == "Missing input" && box.SelectedItem.ToString().Contains("not available"), "The unavailable saved input was replaced or hidden");
                Require(before.SequenceEqual(File.ReadAllBytes(file)), "Opening Settings rewrote the saved configuration");
                Require(box.ItemsSource.Cast<object>().Count() == 4, "Device names were not deduplicated");
            });
            check("refreshing microphone inventory never saves a replacement", () => {
                inventory = new List<string> { "Input B", "Input C" };
                refresh.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); Drain();
                Require(Value(box.SelectedItem) == "Missing input" && before.SequenceEqual(File.ReadAllBytes(file)), "Refresh changed the saved choice");
            });
            check("choosing an active microphone persists its actual device name", () => {
                box.SelectedItem = Choice(box, "Input B"); Drain();
                object loaded = config.GetMethod("Load").Invoke(null, new object[] { file });
                Require((string)mic.GetValue(loaded) == "Input B", "The chosen input did not persist");
            });
            check("a disconnected saved input remains selected without rewriting settings", () => {
                before = File.ReadAllBytes(file); inventory = new List<string> { "Input C" };
                refresh.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); Drain();
                Require(Value(box.SelectedItem) == "Input B" && box.SelectedItem.ToString().Contains("not available") && before.SequenceEqual(File.ReadAllBytes(file)), "Disconnect silently changed the choice");
            });
            check("a returning input restores its available label without saving", () => {
                inventory = new List<string> { "Input A", "Input B" };
                refresh.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); Drain();
                Require(Value(box.SelectedItem) == "Input B" && !box.SelectedItem.ToString().Contains("not available") && before.SequenceEqual(File.ReadAllBytes(file)), "Reconnect changed the value or kept a stale label");
            });
            check("Windows default clears the explicit microphone override", () => {
                box.SelectedItem = Choice(box, ""); Drain();
                object loaded = config.GetMethod("Load").Invoke(null, new object[] { file });
                Require((string)mic.GetValue(loaded) == "", "Windows default did not clear the override");
            });
            check("the microphone picker works from the keyboard and explains restart", () => {
                win.FindControl<Control>("PageSettings").IsVisible = true; win.Show(); Drain(); win.UpdateLayout();
                Require(box.Focus(NavigationMethod.Tab), "The picker did not take keyboard focus");
                void Press(PhysicalKey key, RawInputModifiers modifiers = RawInputModifiers.None) { win.KeyPressQwerty(key, modifiers); win.KeyReleaseQwerty(key, modifiers); Drain(); }
                Press(PhysicalKey.ArrowDown, RawInputModifiers.Alt); Press(PhysicalKey.Home); Press(PhysicalKey.ArrowDown); Press(PhysicalKey.Enter);
                Require((string)mic.GetValue(cfg) == "Input A", "Keyboard selection did not save the input");
                Require(AutomationProperties.GetHelpText(box).Contains("restart", StringComparison.OrdinalIgnoreCase), "Restart behavior is not explained to assistive technology");
                Require(win.FindControl<TextBlock>("TxtMicrophoneNote").Text.Contains("restart", StringComparison.OrdinalIgnoreCase), "Restart behavior is not visible");
            });
        } finally {
            win?.Close();
            shell.GetField("win", Any).SetValue(null, oldWin); shell.GetField("cfg", Any).SetValue(null, oldConfig);
            paths.GetField("CfgFile").SetValue(null, oldPath); savedHook.SetValue(null, oldHook);
            Directory.Delete(folder, true);
        }
    }
}
}
