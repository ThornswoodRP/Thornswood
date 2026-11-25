"""Use the real welcome and deletion paths with a stand-in channel and files."""
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)

import asyncio
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

os.environ['DISCORD_TOKEN'] = 'not-a-real-token'

import discord
import bot_deletion
import bot_joins
import bot_tickets


class WelcomeRetention(unittest.TestCase):
    def test_expiry_and_deletion_request(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.run_scenario(root)

    def run_scenario(self, root):
        joins = root / 'joins.json'
        request = root / 'deletion-requests.json'
        cards = root / 'welcome-posts.json'
        deleted = []
        posts = {99: 'unrelated'}
        attempts = []
        room = SimpleNamespace(id=12)
        ids = iter((21, 22, 23, 24))

        async def send(text, **kw):
            mid = next(ids)
            posts[mid] = text
            return SimpleNamespace(id=mid, channel=room)

        def partial(mid):
            async def delete():
                attempts.append(mid)
                if mid not in posts:
                    raise discord.NotFound(SimpleNamespace(status=404, reason='Not found'), 'gone')
                del posts[mid]
                deleted.append(mid)
            return SimpleNamespace(delete=delete)

        room.send = send
        room.get_partial_message = partial
        guild = SimpleNamespace(id=1, name='Fixture', member_count=50, chunked=True)
        avatar = SimpleNamespace(read=AsyncMock(return_value=b'image'))
        avatar.replace = lambda **kw: avatar
        first, second, third = [SimpleNamespace(id=n, guild=guild, display_name='Fixture',
                                               name='fixture', mention='Fixture', display_avatar=avatar)
                                for n in (100000000000000001, 100000000000000002, 100000000000000003)]
        guild.members = [first, second, third]
        client = SimpleNamespace(guilds=[guild], wait_until_ready=AsyncMock(),
                                 get_channel=lambda cid: room if cid == room.id else None)
        client.is_closed = lambda: False

        class Done(Exception):
            pass

        async def stop(_):
            raise Done

        def sweep():
            with self.assertRaises(Done):
                asyncio.run(bot_joins.watch_join_numbers())

        with patch.object(bot_joins, 'JOINS', str(joins)), \
                patch.object(bot_joins, 'WELCOME_POSTS', str(cards), create=True), \
                patch.object(bot_joins, 'DATA_DIR', str(root)), \
                patch.object(bot_joins, 'client', client), \
                patch.object(bot_joins, 'by_name', return_value=room), \
                patch.object(bot_joins.card, 'render', side_effect=lambda *a: io.BytesIO(b'card')), \
                patch.object(bot_joins, 'asyncio', SimpleNamespace(
                    sleep=stop, get_running_loop=asyncio.get_running_loop)), \
                patch.object(bot_deletion, 'DELETION_REQUESTS', str(request)), \
                patch.object(bot_tickets, 'OPEN_TICKETS', str(root / 'tickets.json')):
            for member in (first, first, second, third):
                asyncio.run(bot_joins.on_member_join(member))
            self.assertEqual(set(posts), {99, 21, 22, 23, 24})
            guild.members = [second, third]
            rec = json.loads(joins.read_text())
            rec['1']['left'] = {str(first.id): 1}
            joins.write_text(json.dumps(rec))
            del posts[22]  # An earlier moderator removal is already complete.
            sweep()
            self.assertEqual(set(posts), {99, 23, 24})
            self.assertNotIn(str(first.id), json.loads(joins.read_text())['1']['members'])
            self.assertCountEqual(attempts, [21, 22])
            request.write_text(json.dumps({'people': [{'discordId': str(second.id)}]}))
            bot_deletion.apply_deletion_requests()
            self.assertFalse(request.exists())
            self.assertEqual(set(posts), {99, 23, 24})  # Startup has no Discord connection.
            sweep()
            sweep()
            self.assertEqual(set(posts), {99, 24})
            self.assertCountEqual(attempts, [21, 22, 23])
            self.assertCountEqual(deleted, [21, 23])
            self.assertIn(str(third.id), json.loads(joins.read_text())['1']['members'])


if __name__ == '__main__':
    unittest.main()
