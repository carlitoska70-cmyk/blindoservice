import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Configures reminder secrets on the production Worker. Never writes secrets to files.
const project = fileURLToPath(new URL('../', import.meta.url));
process.chdir(project);
const rl = createInterface({ input: process.stdin, output: process.stdout });
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
  console.log('\nPROMEMORIA SCADENZE — configurazione del sito pubblicato\n');
  console.log('Lascia vuoto un campo per saltare quel canale. Serve almeno un canale.\n');
  console.log('Telegram: crea un bot con @BotFather, poi scrivi al bot e ricava il tuo chat id.');
  const telegramToken = (await rl.question('Token del bot Telegram: ')).trim();
  const telegramChat = telegramToken ? (await rl.question('Chat id Telegram: ')).trim() : '';
  console.log('\nEmail con Resend (resend.com): serve una chiave API e un mittente verificato.');
  const resendKey = (await rl.question('Chiave API Resend: ')).trim();
  const to = resendKey ? (await rl.question('Email che riceve i promemoria: ')).trim() : '';
  const from = resendKey
    ? (await rl.question('Mittente (es. Presidio <avvisi@tuodominio.it>): ')).trim()
    : '';
  const secrets = { PRESIDIO_REMINDER_TOKEN: randomBytes(32).toString('base64url') };
  if (telegramToken && telegramChat)
    Object.assign(secrets, { TELEGRAM_BOT_TOKEN: telegramToken, TELEGRAM_CHAT_ID: telegramChat });
  if (resendKey && to && from)
    Object.assign(secrets, {
      RESEND_API_KEY: resendKey,
      PRESIDIO_REMINDER_EMAIL: to,
      PRESIDIO_REMINDER_FROM: from,
    });
  if (Object.keys(secrets).length === 1) throw new Error('Nessun canale completo. Nessuna modifica.');
  const ok = await rl.question('\nScrivo questi segreti sul Worker blindoservice? Scrivi CONFERMO: ');
  if (ok.trim() !== 'CONFERMO') throw new Error('Annullato. Nessuna modifica.');
  rl.close();
  await wrangler(JSON.stringify(secrets));
  console.log('\nFATTO. Ora su GitHub › Settings › Secrets and variables › Actions crea:');
  console.log(
    '  PRESIDIO_URL             = indirizzo del sito, es. https://blindoservice.<account>.workers.dev',
  );
  console.log('  PRESIDIO_REMINDER_TOKEN  = ' + secrets.PRESIDIO_REMINDER_TOKEN);
  console.log('Poi avvia a mano il workflow "Promemoria scadenze" per provarlo.');
} catch (e) {
  console.error('\nSTOP: ' + e.message);
  process.exitCode = 1;
} finally {
  rl.close();
}
