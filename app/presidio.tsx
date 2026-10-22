'use client';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Building2,
  ClipboardList,
  Users,
  FolderOpen,
  LockKeyhole,
  Radio,
  ScanLine,
  ShieldCheck,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Toaster, toast } from 'sonner';
import ControlRoom, { roomApi, useRoom } from './control-room';
import { categories, defaultProfile, Entry, Profile } from '@/lib/product';
import type { DocumentData, EmployeeData, InspectionData, TaskData } from '@/lib/schemas';
import { api, emptyDoc, emptyInspection, emptyTask, Kind } from './_presidio/shared';
import { useRecorder } from './_presidio/use-recorder';
import { useLive } from './_presidio/use-live';
import Monitor from './_presidio/monitor';
import AutoShare from './_presidio/auto-share';
import BottomNav from './_presidio/bottom-nav';
import { clearOffline } from '@/lib/offline';
import OverviewTab from './_presidio/overview-tab';
import ArchiveTab from './_presidio/archive-tab';
import ControlTab, { useNoteDraft } from './_presidio/control-tab';
import ActionsTab from './_presidio/actions-tab';
import StaffTab from './_presidio/staff-tab';
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

function mergeRecords(prev: Entry[], changed: Entry[]) {
  const byId = new Map(prev.map(x => [x.id, x]));
  for (const x of changed) byId.set(x.id, x);
  return [...byId.values()].sort((a, b) => b.created.localeCompare(a.created));
}

const STAFF_HIDDEN: string[] = ['room', 'control', 'staff'];
const navigation = [
  ['overview', 'Situazione', ShieldCheck],
  ['archive', 'Documenti', FolderOpen],
  ['catalogue', 'Catalogo', BookOpen],
  ['room', 'Accessi QR', Radio],
  ['control', 'Controlli', ScanLine],
  ['actions', 'Azioni', ClipboardList],
  ['staff', 'Dipendenti', Users],
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

export default function Presidio({ name, role = 'owner' }: { name: string; role?: 'owner' | 'staff' }) {
  // The collaborator works on documents and actions only; the server enforces the same limits.
  const staff = role !== 'owner';
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
  const cursor = useRef('');
  const room = useRoom(!staff);
  const visibleNav = navigation.filter(([id]) => !staff || !STAFF_HIDDEN.includes(id));
  const draft = useNoteDraft();
  const recorder = useRecorder({ setBusy, refresh: () => refresh() });
  const live = useLive({ onArchived: () => refresh() });
  const [monitor, setMonitor] = useState<{ visitId: string | null; inspectionId: string } | null>(null);

  // "Monitora controllo in corso": microphone first (needs the tap), then the inspection
  // file of the visit, then continuous recording with live suggestions.
  async function startMonitor(visitId: string | null, inspectionId?: string) {
    if (recorder.pending) {
      toast.info('Archivia prima la registrazione manuale in corso.');
      return;
    }
    try {
      await live.requestMicrophone();
      const id = visitId ? (await roomApi('monitor', { visitId })).inspectionId : inspectionId!;
      setMonitor({ visitId, inspectionId: id });
      await live.start(id);
      await refresh().catch(() => {});
    } catch (e) {
      const err = e as Error;
      toast.error(
        err.name === 'NotAllowedError'
          ? 'Consenti l’uso del microfono per registrare il controllo.'
          : err.message,
      );
    }
  }

  const liveVisits =
    room.data?.visits.filter(
      (v: any) =>
        v.status !== 'chiusa' &&
        Date.parse(v.expires) > room.now &&
        room.now - Date.parse(v.last_seen) < 20000,
    ) || [];
  // Sessions worth monitoring: open, not expired, inspector seen in the last 10 minutes
  // (the phone may go to sleep while the inspection continues).
  const activeVisits =
    room.data?.visits.filter(
      (v: any) =>
        v.status !== 'chiusa' &&
        Date.parse(v.expires) > room.now &&
        room.now - Date.parse(v.last_seen) < 600000 &&
        v.status !== 'identificazione',
    ) || [];
  // Archived records are kept (and restorable) but hidden from every working view.
  const active = useMemo(() => records.filter(x => !x.data?.archivedAt), [records]);
  const archived = useMemo(() => records.filter(x => x.data?.archivedAt), [records]);
  const documents = useMemo(
    () => active.filter(x => x.kind === 'document') as Entry<DocumentData>[],
    [active],
  );
  const inspections = useMemo(
    () => active.filter(x => x.kind === 'inspection') as Entry<InspectionData>[],
    [active],
  );
  const tasks = useMemo(() => active.filter(x => x.kind === 'task') as Entry<TaskData>[], [active]);
  const employees = useMemo(
    () => records.filter(x => x.kind === 'employee' && !x.data?.archivedAt) as Entry<EmployeeData>[],
    [records],
  );

  async function refresh(initial = false) {
    try {
      // After the first load only records changed since the last cursor are fetched.
      const since = initial ? '' : cursor.current;
      const data = await api(undefined, since ? '?since=' + encodeURIComponent(since) : '');
      setProfile(data.profile);
      if (initial) setDraftProfile(data.profile);
      setRecords(prev => (data.partial ? mergeRecords(prev, data.records) : data.records));
      if (data.cursor) cursor.current = data.cursor;
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
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
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
    cursor.current = rows.reduce((max, x) => (x.updated > max ? x.updated : max), '');
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
            <LockKeyhole size={15} /> {staff ? 'Accesso collaboratore' : 'Spazio riservato'}
          </span>
          <div className="avatar" title={name}>
            {name.slice(0, 1).toUpperCase()}
          </div>
          <form
            method="post"
            action="/api/auth/logout"
            onSubmit={async e => {
              e.preventDefault();
              if (
                (recorder.pending || live.recording) &&
                !window.confirm('Ci sono una registrazione o un audio non salvato. Vuoi uscire comunque?')
              )
                return;
              const form = e.currentTarget;
              // Offline copies of documents must not outlive the session on this device.
              await clearOffline().catch(() => {});
              form.submit();
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
            {visibleNav.map(([id, title, Icon]) => (
              <TabsTrigger value={id} key={id}>
                <Icon size={17} />
                {title}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <main className="workspace">
          {activeVisits.length > 0 && !monitor && (
            <button className="monitorcta" onClick={() => startMonitor(activeVisits[0].id)}>
              <span className="livedot" />
              <span>
                <strong>Monitora controllo in corso</strong>
                <small>
                  {activeVisits[0].data?.firstName
                    ? `${activeVisits[0].data.firstName} ${activeVisits[0].data.lastName} · ${activeVisits[0].data.office}`
                    : 'Un agente ha aperto il portale QR'}
                  {activeVisits.length > 1 ? ` · ${activeVisits.length} sessioni` : ''}
                </small>
                <em>Avvia la registrazione audio su questo dispositivo e i suggerimenti dell’IA</em>
              </span>
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
                  staff={staff}
                  requirements={active.filter(x => x.kind === 'requirement').length}
                  portalEnabled={!!room.data?.portal?.enabled}
                  profile={profile}
                  documents={documents}
                  inspections={inspections}
                  tasks={tasks}
                  records={records}
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
                    records={active}
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
                <AutoShare room={room} documents={documents} onSaved={() => refresh()} />
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
                  records={active}
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
                  onMonitor={id => startMonitor(null, id)}
                  liveReady={!!room.data?.aiReady}
                />
              </TabsContent>
              <TabsContent value="staff">
                <StaffTab
                  employees={employees}
                  documents={documents}
                  allDocuments={records.filter(x => x.kind === 'document') as Entry<DocumentData>[]}
                  busy={busy}
                  action={action}
                  onNewDocument={(emp, item) =>
                    openPrefilled('document', {
                      ...emptyDoc,
                      title: (item.label + ' – ' + emp.data.name).slice(0, 200),
                      category: 'Personale e formazione',
                      holder: emp.data.name,
                      employeeId: emp.id,
                    })
                  }
                />
              </TabsContent>
              <TabsContent value="actions">
                <ActionsTab tasks={tasks} busy={busy} action={action} onOpen={open} />
              </TabsContent>
              <TabsContent value="sources">
                <SourcesTab
                  canRefresh={!staff}
                  onTask={(title, notes) => openPrefilled('task', { ...emptyTask, title, notes })}
                />
              </TabsContent>
              <TabsContent value="profile">
                <ProfileTab
                  onChanged={() => refresh()}
                  staff={staff}
                  draft={draftProfile}
                  onDraft={setDraftProfile}
                  archived={archived}
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
      {monitor && (
        <Monitor
          room={room}
          visitId={monitor.visitId}
          inspectionId={monitor.inspectionId}
          live={live}
          documents={documents}
          onClose={() => {
            setMonitor(null);
            live.reset();
          }}
        />
      )}
      <BottomNav
        items={visibleNav}
        primary={
          staff
            ? ['overview', 'archive', 'catalogue', 'actions']
            : ['overview', 'archive', 'control', 'actions']
        }
        tab={tab}
        onTab={setTab}
      />
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
            onArchive={async entry => {
              const ok = await action(
                { action: 'archive', kind: entry.kind, id: entry.id, version: entry.updated },
                'Scheda archiviata',
              );
              if (ok) setModal('');
            }}
          />
        )}
      </Suspense>
    </div>
  );
}
