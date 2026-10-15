// Owner notifications over the channels configured with CONFIGURA_PROMEMORIA
// (Telegram bot and/or Resend email). Never throws for "no channel configured".
export type NotifyEnv = Record<string, string | undefined>;

export function channels(e: NotifyEnv) {
  return {
    telegram: !!(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID),
    email: !!(e.RESEND_API_KEY && e.PRESIDIO_REMINDER_EMAIL && e.PRESIDIO_REMINDER_FROM),
  };
}

export async function send(e: NotifyEnv, subject: string, text: string) {
  const sent: string[] = [];
  const on = channels(e);
  if (on.telegram) {
    const r = await fetch(`https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ chat_id: e.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
    if (!r.ok) throw new Error('Telegram ' + r.status);
    sent.push('telegram');
  }
  if (on.email) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + e.RESEND_API_KEY },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        from: e.PRESIDIO_REMINDER_FROM,
        to: [e.PRESIDIO_REMINDER_EMAIL],
        subject,
        text,
      }),
    });
    if (!r.ok) throw new Error('Email ' + r.status);
    sent.push('email');
  }
  return sent;
}
