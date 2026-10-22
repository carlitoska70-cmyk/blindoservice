// Worker entry: the site (vinext) plus the hourly link with the Gionti Holding centrale.
// The cron schedule is in wrangler.jsonc ("triggers"); without HOLDING_SEGNALE_KEY it does nothing.
import handler from 'vinext/server/fetch-handler';
import { version } from '../package.json';
import { allCatalogue } from '../lib/catalogue-index';
import { runHolding } from '../lib/holding';

const catalogue = allCatalogue.map(c => ({ id: c.id, title: c.title }));

export default {
  fetch(request, env, ctx) {
    return handler.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runHolding(env, { version, release: env.CF_VERSION_METADATA, now: new Date() }, catalogue).then(r =>
        console.log('holding', JSON.stringify(r)),
      ),
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;
