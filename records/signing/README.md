# records\signing

The code signing setup, in the repository since 25 September. Until then it
was `C:\tools` on Patrick's machine, which nothing backed up and no other
machine had.

- `metadata.json`: which Azure Artifact Signing account, region and
  certificate profile `signtool` signs with. Tracked in git: it names the
  account and holds no key or password. The profile is `ThornswoodRelease`
  (it read "FILL THIS IN AFTER THE PROFILE EXISTS" until 27 September, while
  the machine that signs read its own copy at `C:\tools\metadata.json`).
- `client\`: Microsoft's signing client, `Azure.CodeSigning.Dlib.dll` and what
  comes with it, from the `Microsoft.ArtifactSigning.Client` package on NuGet
  (it was `Microsoft.Trusted.Signing.Client` before the rename). Ignored by
  git: it is Microsoft's, and it can be fetched again. The dlib is under
  `bin\x64` in the package; One has it at
  `client\client\Microsoft.ArtifactSigning.Client\bin\x64`, where nuget.exe
  put it.
- `signing.template.json`: the `records\signing\signing.json` a new machine starts from,
  paths and "enabled": true, no key or password (issue #458).

`records\signing\signing.json` says whether a machine signs, and with what. It stays out
of git because it is one machine's setup. Its `dlib` and `metadata` can name
these files relative to the repository folder, which is what the template
does:

```json
{
  "enabled": true,
  "method": "artifactsigning",
  "dlib": "records\\signing\\client\\Microsoft.ArtifactSigning.Client\\bin\\x64\\Azure.CodeSigning.Dlib.dll",
  "metadata": "records\\signing\\metadata.json",
  "timestampUrl": "http://timestamp.acs.microsoft.com"
}
```

On a new machine `.\scripts\release\Setup-ShipMachine.ps1` fetches the client
at the pinned version (refusing any other bytes), writes `records\signing\signing.json`
from the template when there is none, and asks the signing service whether
this machine's `az login` can sign with the profile. The sign in is the
credential. Each person who ships signs in as themselves, with an account of
their own in the signing tenant that holds the Certificate Profile Signer role
on the ThornswoodRelease profile, which Patrick makes once (docs/guide/set-up-a-machine.md,
"Your own signing sign in"; Patrick, 4 Oct, #1740). Until then only his
account could sign (29 Sep, #1121). `az login --use-device-code` is refused by
the tenant's security defaults (AADSTS530035). Never copy another machine's
`records\signing\signing.json`: it names that machine's paths. One's used to
name `C:\tools\metadata.json`; that folder held only an older copy of
`metadata.json` (the same account and profile) and was removed on 5 Oct, so
One writes its `signing.json` from the template like any other machine.

SIGNING IS ON since 27 September (issue #390, closed). It was switched off on
purpose until then (Patrick, 22 September: "the code signing stuff isnt
finnished thats why its switched off"). The launcher and the setup program are
signed on every Ship from a machine whose `records\signing\signing.json` is enabled.

EVERY RELEASE HAS TO BE SIGNED NOW. `ExpectedSigner` in
`launcher\app\Updater.cs` is set, so a launcher from dev 1.1.101.17 on
refuses an update that is not signed by this certificate. A machine with no
`records\signing\signing.json`, or one that is disabled, still builds and only prints
"not signing", but Ship refuses to publish from it
(`scripts\release\Assert-PublishSigned.ps1`). So only a machine that signs
Ships, dev included.

The certificate is issued to a person, and Windows shows that person's name
as the verified publisher. The live main launcher, 1.1.101, was built before
signing and is unsigned; the next main Ship is the first signed one.

WHAT THE LAUNCHER PINS (issue #912, `launcher\app\Signature.cs`). Artifact
Signing certificates last three days, so no certificate thumbprint can be
pinned. What stays the same, measured on dev 1.1.101.34 on 28 September:

- the root, Microsoft Identity Verification Root Certificate Authority 2020
  (thumbprint `F40042E2E5F7E8EF8189FED15519AECE42C3BFA2`, to 2045), through
  Microsoft ID Verified Code Signing PCA 2021 and an issuing authority named
  "Microsoft ID Verified CS ..." (AOC CA 04 that day; these rotate);
- the usage `1.3.6.1.4.1.311.97.1.0`, in every Artifact Signing public trust
  certificate;
- the durable identity value of the `ThornswoodRelease` profile,
  `1.3.6.1.4.1.311.97.203948530.216998690.847558466.123546472`, which
  Microsoft keeps the same across every renewal of that profile.

A new certificate profile or a new identity validation gets a new durable
identity value. Before signing anything with it, add the new value to
`Signature.Identities` and Ship that launcher signed with the old profile;
otherwise every installed launcher refuses the next update. Ship runs the
same check before it publishes, so a launcher signed
with a profile the code does not name stops there.
