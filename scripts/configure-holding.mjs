import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Connects the published Blindo Service to the Gionti Holding centrale (Kassaro OS).
// The key is typed hidden, checked against the centrale, then stored only as a Worker secret.
// Only for Carlo's own copy: never run it on a copy given to another business.
const project = fileURLToPath(new URL('../', import.meta.url));
process.chdir(project);
const URL_CENTRALE = 'https://kassaro-os.onrender.com/api/holding/segnale';

function hidden(question) {
  process.stdout.write(question);
  if (!process.stdin.isTTY) throw new Error('Avvia il comando dal Terminale.');
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  let value = '';
  return new Promise((ok, fail) => {
    const done = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stdout.write('\n');
    };
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return (done(), ok(value.trim()));
        if (ch === '\u0003') return (done(), fail(new Error('Annullato. Nessuna modifica.')));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}
const wrangler = input =>
  new Promise((ok, fail) => {
    const child = spawn(
      process.execPath,
      ['node_modules/wrangler/bin/wrangler.js', 'secret', 'bulk', '--config', 'wrangler.jsonc'],
      { cwd: project, stdio: ['pipe', 'inherit', 'inherit'] },
    );
    child.on('error', fail);
    child.on('exit', code =>
      code === 0 ? ok() : fail(new Error('Wrangler si è fermato (codice ' + code + ').')),
    );
    child.stdin.end(input);
  });

try {
  console.log('\nGIONTI HOLDING — collega Blindo Service alla centrale di Kassaro OS\n');
  console.log('Serve la chiave del software «blindo» (strumento chiave_software del connettore');
  console.log('Kassaro OS). Incollala qui: non si vede mentre la scrivi e non viene salvata in file.\n');
  const key = await hidden('Chiave (kosw_…): ');
  if (!/^kosw_[A-Za-z0-9_-]{40,}$/.test(key))
    throw new Error('La chiave deve iniziare con kosw_. Nessuna modifica.');

  process.stdout.write('Provo la chiave con la centrale… ');
  const res = await fetch(URL_CENTRALE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stato: 'ok', testo: 'Blindo Service collegato alla centrale' }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!res) throw new Error('Kassaro OS non risponde. Riprova tra qualche minuto. Nessuna modifica.');
  if (res.status === 404)
    throw new Error('Kassaro OS non ha ancora la centrale (serve la 8.2.0). Nessuna modifica.');
  if (res.status === 401)
    throw new Error('La centrale non riconosce la chiave: creane una nuova. Nessuna modifica.');
  if (!res.ok) throw new Error(`La centrale risponde ${res.status}. Nessuna modifica.`);
  const answer = await res.json().catch(() => ({}));
  if (answer.ok !== true)
    throw new Error('Risposta inattesa dalla centrale (serve Kassaro OS 8.2.0). Nessuna modifica.');
  if (answer.software !== 'blindo')
    throw new Error(`Questa chiave è di «${answer.software || '?'}», non di Blindo. Nessuna modifica.`);
  console.log('valida.');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ok = await rl.question('\nSalvo la chiave sul Worker blindoservice? Scrivi CONFERMO: ');
  rl.close();
  if (ok.trim() !== 'CONFERMO') throw new Error('Annullato. Nessuna modifica.');
  await wrangler(JSON.stringify({ HOLDING_SEGNALE_KEY: key }));
  console.log('\nFATTO. Ogni ora (al minuto 7) Blindo manda il riepilogo alla centrale.');
  console.log(
    'Per scollegarlo: corepack pnpm exec wrangler secret delete HOLDING_SEGNALE_KEY --config wrangler.jsonc',
  );
} catch (e) {
  console.error('\nSTOP: ' + e.message);
  process.exitCode = 1;
}
