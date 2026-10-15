import { requireOperator } from '@/lib/operator';
import ReportView from './report-view';
export const dynamic = 'force-dynamic';
export default async function Rapporto({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireOperator();
  const { id } = await searchParams;
  return <ReportView id={id || ''} />;
}
