# test-2955-notice-channels.py
#
# Issue #2955. Discord's own Community Updates and Safety Notifications
# channels go to #staff-updates, by the id in staff-channel.txt, and never to
# #staff-general. This runs Build-Discord's own apply_notice_channels against
# a stand-in guild. Nothing here logs in, and no token is set.
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)

import asyncio
import importlib.util
import io
from contextlib import redirect_stdout

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(("PASS  " if cond else "FAIL  ") + what)


spec = importlib.util.spec_from_file_location(
    "build_discord_notices", os.path.join(HERE, "Build-Discord.py"))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

with open(os.path.join(HERE, "staff-channel.txt"), encoding="utf-8") as f:
    UPDATES_ID = int(f.read().strip())
GENERAL_ID = UPDATES_ID + 1


class Chan(object):
    def __init__(self, id, name):
        self.id = id
        self.name = name


class Refused(B.discord.HTTPException):
    def __init__(self):
        self.status = 403
        self.text = "Missing Permissions"


class Guild(object):
    def __init__(self, at=GENERAL_ID, community=True, has_updates=True, refuse=False):
        self.features = ["COMMUNITY"] if community else []
        self.chans = {GENERAL_ID: Chan(GENERAL_ID, "staff-general")}
        if has_updates:
            self.chans[UPDATES_ID] = Chan(UPDATES_ID, "staff-updates")
        self.public_updates_channel = self.chans.get(at)
        self.safety_alerts_channel = self.chans.get(at)
        self.refuse = refuse
        self.edits = []

    def get_channel(self, id):
        return self.chans.get(id)

    async def edit(self, **kw):
        if self.refuse:
            raise Refused()
        self.edits.append(kw)


def run(guild, check):
    B.CHECK = check
    del B.failed[:]
    buf = io.StringIO()
    with redirect_stdout(buf):
        asyncio.run(B.apply_notice_channels(guild))
    return buf.getvalue(), list(B.failed)


# The case #2955 is about: both fields on #staff-general.
g = Guild()
out, failed = run(g, False)
yes("N1 both fields on #staff-general are moved, in one edit",
    len(g.edits) == 1)
edit = g.edits[0] if g.edits else {}
yes("N2 the Community Updates channel is the id in staff-channel.txt",
    getattr(edit.get("public_updates_channel"), "id", None) == UPDATES_ID)
yes("N3 the Safety Notifications channel is the id in staff-channel.txt",
    getattr(edit.get("safety_alerts_channel"), "id", None) == UPDATES_ID)
yes("N4 it says set, naming #staff-updates, and nothing failed",
    "set" in out and "#staff-updates" in out and not failed)

# -Check changes nothing and never says set.
g = Guild()
out, failed = run(g, True)
yes("N5 check: would change, nothing edited, no set line",
    "would change" in out and g.edits == [] and
    not any(ln.startswith("  set ") for ln in out.splitlines()))

# Only one of the two pointing elsewhere is still a change.
g = Guild(at=UPDATES_ID)
g.safety_alerts_channel = g.chans[GENERAL_ID]
out, failed = run(g, True)
yes("N6 check: one field elsewhere is enough to say would change",
    "would change" in out and g.edits == [])

# Already right: nothing is edited, under either mode.
for check in (True, False):
    g = Guild(at=UPDATES_ID)
    out, failed = run(g, check)
    yes("N7 already on #staff-updates (check=%s): nothing edited, nothing failed" % check,
        g.edits == [] and not failed and "would change" not in out)

# No Community yet: neither field exists, and the run's closing lines say to
# turn it on.
g = Guild(community=False)
out, failed = run(g, False)
yes("N8 no Community: nothing edited and nothing failed",
    g.edits == [] and not failed)

# No channel with that id on the server: said under did not manage, and it
# never falls back to a channel by name.
g = Guild(has_updates=False)
g.chans[UPDATES_ID + 2] = Chan(UPDATES_ID + 2, "staff-updates")
out, failed = run(g, False)
yes("N9 the id is not on the server: did not manage, nothing edited",
    g.edits == [] and len(failed) == 1 and str(UPDATES_ID) in failed[0])

# Discord refuses the edit: its words go under did not manage.
g = Guild(refuse=True)
out, failed = run(g, False)
yes("N10 Discord refuses: did not manage names its answer, no set line",
    len(failed) == 1 and "403" in failed[0] and
    not any(ln.startswith("  set ") for ln in out.splitlines()))

# Nothing in the builder or the README sends these to #staff-general.
with open(os.path.join(HERE, "README.md"), encoding="utf-8") as f:
    readme = f.read()
rows = [ln for ln in readme.splitlines()
        if ln.startswith("| Community Updates Channel") or
        ln.startswith("| Safety Notifications Channel")]
yes("N11 the README's two rows say #staff-updates and never #staff-general",
    len(rows) == 2 and all("#staff-updates" in r and "staff-general" not in r
                           for r in rows))

print("")
print("%d passed, %d failed" % (len(PASS), len(FAIL)))
raise SystemExit(1 if FAIL else 0)
