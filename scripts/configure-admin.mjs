import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

// Run from the project root. Never writes a plaintext password to a file.
const project = fileURLToPath(new URL('../', import.meta.url));
process.chdir(project);
await access(resolve(project, 'wrangler.jsonc'));
await access(resolve(project, 'node_modules/wrangler/bin/wrangler.js'));
const rl = createInterface({ input: process.stdin, output: process.stdout });
async function run(args, input) {
  await new Promise((ok, fail) => {
    const child = spawn(
      process.execPath,
      ['node_modules/wrangler/bin/wrangler.js', ...args, '--config', 'wrangler.jsonc'],
      {
        cwd: project,
        stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
      },
    );
    child.on('error', fail);
    child.on('exit', code =>
      code === 0 ? ok() : fail(new Error(`Wrangler si è fermato (codice ${code}). Non eseguire il deploy.`)),
    );
    if (input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}
try {
  console.log('\nCONFIGURAZIONE ACCESSO BLINDOSERVICE\n');
  console.log(
    'Questa procedura aggiunge tre tabelle di autenticazione al DB remoto e configura un segreto sul Worker indicato da wrangler.jsonc.',
  );
  console.log(
    'Non modifica i documenti né il portale QR. Se ripetuta, cambia la password e invalida le sessioni precedenti.',
  );
  console.log(
    'È destinata al tuo archivio a proprietario unico. Con più proprietari il login si blocca: non unisce i dati.\n',
  );
  const email = (await rl.question('La tua email per accedere: ')).trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Email non valida. Rilancia la procedura.');
  const password = randomBytes(32).toString('base64url');
  const keyHash = createHash('sha256').update(password).digest('hex');
  console.log('\nSALVA QUESTI DATI NELL’APP PASSWORD DEL MAC. NON INVIARLI IN CHAT.');
  console.log('Email: ' + email);
  console.log('Password: ' + password);
  console.log('La password è generata casualmente e non va abbreviata o sostituita con una frase.\n');
  const confirm = await rl.question(
    'Hai salvato la password e autorizzi la configurazione remota? Scrivi CONFERMO: ',
  );
  if (confirm.trim() !== 'CONFERMO') {
    console.log('Annullato. Nessuna modifica remota.');
    process.exitCode = 1;
  } else {
    rl.close();
    await run(['d1', 'execute', 'DB', '--remote', '--file', 'scripts/admin-login-schema.sql', '--yes']);
    await run(
      ['secret', 'bulk'],
      JSON.stringify({ PRESIDIO_ADMIN_CREDENTIALS: JSON.stringify({ email, keyHash }) }),
    );
    console.log('\nCONFIGURAZIONE COMPLETATA. Ora pubblica:');
    console.log('corepack pnpm exec wrangler deploy --config wrangler.jsonc');
    console.log('Poi apri https://blindoservice.carlitoska70.workers.dev/login');
  }
} catch (e) {
  console.error('\nSTOP: ' + e.message);
  process.exitCode = 1;
} finally {
  rl.close();
}
