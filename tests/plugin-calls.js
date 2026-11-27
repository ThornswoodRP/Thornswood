// tests/plugin-calls.js
//
// Issue #7090. Reads a game plugin's source as JavaScript tokens and gives
// every method it calls by name (x.name(...), x?.name(...), x.name?.(...)),
// with its line, and every name the plugin declares itself. Comments,
// strings, template text and regular expression literals are skipped, so a
// call written inside one is not a call. tests/test-7090-platform-calls.js
// holds the calls to what the pinned Skyrim Platform offers.
//
// A tokenizer and not a regular expression over the text: a plugin's
// strings hold JavaScript too (the scripts it hands the browser), and
// x.getThing( inside one of them is not a call into the platform.
'use strict';

const KEYWORD_BEFORE_REGEX = /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

function tokens(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let line = 1;

  function regexMayStart() {
    const p = out[out.length - 1];
    if (!p) { return true; }
    if (p.t === 'id') { return KEYWORD_BEFORE_REGEX.test(p.v); }
    if (p.t === 'num' || p.t === 'str' || p.t === 're') { return false; }
    return !(p.v === ')' || p.v === ']' || p.v === '}');
  }

  function template() {
    i++;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '\n') { line++; }
      if (c === '`') { i++; out.push({ t: 'str', v: '', line }); return; }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) { depth += step(true); }
        continue;
      }
      i++;
    }
  }

  // One token; inside a template's ${ } it says how the braces move.
  function step(inTemplate) {
    const c = src[i];
    if (c === '\n') { line++; i++; return 0; }
    if (/\s/.test(c)) { i++; return 0; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') { i++; } return 0; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      line += (src.slice(i, end).match(/\n/g) || []).length;
      i = end;
      return 0;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { i++; } else if (src[i] === '\n') { line++; }
        i++;
      }
      i++;
      out.push({ t: 'str', v: '', line });
      return 0;
    }
    if (c === '`') { template(); return 0; }
    if (c === '/' && regexMayStart()) {
      i++;
      let inClass = false;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') { inClass = true; } else if (d === ']') { inClass = false; } else if ((d === '/' && !inClass) || d === '\n') { break; }
        i++;
      }
      i++;
      while (i < n && /[a-z]/i.test(src[i])) { i++; }
      out.push({ t: 're', v: '', line });
      return 0;
    }
    let m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200));
    if (m) { out.push({ t: 'id', v: m[0], line }); i += m[0].length; return 0; }
    m = /^(?:0[xX][0-9a-fA-F_]+n?|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?n?|\.\d+(?:[eE][+-]?\d+)?)/.exec(src.slice(i, i + 64));
    if (m) { out.push({ t: 'num', v: m[0], line }); i += m[0].length; return 0; }
    m = /^(?:\?\.|\.\.\.|=>|[{}()[\];,.<>+\-*/%&|^!~?:=@#])/.exec(src.slice(i, i + 3));
    const v = m ? m[0] : c;
    out.push({ t: 'p', v, line });
    i += v.length;
    if (inTemplate) { if (v === '{') { return 1; } if (v === '}') { return -1; } }
    return 0;
  }

  while (i < n) { step(false); }
  return out;
}

// Names the source gives a value of its own: an object key (name: ...),
// function and class names, anything assigned (name = ...), and method
// shorthand (name(...) { ... } in an object or class).
function declared(T) {
  const own = new Set();
  for (let k = 0; k < T.length; k++) {
    const a = T[k];
    const b = T[k + 1] || {};
    const before = T[k - 1] || {};
    if (a.t !== 'id') { continue; }
    if (b.v === ':' && before.v !== '?') { own.add(a.v); }
    if ((a.v === 'function' || a.v === 'class') && b.t === 'id') { own.add(b.v); }
    if (b.v === '=' && T[k + 2] && T[k + 2].v !== '=' && T[k + 2].v !== '>') { own.add(a.v); }
    if (b.v === '(') {
      let depth = 0;
      let j = k + 1;
      for (; j < T.length; j++) {
        if (T[j].v === '(') { depth++; } else if (T[j].v === ')') { depth--; if (!depth) { break; } }
      }
      const opens = T[j + 1] && T[j + 1].v === '{';
      if (opens && (before.v === '{' || before.v === ',' || before.v === ';' || before.v === '}' || /^(get|set|static|async)$/.test(before.v))) { own.add(a.v); }
    }
  }
  return own;
}

// Every x.name( and x?.name( and x.name?.( with the name and its line.
function calls(T) {
  const out = [];
  for (let k = 1; k < T.length - 1; k++) {
    const p = T[k - 1];
    const a = T[k];
    const b = T[k + 1];
    if ((p.v === '.' || p.v === '?.') && a.t === 'id' && (b.v === '(' || (b.v === '?.' && T[k + 2] && T[k + 2].v === '('))) {
      out.push({ name: a.v, line: a.line });
    }
  }
  return out;
}

// The names the JavaScript the plugins run in gives every value: what
// Object, Array, String, Promise and the rest put on their prototypes, and
// node's own modules, process, console and Buffer. Read from the runtime
// this runs in, so nothing is kept by hand.
function builtins() {
  const names = new Set();
  const add = (o) => {
    for (let p = o; p && p !== Object.getPrototypeOf(Object.prototype); p = Object.getPrototypeOf(p)) {
      for (const k of Object.getOwnPropertyNames(p)) { names.add(k); }
    }
  };
  for (const k of Object.getOwnPropertyNames(globalThis)) {
    let v;
    try { v = globalThis[k]; } catch (e) { continue; }
    if (v && (typeof v === 'function' || typeof v === 'object')) {
      add(v);
      if (v.prototype) { add(v.prototype); }
    }
  }
  // Loading some of them (wasi) prints a warning that says nothing here.
  const warn = process.emitWarning;
  process.emitWarning = () => {};
  try {
    for (const m of require('module').builtinModules) {
      let v;
      try { v = require(m); } catch (e) { continue; }
      add(v);
    }
  } finally {
    process.emitWarning = warn;
  }
  add(process);
  add(console);
  add(Buffer.prototype);
  return names;
}

module.exports = { tokens, declared, calls, builtins };
