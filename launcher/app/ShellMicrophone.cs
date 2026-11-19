using System;
using System.Collections.Generic;

namespace Thornswood
{
    static partial class Shell
    {
        static MicrophonePicker microphonePicker;

        static void BuildMicrophoneSettings(Func<List<string>> enumerate = null)
        {
            if (microphonePicker == null || !microphonePicker.Uses(win.BoxMicrophone))
            {
                microphonePicker = new MicrophonePicker(win.BoxMicrophone, win.BtnRefreshMicrophones,
                    enumerate ?? new Func<List<string>>(Mics.All), () => cfg.MicrophoneName,
                    value =>
                    {
                        cfg.MicrophoneName = value;
                        cfg.Save(Paths.CfgFile);
                    });
            }
            microphonePicker.Refresh();
        }
    }
}
