"""Exercise the real status watcher without Discord, HTTP or a wall clock."""
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401

import asyncio
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import harness_bot


class StatusLines(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data = cls.enterClassContext(tempfile.TemporaryDirectory())
        cls.enterClassContext(patch.dict(os.environ, {
            'DISCORD_TOKEN': 'not-a-real-token', 'THORNSWOOD_BOT_DATA': data,
        }))
        harness_bot.whole()
        cls.panels = sys.modules['bot_ticket_panels']

    def test_alternates_in_order_and_keeps_the_longer_tail(self):
        self.assertEqual(self.panels.status_lines({
            'hints': ['First hint.', 'Second hint.', 'Third hint.'],
            'lore': [{'text': 'First quote.', 'from': 'A book'}, {'text': 'Second quote.'}],
        }), ['First hint.', 'First quote.', 'Second hint.', 'Second quote.', 'Third hint.'])
        self.assertEqual(self.panels.status_lines({
            'hints': ['One hint.'], 'lore': [{'text': 'One quote.'}, {'text': 'Another quote.'}],
        }), ['One hint.', 'One quote.', 'Another quote.'])

    def test_filters_invalid_entries_before_alternating(self):
        self.assertEqual(self.panels.status_lines({
            'hints': ['', 7, 'A hint.', None, 'Another hint.'],
            'lore': ['not a quote', {'from': 'A book'}, {'text': 8}, {'text': ''}, {'text': 'A quote.'}],
        }), ['A hint.', 'A quote.', 'Another hint.'])
        for payload in (None, [], {}, {'hints': None, 'lore': None}):
            with self.subTest(payload=payload):
                self.assertEqual(self.panels.status_lines(payload), [])

    def test_watcher_wraps_and_waits_fifteen_minutes_each_turn(self):
        self.assertEqual(self.panels.LINES_EVERY, 900)
        events = []
        turns = iter([True, True, False, True, True])
        sleeps = []

        def site_lines():
            events.append('fetch')
            return self.panels.status_lines({
                'hints': ['A hint.'], 'lore': [{'text': 'A quote.'}],
            } if next(turns) else None)

        async def ready():
            events.append('ready')

        async def change_presence(*, activity):
            events.append(activity.name)

        async def sleep(seconds):
            sleeps.append(seconds)
            events.append('sleep')

        client = SimpleNamespace(wait_until_ready=ready, change_presence=change_presence,
                                 is_closed=lambda: len(sleeps) >= 5)
        clock = SimpleNamespace(sleep=sleep, get_running_loop=asyncio.get_running_loop)
        with patch.multiple(self.panels, client=client, asyncio=clock, site_lines=site_lines,
                            log=lambda *args: events.append('log')):
            asyncio.run(self.panels.watch_lines())

        self.assertEqual(sleeps, [900] * 5)
        self.assertEqual(events, ['ready', 'fetch', 'A hint.', 'sleep', 'fetch', 'A quote.', 'sleep',
                                  'fetch', 'log', 'sleep', 'fetch', 'A hint.', 'sleep',
                                  'fetch', 'A quote.', 'sleep'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
