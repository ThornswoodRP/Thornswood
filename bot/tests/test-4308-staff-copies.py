"""Drive the two staff-copy watchers with local stores and a stand-in Discord."""
import os
import sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401
import asyncio
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch



class Room:
    id = 42
    name = 'staff'

    def __init__(self):
        self.posts = {1: 'untracked notice'}
        self.next = 2

    async def send(self, text, **options):
        mid = self.next
        self.next += 1
        self.posts[mid] = text
        return SimpleNamespace(id=mid, channel=self)

    def get_partial_message(self, mid):
        async def delete():
            del self.posts[mid]
        return SimpleNamespace(delete=delete)


class Copies(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.folder = Path(scratch.name)
        env = patch.dict(os.environ, DISCORD_TOKEN='not-a-real-token',
                         THORNSWOOD_BOT_DATA=scratch.name)
        env.start()
        self.addCleanup(env.stop)
        import bot_reports
        import bot_moderation
        self.reports = bot_reports
        self.moderation = bot_moderation
        self.room = Room()

    def run_watch(self, mod, watch, *steps):
        pending = iter(steps)
        stopped = False

        async def sleep(_):
            nonlocal stopped
            step = next(pending, None)
            if step is None:
                stopped = True
            else:
                step()

        async def ready():
            return None

        client = SimpleNamespace(wait_until_ready=ready, is_closed=lambda: stopped,
                                 get_channel=lambda cid: self.room if cid == self.room.id else None)
        shim = SimpleNamespace(get_running_loop=asyncio.get_running_loop, sleep=sleep)
        with patch.object(mod, 'client', client), patch.object(mod, 'asyncio', shim), \
                patch.object(self.reports, '_trouble_channel', lambda: self.room):
            asyncio.run(watch())

    def test_report_deletion_after_restart(self):
        source = self.folder / 'inbox.json'
        records = [{'id': 'one', 'kind': 'help', 'title': 'Help at the ferry'},
                   {'id': 'two', 'kind': 'report', 'title': 'Kept report'}]
        def put(rows):
            source.write_text(json.dumps(rows), encoding='utf-8')
        put([])
        with patch.object(self.reports, 'REPORTS_FILE', str(source)), \
                patch.object(self.reports, 'REPORT_POSTS', str(self.folder / 'report-posts.json'), create=True):
            self.run_watch(self.reports, self.reports.watch_reports, lambda: put(records))
            self.assertEqual(set(self.room.posts), {1, 2, 3})
            # Start with a good snapshot, then encounter a malformed one.
            def broken():
                source.write_text('{', encoding='utf-8')
            self.run_watch(self.reports, self.reports.watch_reports, broken)
            self.assertEqual(set(self.room.posts), {1, 2, 3})
            put(records[1:])
            self.run_watch(self.reports, self.reports.watch_reports)
            self.assertEqual(set(self.room.posts), {1, 2})
            self.assertIn('Kept report', self.room.posts[2])

    def test_bad_report_index_leaves_details_in_the_inbox(self):
        source = self.folder / 'inbox.json'
        index = self.folder / 'report-posts.json'
        source.write_text('[]', encoding='utf-8')
        index.write_text('[]', encoding='utf-8')

        def add_report():
            source.write_text(json.dumps([
                {'id': 'one', 'kind': 'report', 'title': 'Private report detail'},
            ]), encoding='utf-8')

        with patch.object(self.reports, 'REPORTS_FILE', str(source)), \
                patch.object(self.reports, 'REPORT_POSTS', str(index)):
            self.run_watch(self.reports, self.reports.watch_reports, add_report)
        self.assertEqual(set(self.room.posts), {1, 2})
        self.assertIn('1 report', self.room.posts[2])
        self.assertNotIn('Private report detail', self.room.posts[2])
        self.assertEqual(index.read_text(encoding='utf-8'), '[]')

    def test_bad_moderation_index_reports_a_count_without_details(self):
        source = self.folder / 'moderation.log'
        index = self.folder / 'moderation-posts.json'
        source.write_text('', encoding='utf-8')
        index.write_text('{', encoding='utf-8')

        def add_action():
            action = dict(at='2026-02-01T00:00:00Z', did='kick', by=1, who=2,
                          why='Private moderation detail')
            source.write_text(json.dumps(action) + '\n', encoding='utf-8')

        with patch.object(self.moderation, 'MODERATION_LOGS', [('live', str(source))]), \
                patch.object(self.moderation, 'MODERATION_POSTS', str(index)):
            self.run_watch(self.moderation, self.moderation.watch_moderation, add_action)
        self.assertEqual(set(self.room.posts), {1, 2})
        self.assertIn('1 staff action', self.room.posts[2])
        self.assertNotIn('Private moderation detail', self.room.posts[2])
        self.assertEqual(index.read_text(encoding='utf-8'), '{')

    def test_moderation_expiry_after_restart(self):
        live = self.folder / 'live.log'
        dev = self.folder / 'dev.log'
        line = json.dumps(dict(at='2026-02-01T00:00:00Z', did='kick',
                               by=1, who=2, why='Routine review')) + '\n'
        live.write_text('', encoding='utf-8')
        dev.write_text('', encoding='utf-8')
        def add():
            live.write_text(line, encoding='utf-8')
            dev.write_text(line, encoding='utf-8')
        with patch.object(self.moderation, 'MODERATION_LOGS', [('live', str(live)), ('dev', str(dev))]), \
                patch.object(self.moderation, 'MODERATION_POSTS', str(self.folder / 'moderation-posts.json'), create=True):
            self.run_watch(self.moderation, self.moderation.watch_moderation, add)
            self.assertEqual(set(self.room.posts), {1, 2, 3})
            # A missing source is not proof that retention removed a row.
            live.unlink()
            self.run_watch(self.moderation, self.moderation.watch_moderation)
            self.assertEqual(set(self.room.posts), {1, 2, 3})
            live.write_text('', encoding='utf-8')
            self.run_watch(self.moderation, self.moderation.watch_moderation)
            self.assertEqual(set(self.room.posts), {1, 3})
            self.assertIn('dev server', self.room.posts[3])


if __name__ == '__main__':
    unittest.main()
