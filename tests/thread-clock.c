/*
  thread-clock.c: the CPU time of the calling thread, to the cycle, for the
  NPC native acceptance run (game/tests/test-npc-shared-native.js, issue #2032).

  Node's process.threadCpuUsage reads GetThreadTimes, which Windows charges
  by the clock interrupt, in steps of 15.6 ms, so a callback reading 47 ms
  used anywhere from 31 to 63. QueryThreadCycleTime counts the cycles the
  thread ran, charged at each context switch. On a processor with an
  invariant time stamp counter Windows counts them at that counter's rate,
  which thread-clock.js measures and checks before it trusts the clock.

  Built and loaded by thread-clock.js. The few Node-API calls it makes are
  looked up in the running node.exe, so it needs neither Node's headers nor
  an import library, only the C compiler the engine build already uses.
*/
#include <windows.h>
#include <intrin.h>
#include <stdint.h>

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env, napi_callback_info);

typedef napi_status (*create_double_t)(napi_env, double, napi_value *);
typedef napi_status (*create_function_t)(napi_env, const char *, size_t, napi_callback, void *, napi_value *);
typedef napi_status (*set_named_property_t)(napi_env, napi_value, const char *, napi_value);

static create_double_t create_double;
static create_function_t create_function;
static set_named_property_t set_named_property;

static napi_value number(napi_env env, double v) {
  napi_value out = NULL;
  create_double(env, v, &out);
  return out;
}

/* Cycles this thread has run, user and kernel. */
static napi_value cycles(napi_env env, napi_callback_info info) {
  ULONG64 c = 0;
  QueryThreadCycleTime(GetCurrentThread(), &c);
  return number(env, (double)c);
}

/* The time stamp counter, to measure the rate the cycles are counted at. */
static napi_value tsc(napi_env env, napi_callback_info info) {
  return number(env, (double)__rdtsc());
}

static napi_value qpc(napi_env env, napi_callback_info info) {
  LARGE_INTEGER v;
  QueryPerformanceCounter(&v);
  return number(env, (double)v.QuadPart);
}

static napi_value qpf(napi_env env, napi_callback_info info) {
  LARGE_INTEGER v;
  QueryPerformanceFrequency(&v);
  return number(env, (double)v.QuadPart);
}

static void add(napi_env env, napi_value exports, const char *name, napi_callback cb) {
  napi_value fn = NULL;
  create_function(env, name, (size_t)-1, cb, NULL, &fn);
  set_named_property(env, exports, name, fn);
}

__declspec(dllexport) int32_t node_api_module_get_api_version_v1(void) { return 8; }

__declspec(dllexport) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  HMODULE host = GetModuleHandleW(NULL);
  create_double = (create_double_t)GetProcAddress(host, "napi_create_double");
  create_function = (create_function_t)GetProcAddress(host, "napi_create_function");
  set_named_property = (set_named_property_t)GetProcAddress(host, "napi_set_named_property");
  if (!create_double || !create_function || !set_named_property) return NULL;
  add(env, exports, "cycles", cycles);
  add(env, exports, "tsc", tsc);
  add(env, exports, "qpc", qpc);
  add(env, exports, "qpf", qpf);
  return exports;
}
