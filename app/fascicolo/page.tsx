import { requireOperator } from '@/lib/operator';
import FascicoloPrint from './print';
export const dynamic = 'force-dynamic';
export default async function Fascicolo({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireOperator();
  const { id } = await searchParams;
  return <FascicoloPrint id={id || ''} />;
}
