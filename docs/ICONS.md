# Icons

Three icon files. The launcher and the website tab show the same badge; the
Dev launcher has its own.

## Main launcher

`launcher/app.ico` is the Main launcher icon. Every frame is the round
Thornswood badge, and each size carries the lettering it can show:
128 and 256 have Thornswood written out, 32, 48 and 64 have TW, and 16
and 24 have no lettering. The T and the W are the badge's own letters.
Windows draws shortcuts and the taskbar from the small frames, where the
whole name is only a smudge.

`launcher/app/Thornswood.csproj` stamps it on the exe (`ApplicationIcon`)
and embeds it as the resource `app.ico` (an `EmbeddedResource` with that
`LogicalName`). `scripts/release/Build-Launcher.ps1` has no icon of its own:
it reads those entries off the project and copies each icon beside the exe
it built, for `Install-Launcher.ps1`, and stops if the project does not
embed it exactly once. `launcher/app/Icons.cs` (`IconFile`) writes that
same artwork out beside the installed exe as `icon-<hash>.ico`. The hash is
the first four bytes of the SHA-256 of the file. When `app.ico` changes,
the name changes, and Windows has no cached picture of the old one to show.
`Icons.Ensure` then points every shortcut at the new file.

## Dev launcher

`launcher/app-dev.ico` is the Dev launcher icon, the TF monogram.
`Thornswood.csproj` embeds it as the resource `app-dev.ico` next to the
Main icon, and `Build-Launcher.ps1` requires it and copies it beside the
exe with `app.ico`. `Icons.cs` (`IconBytes`) picks it when `Icons.Dev` is
set. It stays its own file.

## Website tab

`site/public/favicon.ico` is the website tab. Its 16, 32 and 48 frames
are the same frames as `launcher/app.ico`, so the tab and the launcher
show the same badge. `site/public/index.html` and `site/public/home.html`
point the tab at it, each with a `<link rel="icon">` in its head.
`site/public/icon-192.png` is the badge at 192 with Thornswood written
out; `index.html` also gives it as the touch icon.

## History

On 5 Oct, #1581 put a crest into the small frames of `launcher/app.ico`,
and Main looked like the website tab. Djinn put the badge back on 11 Oct
(#2122), and the favicon kept the crest. In #3319 Patrick asked for the
website tab to match the launcher. Djinn, 27 Oct 2026: the tab and the
launcher are the same badge, with TW at the small sizes or no lettering
where none can be read. The Dev icon stays the TF monogram.

`launcher/tests/test-launcher-icons.js` fails if a favicon frame is not app.ico's
frame of the same size, or if `app.ico` and `app-dev.ico` share a frame.

The Main icon reaches installed launchers only with a new launcher
release, which goes out through Velopack (`merge-release.yml` for dev,
`promote-main.yml` for main); Ship sends no launcher (#4825). Changing
the file here does not change what is already installed.
