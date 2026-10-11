'use client';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Building2,
  ClipboardList,
  FolderOpen,
  LockKeyhole,
  Radio,
  ScanLine,
  ShieldCheck,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Toaster, toast } from 'sonner';
import ControlRoom, { useRoom } from './control-room';
import { categories, defaultProfile, Entry, Profile } from '@/lib/product';
import { api, emptyDoc, emptyInspection, emptyTask, Kind } from './_presidio/shared';
import { useRecorder } from './_presidio/use-recorder';
import OverviewTab from './_presidio/overview-tab';
import ArchiveTab from './_presidio/archive-tab';
import ControlTab, { useNoteDraft } from './_presidio/control-tab';
import ActionsTab from './_presidio/actions-tab';
import SourcesTab from './_presidio/sources-tab';
import ProfileTab from './_presidio/profile-tab';

// Heavy, on-demand parts (catalogue data, camera, PDF conversion) load in separate chunks.
const CataloguePanel = lazy(() => import('./catalogue-workbench'));
const DocumentImporter = lazy(() => import('./document-importer'));
const EntryDialog = lazy(() => import('./_presidio/entry-dialog'));
const pending = <div className="loading">Caricamento…</div>;
// Only needed once the catalogue is in use; keeps the matching module out of the first load.
const catalogLink = async (data: any, id: string, add: boolean) =>
  (await import('@/lib/catalogue-matching')).prepareCatalogLink(data, id, add);

const navigation = [
  ['overview', 'Situazione', ShieldCheck],
  ['archive', 'Documenti', FolderOpen],
  ['catalogue', 'Catalogo', BookOpen],
  ['room', 'Accessi QR', Radio],
  ['control', 'Controlli', ScanLine],
  ['actions', 'Azioni', ClipboardList],
  ['sources', 'Norme e progetto', BookOpen],
  ['profile', 'Azienda', Building2],
] as const;

// Exposes a read-only archive search to browser agents that implement document.modelContext.
function useModelContextSearch(onResult: (query: string, records: Entry[]) => void) {
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: 'search_presidio_documents',
          title: 'Cerca documenti in Presidio',
          description:
            'Legge i metadati dell’archivio dell’utente e apre la ricerca. Non trasmette allegati.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string', maxLength: 200 } },
            required: ['query'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (input: any) => {
            if (
              !input ||
              typeof input.query !== 'string' ||
              input.query.length > 200 ||
              Object.keys(input).some(x => x !== 'query')
            )
              throw new Error('Query non valida');
            const data = await api();
            onResult(input.query, data.records);
            return data.records
              .filter(
                (x: Entry) =>
                  x.kind === 'document' && x.data.title.toLowerCase().includes(input.query.toLowerCase()),
              )
              .map((x: Entry) => ({
                id: x.id,
                title: x.data.title,
                category: x.data.category,
                expires: x.data.expires,
              }));
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
    // Registered once; onResult only calls state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export default function Presidio({ name }: { name: string }) {
  const [tab, setTab] = useState('overview'),
    [profile, setProfile] = useState<Profile>(defaultProfile),
    [draftProfile, setDraftProfile] = useState<Profile>(defaultProfile),
    [records, setRecords] = useState<Entry[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false),
    [modal, setModal] = useState<Kind | ''>(''),
    [editing, setEditing] = useState<Entry | null>(null),
    [form, setForm] = useState<any>({}),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('Tutte'),
    [selected, setSelected] = useState(''),
    [importUsed, setImportUsed] = useState(false),
    [dialogUsed, setDialogUsed] = useState(false);
  const room = useRoom();
  const draft = useNoteDraft();
  const recorder = useRecorder({ setBusy, refresh: () => refresh() });

  const liveVisits =
    room.data?.visits.filter(
      (v: any) =>
        v.status !== 'chiusa' &&
        Date.parse(v.expires) > room.now &&
        room.now - Date.parse(v.last_seen) < 20000,
    ) || [];
  const documents = useMemo(() => records.filter(x => x.kind === 'document'), [records]);
  const inspections = useMemo(() => records.filter(x => x.kind === 'inspection'), [records]);
  const tasks = useMemo(() => records.filter(x => x.kind === 'task'), [records]);

  async function refresh(initial = false) {
    try {
      const data = await api();
      setProfile(data.profile);
      if (initial) setDraftProfile(data.profile);
      setRecords(data.records);
      setError('');
      return data;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh(true)
      .catch(() => {})
      .finally(() => {
        if (location.hash === '#controllo') setTab('control');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // On narrow screens the tab bar scrolls: keep the active tab in view.
  useEffect(() => {
    document
      .querySelector('.navigation [data-state="active"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [tab]);
  useModelContextSearch((q, rows) => {
    setQuery(q);
    setTab('archive');
    setRecords(rows);
  });

  async function action(body: unknown, message: string) {
    setBusy(true);
    try {
      const result = await api(body);
      await refresh();
      toast.success(message);
      return result;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function linkMany(c: any, docs: any[]) {
    setBusy(true);
    const successIds: string[] = [],
      failures: any[] = [];
    try {
      for (const doc of docs) {
        try {
          await api({
            action: 'update',
            kind: 'document',
            id: doc.id,
            version: doc.updated,
            data: await catalogLink(doc.data, c.id, true),
          });
          successIds.push(doc.id);
        } catch (e) {
          failures.push({ id: doc.id, title: doc.data.title, error: (e as Error).message });
        }
      }
      try {
        await refresh();
      } catch {
        toast.error('Abbinamenti salvati: ricarica la pagina per aggiornare l’elenco.');
      }
      return { successIds, failures };
    } finally {
      setBusy(false);
    }
  }
  function open(kind: Kind, entry: Entry | null = null) {
    if (kind === 'document' && !entry) {
      setImportUsed(true);
      setImportOpen(true);
      return;
    }
    setEditing(entry);
    setForm(
      entry
        ? { ...entry.data }
        : { ...(kind === 'document' ? emptyDoc : kind === 'inspection' ? emptyInspection : emptyTask) },
    );
    setDialogUsed(true);
    setModal(kind);
  }
  function openPrefilled(kind: Kind, data: Record<string, unknown>) {
    setEditing(null);
    setForm(data);
    setDialogUsed(true);
    setModal(kind);
  }
  async function saveForm(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setBusy(true);
    try {
      const data = { ...form };
      if (modal === 'inspection' && !editing) data.started = new Date().toISOString();
      const r = await api({
        action: editing ? 'update' : 'create',
        kind: modal,
        id: editing?.id,
        version: editing?.updated,
        data,
      });
      await refresh();
      if (modal === 'inspection') {
        setSelected(r.id);
        setTab('control');
      }
      setModal('');
      toast.success('Salvato nell’archivio');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function goToInspection(id: string, message = 'Archivia prima l’audio in corso.') {
    if (recorder.pending) {
      toast.info(message);
      return;
    }
    setSelected(id);
    setTab('control');
  }

  return (
    <div className="presidio">
      <Toaster richColors position="bottom-right" />
      <header className="masthead">
        {/* Full reload on purpose: next/link duplicates React under vinext dev. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="brand" href="/" aria-label="Presidio, pagina iniziale">
          <span className="brandmark">
            <ShieldCheck />
          </span>
          <span>
            PRESIDIO<small>Il fascicolo della tua impresa</small>
          </span>
        </a>
        <div className="header-right">
          <span>
            <LockKeyhole size={15} /> Spazio riservato
          </span>
          <div className="avatar" title={name}>
            {name.slice(0, 1).toUpperCase()}
          </div>
          <form
            method="post"
            action="/api/auth/logout"
            onSubmit={e => {
              if (
                recorder.pending &&
                !window.confirm('Ci sono una registrazione o un audio non salvato. Vuoi uscire comunque?')
              )
                e.preventDefault();
            }}
          >
            <button className="button secondary compact" type="submit">
              Esci
            </button>
          </form>
        </div>
      </header>
      <Tabs value={tab} onValueChange={setTab} className="shell">
        <div className="navwrap">
          <TabsList className="navigation">
            {navigation.map(([id, title, Icon]) => (
              <TabsTrigger value={id} key={id}>
                <Icon size={17} />
                {title}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <main className="workspace">
          {liveVisits.length > 0 && (
            <button className="livealert" onClick={() => setTab('room')}>
              <span className="livedot" />
              <strong>
                QR IN USO · {liveVisits.length} {liveVisits.length === 1 ? 'sessione' : 'sessioni'}
              </strong>
              <span>Apri il controllo in diretta →</span>
            </button>
          )}
          {recorder.rec && (
            <div className="notice error" role="status">
              <strong>
                Microfono attivo · {Math.floor(recorder.elapsed / 60)} min {recorder.elapsed % 60} s
              </strong>
              <button onClick={recorder.stop}>Ferma registrazione</button>
            </div>
          )}
          <div className="companyline">
            <span>{profile.name}</span>
            <span>
              {profile.city} · {profile.region}
            </span>
          </div>
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button onClick={() => refresh(true).catch(() => {})}>Riprova</button>
            </div>
          )}
          {loading ? (
            <div className="loading">Apertura del tuo archivio…</div>
          ) : (
            <>
              <TabsContent value="overview">
                <OverviewTab
                  profile={profile}
                  documents={documents}
                  inspections={inspections}
                  tasks={tasks}
                  onOpen={open}
                  onTab={setTab}
                  onFilter={c => {
                    setFilter(c);
                    setTab('archive');
                  }}
                  onInspection={id => goToInspection(id)}
                />
              </TabsContent>
              <TabsContent value="catalogue">
                <Suspense fallback={pending}>
                  <CataloguePanel
                    onRefresh={refresh}
                    onLinkMany={linkMany}
                    records={records}
                    profile={profile}
                    busy={busy}
                    onEdit={doc => open('document', doc)}
                    onLink={async (c, doc, add) =>
                      action(
                        {
                          action: 'update',
                          kind: 'document',
                          id: doc.id,
                          version: doc.updated,
                          data: await catalogLink(doc.data, c.id, add),
                        },
                        add ? 'Documento abbinato' : 'Abbinamento rimosso',
                      )
                    }
                    onTask={c =>
                      openPrefilled('task', {
                        ...emptyTask,
                        title: ('Verificare / reperire: ' + c.title).slice(0, 200),
                        notes: c.condition + '\n' + c.source,
                      })
                    }
                    onAdd={c =>
                      openPrefilled('document', {
                        ...emptyDoc,
                        title: c.title,
                        category: categories.includes(c.category) ? c.category : 'Altro',
                        catalogId: c.id,
                        catalogIds: [c.id],
                        priority: c.priority,
                        publicDescription: c.description,
                        notes:
                          'Applicabilità da verificare: ' +
                          c.condition +
                          '\nRiferimento di area: ' +
                          c.source,
                      })
                    }
                    onSave={(c, status, notes, old) =>
                      action(
                        {
                          action: old ? 'update' : 'create',
                          kind: 'requirement',
                          id: old?.id,
                          version: old?.updated,
                          data: { catalogId: c.id, status, notes, reviewer: name },
                        },
                        'Valutazione salvata',
                      )
                    }
                  />
                </Suspense>
              </TabsContent>
              <TabsContent value="room">
                <ControlRoom
                  room={room}
                  documents={documents}
                  onInspection={async id => {
                    if (recorder.pending) {
                      toast.info('Ferma e archivia l’audio prima di cambiare fascicolo.');
                      return;
                    }
                    await refresh();
                    goToInspection(id);
                  }}
                />
              </TabsContent>
              <TabsContent value="archive">
                <ArchiveTab
                  documents={documents}
                  query={query}
                  onQuery={setQuery}
                  filter={filter}
                  onFilter={setFilter}
                  onOpen={open}
                />
              </TabsContent>
              <TabsContent value="control">
                <ControlTab
                  profile={profile}
                  records={records}
                  documents={documents}
                  inspections={inspections}
                  selected={selected}
                  onSelect={setSelected}
                  recorder={recorder}
                  draft={draft}
                  busy={busy}
                  aiReady={!!room.data?.aiReady}
                  action={action}
                  onOpen={open}
                  onTab={setTab}
                  onRefresh={() => refresh()}
                />
              </TabsContent>
              <TabsContent value="actions">
                <ActionsTab tasks={tasks} busy={busy} action={action} onOpen={open} />
              </TabsContent>
              <TabsContent value="sources">
                <SourcesTab />
              </TabsContent>
              <TabsContent value="profile">
                <ProfileTab
                  profile={profile}
                  draft={draftProfile}
                  onDraft={setDraftProfile}
                  records={records}
                  busy={busy}
                  action={action}
                />
              </TabsContent>
            </>
          )}
          <footer className="footer">
            <span>
              PRESIDIO <span>·</span> Archivio e assistenza organizzativa
            </span>
            <span>Valutazioni legali affidate al professionista</span>
          </footer>
        </main>
      </Tabs>
      {/* Mounted on first use, then kept mounted so an import queue survives closing the dialog. */}
      <Suspense>
        {importUsed && (
          <DocumentImporter
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onSaved={() => refresh()}
          />
        )}
        {dialogUsed && (
          <EntryDialog
            kind={modal}
            editing={editing}
            form={form}
            onForm={setForm}
            busy={busy}
            onBusy={setBusy}
            onClose={() => setModal('')}
            onSubmit={saveForm}
          />
        )}
      </Suspense>
    </div>
  );
}
