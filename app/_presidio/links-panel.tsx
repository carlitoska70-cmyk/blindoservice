'use client';
import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, fmt } from './shared';

type Key = {
  id: string;
  name: string;
  scopes: string[];
  created: string;
  last_used: string | null;
  revoked: string | null;
};
type Proposal = {
  id: string;
  source: string;
  kind: 'dipendente' | 'documento';
  data: any;
  file_id: string | null;
  status: 'in_attesa' | 'accettata' | 'scartata';
  created: string;
};

async function call(body?: unknown) {
  const r = await fetch(
    '/api/collegamenti',
    body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store' },
  );
  const d: any = await r.json();
  if (!r.ok) throw new Error(d.error || 'Operazione non riuscita');
  return d;
}

/**
 * Holding interchange (owner only): keys for the other software and the proposals
 * they send. A proposal changes the registry only after "Accetta".
 */
export default function LinksPanel({ onChanged }: { onChanged: () => Promise<unknown> }) {
  const [state, setState] = useState<{
      scopes: Record<string, string>;
      keys: Key[];
      inbox: Proposal[];
    } | null>(null),
    [busy, setBusy] = useState(false),
    [name, setName] = useState('Gionti Suite'),
    [scopes, setScopes] = useState<string[]>(['documenti:leggi', 'dipendenti:leggi', 'proposte:scrivi']),
    [token, setToken] = useState('');
  const load = () =>
    call()
      .then(setState)
      .catch(() => setState(null));
  useEffect(() => {
    load();
  }, []);
  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!state) return null;
  const pending = state.inbox.filter(i => i.status === 'in_attesa');
  return (
    <>
      <section className="panel" id="proposte">
        <div className="sectionhead">
          <h2>Proposte dagli altri programmi</h2>
          <Badge tone={pending.length ? 'amber' : 'gray'}>{pending.length} da decidere</Badge>
        </div>
        <p className="muted">
          Documenti e dati inviati da Gionti Suite e dagli altri software della holding. Entrano nel registro
          solo se li accetti.
        </p>
        {pending.map(p => (
          <div className="archivedrow" key={p.id}>
            <span>
              <strong>{p.kind === 'dipendente' ? 'Dipendente: ' + p.data.name : p.data.title}</strong>
              <small>
                da {p.source} · {fmt(p.created)}
                {p.kind === 'dipendente' && p.data.role ? ' · ' + p.data.role : ''}
                {p.kind === 'documento' && p.data.expires ? ' · scade ' + fmt(p.data.expires) : ''}
                {p.file_id ? ' · con allegato' : ''}
              </small>
            </span>
            <span className="row">
              {p.file_id && (
                <a
                  className="textbutton"
                  href={'/api/files?id=' + p.file_id}
                  target="_blank"
                  rel="noreferrer"
                >
                  Vedi
                </a>
              )}
              <button
                className="button secondary compact"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await call({ action: 'accept', id: p.id });
                    await onChanged();
                  }, 'Aggiunto al registro')
                }
              >
                <Check size={15} /> Accetta
              </button>
              <button
                className="textbutton"
                disabled={busy}
                onClick={() => run(() => call({ action: 'reject', id: p.id }), 'Proposta scartata')}
              >
                <X size={15} />
              </button>
            </span>
          </div>
        ))}
        {!pending.length && <p className="smallnote">Nessuna proposta in attesa.</p>}
      </section>

      <section className="panel">
        <h2>Collegamenti con gli altri programmi</h2>
        <p className="muted">
          Ogni programma ha la sua chiave e solo i permessi che scegli. Blindo Service resta il registro
          generale: gli altri leggono da qui e propongono quello che manca.
        </p>
        {state.keys.map(k => (
          <div className="archivedrow" key={k.id}>
            <span>
              <strong>
                <KeyRound size={14} /> {k.name}
              </strong>
              <small>
                {k.scopes.join(' · ')} · creata il {fmt(k.created)}
                {k.last_used ? ' · ultimo uso ' + fmt(k.last_used) : ' · mai usata'}
              </small>
            </span>
            {k.revoked ? (
              <Badge>Revocata</Badge>
            ) : (
              <button
                className="button secondary compact"
                disabled={busy}
                onClick={() =>
                  window.confirm(`Revocare la chiave di ${k.name}? Il programma non potrà più collegarsi.`) &&
                  run(() => call({ action: 'revoke-key', id: k.id }), 'Chiave revocata')
                }
              >
                Revoca
              </button>
            )}
          </div>
        ))}
        {token ? (
          <div className="notice">
            <div>
              <strong>Chiave per {name}: copiala ora, non verrà più mostrata.</strong>
              <p className="keybox">{token}</p>
              <div className="row">
                <button
                  className="button secondary compact"
                  onClick={() => navigator.clipboard.writeText(token).then(() => toast.success('Copiata'))}
                >
                  <Copy size={14} /> Copia
                </button>
                <button className="textbutton" onClick={() => setToken('')}>
                  Fatto
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form
            className="linkform"
            onSubmit={e => {
              e.preventDefault();
              run(
                async () => setToken((await call({ action: 'create-key', name, scopes })).token),
                'Chiave creata',
              );
            }}
          >
            <label className="field">
              <span>Programma</span>
              <input
                required
                minLength={2}
                maxLength={60}
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </label>
            {Object.entries(state.scopes).map(([k, label]) => (
              <label className="checkrow" key={k}>
                <input
                  type="checkbox"
                  checked={scopes.includes(k)}
                  onChange={e => setScopes(e.target.checked ? [...scopes, k] : scopes.filter(s => s !== k))}
                />
                {label}
              </label>
            ))}
            <button className="button secondary" disabled={busy || !scopes.length}>
              <KeyRound size={15} /> Crea chiave
            </button>
          </form>
        )}
      </section>
    </>
  );
}
