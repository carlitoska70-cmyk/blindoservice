// Full backup of the published archive: D1 database (SQL) + every R2 attachment,
// each verified against the SHA-256 stored at upload time.
// Usage: node scripts/backup-online.mjs            (production, read-only)
//        node scripts/backup-online.mjs --local    (local data, to test the procedure)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.umask(0o077);
const local = process.argv.includes('--local');
const config = local ? 'wrangler.local.json' : 'wrangler.jsonc';
const bucket = JSON.parse(fs.readFileSync(config, 'utf8').replace(/^\s*\/\/.*$/gm, '')).r2_buckets[0]
  .bucket_name;
const where = local ? ['--local', '--persist-to', '.wrangler/state'] : ['--remote'];

function wrangler(args, capture = false) {
  const r = spawnSync(
    process.execPath,
    ['node_modules/wrangler/bin/wrangler.js', ...args, '--config', config],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (r.status !== 0) throw new Error('Wrangler non completato: ' + args.slice(0, 3).join(' '));
  return r.stdout;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const name = `Presidio-backup-${local ? 'locale' : 'online'}-${stamp}`;
const work = fs.mkdtempSync(path.join(path.dirname(root), '.presidio-backup-'));
const dir = path.join(work, name);
fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
try {
  console.log(`\nBACKUP ${local ? 'LOCALE (prova)' : 'ONLINE'} — sola lettura, nessuna modifica ai dati\n`);
  console.log('1/3 Esportazione del database…');
  // d1 export has no --persist-to; locally it reads the default .wrangler/state.
  wrangler([
    'd1',
    'export',
    'DB',
    local ? '--local' : '--remote',
    '--output',
    path.join(dir, 'database.sql'),
  ]);

  console.log('2/3 Elenco e download degli allegati…');
  const out = wrangler(
    ['d1', 'execute', 'DB', ...where, '--json', '--command', 'SELECT id,name,object_key,sha256 FROM files'],
    true,
  );
  const files = JSON.parse(out)[0].results;
  const report = [];
  for (const [i, f] of files.entries()) {
    const target = path.join(dir, 'files', f.object_key);
    if (!target.startsWith(path.join(dir, 'files') + path.sep))
      throw new Error('Chiave non valida: ' + f.object_key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    process.stdout.write(`   ${i + 1}/${files.length} ${f.name}\n`);
    wrangler(['r2', 'object', 'get', `${bucket}/${f.object_key}`, ...where, '--file', target], true);
    const hash = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    report.push({ id: f.id, name: f.name, key: f.object_key, sha256: f.sha256, verified: hash === f.sha256 });
  }
  const bad = report.filter(x => !x.verified);
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(
      { createdAt: new Date().toISOString(), source: local ? 'local' : 'production', files: report },
      null,
      2,
    ),
  );

  console.log('3/3 Creazione dell’archivio…');
  const dest = path.join(path.dirname(root), name + '.tar.gz');
  const tar = spawnSync('tar', ['-czf', dest, '-C', work, name], { stdio: 'inherit' });
  if (tar.status !== 0) throw new Error('Creazione archivio non riuscita');
  fs.chmodSync(dest, 0o600);
  console.log(`\nBackup creato: ${dest}`);
  console.log(`Database + ${report.length} allegati, ${report.length - bad.length} verificati con SHA-256.`);
  if (bad.length) {
    console.log('ATTENZIONE: impronta diversa per ' + bad.map(x => x.name).join(', '));
    process.exitCode = 2;
  }
  console.log(
    'Contiene dati riservati: conservalo cifrato (es. disco esterno con FileVault) e non condividerlo.',
  );
} catch (e) {
  console.error('\nSTOP: ' + e.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
