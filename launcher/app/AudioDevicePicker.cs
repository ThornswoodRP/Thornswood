using System;
using System.Collections.Generic;
using Avalonia.Controls;

namespace Thornswood
{
    // Selection edits a preference only. The audio workers open the chosen
    // devices at startup.
    sealed class AudioDevicePicker
    {
        internal sealed class Choice
        {
            public string Value { get; }
            public string Label { get; }
            public Choice(string value, string label)
            {
                Value = value;
                Label = label;
            }
            public override string ToString() { return Label; }
        }

        readonly ComboBox box;
        readonly Func<IEnumerable<Choice>> devices;
        readonly Func<string> saved;
        readonly Func<string> unavailableLabel;
        bool refreshing;

        public AudioDevicePicker(ComboBox box, Button refresh, Func<IEnumerable<Choice>> devices,
            Func<string> saved, Func<string> unavailableLabel, Action<Choice> select)
        {
            this.box = box;
            this.devices = devices;
            this.saved = saved;
            this.unavailableLabel = unavailableLabel;
            refresh.Click += delegate { Refresh(); };
            box.SelectionChanged += delegate
            {
                if (refreshing || box.SelectedItem is not Choice chosen) return;
                if (!string.Equals((saved() ?? "").Trim(), chosen.Value, StringComparison.OrdinalIgnoreCase)) select(chosen);
            };
        }

        public bool Uses(ComboBox control) { return ReferenceEquals(box, control); }

        public void Refresh()
        {
            string current = (saved() ?? "").Trim();
            var choices = new List<Choice> { new Choice("", "Windows default") };
            var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var device in devices())
                if (!string.IsNullOrWhiteSpace(device.Value) && ids.Add(device.Value)) choices.Add(device);
            if (current.Length > 0 && !ids.Contains(current))
            {
                string label = unavailableLabel();
                choices.Add(new Choice(current, (string.IsNullOrEmpty(label) ? current : label) + " (not available)"));
            }
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
