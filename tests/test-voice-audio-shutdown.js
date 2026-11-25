'use strict';
// Compiles the real session and loop with a gated, local audio substitute.
// No network, audio endpoints, or Windows device preferences are used.
const { spawnSync } = require('node:child_process');
const voice = require('./voice-launcher');
const { dotnet, dll } = voice.build();
const result = spawnSync(dotnet, [dll, '--audio-shutdown'], { encoding: 'utf8', timeout: 45000 });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.error) throw result.error;
process.exitCode = result.status === 0 ? 0 : 1;
