import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getMember } from '@/lib/operator';
import { recognize } from '@/lib/recognition-service';
import { handleImport } from '@/lib/document-import';
import { documentSchema, confirmedDocumentSchema } from '@/lib/document-schema';
export const dynamic = 'force-dynamic';
const draft = documentSchema.extend({ title: z.string().max(200) });
function handle(req: Request) {
  return handleImport(req, {
    authorize: getMember, // collaborator allowed: document workflows
    db: env.DB,
    bucket: env.BUCKET,
    recognize,
    validate: (data, complete) => (complete ? confirmedDocumentSchema : draft).parse(data),
  });
}
export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
