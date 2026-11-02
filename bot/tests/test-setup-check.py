# test-setup-check.py
#
# Issue #1211. Setup-Discord -Check must not say the AFK channel or the join
# message was set when nothing changed. This runs Build-Discord's own
# apply_welcome_and_afk in check mode against a stand-in guild. Nothing here
# logs in, and no token is set.
#
# When the stand-in is already the way the build wants, the output has no set
# line for the AFK channel or the join message. When a change would happen,
# the line says would change, and still not set.
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
    "build_discord_check", os.path.join(HERE, "Build-Discord.py"))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)


class Flags(object):
    def __init__(self, **kw):
        self.__dict__.update(kw)


class Chan(object):
    def __init__(self, name):
        self.name = name


class Guild(object):
    def __init__(self):
        self.edits = []
        self.system_channel = Chan("welcome-travelers")
        self.system_channel_flags = Flags(
            join_notifications=False,
            join_notification_replies=False,
            premium_subscriptions=True,
            guild_reminder_notifications=False)
        self.afk = Chan("AFK")
        self.afk_channel = self.afk

    async def edit(self, **kw):
        self.edits.append(kw)


def found_for(guild):
    return {"WELCOME": Chan("welcome"), "AFK": guild.afk}


def lines_of(text):
    return [ln for ln in text.splitlines() if ln.strip()]


def is_set(ln):
    return ln.startswith("  set ") or ln.startswith("  set\t")


def run(guild, check):
    B.CHECK = check
    buf = io.StringIO()
    with redirect_stdout(buf):
        asyncio.run(B.apply_welcome_and_afk(guild, found_for(guild)))
    return buf.getvalue()


# Already the way the build wants: no set line, and it does not edit.
same = Guild()
out = run(same, True)
yes("check, nothing to change: no set line",
    not any(is_set(ln) for ln in lines_of(out)))
yes("check, nothing to change: the AFK channel is not said to be set",
    "AFK after five minutes" not in out)
yes("check, nothing to change: the join message is not said to be set",
    "join message is off" not in out)
yes("check, nothing to change: nothing was edited", same.edits == [])

# A change would happen. The line says would change, and still not set.
need = Guild()
need.system_channel = None
need.system_channel_flags = Flags(
    join_notifications=True,
    join_notification_replies=True,
    premium_subscriptions=False,
    guild_reminder_notifications=True)
need.afk_channel = Chan("Away")
out = run(need, True)
yes("check, a change would happen: the line says would change",
    "would change" in out)
yes("check, a change would happen: no set line",
    not any(is_set(ln) for ln in lines_of(out)))
yes("check, a change would happen: the AFK channel is not said to be set",
    "AFK after five minutes" not in out)
yes("check, a change would happen: the join message is not said to be set",
    "join message is off" not in out)
yes("check, a change would happen: nothing was edited", need.edits == [])

# The older discord.py, which has no join_notification_replies.
real_flags = B.discord.SystemChannelFlags


class OldFlags(object):
    def __init__(self, **kw):
        if "join_notification_replies" in kw:
            raise TypeError("old discord.py")
        self.__dict__.update(kw)


B.discord.SystemChannelFlags = OldFlags
try:
    old_same = Guild()
    out = run(old_same, True)
    yes("check on the older library, nothing to change: no set line",
        not any(is_set(ln) for ln in lines_of(out)) and
        "join message is off" not in out and
        "AFK after five minutes" not in out)
    old_need = Guild()
    old_need.system_channel_flags = Flags(
        join_notifications=True,
        premium_subscriptions=False,
        guild_reminder_notifications=True)
    old_need.afk_channel = Chan("Away")
    out = run(old_need, True)
    yes("check on the older library, a change would happen: would change, not set",
        "would change" in out and
        not any(is_set(ln) for ln in lines_of(out)) and
        "join message is off" not in out)
finally:
    B.discord.SystemChannelFlags = real_flags

print("")
print("%d passed, %d failed" % (len(PASS), len(FAIL)))
if FAIL:
    sys.exit(1)

