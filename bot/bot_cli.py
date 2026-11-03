"""
The by-hand jobs: python bot.py --setup-channels and the rest.

Part of the bot: bot.py loads it (#5357).
"""
import traceback

import discord

from bot_base import TrustedClient
from bot_core import TOKEN, _state_read
from bot_testing import (HAND_TAGS, KNOWN_NAME, KNOWN_STATE, TASKS_NAME,
    TASK_POST_TAG, _channel_named, channel_setup, dev_tasks_forum,
    post_test_task)
from bot_forums import adopt_task, forum_check, forum_records


def run_cli(argv):
    """
    The by-hand jobs, on a connection of their own that starts none of the
    bot's watchers, panels or command sync, and closes when it is done:

      --setup-channels [--apply]   the one-time setup, a preview without --apply
      --post-task --title T --body B|--body-file F [--tag Main|Dev]
      --adopt-task --issue N --thread ID   (offline; with the bot stopped)
      --forum-check [--apply]      the duplicate posts in #known-issues,
                                   #test-tasks and #dev-test-tasks, a preview
                                   without --apply (forum_check)

    Returns the exit code.
    """
    import argparse
    ap = argparse.ArgumentParser(prog='bot.py')
    ap.add_argument('--env-file')
    ap.add_argument('--setup-channels', action='store_true')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--post-task', action='store_true')
    ap.add_argument('--title')
    ap.add_argument('--body')
    ap.add_argument('--body-file')
    ap.add_argument('--tag', choices=list(HAND_TAGS), default=TASK_POST_TAG)
    ap.add_argument('--guild', type=int, default=0)
    ap.add_argument('--adopt-task', action='store_true')
    ap.add_argument('--issue', type=int)
    ap.add_argument('--thread', type=int)
    ap.add_argument('--forum-check', action='store_true')
    a = ap.parse_args(argv)
    if a.adopt_task:
        if not a.issue or not a.thread:
            ap.error('--adopt-task needs --issue and --thread')
        print(adopt_task(a.issue, a.thread))
        return 0
    if a.post_task:
        body = a.body
        if a.body_file:
            with open(a.body_file, encoding='utf-8-sig') as f:
                body = f.read()
        if not a.title or not body:
            ap.error('--post-task needs --title and --body or --body-file')
    out = {'code': 0}
    cli = TrustedClient(intents=discord.Intents(guilds=True))

    @cli.event
    async def on_ready():
        try:
            guilds = [g for g in cli.guilds if not a.guild or g.id == a.guild]
            if not guilds:
                print('the bot is in no server%s' % (
                    ' with id %d' % a.guild if a.guild else ''))
                out['code'] = 1
            for g in guilds:
                print('"%s" (%d):' % (g.name, g.id))
                if a.setup_channels:
                    for line in await channel_setup(g, apply=a.apply):
                        print('  ' + line)
                    if not a.apply:
                        print('  (preview only; add --apply to do it)')
                elif a.forum_check:
                    state = _state_read(KNOWN_STATE)
                    if state is None:
                        print('  %s will not read; nothing was looked at' % KNOWN_STATE)
                        out['code'] = 1
                        continue
                    recs = forum_records(state)
                    me = getattr(cli.user, 'id', None)
                    for forum, part in ((_channel_named(g, KNOWN_NAME, ('forum',)), 'known'),
                                        (_channel_named(g, TASKS_NAME, ('forum',)), 'tasks'),
                                        (dev_tasks_forum(g), 'dev')):
                        if forum is None:
                            print('  no %s forum' % part)
                            continue
                        for line in await forum_check(forum, recs[part], me, a.apply):
                            print('  ' + line)
                    if not a.apply:
                        print('  (preview only; add --apply to delete the duplicates)')
                else:
                    thread, said = await post_test_task(g, a.title, body, a.tag)
                    print('  ' + said)
                    if thread is None:
                        out['code'] = 1
        except Exception:
            traceback.print_exc()
            out['code'] = 1
        finally:
            await cli.close()

    cli.run(TOKEN, log_handler=None)
    return out['code']
