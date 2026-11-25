"""Local Discord messages, returned receipts and bounded channel history."""
from types import SimpleNamespace as NS
import discord


class Message:
    def __init__(self, channel, mid, content, author=50):
        self.channel, self.id, self.content = channel, mid, content
        self.author = NS(id=author)

    async def delete(self):
        self.channel.deleted.append(self.id)
        self.channel.messages.pop(self.id, None)


class Room:
    name = 'staff-fixture'

    def __init__(self, cid=42, serial=0):
        self.id, self.serial = cid, serial
        self.messages, self.deleted, self.attempts = {}, [], []
        self.mode, self.history_forbidden = 'ok', False

    @property
    def posts(self):
        return {mid: message.content for mid, message in self.messages.items()}

    def add(self, content, author=50):
        self.serial += 1
        message = Message(self, self.serial, content, author)
        self.messages[message.id] = message
        return message

    async def send(self, text, **options):
        self.attempts.append(text)
        if self.mode == 'refused':
            raise discord.Forbidden(NS(status=403, reason='Forbidden'),
                                    {'code': 50013, 'message': 'Missing Permissions'})
        if self.mode == 'unknown-empty':
            raise TimeoutError('fixture cannot prove whether Discord accepted')
        message = self.add(text)
        if self.mode == 'unknown-accepted':
            raise TimeoutError('fixture accepted the post then lost the response')
        return message

    async def history(self, *, limit, after=None, oldest_first=False):
        if self.history_forbidden:
            raise discord.Forbidden(NS(status=403, reason='Forbidden'),
                                    {'code': 50013, 'message': 'Missing History'})
        rows = sorted(self.messages.values(), key=lambda message: message.id,
                      reverse=not oldest_first)
        if after is not None:
            rows = [message for message in rows if message.id > after.id]
        for message in rows[:limit]:
            yield message

    def get_partial_message(self, mid):
        message = self.messages.get(mid)
        if message is not None:
            return message
        class Gone:
            async def delete(self):
                raise discord.NotFound(NS(status=404, reason='Gone'),
                                       {'code': 10008, 'message': 'Unknown Message'})
        return Gone()
