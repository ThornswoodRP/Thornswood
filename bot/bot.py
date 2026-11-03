"""
The Thornswood bot. This one stays running, unlike Build-Discord.py which sets
the server up once and exits.

What it does:

  Joins    draws a card and puts it in #welcome
  Tickets  a panel in #tickets-and-applications, one private thread per
           ticket, and a copy pushed to the site so the inbox has it whether
           or not anybody was looking at Discord. #tickets is the staff only
           channel closed tickets are written down in, and where a ticket
           goes when its thread will not open
  Services posts in the staff channel what the VPS watchdog says has died
           and when it is back, from its outbox, once each (issue #447)
  Reports  says each thing sent in on the site's public report page in the
           staff channel, the day it arrives
  Holds    a panel in #choose-your-hold where a Member picks their hold
           and which announcements ping them
  Testing  #known-issues is a forum with one post per open GitHub issue
           labelled Dev Findings or Main Findings; the post goes when the
           issue is closed, which is when its fix is on main. #test-tasks is a
           forum of test tasks: one for each issue closed as fixed (its "Test
           task:" comment), always tagged Main, because main is where testers
           test, plus any posted by hand tagged Main (/test-task,
           python bot.py --post-task). #dev-test-tasks, a staff only forum
           in Staff, holds the test tasks whose comment says "Server: Dev":
           a measurement someone on dev has to take, open issue or closed,
           and any posted by hand tagged Dev. The same read writes the
           site's Known Issues page (the #known-issues list) and its
           roadmap (the "roadmap:" labels) for the site to show (#3140).
           The channels get there once, by hand, with
           python bot.py --setup-channels [--apply] (the testing channels
           section below)
  Heartbeat writes heartbeat.json beside this file every minute, so the
           watchdog can tell a bot that is running from one that is on
           Discord (issue #449)
  Uptime   pings an outside monitor every minute while it is on Discord, so
           a bot or a VPS that stops is noticed from outside the box (#449)

Everything it needs is in env:

  DISCORD_TOKEN    the bot token
  THORNSWOOD_SITE  https://thornswood.net
  THORNSWOOD_KEY   shared secret the site checks on /api/ticket
  JOIN_CHANNEL     name of the channel join cards go in, default general
  TICKET_CHANNEL   public channel the panel lives in, comma separated, first wins
  TICKET_LOG       staff only channel closed tickets are recorded in, and where
                   a ticket goes when its thread will not open. Checked by its
                   permissions, never trusted by its name
  STAFF_ROLES      comma separated role IDs (preferred) or names, who gets
                   pulled into every ticket thread
  CREATOR_ROLES    comma separated role IDs or names, added to Apply:
                   Content Creator only
  UPPER_STAFF_ROLES comma separated role IDs only, who is pinged and added
                   to Faction Leader tickets. Must include the Owner role
                   ID and each department Lead ID (today Lead Gamemaster).
                   Names are ignored and logged. Empty or unset means a
                   Faction Leader ticket is refused: nobody else is added,
                   and the applicant is told to try again later.
  TICKET_COOLDOWN  seconds between one person's tickets, default 300
  WATCH_CHANNEL_ID id of the staff channel the watchdog's messages go in,
                   default whatever staff-channel.txt beside this file
                   holds, #staff-updates. Leave it unset
  WATCH_DIR        the watchdog's folder, default the one Watch-Services.ps1
                   makes on the VPS
  WATCH_READ_EVERY seconds between reads of its outbox, default 60
  HOLD_CHANNEL     channel the hold panel lives in, default choose-your-hold
  MEMBER_ROLE      role ID (preferred) or name that may pick a hold, default Member
  TEST_TASK_ROLES  comma separated role IDs (preferred) or names, who may
                   post a test task, default Owner,Dev,Lead Gamemaster,Lead GM
  TEST_TASKS_CHANNEL, TEST_FINDINGS_CHANNEL, KNOWN_ISSUES_CHANNEL
                   default test-tasks, test-findings, known-issues
  DEV_TASKS_CHANNEL   the staff forum of dev test tasks, default dev-test-tasks
  DEV_TASKS_CATEGORY  id of the category it is made in, default the Staff
                      category, 1549254990110134374
  GITHUB_TOKEN_FILE  where the box admin service writes the bot's GitHub
                   token, issues write on KNOWN_ISSUES_REPO, made by its App
                   every half hour (#5184), default
                   C:\Thornswood-Admin\for-bot\github-token.json. Read at
                   each call; while it holds a token that has not ended, that
                   is the token
  GITHUB_TOKEN     the token used when that file has none: for the
                   repository's issues, read and write: the rule comments and
                   Report a problem (#3155) write. A secret, set only in
                   bot.env.json. With neither, no #known-issues posts and no
                   problems filed
  PROBLEM_LABELS   labels a filed problem gets, default Tester report,area: triage
  PROBLEM_CHANNEL  channel the Report a problem panel lives in, default
                   TEST_FINDINGS_CHANNEL
  TESTER_ROLES     comma separated role IDs (preferred) or names that may use
                   that panel besides staff, default Playtester
  KNOWN_ISSUES_REPO   default ThornswoodRP/Thornswood
  KNOWN_ISSUES_LABELS default Dev Findings,Main Findings
  KNOWN_ISSUES_EVERY  seconds between GitHub reads, default 300, never under 60
  PUBLIC_LISTS_FILE   where the site's known issues and roadmap are written,
                      default the site's data/from-bot/lists.json on the VPS
  HEARTBEAT_FILE   where the heartbeat goes, default heartbeat.json beside this
                   file, which is where the watchdog reads it
  HEARTBEAT_EVERY  seconds between heartbeats, default 60
  PING_URL         the outside monitor's ping address. A secret, set only by
                   Install-Bot.ps1 -SetPing and never written to the log. Not
                   set means no ping
  PING_EVERY       seconds between pings, default 60
  PING_TIMEOUT     seconds one ping may take, default 10

It is written to keep going when a piece of it fails. A card that will not
draw still gets a greeting, a site that is down still gets a thread, and a
thread that cannot be made still gets an answer to the person who asked.
"""
# First, before anything else: Python 3.11 or newer, or a plain message
# saying so (#2276). Shared with every bot test.
import _pyguard  # noqa: F401
import json
import os
import sys

# Where its files are and which roots it trusts, before anything else
# (bot_base.py), then the settings a by-hand run reads from its env
# file, then the parts, each of which reads its settings as it loads.
import bot_base  # noqa: F401


def _load_env_file(argv):
    """
    --env-file PATH: read bot.env.json into the environment before anything
    below reads it, so the one-time setup and --post-task can be run by hand
    on the VPS with the service's settings. The service never passes it.
    """
    if '--env-file' not in argv:
        return
    at = argv.index('--env-file')
    with open(argv[at + 1], encoding='utf-8-sig') as f:
        for k, v in json.load(f).items():
            os.environ[str(k)] = str(v)


if __name__ == '__main__':
    _load_env_file(sys.argv)


# The parts, in the order they import each other: one area of the bot
# each (#5357).
import bot_core  # noqa: E402,F401
import bot_joins  # noqa: E402,F401
import bot_holds  # noqa: E402,F401
import bot_staff_channel  # noqa: E402,F401
import bot_reports  # noqa: E402,F401
import bot_tickets  # noqa: E402,F401
import bot_ticket_panels  # noqa: E402,F401
import bot_offices  # noqa: E402,F401
import bot_factions  # noqa: E402,F401
import bot_testing  # noqa: E402,F401
import bot_github  # noqa: E402,F401
import bot_task_text  # noqa: E402,F401
import bot_post_rules  # noqa: E402,F401
import bot_forums  # noqa: E402,F401
import bot_roadmap  # noqa: E402,F401
import bot_notices  # noqa: E402,F401
import bot_news  # noqa: E402,F401
import bot_watchdog  # noqa: E402,F401
import bot_problems  # noqa: E402,F401
import bot_moderation  # noqa: E402,F401
import bot_heartbeat  # noqa: E402,F401
import bot_uptime  # noqa: E402,F401
import bot_ready  # noqa: E402,F401
import bot_cli  # noqa: E402,F401
import bot_deletion  # noqa: E402,F401

import discord  # noqa: E402

from bot_base import ROOTS, _left_out, _trusted  # noqa: E402
from bot_core import TOKEN, client, log  # noqa: E402
from bot_heartbeat import beat_now  # noqa: E402
from bot_cli import run_cli  # noqa: E402
from bot_deletion import apply_deletion_requests  # noqa: E402


# Under a main guard, so that importing this file reads it instead of running
# it. Without one, `import bot` connects to Discord with whatever token is in
# env, which is why nothing in here had ever been tested: there was no way to
# get at a function without starting a bot. Install-Bot.ps1 launches it as
# `python bot.py`, where __name__ is __main__, so this changes nothing about
# how it runs on the VPS.
if __name__ == '__main__':
    if ('--setup-channels' in sys.argv or '--post-task' in sys.argv
            or '--adopt-task' in sys.argv or '--forum-check' in sys.argv):
        raise SystemExit(run_cli(sys.argv[1:]))
    # Said here and not where the roots are written, so a tool that imports
    # bot.py reads nothing extra on its standard output.
    log('trusting %d root certificates from %s, leaving out %s' % (
        _trusted, ROOTS, ', '.join(_left_out) or 'none'))
    # One heartbeat before anything can hang, so a bot stuck logging in has
    # this run's pid in the file and the watchdog can say how long it has sat.
    beat_now()
    # Before it connects, so nothing it does can write a record back (#2758).
    apply_deletion_requests()
    try:
        client.run(TOKEN)
    except discord.PrivilegedIntentsRequired:
        log('Discord refused the connection because Server Members Intent is off.')
        log('Go to discord.com/developers, open the Thornswood application, Bot in')
        log('the left menu, switch on SERVER MEMBERS INTENT, save, then run')
        log('Install-Bot.ps1 again.')
        raise SystemExit(1)
    except discord.LoginFailure:
        log('Discord rejected the bot token. Reset it on the Bot page and run')
        log('Install-Bot.ps1 again to paste the new one.')
        raise SystemExit(1)
