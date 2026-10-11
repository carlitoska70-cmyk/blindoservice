import { recognize } from '@/lib/recognition-service';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  return recognize(req);
}
