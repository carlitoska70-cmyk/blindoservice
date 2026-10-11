'use client';
import type { TaskData } from '@/lib/schemas';
import { ClipboardList, Plus } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { dayDiff, Entry } from '@/lib/product';
import { Action, Badge, fmt, OpenEntry, SectionTitle } from './shared';

function tone(task: Entry<TaskData>) {
  if (task.data.done) return 'blue';
  const d = dayDiff(task.data.due);
  return d !== null && d < 0 ? 'red' : 'gray';
}

export default function ActionsTab({
  tasks,
  busy,
  action,
  onOpen,
}: {
  tasks: Entry<TaskData>[];
  busy: boolean;
  action: Action;
  onOpen: OpenEntry;
}) {
  return (
    <>
      <SectionTitle
        eyebrow="DALLA VERIFICA ALL’AZIONE"
        title="Un passo alla volta."
        text="Un responsabile, una data e un risultato per ogni attività."
      >
        <button className="button primary" onClick={() => onOpen('task')}>
          <Plus size={17} />
          Nuova azione
        </button>
      </SectionTitle>
      <div className="tasklist">
        {tasks.map(x => (
          <article className="panel task" key={x.id}>
            <Checkbox
              aria-label={'Completa ' + x.data.title}
              checked={x.data.done}
              disabled={busy}
              onCheckedChange={v =>
                action(
                  {
                    action: 'update',
                    kind: 'task',
                    id: x.id,
                    version: x.updated,
                    data: { ...x.data, done: v === true },
                  },
                  'Azione aggiornata',
                )
              }
            />
            <div>
              <h3 className={x.data.done ? 'completed' : ''}>{x.data.title}</h3>
              <p>
                {x.data.responsible || 'Responsabile da assegnare'} · {fmt(x.data.due)}
              </p>
              {x.data.notes && <p className="muted">{x.data.notes}</p>}
            </div>
            <Badge tone={tone(x)}>{x.data.done ? 'Completata' : 'Da fare'}</Badge>
            <button className="textbutton" onClick={() => onOpen('task', x)}>
              Modifica
            </button>
          </article>
        ))}
      </div>
      {!tasks.length && (
        <div className="panel empty">
          <ClipboardList />
          <h2>Trasforma i dubbi in attività concrete</h2>
          <p>
            Per esempio: reperire un originale, confrontare una planimetria o far verificare un titolo al
            tecnico.
          </p>
          <button className="button secondary" onClick={() => onOpen('task')}>
            Crea la prima azione
          </button>
        </div>
      )}
    </>
  );
}
