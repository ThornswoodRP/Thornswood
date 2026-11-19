using System;
using System.Collections.Generic;
using Avalonia.Controls;

namespace Thornswood
{
    // Selection edits a preference only. The existing audio worker opens it
    // at launcher start; this control never replaces a running audio stream.
    sealed class MicrophonePicker
    {
        internal sealed class Choice
        {
            public string Value { get; }
            readonly string label;
            public Choice(string value, bool available = true)
            {
                Value = value;
                label = value.Length == 0 ? "Windows default" : value + (available ? "" : " (not available)");
            }
            public override string ToString() { return label; }
        }

        readonly ComboBox box;
        readonly Func<List<string>> devices;
        readonly Func<string> saved;
        readonly Action<string> select;
        bool refreshing;

        public MicrophonePicker(ComboBox box, Button refresh, Func<List<string>> devices, Func<string> saved, Action<string> select)
        {
            this.box = box;
            this.devices = devices;
            this.saved = saved;
            this.select = select;
            refresh.Click += delegate { Refresh(); };
            box.SelectionChanged += delegate
            {
                if (refreshing || box.SelectedItem is not Choice chosen) return;
                if (!string.Equals((saved() ?? "").Trim(), chosen.Value, StringComparison.OrdinalIgnoreCase)) select(chosen.Value);
            };
        }

        public bool Uses(ComboBox control) { return ReferenceEquals(box, control); }

        public void Refresh()
        {
            string current = (saved() ?? "").Trim();
            var choices = new List<Choice> { new Choice("") };
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string name in devices() ?? new List<string>())
                if (!string.IsNullOrWhiteSpace(name) && names.Add(name)) choices.Add(new Choice(name));
            if (current.Length > 0 && !names.Contains(current)) choices.Add(new Choice(current, false));
            refreshing = true;
            try
            {
                box.ItemsSource = choices;
                box.SelectedItem = choices.Find(c => string.Equals(c.Value, current, StringComparison.OrdinalIgnoreCase));
            }
            finally { refreshing = false; }
        }
    }
}
