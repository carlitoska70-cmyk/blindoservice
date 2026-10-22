// Worker entry: the site (vinext), the hourly signal to the Gionti Holding centrale, the nightly
// data retention and the weekly news search. The cron schedule is in wrangler.jsonc ("triggers");
// without HOLDING_SEGNALE_KEY the signal does nothing, while retention runs in every copy (at most
// once every 20 hours) and the news search once a week from Monday 08:00 (Rome) if the AI is set up.
import handler from 'vinext/server/fetch-handler';
import { version } from '../package.json';
import { sendHolding } from '../lib/holding';
import { runRetention } from '../lib/retention';
import { runNews } from '../lib/news-job';

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
    ctx.waitUntil(runRetention(env).then(r => console.log('retention', JSON.stringify(r))));
    ctx.waitUntil(runNews(env).then(r => console.log('novita', JSON.stringify(r))));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
