import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.umask(0o077);
const node = process.execPath;
const action = process.argv[2] || 'help';
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const run = (bin, args) => {
  const r = spawnSync(bin, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('Comando non completato (codice ' + r.status + ').');
};
const wrangler = args =>
  run(node, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', ...args]);
const config = 'wrangler.local.json';
const protectedPath = p =>
  /(^|\/)(node_modules|\.git|\.wrangler|\.sites-runtime|\.vinext|dist|backups)(\/|$)/.test(p) ||
  /(^|\/)(\.env[^/]*|\.dev\.vars[^/]*)$/.test(p);
function safe(p) {
  if (
    typeof p !== 'string' ||
    !p ||
    p.startsWith('/') ||
    p.includes('\\') ||
    p.split('/').some(x => !x || x === '.' || x === '..') ||
    protectedPath(p) ||
    p === 'SOURCE_MANIFEST.json'
  )
    throw new Error('Percorso non ammesso nel manifesto: ' + p);
  return p;
}
function verifiedManifest(base, strict = true) {
  const m = read(path.join(base, 'SOURCE_MANIFEST.json'));
  if (m.product !== 'Presidio' || !m.files || Object.keys(m.files).length < 20)
    throw new Error('Manifesto Presidio mancante o non valido.');
  for (const [p, h] of Object.entries(m.files)) {
    safe(p);
    let current = base;
    for (const part of p.split('/')) {
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
        throw new Error('Link simbolico non ammesso: ' + p);
    }
    if (strict && (!fs.existsSync(current) || hash(current) !== h))
      throw new Error('File modificato o incompleto: ' + p);
  }
  return m;
}
function prepare() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13))
    throw new Error('Installa Node.js >=22.13 (consigliata versione 22 o 24) da nodejs.org.');
  fs.mkdirSync('.sites-runtime', { recursive: true });
  fs.writeFileSync('.sites-runtime/execution-profile.json', JSON.stringify({ executionProfile: 'portable' }));
  if (!fs.existsSync('.dev.vars'))
    fs.writeFileSync(
      '.dev.vars',
      '# SOLO LOCALE: non caricare online e non condividere.\nPRESIDIO_OWNER_EMAIL="seedy@sites.test"\nOPENAI_API_KEY=""\n',
      { mode: 0o600 },
    );
  const local = fs.readFileSync('.dev.vars', 'utf8');
  if (!/^PRESIDIO_OWNER_EMAIL=["']?seedy@sites\.test["']?\s*$/m.test(local))
    throw new Error(
      'Per il login locale imposta PRESIDIO_OWNER_EMAIL="seedy@sites.test" in .dev.vars. Questo non cambia il titolare online.',
    );
  fs.chmodSync('.dev.vars', 0o600);
}
function install() {
  const pm = read('package.json').packageManager;
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(pm)) throw new Error('Versione pnpm non valida');
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', pm, 'install', '--frozen-lockfile']);
}
function database() {
  if (!fs.existsSync('node_modules/wrangler')) throw new Error('Prima esegui INSTALLA.command.');
  wrangler([
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--config',
    config,
    '--persist-to',
    '.wrangler/state',
  ]);
  // Admin login tables: same idempotent script used for the online database.
  wrangler([
    'd1',
    'execute',
    'DB',
    '--local',
    '--config',
    config,
    '--persist-to',
    '.wrangler/state',
    '--file',
    'scripts/admin-login-schema.sql',
  ]);
}
async function stopped() {
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', () =>
      reject(
        new Error(
          'Presidio è avviato o la porta 5173 è occupata. Ferma il server con Ctrl+C prima di proseguire.',
        ),
      ),
    );
    s.listen(5173, '127.0.0.1', () => s.close(resolve));
  });
}
function backup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(path.dirname(root), 'Presidio-backup-' + stamp + '.tar.gz');
  run('tar', [
    '-czf',
    dest,
    '--exclude=./node_modules',
    '--exclude=./.git',
    '--exclude=./.sites-runtime',
    '--exclude=./.vinext',
    '--exclude=./dist',
    '--exclude=./.env*',
    '--exclude=./.dev.vars*',
    '--exclude=./.wrangler/logs',
    '-C',
    root,
    '.',
  ]);
  fs.chmodSync(dest, 0o600);
  console.log(
    'Backup creato: ' +
      dest +
      '\nInclude codice e dati locali. Le chiavi sono escluse. Conservare privatamente.',
  );
  return dest;
}
try {
  switch (action) {
    case 'setup':
      await stopped();
      prepare();
      install();
      database();
      console.log('Installazione completata. Esegui AVVIA.command.');
      break;
    case 'prepare':
      prepare();
      console.log('Configurazione locale pronta.');
      break;
    case 'db':
      prepare();
      await stopped();
      database();
      break;
    case 'start':
      prepare();
      await stopped();
      if (!fs.existsSync('node_modules/vinext')) throw new Error('Esegui prima INSTALLA.command.');
      console.log('Apri http://localhost:5173 — arresta con Ctrl+C. I dati sono locali.');
      run(node, ['scripts/run-framework.mjs', 'dev', '--hostname', '127.0.0.1']);
      break;
    case 'admin': {
      prepare();
      const email = (process.argv[3] || 'admin@presidio.local').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email non valida.');
      const password = randomBytes(32).toString('base64url');
      const keyHash = createHash('sha256').update(password).digest('hex');
      const previous = fs
        .readFileSync('.dev.vars', 'utf8')
        .split('\n')
        .filter(l => !/^PRESIDIO_ADMIN_CREDENTIALS=/.test(l))
        .join('\n')
        .trimEnd();
      fs.writeFileSync(
        '.dev.vars',
        previous + "\nPRESIDIO_ADMIN_CREDENTIALS='" + JSON.stringify({ email, keyHash }) + "'\n",
        { mode: 0o600 },
      );
      fs.chmodSync('.dev.vars', 0o600);
      console.log('Accesso LOCALE configurato (non cambia il sito online). Riavvia Presidio.');
      console.log('Email: ' + email);
      console.log('Password: ' + password);
      console.log('Salvala nel portachiavi del Mac. Rilanciando il comando ne generi una nuova.');
      break;
    }
    case 'key': {
      prepare();
      let key = '';
      for await (const chunk of process.stdin) {
        key += chunk;
        if (key.length > 1000) throw new Error('Valore troppo lungo.');
      }
      key = key.trim();
      if (!/^sk-[A-Za-z0-9_-]{15,}$/.test(key))
        throw new Error('Formato della chiave non riconosciuto. Nessuna modifica.');
      const previous = fs
        .readFileSync('.dev.vars', 'utf8')
        .split('\n')
        .filter(l => !/^OPENAI_API_KEY=/.test(l))
        .join('\n')
        .trimEnd();
      fs.writeFileSync('.dev.vars', previous + '\nOPENAI_API_KEY=' + JSON.stringify(key) + '\n', {
        mode: 0o600,
      });
      fs.chmodSync('.dev.vars', 0o600);
      console.log('Chiave salvata soltanto in locale. Riavvia Presidio.');
      break;
    }
    case 'backup':
      await stopped();
      backup();
      break;
    case 'verify':
      verifiedManifest(root);
      console.log('Tutti i file distribuiti corrispondono al manifesto SHA-256.');
      break;
    case 'update': {
      if (!process.argv[3])
        throw new Error('Uso: node scripts/pc.mjs update /percorso/cartella/blindoservice');
      const src = fs.realpathSync(path.resolve(process.argv[3]));
      if (src === root || src.startsWith(root + path.sep))
        throw new Error('Estrai il nuovo pacchetto fuori dalla cartella in uso.');
      await stopped();
      const next = verifiedManifest(src);
      const old = verifiedManifest(root, false);
      const oldId = read('.openai/hosting.json').project_id;
      const newId = read(path.join(src, '.openai/hosting.json')).project_id;
      if (oldId !== newId) throw new Error('Il pacchetto appartiene a un altro sito.');
      const changed = Object.entries(old.files)
        .filter(([p, h]) => !fs.existsSync(p) || hash(p) !== h)
        .map(([p]) => p);
      if (changed.length)
        throw new Error('Modifiche locali da integrare prima di aggiornare: ' + changed.join(', '));
      for (const p of Object.keys(next.files))
        if (fs.existsSync(p) && !Object.hasOwn(old.files, p))
          throw new Error('Un file locale non tracciato verrebbe sovrascritto: ' + p);
      const saved = backup();
      for (const p of Object.keys(next.files)) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.copyFileSync(path.join(src, p), p);
        fs.chmodSync(p, p.endsWith('.command') ? 0o755 : 0o644);
      }
      for (const p of Object.keys(old.files)) if (!Object.hasOwn(next.files, p)) fs.unlinkSync(p);
      fs.copyFileSync(path.join(src, 'SOURCE_MANIFEST.json'), 'SOURCE_MANIFEST.json');
      prepare();
      install();
      database();
      console.log('Aggiornamento completato. Ripristino disponibile in ' + saved);
      break;
    }
    case 'test':
      run(node, ['tests/access-control.mjs']);
      break;
    default:
      console.log(
        'Presidio PC: setup | start | db | admin [EMAIL] | key (stdin) | backup | verify | update CARTELLA | test',
      );
  }
} catch (e) {
  console.error('\nPRESIDIO: ' + e.message);
  process.exitCode = 1;
}
