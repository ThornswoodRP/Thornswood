Thornswood installer licence texts
==================================

These files go out with every install beside SOURCE CODE.txt. The launcher's
Velopack package carries them (scripts\release\Build-SetupFiles.ps1), the
install copies them into the install folder (InstallSteps.LicenceFiles in
launcher\app\InstallSteps.cs), and the uninstall removes them (Uninstall.cs).
Issues #421 and #4823. THIRD-PARTY.md says what each library is and where it
sits in the launcher.

  GPL-3.0.txt
    Byte for byte skyrim-platform/LICENSE at fork commit 1a2e5995, and at
    5c54e8b9 before it (the file did not change between them)
    (https://github.com/ThornswoodRP/skymp). Same text as skymp5-client/LICENSE
    at that commit. Covers the GPL client runtime files.

  AGPL-3.0.txt
    Byte for byte skymp5-server/LICENSE at the same commit. Covers
    MpClientPlugin.dll and the server engine.

  Concentus-LICENSE.txt
    Byte for byte LICENSE in the Concentus 2.2.2 package from nuget.org, the
    Opus BSD licence, quoted in THIRD-PARTY.md under "Concentus licence".
    Covers the Opus codec compiled into the launcher for voice (#4823).

  SharpSRTP-LICENSE.txt
    Byte for byte LICENSE in https://github.com/jimm98y/SharpSRTP at commit
    ede1d045, the commit SharpSRTP 0.5.8's nuspec names (MIT), quoted in
    THIRD-PARTY.md under "SharpSRTP licence". Covers the DTLS-SRTP code
    compiled into the launcher for voice (#4823).

  BouncyCastle-LICENSE.txt
    Byte for byte LICENSE.md in the BouncyCastle.Cryptography 2.7.0 package
    from nuget.org (MIT), quoted in THIRD-PARTY.md under "BouncyCastle
    licence". Covers the cryptography SharpSRTP is built on, compiled into
    the launcher (#4823).

  dotnet-LICENSE.txt
    Byte for byte LICENSE.TXT in the Microsoft.NETCore.App.Runtime.NativeAOT.win-x64
    10.0.14 package (MIT, the .NET Foundation). Covers the .NET runtime and
    libraries compiled into Thornswood.exe, and
    System.Security.Cryptography.ProtectedData 10.0.14, whose package carries
    the same text.

  dotnet-THIRD-PARTY-NOTICES.txt
    Byte for byte THIRD-PARTY-NOTICES.TXT in the same package: the code of
    others inside the .NET runtime and libraries.

  Avalonia-LICENSE.txt
    Byte for byte licence.md in https://github.com/AvaloniaUI/Avalonia at
    commit 2d79ba55, the commit the Avalonia 12.1.4 packages name (MIT).
    Covers Avalonia and the rest of its 12.1.4 packages the launcher restores
    (Desktop, Win32, Skia, HarfBuzz, the Fluent theme and the others),
    compiled into the launcher.

  MicroCom-LICENSE.txt
    Byte for byte LICENSE in https://github.com/kekekeks/MicroCom at commit
    76785efc, the commit MicroCom.Runtime 0.11.6's nuspec names (MIT).
    Avalonia's COM interop, compiled into the launcher.

  Tmds.DBus-LICENSE.txt
    Byte for byte COPYING in https://github.com/tmds/Tmds.DBus at commit
    b4a7fed0, the commit Tmds.DBus.Protocol 0.94.1's nuspec names (MIT).
    Avalonia's Linux support brings it in, and the win-x64 restore lists it.

  SkiaSharp-LICENSE.txt
    Byte for byte LICENSE.txt in the SkiaSharp 3.119.4 package (MIT). The
    HarfBuzzSharp 8.3.1.3 packages and SkiaSharp.NativeAssets.Win32 carry the
    same bytes. Covers SkiaSharp and HarfBuzzSharp, and libSkiaSharp.dll and
    libHarfBuzzSharp.dll beside the exe.

  SkiaSharp-THIRD-PARTY-NOTICES.txt
    Byte for byte THIRD-PARTY-NOTICES.txt in the
    SkiaSharp.NativeAssets.Win32 3.119.4 package; HarfBuzzSharp.NativeAssets.Win32
    8.3.1.3 carries the same bytes. Skia (BSD), HarfBuzz (Old MIT) and the
    libraries built into the two native files: libpng, libjpeg-turbo,
    libwebp, FreeType, expat, zlib and the rest.

  ANGLE-LICENSE.txt
    Byte for byte LICENSE in the Avalonia.Angle.Windows.Natives
    2.1.27548.20260419 package (BSD). Covers av_libglesv2.dll beside the exe.

  Velopack-LICENSE.txt
    Byte for byte LICENSE in https://github.com/velopack/velopack at commit
    92d6a1c9, the commit the Velopack 1.2.161 package names (MIT). Covers
    Velopack in the launcher and Update.exe, Setup.exe and the starter.

  Velopack-Rust-crates.txt
    The Rust crates inside Update.exe, Setup.exe and the starter, with their
    licence texts. Velopack's repository carries no notices file for them, so
    this was made on 1 November 2026 from its Cargo.lock at 92d6a1c9: cargo
    tree for velopack_bins with its windows feature, target
    x86_64-pc-windows-msvc, normal dependencies, and the licence files of
    each crate as crates.io serves it (from the crate's repository at the
    commit the crate names when the crate carries none). The file's own
    header says the same.

  NLayer-LICENSE.txt
    Byte for byte LICENSE in https://github.com/naudio/NLayer at commit
    046c7ce4, the commit NLayer 3.0.0's nuspec names (MIT), quoted in
    THIRD-PARTY.md under "NLayer licence". The MP3 decoder for the menu
    theme, compiled into the launcher.

  Chromium-HRTF-LICENSE.txt
    The launcher's HRTF panner (launcher\app\VoiceHrtf.cs) is a C# port of
    Chromium's Web Audio HRTF panning at Chromium commit dd2ed7a2 (in full,
    dd2ed7a22c23f9c9a85e9514c8c3308bf6ae4fbe). The file carries, word for
    word, the two BSD notices at the top of the Blink files it ports
    (hrtf_panner.cc and delay.cc; hrtf_elevation.cc, hrtf_kernel.cc,
    hrtf_database.cc, fft_frame.cc and fft_convolver.cc) and Chromium's own
    LICENSE at that commit (sinc_resampler.cc, rustfft_ffi.rs and
    panner_handler.cc's azimuth), with a list of which covers which (#963).

  IRCAM-Listen-HRTF.txt
    The impulse responses the panner filters with, launcher\hrtf-composite.wav:
    Chromium's resources/Composite.flac at the same commit, decoded to
    16-bit PCM unchanged. Chromium gives them no licence file of their own.
    The file quotes word for word what Firefox's copy says of them (derived
    by Chris Rogers from the IRCAM Listen HRTF Database and granted to the
    public domain) and IRCAM's terms for that database ("public and
    available for any use", with an acknowledgment asked for), as the
    Ambisonic Toolkit's licensing notes quote them, IRCAM's own page being
    unreachable on 1 November 2026 (#963).

When a library's version moves in launcher/app/Thornswood.csproj (or vpk's
VPK_VERSION in .github/workflows/merge-release.yml), refresh its text here
from the new package or commit in the same pull request.

When the recorded fork commit moves, refresh GPL-3.0.txt and AGPL-3.0.txt from
that commit's LICENSE files in the same pull request that moves
records/client-build.json and records/server-build.json.
