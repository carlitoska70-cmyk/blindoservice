// Worker entry: the site (vinext), the hourly link with the Gionti Holding centrale (signal, evidence
// and staff proposals), the nightly data retention and the weekly news search. The cron schedule is in
// wrangler.jsonc ("triggers"); without HOLDING_SEGNALE_KEY the holding link does nothing, while
// retention runs in every copy (at most once every 20 hours) and the news search once a week from
// Monday 08:00 (Rome) if the AI is set up.
import handler from 'vinext/server/fetch-handler';
import { version } from '../package.json';
import { allCatalogue } from '../lib/catalogue-index';
import { runHolding } from '../lib/holding';
import { syncStaff } from '../lib/holding-staff';
import { staffSummary } from '../lib/staff';
import { runRetention } from '../lib/retention';
import { runNews } from '../lib/news-job';
import { runReminders } from '../lib/reminders-job';
import { reportToPortal, suspended, suspensionBlock } from '../lib/copy';

const catalogue = allCatalogue.map(c => ({ id: c.id, title: c.title }));

export default {
  fetch(request, env, ctx) {
    // A merchant's copy with the subscription suspended: read-only, portal and alerts still work.
    return suspensionBlock(request, env) || handler.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runHolding(
        env,
        { version, release: env.CF_VERSION_METADATA, now: new Date(), staffSummary },
        catalogue,
      ).then(r => console.log('holding', JSON.stringify(r))),
    );
    // The staff of Gionti Suite, proposed to the owner for the employee registry.
    ctx.waitUntil(syncStaff(env, new Date()).then(r => console.log('personale', JSON.stringify(r))));
    ctx.waitUntil(runRetention(env).then(r => console.log('retention', JSON.stringify(r))));
    // No AI work while a merchant's subscription is suspended.
    if (!suspended(env)) ctx.waitUntil(runNews(env).then(r => console.log('novita', JSON.stringify(r))));
    ctx.waitUntil(runReminders(env).then(r => console.log('promemoria', JSON.stringify(r))));
    // Merchants' copies: technical report to the sales portal (counts and version only).
    ctx.waitUntil(reportToPortal(env, version).then(r => console.log('portale', JSON.stringify(r))));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
