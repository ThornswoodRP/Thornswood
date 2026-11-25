"""Trusted Windows launch gate: own the real Python process before test code.

Opening/assignment failure stops before the harness can run. The parent keeps
the only job handle after assignment, so its exit also kills the owned tree.
https://learn.microsoft.com/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject
"""
import ctypes
from ctypes import wintypes
import os
import runpy
import sys

if os.name != 'nt':
    raise RuntimeError('bot harness job ownership requires Windows')

kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.OpenJobObjectW.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR]
kernel.OpenJobObjectW.restype = wintypes.HANDLE
kernel.GetCurrentProcess.argtypes = []
kernel.GetCurrentProcess.restype = wintypes.HANDLE
kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
kernel.AssignProcessToJobObject.restype = wintypes.BOOL
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
kernel.CloseHandle.restype = wintypes.BOOL
job = kernel.OpenJobObjectW(0x1, False, sys.argv[1])  # JOB_OBJECT_ASSIGN_PROCESS
if not job:
    raise ctypes.WinError(ctypes.get_last_error())
try:
    if not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        raise ctypes.WinError(ctypes.get_last_error())
finally:
    if not kernel.CloseHandle(job):
        raise ctypes.WinError(ctypes.get_last_error())

test = os.path.abspath(sys.argv[2])
sys.argv = [test]
sys.path[0] = os.path.dirname(test)
runpy.run_path(test, run_name='__main__')
