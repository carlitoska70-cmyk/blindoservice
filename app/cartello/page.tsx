import { requireOperator } from '@/lib/operator';
import Poster from './poster';
export const dynamic = 'force-dynamic';
export default async function Cartello() {
  await requireOperator();
  return <Poster />;
}
