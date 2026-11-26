"""One actual forum watcher recovers from unavailable startup prerequisites.

The token reader and index/list files are real; forum passes and staff sends
are local stand-ins. No GitHub requests, Discord connection or live writes.
"""
import os
import sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401
import asyncio
import datetime
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace as NS
import unittest

PRIVATE = tempfile.TemporaryDirectory(prefix='tw5514-')
os.environ['DISCORD_TOKEN'] = 'not-a-real-token'
os.environ['THORNSWOOD_BOT_DATA'] = PRIVATE.name
os.environ['GITHUB_TOKEN_FILE'] = str(Path(PRIVATE.name) / 'initial-no-token.json')
os.environ.pop('GITHUB_TOKEN', None)
import discord  # noqa: E402
import harness_bot  # noqa: E402
bot = harness_bot.whole()
REAL_WRITE = bot._state_write
TOKEN = 'ghs_fixture_5514_not_a_secret'


class Rig:
    def __init__(self):
        self.folder = Path(tempfile.mkdtemp(dir=PRIVATE.name))
        self.token, self.index = self.folder / 'token.json', self.folder / 'known.json'
        self.lists = self.folder / 'lists.json'
        self.index.write_text('{"issues":{}}', encoding='utf-8')
        self.calls, self.warnings, self.logs, self.sleeps, self.snapshots = [], [], [], [], []
        self.ready_calls = 0
        self.fail_save = self.warning_raises = False
        bot.GITHUB_TOKEN_FILE, bot.KNOWN_STATE = str(self.token), str(self.index)
        bot.PUBLIC_LISTS_FILE = str(self.lists)
        bot.log = lambda *parts: self.logs.append(' '.join(map(str, parts)))
        self.known = NS(id=10, name=bot.KNOWN_NAME, type=discord.ChannelType.forum)
        self.tasks = NS(id=20, name=bot.TASKS_NAME, type=discord.ChannelType.forum)
        self.dev = NS(id=30, name=bot.DEV_TASKS_NAME, type=discord.ChannelType.forum)
        self.guild = NS(id=1, name='Fixture', channels=[self.known, self.tasks, self.dev])
        bot.dev_tasks_forum = lambda guild: self.dev
        async def work(forum, state, *, save, me_id):
            self.calls.append(forum.name)
            self.snapshots.append(json.loads(json.dumps(state)))
            state['marker'] = 'live metadata'
            state['_dirty'] = True
            save(state)
            return [], [], []
        bot.known_issues_once = bot.test_tasks_once = bot.dev_tasks_once = work
        bot.roadmap_once = lambda state: [{'title': 'Fixture roadmap', 'text': 'Local only'}]
        async def warn(text):
            self.warnings.append(text)
            if self.warning_raises:
                raise RuntimeError('fixture warning delivery outcome unknown')
            return NS(id=1)
        bot.report_say = warn

    def put_token(self):
        ends = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)
        self.token.write_text(json.dumps({'token': TOKEN, 'expires_at': ends.strftime('%Y-%m-%dT%H:%M:%SZ')}), encoding='utf-8')

    def repair(self):
        self.index.write_text('{"issues":{}}', encoding='utf-8')

    def run(self, *steps, cancel=False):
        pending = iter(steps)
        stopped = False
        async def ready():
            self.ready_calls += 1
        async def sleep(seconds):
            nonlocal stopped
            self.sleeps.append(seconds)
            if cancel:
                raise asyncio.CancelledError()
            action = next(pending, None)
            if action is None:
                stopped = True
            else:
                action()
        def write(path, state):
            if self.fail_save and path == str(self.index):
                raise OSError('fixture refuses metadata save')
            REAL_WRITE(path, state)
        bot._state_write = write
        bot.client = NS(user=NS(id=50), guilds=[self.guild], wait_until_ready=ready,
                        is_closed=lambda: stopped)
        bot.asyncio = NS(get_running_loop=asyncio.get_running_loop, sleep=sleep)
        try:
            asyncio.run(bot.watch_known_issues())
        finally:
            bot.asyncio, bot._state_write = asyncio, REAL_WRITE


class Recovery(unittest.TestCase):
    def test_token_file_appears_during_same_running_task(self):
        r = Rig()
        def still_blocked():
            self.assertFalse(r.calls)
            self.assertFalse(r.lists.exists())
        r.run(still_blocked, r.put_token)
        self.assertEqual(r.ready_calls, 1)
        self.assertEqual(set(r.calls), {r.known.name, r.tasks.name, r.dev.name})
        self.assertEqual(json.loads(r.lists.read_text())['roadmap'][0]['title'], 'Fixture roadmap')
        self.assertEqual(len(r.warnings), 1)
        self.assertTrue(all(seconds == bot.KNOWN_EVERY for seconds in r.sleeps))
        self.assertNotIn(TOKEN, '\n'.join(r.warnings + r.logs))

    def test_unreadable_and_nonobject_index_recover_without_empty_fallback(self):
        for bad in ['{', '[]', 'null', '42']:
            with self.subTest(bad):
                r = Rig()
                r.put_token()
                r.index.write_text(bad, encoding='utf-8')
                def still_blocked():
                    self.assertEqual(r.index.read_text(), bad)
                    self.assertFalse(r.calls)
                    self.assertFalse(r.lists.exists())
                r.run(still_blocked, r.repair)
                self.assertEqual(r.ready_calls, 1)
                self.assertEqual(len(r.calls), 3)
                self.assertEqual(len(r.warnings), 1)
                self.assertTrue(r.lists.exists())

    def test_changed_blocking_reason_says_each_once_then_resumes(self):
        r = Rig()
        r.index.write_text('{', encoding='utf-8')
        r.run(lambda: None, r.put_token, lambda: None, r.repair)
        self.assertEqual(len(r.warnings), 2)
        self.assertTrue(any('token' in text.lower() for text in r.warnings))
        self.assertTrue(any('index' in text.lower() or 'known-issues' in text.lower() for text in r.warnings))
        self.assertEqual(len(r.calls), 3)

    def test_corruption_after_start_pauses_without_overwriting_input(self):
        r = Rig()
        r.put_token()
        def break_index():
            r.index.write_text('{', encoding='utf-8')
        def verify_then_repair():
            self.assertEqual(len(r.calls), 3)
            self.assertEqual(r.index.read_text(), '{')
            r.repair()
        r.run(break_index, verify_then_repair)
        self.assertEqual(len(r.calls), 6)
        self.assertEqual(len(r.warnings), 1)

    def test_unsaved_live_metadata_survives_blocked_pass(self):
        r = Rig()
        r.put_token()
        r.fail_save = True
        def lose_token():
            r.token.unlink()
        def restore():
            r.fail_save = False
            r.put_token()
        r.run(lose_token, restore)
        self.assertGreaterEqual(len(r.snapshots), 2)
        self.assertEqual(r.snapshots[1]['marker'], 'live metadata')
        self.assertTrue(r.snapshots[1]['_dirty'])
        self.assertEqual(json.loads(r.index.read_text())['marker'], 'live metadata')

    def test_ambiguous_warning_is_not_blindly_repeated(self):
        r = Rig()
        r.warning_raises = True
        r.run(lambda: None, r.put_token)
        self.assertEqual(len(r.warnings), 1)
        self.assertEqual(len(r.calls), 3)

    def test_warning_failure_cannot_save_dirty_state_over_corrupt_index(self):
        r = Rig()
        r.put_token()
        r.fail_save = True
        def damage_and_fail_warning():
            r.fail_save = False
            r.warning_raises = True
            r.index.write_text('{', encoding='utf-8')
        def verify_then_repair():
            self.assertEqual(r.index.read_text(), '{')
            self.assertEqual(len(r.calls), 1)
            r.warning_raises = False
            r.repair()
        r.run(damage_and_fail_warning, verify_then_repair)
        self.assertEqual(len(r.calls), 4)
        self.assertEqual(r.snapshots[1]['marker'], 'live metadata')
        self.assertTrue(r.snapshots[1]['_dirty'])
        self.assertEqual(json.loads(r.index.read_text())['marker'], 'live metadata')

    def test_cancellation_propagates_while_waiting(self):
        r = Rig()
        with self.assertRaises(asyncio.CancelledError):
            r.run(cancel=True)


try:
    program = unittest.main(exit=False)
finally:
    PRIVATE.cleanup()
sys.exit(0 if program.result.wasSuccessful() else 1)
