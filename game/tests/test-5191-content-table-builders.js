'use strict';

// Check generated market stall and merchant tables against their exact sources.
// The content gate matches these generated filenames when it has no read trace
// for this harness. The code bundle checks live in test-5191-gamemode-tables.js.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repo = path.join(__dirname, '..', '..');
const checks = [
  ['Build-MarketStallTables.js', 'MARKET_STALL_TABLE.json'],
  ['Build-MerchantTables.js', 'MERCHANT_TRADERS.json'],
];

for (const [builder, table] of checks) {
  const tool = path.join(repo, 'scripts', 'dev', builder);
  const result = spawnSync(process.execPath, [tool, '--check'], { cwd: repo, encoding: 'utf8' });
  if (result.status === 0) {
    console.log('PASS ' + builder + ' checks ' + table + ' and its other generated outputs');
  } else {
    console.error('FAIL ' + builder + ' checks ' + table + ' and its other generated outputs');
    console.error(result.error || (result.stderr || result.stdout || 'exit ' + result.status).trim());
    process.exitCode = 1;
  }
}
