# Thornswood: watched from outside

Every five minutes, from GitHub's servers, this asks what a stranger on the
internet would see of [thornswood.net](https://thornswood.net/): the site,
both update feeds, the certificate, where the name points, the registration,
the build runners and the Nexus collection. When one breaks it tells the
staff channel once, and once more when it is fixed. It is off the VPS on
purpose, so it can say when the whole box is gone.

Everything here is written by `Watch-Outside.ps1 -Export` from the project's
own repository. Change it there and export it again; an edit made here is
written over.

## What it holds

- `Watch-Outside.ps1`, the watcher. Its header says what each check asks and why.
- `watch-outside.json`, what it asks: public addresses, and the names the
  runner check needs.
- `.github/workflows/watch-outside.yml`, the schedule. Run it by hand with
  "test" ticked to post one test message instead of watching.
- `.github/workflows/keep-alive.yml`, a commit to `alive.txt` once a month,
  because GitHub turns off a public repository's schedules after 60 days with
  no activity.

## What it needs

Two repository secrets (Settings, Secrets and variables, Actions):

- `STAFF_WEBHOOK`, the Discord webhook in #staff-updates that the VPS watchdog
  also posts through.
- `RUNNER_TOKEN`, a fine-grained personal access token whose only repository
  is ThornswoodRP/Thornswood-Ops, where the box's runners are registered
  since the flip (#4013), and whose only permission is Administration:
  Read-only, so it can read those runners and nothing else.

And one setting (Settings, Actions, General, "Approval for running fork pull
request workflows from contributors"): **Require approval for all external
contributors**. What the watcher remembers between runs is in the Actions
cache, and a fork's pull request workflow can read this repository's cache.

## Its logs are public

Anybody can read a public repository's run logs, so the watcher prints only
what anybody can already see. For the build runners it prints only ok or
WRONG, and for COULD NOT CHECK the reason GitHub gave (the token refused, with
its HTTP code, or GitHub not answering), which names nothing in the project's
repository. What it tells staff goes only to Discord.
