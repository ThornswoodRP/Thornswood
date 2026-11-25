"""Run the real ready handler and CLI with an offline Discord client."""
import ast
import asyncio
from contextlib import redirect_stderr, redirect_stdout
import io
from pathlib import Path
import types
import unittest
from unittest.mock import AsyncMock

SOURCE = Path(__file__).resolve().parents[1] / 'bot' / 'Build-Discord.py'
TREE = ast.parse(SOURCE.read_text(encoding='utf-8-sig'), filename=str(SOURCE))
READY = next(n for n in TREE.body if isinstance(n, ast.AsyncFunctionDef)
             and n.name == 'on_ready')
CLI = TREE.body[-1]
CODE = compile(ast.Module(body=[READY, CLI], type_ignores=[]), str(SOURCE), 'exec')


class OfflineClient:
    def __init__(self, count, ready):
        self.guilds = [types.SimpleNamespace(id=i, name=f'Stand-in {i}',
                       channels=[], features=[]) for i in range(count)]
        self.close = AsyncMock()
        self.ready = ready

    def event(self, callback):
        self.on_ready = callback
        return callback

    def run(self, _token, *, log_handler):
        if self.ready:
            asyncio.run(self.on_ready())


class ExitContract(unittest.TestCase):
    def scenario(self, count=1, *, stopped=False, failed=False, audit=False,
                 check=False, roles_only=False, only=(), give=(), ready=True):
        client = OfflineClient(count, ready)
        async def settings(_guild, _found):
            if failed:
                state['failed'].append('stand-in step refused')
        ensure_roles = AsyncMock(side_effect=RuntimeError('stand-in stop') if stopped else None)
        read_audit = AsyncMock(side_effect=lambda _guild: print('DIFFERS: stand-in drift'))
        state = dict(__name__='__main__', sys=__import__('sys'), client=client,
                     discord=types.SimpleNamespace(CategoryChannel=type('Category', (), {}),
                         utils=types.SimpleNamespace(get=lambda _items, **_kw: None),
                         LoginFailure=type('LoginFailure', (Exception,), {}),
                         PrivilegedIntentsRequired=type('IntentsRequired', (Exception,), {})),
                     GUILD='', TOKEN=object(), AUDIT=audit, CHECK=check, GIVE=give, STAFF=['Staff'],
                     ROLES_ONLY=roles_only, ONLY=only, PRUNE=False, PLAN=[], KEEP=[], RETIRED=[],
                     RETIRED_CATEGORIES=[], made=[], kept=[], failed=[], check_docs=lambda: [],
                     plan_for=lambda _: [], audit=read_audit, ensure_roles=ensure_roles,
                     give=AsyncMock(),
                     say=lambda *_: None, onboarding_on=AsyncMock(return_value=False),
                     apply_welcome_and_afk=AsyncMock(side_effect=settings))
        if give and failed:
            async def refuse_rank(_guild):
                state['failed'].append('stand-in rank refused')
            state['give'].side_effect = refuse_rank
        if roles_only and failed:
            async def refuse_role(_guild):
                state['failed'].append('stand-in role refused')
            ensure_roles.side_effect = refuse_role
        for name in ('keep_onboarding_off', 'keep_onboarding_channels', 'keep_welcome_screen',
                     'tell_server_guide', 'keep_order', 'write_posts', 'apply_notice_channels'):
            state[name] = AsyncMock()
        out = io.StringIO()
        code = 0
        with redirect_stdout(out), redirect_stderr(out):
            try:
                exec(CODE, state)
            except SystemExit as end:
                code = end.code
        if ready:
            client.close.assert_awaited()
        if audit:
            read_audit.assert_awaited_once()
            ensure_roles.assert_not_awaited()
        return code, out.getvalue()

    def test_exception_stops_build(self):
        code, log = self.scenario(stopped=True)
        self.assertIn('stand-in stop', log)
        self.assertEqual(code, 1)

    def test_ambiguous_server_stops_build(self):
        code, log = self.scenario(count=2)
        self.assertIn('Say which', log)
        self.assertEqual(code, 1)

    def test_failed_step_fails_build(self):
        code, log = self.scenario(failed=True)
        self.assertIn('stand-in step refused', log)
        self.assertEqual(code, 1)

    def test_failed_roles_only_step_fails_build(self):
        self.assertEqual(self.scenario(failed=True, roles_only=True)[0], 1)

    def test_no_ready_event_is_not_success(self):
        self.assertEqual(self.scenario(ready=False)[0], 1)

    def test_clean_runs_exit_zero(self):
        for options in ({}, {'check': True}, {'roles_only': True}, {'only': ('Stand-in',)},
                        {'give': [('Staff', 'Stand-in')]}):
            with self.subTest(options=options):
                self.assertEqual(self.scenario(**options)[0], 0)

    def test_audit_drift_is_not_failure(self):
        code, log = self.scenario(audit=True)
        self.assertIn('DIFFERS', log)
        self.assertEqual(code, 0)

    def test_failed_give_still_fails(self):
        self.assertEqual(self.scenario(give=[('Staff', 'Stand-in')], failed=True)[0], 1)


if __name__ == '__main__':
    unittest.main()
