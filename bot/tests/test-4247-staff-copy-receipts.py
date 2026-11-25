"""Actual staff-copy watchers, local files and strict Discord delivery states.

No live Discord or report writes. Pending delivery is not an acknowledgment;
unknown network outcomes can only be reconciled, never blindly retried.
"""
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
PRIVATE = tempfile.TemporaryDirectory(prefix='tw4247-')
os.environ['THORNSWOOD_BOT_DATA'] = PRIVATE.name
import discord  # noqa: E402
import harness_bot  # noqa: E402
bot = harness_bot.whole()
REAL_WRITE = bot._state_write


from staff_copy_fixture import Room


class Channel(Room):
    def __init__(self, rig, cid):
        super().__init__(cid, serial=1000)
        self.rig = rig

    async def send(self, text, **kw):
        self.rig.before_send.append(self.rig.index())
        return await super().send(text, **kw)


class Rig:
    def __init__(self, mode):
        self.mode = mode
        self.folder = Path(tempfile.mkdtemp(dir=PRIVATE.name))
        self.source, self.receipts = self.folder / 'source', self.folder / 'receipts.json'
        self.a, self.b = Channel(self, 10), Channel(self, 20)
        self.current, self.before_send, self.logs = self.a, [], []
        self.put([])
        bot.log = lambda *parts: self.logs.append(' '.join(map(str, parts)))
        bot.REPORTS_FILE = str(self.source)
        bot.REPORT_POSTS = str(self.receipts)
        bot.MODERATION_LOGS = [('live', str(self.source))]
        bot.MODERATION_POSTS = str(self.receipts)
        bot.REPORTS_AT_ONCE = 2
        bot.MODERATION_AT_ONCE = 2
        bot._trouble_channel = lambda: self.current
        self.source_key = bot.source_key('reports' if mode == 'reports' else 'live', str(self.source))

    def row(self, rid):
        if self.mode == 'reports':
            return dict(id=str(rid), kind='help', title='Private fixture ' + str(rid), by='Fixture')
        return dict(at=str(rid), did='kick', by=1, byName='Keeper', who=2,
                    whoName='Fixture', why='Private fixture ' + str(rid))

    def put(self, rows):
        self.source.write_text(json.dumps(rows) if self.mode == 'reports' else
                               ''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')

    def index(self):
        return json.loads(self.receipts.read_text(encoding='utf-8')) if self.receipts.exists() else {}

    def records(self):
        return self.index().get(self.source_key, {})

    def text(self, row):
        return bot.report_text(row) if self.mode == 'reports' else bot.moderation_text('live', row)

    def run(self, *steps, fail_confirmed_save=False, fail_any_save=False):
        pending = iter(steps)
        stopped = False
        async def ready():
            return None
        async def sleep(seconds):
            nonlocal stopped
            action = next(pending, None)
            if action is None:
                stopped = True
            else:
                action()
        bot.client = NS(user=NS(id=50), wait_until_ready=ready, is_closed=lambda: stopped,
                        get_channel=lambda cid: {10: self.a, 20: self.b}.get(cid))
        bot.asyncio = NS(get_running_loop=asyncio.get_running_loop, sleep=sleep)
        def write(path, state):
            if fail_any_save:
                raise OSError('fixture refuses pending intent save')
            if fail_confirmed_save and any('message' in record for records in state.values()
                                           for record in records.values()):
                raise OSError('fixture refuses the confirmed receipt save')
            REAL_WRITE(path, state)
        bot._state_write = write
        try:
            asyncio.run(bot.watch_reports() if self.mode == 'reports' else bot.watch_moderation())
        finally:
            bot._state_write, bot.asyncio = REAL_WRITE, asyncio


class Copies(unittest.TestCase):
    def each(self):
        yield Rig('reports')
        yield Rig('moderation')

    def test_offline_backlog_and_confirmed_restart(self):
        for r in self.each():
            with self.subTest(r.mode):
                r.put([r.row('offline')])
                r.run()
                self.assertEqual(len(r.a.messages), 1)
                self.assertTrue(all('attempt' in record and 'message' not in record
                                    for records in r.before_send[0].values() for record in records.values()))
                self.assertEqual(len(r.records()), 1)
                self.assertTrue(all(record.get('message') for record in r.records().values()))
                r.run()
                self.assertEqual(len(r.a.attempts), 1)

    def test_missing_permissions_and_absent_channel_retry_later(self):
        for r in self.each():
            with self.subTest(r.mode):
                r.put([r.row('refused')])
                r.a.guild = NS(me=NS(id=50))
                permissions = NS(view_channel=True, send_messages=False, read_message_history=True)
                r.a.permissions_for = lambda _: permissions
                r.run()
                self.assertFalse(r.a.attempts)
                self.assertFalse(r.records())
                self.assertTrue(r.logs)
                permissions.send_messages = True
                permissions.read_message_history = False
                r.run()
                self.assertFalse(r.a.attempts)
                self.assertFalse(r.records())
                permissions.read_message_history = True
                r.current = None
                r.run()
                self.assertFalse(r.records())
                r.current = r.a
                r.run()
                self.assertEqual(len(r.a.attempts), 1)
                self.assertEqual(len(r.a.messages), 1)

    def test_final_403_cannot_rule_out_acceptance_on_a_client_retry(self):
        for r in self.each():
            with self.subTest(r.mode):
                r.put([r.row('accepted-before-403')])
                original_send = r.a.send

                async def accepted_then_forbidden(text, **options):
                    await original_send(text, **options)
                    raise discord.Forbidden(NS(status=403, reason='Forbidden'),
                                            {'code': 50013, 'message': 'Missing Permissions'})

                r.a.send = accepted_then_forbidden
                r.run()
                self.assertEqual(len(r.a.messages), 1)
                self.assertTrue(r.records())
                self.assertTrue(all('attempt' in record for record in r.records().values()))
                r.a.send = original_send
                r.run()
                self.assertEqual(len(r.a.attempts), 1)
                self.assertTrue(all(record['message'] in r.a.messages for record in r.records().values()))

    def test_final_403_without_a_found_message_stays_pending(self):
        for r in self.each():
            with self.subTest(r.mode):
                r.put([r.row('403-no-copy')])
                r.a.mode = 'refused'
                r.run()
                self.assertTrue(r.records())
                self.assertTrue(all('attempt' in record for record in r.records().values()))
                r.a.mode = 'ok'
                r.run()
                self.assertEqual(len(r.a.attempts), 1)
                self.assertFalse(r.a.messages)

    def test_accepted_then_save_refused_reconciles_after_restart(self):
        for r in self.each():
            with self.subTest(r.mode):
                r.put([r.row('save-refused')])
                r.run(fail_confirmed_save=True)
                self.assertEqual(len(r.a.messages), 1)
                self.assertTrue(r.records())
                self.assertTrue(all('attempt' in record and 'message' not in record for record in r.records().values()))
                r.current = r.b
                r.run()
                self.assertEqual(len(r.a.attempts), 1)
                self.assertFalse(r.b.attempts)
                self.assertTrue(all(record.get('channel') == 10 and record.get('message') for record in r.records().values()))

    def test_unknown_network_never_blindly_reposts(self):
        for r in self.each():
            with self.subTest(r.mode):
                r.put([r.row('unknown')])
                r.a.mode = 'unknown-empty'
                r.run(lambda: None, lambda: None)
                self.assertEqual(len(r.a.attempts), 1)
                self.assertTrue(r.records())
                self.assertFalse(any(record.get('message') for record in r.records().values()))
                r.a.mode = 'ok'
                r.run()
                self.assertEqual(len(r.a.attempts), 1)
                # A foreign author and a bot message with another reference cannot acknowledge it.
                sent = r.a.attempts[0]
                r.a.add(sent, author=99)
                r.a.add(sent + 'different marker')
                r.run()
                self.assertFalse(any(record.get('message') for record in r.records().values()))
                # Empty or forbidden history is never evidence that nothing was posted.
                r.a.history_forbidden = True
                r.run()
                self.assertEqual(len(r.a.attempts), 1)
                self.assertFalse(any(record.get('message') for record in r.records().values()))
                r.a.history_forbidden = False
                accepted = r.a.add(sent)
                r.run()
                self.assertEqual(len(r.a.attempts), 1)
                self.assertTrue(all(record.get('message') == accepted.id for record in r.records().values()))

    def test_network_lost_after_acceptance(self):
        for r in self.each():
            with self.subTest(r.mode):
                r.put([r.row('accepted')])
                r.a.mode = 'unknown-accepted'
                r.run()
                self.assertEqual(len(r.a.attempts), 1)
                self.assertTrue(all('attempt' in record for record in r.records().values()))
                r.a.mode = 'ok'
                r.run()
                self.assertEqual(len(r.a.attempts), 1)
                self.assertTrue(all(record.get('message') for record in r.records().values()))

    def test_identical_old_content_is_not_a_receipt(self):
        for r in self.each():
            with self.subTest(r.mode):
                row = r.row('same')
                original = r.a.add(r.text(row))
                r.put([row])
                r.run()
                self.assertEqual(len(r.a.messages), 2)
                self.assertTrue(all(record.get('message') != original.id for record in r.records().values()))

    def test_summary_partial_and_complete_source_expiry(self):
        for r in self.each():
            with self.subTest(r.mode):
                rows = [r.row(str(i)) for i in range(3)]
                r.put(rows)
                r.run()
                self.assertEqual(len(r.a.messages), 1)
                self.assertEqual(len(r.records()), 3)
                self.assertEqual(len({record['message'] for record in r.records().values()}), 1)
                r.put(rows[1:])
                r.run()
                self.assertEqual(len(r.a.messages), 1)
                self.assertEqual(len(r.records()), 2)
                r.put([])
                r.run()
                self.assertFalse(r.a.messages)
                self.assertFalse(r.records())
                self.assertEqual(len(r.a.deleted), 1)

    def test_expired_source_of_accepted_unsaved_post_is_cleaned(self):
        for r in self.each():
            with self.subTest(r.mode):
                r.put([r.row('expired')])
                r.run(fail_confirmed_save=True)
                self.assertEqual(len(r.a.messages), 1)
                r.put([])
                r.run()
                self.assertFalse(r.a.messages)
                self.assertFalse(r.records())
                self.assertEqual(len(r.a.attempts), 1)

    def test_duplicate_source_identity_is_delivered_only_once(self):
        for r in self.each():
            with self.subTest(r.mode):
                row = r.row('duplicate')
                r.put([row, row])
                r.run()
                self.assertEqual(len(r.a.messages), 1)
                self.assertEqual(len(r.a.attempts), 1)
                self.assertEqual(len(r.records()), 1)

    def test_pending_save_refusal_prevents_any_outbound(self):
        for r in self.each():
            with self.subTest(r.mode):
                r.put([r.row('no-intent-save')])
                r.run(fail_any_save=True)
                self.assertFalse(r.a.attempts)
                self.assertFalse(r.receipts.exists())
                self.assertTrue(any('pending intent save' in line for line in r.logs))

    def test_bounded_history_page_never_causes_resend(self):
        for r in self.each():
            with self.subTest(r.mode):
                r.put([r.row('bounded')])
                r.a.mode = 'unknown-empty'
                r.run()
                self.assertEqual(len(r.a.attempts), 1)
                for i in range(bot.COPY_HISTORY_PAGE + 1):
                    r.a.add('Unrelated history ' + str(i))
                accepted = r.a.add(r.a.attempts[0])
                r.run()
                self.assertFalse(any(record.get('message') for record in r.records().values()))
                self.assertEqual(len(r.a.attempts), 1)
                r.run()
                self.assertTrue(all(record.get('message') == accepted.id for record in r.records().values()))
                self.assertEqual(len(r.a.attempts), 1)

    def test_unreadable_or_incomplete_source_cannot_delete_receipts(self):
        for r in self.each():
            with self.subTest(r.mode):
                row = r.row('retained')
                r.put([row])
                r.run()
                before = r.index()
                if r.mode == 'reports':
                    # The already-running watcher encounters a partial JSON write.
                    r.run(lambda: r.source.write_text('{', encoding='utf-8'))
                else:
                    r.source.write_text(json.dumps(row)[:10], encoding='utf-8')
                    r.run()
                self.assertEqual(r.index(), before)
                self.assertEqual(len(r.a.messages), 1)
                self.assertFalse(r.a.deleted)

    def test_same_action_in_separate_server_sources_has_separate_receipts(self):
        r = Rig('moderation')
        row = r.row('both')
        r.put([row])
        other = r.folder / 'dev-source'
        other.write_text(json.dumps(row) + '\n', encoding='utf-8')
        bot.MODERATION_LOGS = [('live', str(r.source)), ('dev', str(other))]
        r.run()
        self.assertEqual(len(r.a.messages), 2)
        self.assertEqual(len(r.index()), 2)
        r.run()
        self.assertEqual(len(r.a.attempts), 2)

    def test_fully_terminated_corrupt_action_log_cannot_prove_expiry(self):
        for damaged in [b'not JSON\n', b'[]\n', b'\xff\n']:
            with self.subTest(damaged):
                r = Rig('moderation')
                row = r.row('corrupt-source')
                r.put([row])
                r.run()
                before = r.index()
                r.source.write_bytes(damaged)
                r.run()
                self.assertEqual(r.index(), before)
                self.assertEqual(len(r.a.messages), 1)
                self.assertFalse(r.a.deleted)
                self.assertTrue(any('cannot read' in line or 'corrupt' in line for line in r.logs))
                r.put([row])
                r.run()
                self.assertEqual(len(r.a.attempts), 1)
                r.put([])
                r.run()
                self.assertFalse(r.a.messages)
                self.assertFalse(r.records())

    def test_corrupt_receipt_index_never_publishes_details(self):
        for r in self.each():
            with self.subTest(r.mode):
                r.receipts.write_text('{', encoding='utf-8')
                r.put([r.row('private-secret')])
                r.run()
                self.assertEqual(r.receipts.read_text(encoding='utf-8'), '{')
                self.assertTrue(r.logs)
                self.assertFalse(any('private-secret' in text for text in r.a.attempts))


try:
    program = unittest.main(exit=False)
finally:
    PRIVATE.cleanup()

sys.exit(0 if program.result.wasSuccessful() else 1)
