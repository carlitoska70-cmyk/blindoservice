'use client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { categories, Entry } from '@/lib/product';

export type Kind = 'document' | 'inspection' | 'task';
export type OpenEntry = (kind: Kind, entry?: Entry | null) => void;
export type Action = (body: unknown, message: string) => Promise<any>;

export const fmt = (s: string) =>
  s
    ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('it-IT', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Europe/Rome',
      })
    : 'Non indicata';
export const time = (s: string) =>
  new Date(s).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Rome',
  });

export const emptyDoc = {
  title: '',
  category: categories[0],
  expires: '',
  issued: '',
  vat: '',
  address: '',
  notes: '',
  fileId: '',
  fileName: '',
  reviewed: false,
  reviewer: '',
  protocol: '',
  catalogId: '',
  priority: 'Prioritario',
  publicDescription: '',
};
export const emptyInspection = {
  authority: '',
  scope: '',
  officers: '',
  reference: '',
  status: 'aperto',
  outcome: '',
  started: '',
  ended: '',
};
export const emptyTask = { title: '', responsible: '', due: '', notes: '', done: false };

export function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: string }) {
  return <span className={'badge ' + tone}>{children}</span>;
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Pick({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(x => (
          <SelectItem key={x} value={x}>
            {x}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  text,
  children,
}: {
  eyebrow: string;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sectiontitle">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {children}
    </div>
  );
}

export async function api(body?: unknown, query = '') {
  const r = await fetch(
    '/api/state' + query,
    body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' },
  );
  const data: any = await r.json();
  if (!r.ok) throw new Error(data.error || 'Operazione non riuscita');
  return data;
}
export async function upload(file: File) {
  const f = new FormData();
  f.append('file', file);
  const r = await fetch('/api/files', { method: 'POST', body: f });
  const data: any = await r.json();
  if (!r.ok) throw new Error(data.error || 'Caricamento non riuscito');
  return data as { id: string; name: string };
}
export function download(text: string, name: string, type = 'application/json') {
  const u = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
