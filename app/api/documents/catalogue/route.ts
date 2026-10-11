import { env } from 'cloudflare:workers';
import { getMember } from '@/lib/operator';
import { recognize } from '@/lib/recognition-service';
import { allCatalogue } from '@/lib/catalogue-index';
import { withCatalogLinks } from '@/lib/catalogue-matching';
import { decideCatalogue } from '@/lib/catalogue-decision';
import { handleCatalogueBatch } from '@/lib/catalogue-batch';
export const dynamic = 'force-dynamic';
const valid = new Set(allCatalogue.map(c => c.id));
function handle(req: Request) {
  return handleCatalogueBatch(req, {
    authorize: getMember, // collaborator allowed: document workflows
    db: env.DB,
    recognize,
    decide: (r, p) => decideCatalogue(r, p, allCatalogue),
    link: withCatalogLinks,
    validIds: ids => ids.every(id => valid.has(id)),
  });
}
export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
