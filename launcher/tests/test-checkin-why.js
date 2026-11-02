// test-checkin-why.js
//
//     node launcher\tests\test-checkin-why.js
//
// A check in that gets no answer says what it ran into and how long it
// waited. Measured on dev, 22 Oct: launcher.log said "thornswood.net is not
// answering" at 13:16:06 and 13:17:44 while the site answered the door and
// the join pass in the same minutes, so a new character was never linked and
// /tp refused its owner. Discord.Send returned 0 for every request that got
// no answer, a timeout, a refused connection or a name that would not
// resolve alike, and nothing recorded which.
//
// Reads launcher\app\Discord.cs and ShellChars.cs. Read only.
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8').split(CR).join(''); }

const discord = read('launcher/app/Discord.cs');
const chars = read('launcher/app/ShellChars.cs');

const send = /public static int Send\(string method, string url, string json, out string reply\)\s*\{[\s\S]*?\n        \}\n/.exec(discord);
const body = send ? send[0] : '';
yes('Send keeps its signature, so nothing that calls it changes', !!send);
yes('the reason is kept per thread, since check ins run side by side on pool threads',
    /\[ThreadStatic\] public static string LastFailure;/.test(discord));
yes('Send clears it and starts a clock before it asks', /LastFailure = "";\s*var took = System\.Diagnostics\.Stopwatch\.StartNew\(\);/.test(body));
// Since .NET 10 (#4823) a request with no answer is an HttpRequestException
// or Http.Send's TimeoutException, and FailureKind names it with the word
// .NET Framework's WebExceptionStatus used, so the log line reads the same.
const kind = /static string FailureKind\(Exception ex\)\s*\{[\s\S]*?\n        \}\n/.exec(discord);
const kindBody = kind ? kind[0] : '';
yes('a request with no answer records the kind of failure and the wait',
    /catch \(Exception ex\) when \(ex is HttpRequestException \|\| ex is TimeoutException\)\s*\{[\s\S]*?LastFailure = FailureKind\(ex\) \+ " after " \+ took\.ElapsedMilliseconds \+ " ms";\s*return 0;/.test(body));
yes('the kind is named in WebExceptionStatus\'s words: Timeout, NameResolutionFailure, ConnectFailure, SecureChannelFailure',
    /if \(ex is TimeoutException\) return "Timeout";/.test(kindBody) &&
    /HttpRequestError\.NameResolutionError: return "NameResolutionFailure";/.test(kindBody) &&
    /HttpRequestError\.ConnectionError: return "ConnectFailure";/.test(kindBody) &&
    /HttpRequestError\.SecureConnectionError: return "SecureChannelFailure";/.test(kindBody));
yes('any other failure records its kind and the wait',
    /LastFailure = ex\.GetType\(\)\.Name \+ " after " \+ took\.ElapsedMilliseconds \+ " ms";\s*return 0;/.test(body));
// HttpClient hands back a refusal as an answer rather than throwing, so its
// body is read and its status returned the same as any other answer's.
const readReply = /static string ReadReply\(HttpResponseMessage res, string where\)\s*\{[\s\S]*?\n        \}\n/.exec(discord);
yes('a refusal with a body is still an answer, read as before',
    /using \(HttpResponseMessage res = Http\.Send\(req, 15000\)\)\s*\{[\s\S]*?reply = ReadReply\(res, "Discord\.Send, reading refusal body"\);\s*return \(int\)res\.StatusCode;/.test(body) &&
    !!readReply && /new StreamReader\(new MemoryStream\(Http\.Body\(res, Http\.DefaultReadMs\)\)\)\) return r\.ReadToEnd\(\);/.test(readReply[0]) &&
    !/if \(!res\.IsSuccessStatusCode\)/.test(body));

yes('Standing carries it beside offline', /public string Why = "";[^\n]*\n[\s\S]{0,200}public string NetFailure = "";/.test(discord));
const join = /public static Standing Join\(int profileId\)[\s\S]*?if \(code == 0\)\s*\{[\s\S]*?return st;\s*\}/.exec(discord);
yes('a check in with no answer hands it on', !!join && /st\.Why = "offline";[\s\S]*?st\.NetFailure = LastFailure \?\? "";/.test(join[0]));

const off = /if \(st\.Why == "offline"\)\s*\{[\s\S]*?return false;\s*\}/.exec(chars);
yes('the log line names the character and what the request ran into', !!off &&
    /The game still starts\. \(character " \+ id \+\s*\(st\.NetFailure\.Length > 0 \? ": " \+ st\.NetFailure : ""\) \+ "\)"/.test(off[0]));
yes('and still says the game starts, as it did', !!off && /The game still starts\./.test(off[0]));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
