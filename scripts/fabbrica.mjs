#!/usr/bin/env node
// La fabbrica delle copie di Blindo Service: una copia per esercente (Worker, database D1, archivio R2),
// sull'account Cloudflare di chi lancia il comando (wrangler login).
//
//   node scripts/fabbrica.mjs crea <nome-copia> [--tetto 10] [--portale https://…]
//   node scripts/fabbrica.mjs attivazione <nome-copia>       nuovo link di attivazione (anche per chiave persa)
//   node scripts/fabbrica.mjs aggiorna [nome-copia…]         pubblica la build corrente (tutte, se nessun nome)
//   node scripts/fabbrica.mjs sospendi|riattiva <nome-copia>
//   node scripts/fabbrica.mjs tetto <nome-copia> <euro>
//   node scripts/fabbrica.mjs chiave-ia [nome-copia…]        reimposta la chiave OpenAI
//   node scripts/fabbrica.mjs elenco
//   node scripts/fabbrica.mjs elimina <nome-copia> --conferma <nome-copia>
//
// Aggiungi --prova per vedere i comandi senza eseguirli. Prima di crea/aggiorna: corepack pnpm run build.
// Il registro (BLINDO_COPIE_DIR, predefinito ~/Desktop/siti/blindo-copie) sta fuori dal codice e conserva
// solo l'impronta delle chiavi. La chiave OpenAI si chiede senza mostrarla (o FABBRICA_OPENAI_KEY).
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACTIVATION_SECONDS = 7 * 24 * 3600;
const DEFAULT_CAP = 10;

export const slugOk = s => /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(String(s || ''));
export const names = slug => ({
  worker: `blindo-${slug}`,
  database: `blindo-${slug}`,
  bucket: `blindo-${slug}-documenti`,
});
export const sha256 = v => createHash('sha256').update(v).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

/** The copy's Wrangler config: same program as Carlo's, its own name, database, archive and limits. */
export function copyConfig({ slug, databaseId, cap, portal, suspended = false, repo = REPO }) {
  const n = names(slug);
  return {
    name: n.worker,
    main: join(repo, 'dist/server/index.js'),
    compatibility_date: '2026-05-15',
    compatibility_flags: ['nodejs_compat'],
    assets: { directory: join(repo, 'dist/client') },
    d1_databases: [
      {
        binding: 'DB',
        database_name: n.database,
        database_id: databaseId,
        migrations_dir: join(repo, 'drizzle'),
      },
    ],
    r2_buckets: [{ binding: 'BUCKET', bucket_name: n.bucket }],
    observability: { enabled: true },
    triggers: { crons: ['7 * * * *'] },
    version_metadata: { binding: 'CF_VERSION_METADATA' },
    // Never HOLDING_SEGNALE_KEY here: Gionti Holding is only Carlo's.
    vars: {
      BLINDO_COPIA: slug,
      AI_TETTO_EURO: String(cap),
      ...(portal ? { PORTALE_URL: portal } : {}),
      ...(suspended ? { BLINDO_SOSPESO: '1' } : {}),
    },
  };
}

/** The SQL that puts a one-time activation link in the copy's database: only its SHA-256 is stored. */
export const activationSql = (token, now = Math.floor(Date.now() / 1000)) =>
  `INSERT INTO admin_activation(token_hash,expires,used) VALUES('${sha256(token)}',${now + ACTIVATION_SECONDS},NULL)`;

function parseArgs(argv) {
  const flags = {},
    rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prova') flags.prova = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
    else rest.push(a);
  }
  return { flags, rest };
}

function main(argv) {
  const { flags, rest } = parseArgs(argv);
  const [command, ...args] = rest;
  const dir = resolve(process.env.BLINDO_COPIE_DIR || join(homedir(), 'Desktop/siti/blindo-copie'));
  const fail = msg => {
    console.error('\nFERMO: ' + msg + '\n');
    process.exit(1);
  };
  const wrangler = (cmdArgs, { input, capture } = {}) => {
    const shown = ['wrangler', ...cmdArgs].join(' ');
    if (flags.prova) {
      console.log('  [prova] ' + shown);
      return '';
    }
    console.log('  → ' + shown);
    const r = spawnSync(process.execPath, [join(REPO, 'node_modules/wrangler/bin/wrangler.js'), ...cmdArgs], {
      cwd: REPO,
      input,
      encoding: 'utf8',
      stdio: [
        input === undefined ? 'inherit' : 'pipe',
        capture ? 'pipe' : 'inherit',
        capture ? 'pipe' : 'inherit',
      ],
      env: { ...process.env, CI: '1' },
    });
    if (r.status !== 0) fail(`wrangler si è fermato: ${shown}\n${capture ? r.stderr || r.stdout : ''}`);
    return r.stdout || '';
  };
  const registryFile = slug => join(dir, slug, 'copia.json');
  const configFile = slug => join(dir, slug, 'wrangler.json');
  const read = slug => {
    if (!existsSync(registryFile(slug))) fail(`copia sconosciuta: ${slug}. Vedi: fabbrica elenco`);
    return JSON.parse(readFileSync(registryFile(slug), 'utf8'));
  };
  const save = copy => {
    if (flags.prova) return;
    mkdirSync(join(dir, copy.slug), { recursive: true, mode: 0o700 });
    writeFileSync(registryFile(copy.slug), JSON.stringify(copy, null, 2) + '\n', { mode: 0o600 });
    chmodSync(registryFile(copy.slug), 0o600);
    writeFileSync(
      configFile(copy.slug),
      JSON.stringify(
        copyConfig({
          slug: copy.slug,
          databaseId: copy.databaseId,
          cap: copy.tetto,
          portal: copy.portale,
          suspended: copy.sospesa,
        }),
        null,
        2,
      ) + '\n',
    );
  };
  const needBuild = () => {
    if (!flags.prova && !existsSync(join(REPO, 'dist/server/index.js')))
      fail('manca la build: lancia prima «corepack pnpm run build».');
  };
  const schema = (slug, conf) => {
    wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', conf]);
    wrangler([
      'd1',
      'execute',
      'DB',
      '--remote',
      '-y',
      '--config',
      conf,
      '--file',
      join(REPO, 'scripts/admin-login-schema.sql'),
    ]);
  };
  const deploy = conf => {
    const out = wrangler(['deploy', '--config', conf], { capture: true });
    const url = out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] || '';
    const version = out.match(/Current Version ID: ([0-9a-f-]+)/)?.[1] || '';
    return { url, version };
  };
  const secret = (conf, name, value) =>
    wrangler(['secret', 'put', name, '--config', conf], { input: value + '\n', capture: true });
  const activationLink = async (copy, conf) => {
    const token = newToken();
    wrangler(['d1', 'execute', 'DB', '--remote', '-y', '--config', conf, '--command', activationSql(token)], {
      capture: true,
    });
    return `${copy.url || 'https://<indirizzo-della-copia>'}/attiva?t=${flags.prova ? '<link-di-prova>' : token}`;
  };
  const askKey = () =>
    new Promise(ok => {
      const fromEnv = (process.env.FABBRICA_OPENAI_KEY || '').trim();
      if (fromEnv || flags.prova) return ok(fromEnv || 'sk-prova');
      process.stdout.write('Chiave OpenAI per le copie (non si vede mentre la incolli): ');
      const rl = createInterface({ input: process.stdin, terminal: false });
      if (process.stdin.isTTY) spawnSync('stty', ['-echo'], { stdio: 'inherit' });
      rl.once('line', line => {
        if (process.stdin.isTTY) spawnSync('stty', ['echo'], { stdio: 'inherit' });
        rl.close();
        console.log('');
        ok(line.trim());
      });
    });
  const all = () => (existsSync(dir) ? readdirSync(dir).filter(d => existsSync(registryFile(d))) : []);
  const one = name => {
    if (!slugOk(name))
      fail('nome della copia non valido: 3–30 lettere minuscole, numeri e trattini (es. bar-rossi).');
    return name;
  };

  const commands = {
    async crea() {
      const slug = one(args[0]);
      if (existsSync(registryFile(slug))) fail(`la copia ${slug} esiste già.`);
      needBuild();
      const key = await askKey();
      if (!/^sk-/.test(key)) fail('la chiave OpenAI non sembra valida (deve iniziare con sk-).');
      const n = names(slug),
        cap = Number(flags.tetto ?? DEFAULT_CAP);
      if (!(cap > 0)) fail('tetto non valido.');
      console.log(`\nCopia «${slug}»\n`);
      const created = wrangler(['d1', 'create', n.database], { capture: true });
      const databaseId =
        created.match(/"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/)?.[1] ||
        (flags.prova ? 'id-di-prova' : '');
      if (!databaseId) fail('non ho trovato l’id del database nella risposta di wrangler.');
      wrangler(['r2', 'bucket', 'create', n.bucket], { capture: true });
      const copy = {
        slug,
        databaseId,
        tetto: cap,
        portale: flags.portale || '',
        sospesa: false,
        creata: new Date().toISOString(),
      };
      save(copy);
      const conf = configFile(slug);
      schema(slug, conf);
      Object.assign(copy, deploy(conf));
      secret(conf, 'OPENAI_API_KEY', key);
      const portalKey = newToken();
      if (copy.portale) {
        secret(conf, 'PORTALE_CHIAVE', portalKey);
        copy.chiave_portale_sha256 = sha256(portalKey);
      }
      save(copy);
      const link = await activationLink(copy, conf);
      console.log(`\nFATTO. Indirizzo: ${copy.url || '(in prova)'}`);
      console.log(`Link di attivazione per il cliente (vale 7 giorni, una volta sola):\n\n  ${link}\n`);
      if (copy.portale)
        console.log(`Impronta della chiave da registrare nel portale: ${copy.chiave_portale_sha256}\n`);
    },
    async attivazione() {
      const copy = read(one(args[0]));
      console.log(
        `\nNuovo link di attivazione per «${copy.slug}»: la chiave attuale smette di valere quando viene usato.\n`,
      );
      console.log('  ' + (await activationLink(copy, configFile(copy.slug))) + '\n');
    },
    async aggiorna() {
      needBuild();
      const list = args.length ? args.map(one) : all();
      if (!list.length) fail('nessuna copia nel registro.');
      for (const slug of list) {
        const copy = read(slug);
        console.log(`\nAggiorno «${slug}»`);
        save(copy);
        schema(slug, configFile(slug));
        Object.assign(copy, deploy(configFile(slug)), { aggiornata: new Date().toISOString() });
        save(copy);
        console.log(`  versione ${copy.version || '(in prova)'}`);
      }
      console.log(
        `\nFATTO: ${list.length} ${list.length === 1 ? 'copia aggiornata' : 'copie aggiornate'}.\n`,
      );
    },
    async sospendi() {
      needBuild();
      const copy = read(one(args[0]));
      copy.sospesa = true;
      save(copy);
      Object.assign(copy, deploy(configFile(copy.slug)));
      save(copy);
      console.log(`\n«${copy.slug}» sospesa: sola lettura, il portale QR per i controllori funziona.\n`);
    },
    async riattiva() {
      needBuild();
      const copy = read(one(args[0]));
      copy.sospesa = false;
      save(copy);
      Object.assign(copy, deploy(configFile(copy.slug)));
      save(copy);
      console.log(`\n«${copy.slug}» riattivata.\n`);
    },
    async tetto() {
      needBuild();
      const copy = read(one(args[0]));
      const cap = Number(args[1]);
      if (!(cap > 0)) fail('scrivi il tetto mensile in euro, per esempio: tetto bar-rossi 15');
      copy.tetto = cap;
      save(copy);
      Object.assign(copy, deploy(configFile(copy.slug)));
      save(copy);
      console.log(`\n«${copy.slug}»: tetto IA ${cap} € al mese.\n`);
    },
    async 'chiave-ia'() {
      const list = args.length ? args.map(one) : all();
      const key = await askKey();
      if (!/^sk-/.test(key)) fail('la chiave OpenAI non sembra valida.');
      for (const slug of list) secret(configFile(read(slug).slug), 'OPENAI_API_KEY', key);
      console.log(`\nChiave OpenAI aggiornata su ${list.length} copie.\n`);
    },
    async elenco() {
      const list = all();
      if (!list.length) return console.log('\nNessuna copia nel registro.\n');
      console.log('');
      for (const slug of list) {
        const c = read(slug);
        console.log(
          `${slug.padEnd(30)} ${c.sospesa ? 'SOSPESA' : 'attiva '}  tetto ${c.tetto} €  ${c.url || ''}`,
        );
      }
      console.log('');
    },
    async elimina() {
      const copy = read(one(args[0]));
      if (flags.conferma !== copy.slug)
        fail(
          `per cancellare davvero programma e dati scrivi: elimina ${copy.slug} --conferma ${copy.slug}\nPrima il cliente deve aver scaricato i suoi dati.`,
        );
      const n = names(copy.slug);
      console.log(`\nElimino «${copy.slug}»: programma, database e archivio.\n`);
      wrangler(['delete', n.worker, '--force']);
      wrangler(['d1', 'delete', n.database, '--skip-confirmation']);
      // R2 cancella un archivio solo se è vuoto: le regole di scadenza lo svuotano entro un giorno.
      wrangler(['r2', 'bucket', 'lifecycle', 'add', n.bucket, 'svuota', '--expire-days', '1', '--force']);
      console.log(
        `\nFATTO. Tra due giorni: wrangler r2 bucket delete ${n.bucket}\nToglie anche la cartella ${join(dir, copy.slug)} dal registro quando hai finito.\n`,
      );
    },
  };
  const run = commands[command];
  if (!run) {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n')
        .slice(1, 17)
        .map(l => l.replace(/^\/\/ ?/, ''))
        .join('\n'),
    );
    process.exit(command ? 1 : 0);
  }
  return run();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main(process.argv.slice(2));
