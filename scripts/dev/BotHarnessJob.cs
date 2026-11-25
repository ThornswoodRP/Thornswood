// Windows-only process ownership for Run-BotHarnesses.ps1 (#5958).
// The Python bootstrap joins BEFORE executing the test. Closing our last
// handle kills descendants even after the Python/venv parent has exited.
// https://learn.microsoft.com/windows/win32/procthread/job-objects
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public sealed class BotHarnessJob : IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong ReadCount, WriteCount, OtherCount, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, int length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr buffer, int length, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    IntPtr handle;

    public BotHarnessJob(string name)
    {
        handle = CreateJobObject(IntPtr.Zero, name);
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(handle, 9, ref limits, Marshal.SizeOf(typeof(ExtendedLimits))))
        {
            int error = Marshal.GetLastWin32Error();
            Dispose();
            throw new Win32Exception(error);
        }
    }

    // BASIC_PROCESS_ID_LIST includes exited processes whose handles remain
    // open. The caller tests HasExited, rather than treating those as orphans.
    public long[] ProcessIds()
    {
        int size = 8 + IntPtr.Size * 4096;
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            if (!QueryInformationJobObject(handle, 3, buffer, size, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            int count = Marshal.ReadInt32(buffer, 4);
            if (count < 0 || count > 4096) throw new InvalidOperationException("Invalid job process count");
            var result = new long[count];
            for (int i = 0; i < count; i++) result[i] = Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64();
            return result;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    public void Kill()
    {
        if (!TerminateJobObject(handle, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    public void Dispose()
    {
        if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; }
    }
}
