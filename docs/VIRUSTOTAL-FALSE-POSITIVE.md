# When a scanner calls the setup program malware

What to do when VirusTotal, Defender, SmartScreen or somebody's antivirus
flags `Thornswood-Setup.exe`, the setup program on the Downloads page.
Nothing here is a fix for a real detection: if a build is ever genuinely
dirty, it comes off the site first and is worked out afterwards. This page
is for the ones that are wrong, which is all of them so far.

Since #4824 that file is Velopack's setup program. `merge-release.yml` makes
it with the launcher's Velopack package inside it, signs it, and puts it on a
GitHub Release: main's as `Thornswood-Setup.exe` on a Release `main-<tag>`
once Patrick approves that build (#5181), dev's as `Thornswood-Dev-Setup.exe`
on each build Release. The site links to the newest one (`site\server.js`
`newestSetup`). It installs the launcher with Thornswood's own files and starts
it; the launcher's first start asks the install's questions. The program
measured below is the setup program before it, which downloaded a payload from
the site and ran a script from it (`installer\setup\Bootstrap.cs`, gone with
#4824). Nothing on this page has measured the Velopack one yet.

## What was measured

27 September 2026, the live download, `Thornswood-Setup-20260927-0257.exe`,
SHA-256 `c1d2065f25291458d6748ff312efadf311202ae38c47971167a138e0120f258b`:

    https://www.virustotal.com/gui/file/c1d2065f25291458d6748ff312efadf311202ae38c47971167a138e0120f258b

5 of 71 engines flagged it, and every one of the five is a machine learning or
hash reputation verdict rather than a signature for a known family:

| Engine | What it said | What that is |
| --- | --- | --- |
| CrowdStrike Falcon | win/malicious_confidence_90% | a model's confidence score, no family named |
| APEX | Malicious | a model's verdict, no family named |
| McAfeeD | ti!\<hash\> | hash intelligence: the file is bad because other feeds say so |
| Trapmine | malicious.moderate.ml.score | a model's score |
| Kingsoft | a generic heuristic | a heuristic, no family named |

Windows reports the file as NotSigned. The version resource is filled in:
Title and Product are Thornswood Setup, Company is Thornswood, with a
copyright line, and Build-Launcher stamped FileVersion and ProductVersion from
the launcher's own version. VirusTotal
also tagged the file `detect-debug-environment` and
`packers: .NET executable`.

That build is from before two changes made later the same day. Issue #390
turned signing on (Azure Artifact Signing), and the site stopped stamping the
date into the name: from then on the download was one name,
`Thornswood-Setup.exe`. Nothing on this page measures a signed build yet. Before reporting a file,
check which kind it is: `Get-AuthenticodeSignature` says Valid for a signed
build and NotSigned for one from before 27 September.

## Why an honest installer earns those verdicts

Five things about the old program, all of them on purpose, were the same five
a dropper does. The second and third were its own and went with it: Velopack's
setup program carries its package inside it rather than downloading one, and
asks nothing about other programs. The other three hold for it too.

- Until 27 September it was not signed. Authenticode is the one input every
  reputation system weighs heavily and the only one that carries across
  releases. Issue #390 turned signing on that day (Azure Artifact Signing), so
  a build from then on is signed and one from before is not: check which you
  are looking at before reporting it. Everything below still helps a signed
  build whose publisher has little reputation yet.
- It was a small .NET executable that downloaded a much bigger payload and
  ran what was inside it. That is the definition of a downloader. The one
  thing that made ours different was that the payload was checked against the
  SHA-256 the site published before anything in it ran, and a file that did
  not match was deleted.
- It ended other programs. It enumerated processes and at first called Kill
  on a Skyrim still alive. Killing a process with no consent is behaviour a
  model can see, so it came to ask first: a Yes or No box naming what was
  still running, Kill only on Yes. The launcher's install asks the same way
  now (`launcher\app\InstallSkyrim.cs:InstallSkyrim`).
- Its resources have high entropy. The icon and the logo are compressed
  images sitting in `.rsrc`, which reads the same to an entropy check as a
  packed payload does.
- Every build is a new file. Until 27 September the name changed too
  (`Thornswood-Setup-<date>.exe`); since then it is always
  `Thornswood-Setup.exe`. A stable file name does not help: every build is
  still a new hash, so reputation never accumulates on the file. The
  certificate in the first bullet is what carries across releases. The
  product NAME is deliberately stable for the same reason, and must stay
  stable: Thornswood Setup, company Thornswood, from thornswood.net. Changing
  those strings throws away the identity the signed publisher is building.

`ti!<hash>` deserves its own line. McAfeeD is not looking at the file, it is
looking up a hash in a threat intelligence feed, and those feeds read
VirusTotal. So a detection there is downstream of the other four, and clearing
the model-based ones, plus community votes and a comment on the report, is
what eventually clears it. There is nothing in the binary to change for it.

## The checklist, once per flagged hash

Do this after a build is published and has been looked at on VirusTotal, not
before: the report has to exist first. Everything below needs the same three
facts, so write them once and paste them into each form.

    Thornswood Setup, the installer for Thornswood, a private modded
    Skyrim multiplayer server at https://thornswood.net
    It is a Velopack setup program: it installs the Thornswood launcher
    and its game files from the package inside it, then starts the
    launcher. It is Authenticode signed through Azure Artifact Signing,
    and published on the Thornswood GitHub Releases.
    File: Thornswood-Setup.exe
    SHA-256: <the hash of that exact file>
    Report: https://www.virustotal.com/gui/file/<sha256>

The name is the same for every build, so the SHA-256 is what says which build
a report is about. For a build from before 27 September, say instead that it
is not signed, and give the dated name it was published under.

1. **VirusTotal, the report itself.** Get the hash the way the site gets it,
   in lower case: GitHub measures every Release file and gives its SHA-256 as
   the asset's digest, the site reads it from there, and the Downloads page
   shows it, lower cased by the site, beside the size (`site\lib\downloads.js`
   `listFiles`, `site\public\home.js` `sum`).
   Open `https://www.virustotal.com/gui/file/<sha256>`, read which engines
   flagged it, and leave a community comment with the three facts above.
   `scripts\release\Add-VirusTotalComment.ps1` posts that comment through the
   API when `VT_API_KEY` is set, so in practice this step is one command. The
   upload that makes the report exist in the first place is a separate script,
   `Publish-VirusTotal.ps1 -Path <the exe>`, run by hand: publish does not call
   it any more (`scripts\release\Publish-VirusTotal.ps1:Not called from publish`).
   Run it, or send the file at <https://www.virustotal.com/gui/home/upload>
   by hand, before the comment, because there is nothing to comment on before
   it has been.
2. **Vote.** On the same report, a clean vote from the account that posted the
   comment. Votes and comments are what the smaller engines look at when
   somebody in their queue reads the case.
3. **Microsoft.** Defender and SmartScreen are the two that decide whether a
   stranger can install at all, so this one matters most. Submit the file as a
   suspected false positive at
   <https://www.microsoft.com/en-us/wdsi/filesubmission>, as a software
   developer, naming Thornswood Setup and thornswood.net and pointing at the
   Downloads page as the place it is published from. Microsoft's criteria for
   what it flags and why are at
   <https://learn.microsoft.com/en-us/windows/security/threat-protection/intelligence/criteria>.
   SmartScreen has no separate form; it follows Defender's verdict and the
   file's reputation.
4. **CrowdStrike.** Falcon false positives are raised through the CrowdStrike
   support portal, <https://supportportal.crowdstrike.com/>, which wants a
   Falcon subscription. Nobody here has one, so unless a tester who does
   raises it from their own console, the practical levers on Falcon are the
   VirusTotal comment, the votes, and the signing that is on since #390. Say so plainly
   rather than pretending the ticket was filed.
5. **McAfee and Trellix.** The consumer McAfee and the Trellix products share
   the same intelligence. Their submission routes move about, so find the
   current one from their support site rather than trusting a link copied from
   here, and send the file with the three facts. Expect the `ti!<hash>`
   verdict to clear only after the report itself is clean, for the reason
   above.
6. **The small engines** (APEX, Trapmine, Kingsoft and whoever else is on the
   list that week). Each publishes a contact address on its own site, and the
   VirusTotal report links to the vendor page. One short message each, with
   the same three facts and the report link. They answer more often than the
   big ones do.
7. **Write down what was sent and when**, as a comment on the board issue for
   the report (issue #390 is closed now that signing is on), so the
   next person can see which vendors have already been asked and does not
   start again from nothing.

## Every release, not once

A new build is a new hash, and none of the work above carries over to it. So
after each Release that carries a new `Thornswood-Setup.exe`:

- Take the hash off the Downloads page, or off the Release's file list.
- Send the file, so the report exists. `Publish-VirusTotal.ps1 -Path <the exe>`
  does that, run by hand, or upload the exe on VirusTotal's upload page.
- Run `scripts\release\Add-VirusTotalComment.ps1 -Path <the exe>` with
  `VT_API_KEY` set. Without the key, without the file, or with nothing
  answering, it says which and exits 0, so it is safe on any machine and in
  any script.
- Look at the report. If the count is zero, there is nothing else to do.
- If anything flagged it, work the checklist above for that hash.

What actually ends this is signing, and it is on since 27 September (issue
#390). It moves reputation from a file hash that changes every release to a
certificate that does not, so the counts should fall as signed builds are
downloaded; a new publisher still starts with little reputation. Keep
the identity strings stable, keep the ask before anything is ended, keep the
published SHA-256 on the Downloads page, and send the false positive reports.
Those still help while the signed publisher builds reputation. The Downloads
page shows the hash and no VirusTotal link (`site\public\home.js` `sum`):
signing is the trust path, and publish no longer sends the file (#802). The
report address goes in the comment and the vendor messages, not on the site.
