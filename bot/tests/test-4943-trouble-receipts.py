"""Actual failed-session watcher, local files and strict uncertain delivery states."""
import os
import sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401
import asyncio
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace as NS
import unittest

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
os.environ['GITHUB_TOKEN_FILE'] = ''
os.environ.pop('GITHUB_TOKEN', None)
PRIVATE = tempfile.TemporaryDirectory(prefix='tw4943-')
os.environ['THORNSWOOD_BOT_DATA'] = PRIVATE.name
import harness_bot  # noqa: E402
from staff_copy_fixture import Room  # noqa: E402
bot = harness_bot.whole()
REAL_WRITE = bot._state_write


class Channel(Room):
    def __init__(self, rig, cid):
        super().__init__(cid, serial=1000)
        self.rig, self.allowed = rig, True
        self.guild = NS(me=NS(id=50))

    def permissions_for(self, member):
        return NS(view_channel=True, read_message_history=True, send_messages=self.allowed,
                  send_messages_in_threads=self.allowed)

    async def send(self, text, **options):
        try:
            snapshot = self.rig.index()
        except ValueError:
            snapshot = None
        self.rig.before_send.append(snapshot)
        return await super().send(text, **options)


class Rig:
    def __init__(self):
        self.folder = Path(tempfile.mkdtemp(dir=PRIVATE.name))
        self.source, self.receipts = self.folder / 'trouble.json', self.folder / 'trouble-posts.json'
        self.a, self.b = Channel(self, 10), Channel(self, 20)
        self.current, self.before_send, self.logs = self.a, [], []
        self.put([])
        bot.TROUBLE_FILE, bot.TROUBLE_POSTS = str(self.source), str(self.receipts)
        bot._trouble_channel = lambda: self.current
        bot.log = lambda *parts: self.logs.append(' '.join(map(str, parts)))
        bot._COPY_NOTICES.clear()

    def row(self, sid='session-one'):
        return dict(session=sid, name='Private fixture person', why='Private fixture failure',
                    line='Private fixture log', channel='dev')

    def put(self, rows):
        self.source.write_text(json.dumps(rows), encoding='utf-8')

    def index(self):
        return json.loads(self.receipts.read_text(encoding='utf-8')) if self.receipts.exists() else {}

    def records(self):
        return self.index().get('posts', {})

    def run(self, *steps, fail_intent=False, fail_confirmed=False):
        pending, stopped = iter(steps), False

        async def ready():
            return None

        async def sleep(seconds):
            nonlocal stopped
            action = next(pending, None)
            if action is None:
                stopped = True
            else:
                action()

        def write(path, state):
            if str(path) == str(self.receipts):
                posts = state.get('posts', {})
                if fail_intent and any('attempt' in value for value in posts.values()):
                    raise OSError('fixture refused intent save')
                if fail_confirmed and any('message' in value for value in posts.values()):
                    raise OSError('fixture refused confirmed save')
            return REAL_WRITE(path, state)

        bot.client = NS(user=NS(id=50), wait_until_ready=ready, is_closed=lambda: stopped,
                        get_channel=lambda cid: {10: self.a, 20: self.b}.get(cid))
        bot.asyncio = NS(get_running_loop=asyncio.get_running_loop, sleep=sleep)
        bot._state_write = write
        try:
            asyncio.run(bot.watch_trouble())
        finally:
            bot._state_write = REAL_WRITE
            bot.asyncio = asyncio


class TroubleReceipts(unittest.TestCase):
    def test_known_permission_refusal_retries_without_acknowledging(self):
        rig = Rig()
        def arrive():
            rig.put([rig.row()]); rig.a.allowed = False; rig.a.mode = 'refused'
        def recover():
            self.assertNotIn('session-one', rig.records())
            rig.a.allowed = True; rig.a.mode = 'ok'
        rig.run(arrive, recover, lambda: None)
        self.assertEqual(len(rig.a.posts), 1)
        self.assertEqual(len(rig.a.attempts), 1)
        self.assertIn('message', rig.records()['session-one'])
        self.assertIn('attempt', rig.before_send[0]['posts']['session-one'])

    def test_intent_save_refusal_prevents_outbound(self):
        rig = Rig()
        rig.run(lambda: rig.put([rig.row()]), lambda: None, fail_intent=True)
        self.assertEqual(rig.a.attempts, [])
        self.assertNotIn('session-one', rig.records())

    def test_known_preflight_refusal_retries_after_restart(self):
        rig = Rig()
        def arrive():
            rig.put([rig.row()]); rig.a.allowed = False; rig.a.mode = 'refused'
        rig.run(arrive)
        self.assertEqual(rig.a.posts, {})
        rig.a.allowed = True; rig.a.mode = 'ok'; rig.run(lambda: None)
        self.assertEqual(len(rig.a.posts), 1)
        self.assertIn('message', rig.records()['session-one'])

    def test_admitted_alert_retries_intent_save_after_restart(self):
        rig = Rig(); rig.run(lambda: rig.put([rig.row()]), fail_intent=True)
        self.assertEqual(rig.a.attempts, [])
        rig.run(lambda: None)
        self.assertEqual(len(rig.a.posts), 1)
        self.assertIn('message', rig.records()['session-one'])

    def test_admission_without_delivery_expires_with_complete_source(self):
        rig = Rig(); rig.a.allowed = False
        rig.run(lambda: rig.put([rig.row()]))
        self.assertIn('session-one', rig.index().get('admitted', {}))
        rig.run(lambda: rig.put([]), lambda: None)
        self.assertNotIn('session-one', rig.index().get('admitted', {}))
        self.assertEqual(rig.a.attempts, [])

    def test_confirmed_save_failure_reconciles_after_restart_without_resend(self):
        rig = Rig()
        rig.run(lambda: rig.put([rig.row()]), fail_confirmed=True)
        self.assertEqual(len(rig.a.posts), 1)
        self.assertIn('attempt', rig.records()['session-one'])
        rig.run(lambda: None)
        self.assertEqual(len(rig.a.posts), 1)
        self.assertEqual(len(rig.a.attempts), 1)
        self.assertIn('message', rig.records()['session-one'])
        self.assertTrue(rig.index().get('backfilled'))

    def test_unknown_accepted_uses_captured_channel_then_expires(self):
        rig = Rig(); rig.a.mode = 'unknown-accepted'
        rig.run(lambda: rig.put([rig.row()]))
        self.assertIn('attempt', rig.records()['session-one'])
        rig.current = rig.b; rig.a.mode = 'ok'
        rig.run(lambda: rig.put([]), lambda: None)
        self.assertEqual(rig.b.attempts, [])
        self.assertEqual(rig.a.posts, {})
        self.assertEqual(rig.records(), {})
        self.assertEqual(len(rig.a.attempts), 1)

    def test_unknown_empty_is_pending_and_never_blindly_resent(self):
        rig = Rig(); rig.a.mode = 'unknown-empty'
        rig.run(lambda: rig.put([rig.row()]))
        self.assertIn('attempt', rig.records()['session-one'])
        rig.a.mode = 'ok'; rig.run(lambda: None, lambda: None)
        self.assertEqual(len(rig.a.attempts), 1)
        self.assertIn('attempt', rig.records()['session-one'])
        self.assertTrue(any('uncertain' in line or 'pending' in line for line in rig.logs))

    def test_pending_attempt_holds_newer_alerts_as_the_shared_protocol_requires(self):
        rig = Rig(); rig.a.mode = 'unknown-empty'
        rig.run(lambda: rig.put([rig.row()]))
        rig.a.mode = 'ok'
        rig.run(lambda: rig.put([rig.row(), rig.row('session-two')]), lambda: None)
        self.assertEqual(len(rig.a.attempts), 1)
        self.assertIn('attempt', rig.records()['session-one'])
        self.assertNotIn('session-two', rig.records())

    def test_corrupt_index_pauses_private_delivery_without_overwrite(self):
        for malformed in ['{', '[]', 'null', '5', json.dumps(dict(admitted=[]))]:
            with self.subTest(malformed=malformed):
                rig = Rig(); rig.receipts.write_text(malformed, encoding='utf-8')
                old = rig.a.add(bot.TROUBLE_HEAD + ' Preserve until the index can be read.')
                rig.run(lambda: rig.put([rig.row()]), lambda: None)
                self.assertEqual(rig.receipts.read_text(encoding='utf-8'), malformed)
                self.assertFalse(any('Private fixture' in text for text in rig.a.posts.values()))
                self.assertIn(old.id, rig.a.posts)
                self.assertEqual(rig.a.deleted, [])

    def test_malformed_source_cannot_prove_expiry(self):
        rig = Rig(); rig.run(lambda: rig.put([rig.row()]))
        self.assertEqual(len(rig.a.posts), 1)
        before = rig.receipts.read_bytes(); rig.put([None]); rig.run(lambda: None)
        self.assertEqual(len(rig.a.posts), 1)
        self.assertEqual(rig.receipts.read_bytes(), before)

    def test_healthy_existing_startup_rows_remain_suppressed(self):
        rig = Rig(); rig.put([rig.row()]); rig.run(lambda: None)
        self.assertEqual(rig.a.posts, {})
        self.assertEqual(rig.a.attempts, [])

    def test_malformed_startup_recovers_without_killing_watcher(self):
        rig = Rig(); rig.put([dict(session=['invalid'])])
        rig.run(lambda: rig.put([rig.row()]), lambda: None)
        self.assertEqual(len(rig.a.posts), 1)
        self.assertIn('message', rig.records()['session-one'])

    def test_pending_marker_requires_bot_author_and_preserves_original_channel(self):
        rig = Rig(); rig.a.mode = 'unknown-empty'
        rig.run(lambda: rig.put([rig.row()]))
        marked = rig.a.attempts[0]
        wrong = rig.a.add(marked, author=999)
        rig.current = rig.b; rig.a.mode = 'ok'; rig.run(lambda: None)
        self.assertIn('attempt', rig.records()['session-one'])
        right = rig.a.add(marked, author=50); rig.run(lambda: None)
        self.assertEqual(rig.records()['session-one'], dict(channel=rig.a.id, message=right.id))
        self.assertIn(wrong.id, rig.a.posts)
        self.assertEqual(rig.b.attempts, [])
        self.assertEqual(len(rig.a.attempts), 1)

    def test_legacy_receipt_survives_then_expires_with_its_row(self):
        rig = Rig(); msg = rig.b.add('existing legacy failed-session post')
        state = dict(backfilled=True, posts={'legacy': dict(channel=rig.b.id, message=msg.id)})
        REAL_WRITE(str(rig.receipts), state); rig.put([rig.row('legacy')]); rig.run(lambda: None)
        self.assertEqual(rig.index(), state)
        self.assertIn(msg.id, rig.b.posts)
        self.assertEqual(rig.a.attempts, [])
        rig.run(lambda: rig.put([]), lambda: None)
        self.assertEqual(rig.records(), {})
        self.assertTrue(rig.index()['backfilled'])
        self.assertEqual(rig.b.posts, {})

    def test_failure_diagnostics_never_copy_private_source_text(self):
        for mode in ['unknown-empty', 'unknown-accepted']:
            rig = Rig(); rig.a.mode = mode
            rig.run(lambda: rig.put([rig.row()]), lambda: None)
            self.assertFalse(any('Private fixture' in line for line in rig.logs))

    def test_strict_send_redacts_private_sdk_error_details(self):
        rig = Rig()
        async def refused(text, **options):
            raise TimeoutError('SDK error echoing Private fixture log')
        rig.a.send = refused
        rig.run(lambda: rig.put([rig.row()]), lambda: None)
        self.assertIn('attempt', rig.records()['session-one'])
        self.assertTrue(any('TimeoutError' in line for line in rig.logs))
        self.assertFalse(any('Private fixture log' in line for line in rig.logs))


if __name__ == '__main__':
    unittest.main()
