using System;
using System.Collections.Generic;
using System.Linq;

namespace Thornswood
{
    static partial class Shell
    {
        static AudioDevicePicker microphonePicker;
        static AudioDevicePicker outputPicker;

        static void BuildMicrophoneSettings(Func<List<string>> enumerate = null)
        {
            if (microphonePicker == null || !microphonePicker.Uses(win.BoxMicrophone))
            {
                microphonePicker = new AudioDevicePicker(win.BoxMicrophone, win.BtnRefreshMicrophones,
                    () => (enumerate ?? Mics.All)().Select(name => new AudioDevicePicker.Choice(name, name)),
                    () => cfg.MicrophoneName, () => cfg.MicrophoneName,
                    value =>
                    {
                        cfg.MicrophoneName = value.Value;
                        cfg.Save(Paths.CfgFile);
                    });
            }
            microphonePicker.Refresh();
        }

        static void BuildOutputSettings()
        {
            if (outputPicker == null || !outputPicker.Uses(win.BoxAudioOutput))
            {
                outputPicker = new AudioDevicePicker(win.BoxAudioOutput, win.BtnRefreshMicrophones,
                    () => AudioOutput.All().Select(device => new AudioDevicePicker.Choice(device.Id, device.Name)),
                    () => cfg.AudioOutputId, () => cfg.AudioOutputName,
                    choice =>
                    {
                        cfg.AudioOutputId = choice.Value;
                        cfg.AudioOutputName = choice.Value.Length == 0 ? "" : choice.Label;
                        cfg.AudioOutputConfigured = true;
                        cfg.Save(Paths.CfgFile);
                    });
            }
            outputPicker.Refresh();
        }
    }
}
