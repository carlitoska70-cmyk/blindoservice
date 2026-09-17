declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    PRESIDIO_OWNER_EMAIL?: string;
    OPENAI_API_KEY?: string;
  }
}
