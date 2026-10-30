declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    PRESIDIO_OWNER_EMAIL?: string;
    OPENAI_API_KEY?: string;
    /** Test only: local OpenAI mock used by the end-to-end server. */
    OPENAI_BASE_URL?: string;
    PRESIDIO_ADMIN_CREDENTIALS?: string;
    PRESIDIO_STAFF_CREDENTIALS?: string;
    PRESIDIO_REMINDER_TOKEN?: string;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    RESEND_API_KEY?: string;
    PRESIDIO_REMINDER_EMAIL?: string;
    PRESIDIO_REMINDER_FROM?: string;
    /** Key from Kassaro OS (chiave_software «blindo»): only in Carlo's own copy. */
    HOLDING_SEGNALE_KEY?: string;
    /** Test only: replaces the centrale address (HTTPS, or HTTP on loopback). */
    HOLDING_URL?: string;
    CF_VERSION_METADATA?: WorkerVersionMetadata;
    /** Merchants' copies (factory): monthly AI cap in euro, suspension, sales portal report. */
    AI_TETTO_EURO?: string;
    BLINDO_SOSPESO?: string;
    BLINDO_COPIA?: string;
    PORTALE_URL?: string;
    PORTALE_CHIAVE?: string;
  }
}
