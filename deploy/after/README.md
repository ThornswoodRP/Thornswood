# Steps after a deploy

Issue #5186. A pull request whose change needs something done once it is
deployed says so here, in a file of its own, instead of a run note somebody
has to remember. The box deploy agent runs each step once, after a
Deployment of the Release that carries it succeeds, and says how each went
on that Deployment. Nobody runs anything by hand.

One file per issue, named `<issue>-<a-few-words>.json` in lower case with
hyphens:

```json
{
  "issue": 2484,
  "environment": "dev",
  "steps": [
    { "run": "Reset-Npcs-Dev" },
    { "inGame": "Walk in at Whiterun's main gate and at Riften's.", "doneWhen": "Neither gate shows a lock prompt." }
  ]
}
```

- `environment` is `dev` or `main`. A step runs after a deploy to that
  environment only.
- A `run` step is one line for the deploy gate (`scripts/vps/gate/`), the
  same line `Box-Run.ps1 -Line` takes. Its verb has to be one that
  `scripts/vps/gate/verbs.json` lets run after a deploy to that
  environment (its `afterDeploy` list). The step is done when the verb ends
  0. The gate runs main as it is when the step runs.
- An `inGame` step is a check only a person in the game can make, with
  `doneWhen` saying how they know it worked. It becomes an issue labelled
  `check: in game`, filed by `.github/workflows/after-deploy.yml` when the
  Deployment succeeds.
- At most ten steps in a file. The text is plain, one line each, with no em
  dash.

Check a change's steps before a push (the agent's own rules, the same ones
it runs them by, and the ones the pull request's Tree checks hold them to):

```
dotnet run --project tools/DeployAgent -- steps --folder deploy/after --verbs scripts/vps/gate/verbs.json
```

Each step runs once on each environment: the agent keeps what ran in its
state folder, writes a step down as started before it starts, and never runs
one again that it was stopped in the middle of. A step that failed, or was
cut short, is said first in the Deployment's description by its issue, and
after-deploy.yml says so on that issue. A file can come out once every step
in it has run where it was meant to; leaving it does no harm.

docs/DEPLOY-AGENT.md says how the agent runs them.
