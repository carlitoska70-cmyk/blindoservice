// Worker entry: the site (vinext) plus the hourly signal to the Gionti Holding centrale.
// The cron schedule is in wrangler.jsonc ("triggers"); without HOLDING_SEGNALE_KEY it does nothing.
import handler from 'vinext/server/fetch-handler';
import { version } from '../package.json';
import { sendHolding } from '../lib/holding';

export default {
  fetch(request, env, ctx) {
    return handler.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      sendHolding(env, { version, release: env.CF_VERSION_METADATA, now: new Date() }).then(r =>
        console.log('holding', JSON.stringify(r)),
      ),
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;
