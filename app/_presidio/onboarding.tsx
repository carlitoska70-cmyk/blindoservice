'use client';
import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

type Step = { done: boolean; title: string; text: string; tab: string; cta: string };
// New key for the readiness guide (0.5.0): it shows again even if the first-run guide was dismissed.
const KEY = 'blindo-pronto-hidden';

// Readiness checklist; disappears when complete or dismissed (remembered on this device).
export default function Onboarding({
  steps,
  onTab,
  title = 'Prepara Blindo Service in pochi passi',
}: {
  steps: Step[];
  onTab: (tab: string) => void;
  title?: string;
}) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(KEY) === '1');
    } catch {
      setHidden(false);
    }
  }, []);
  const done = steps.filter(s => s.done).length;
  if (hidden || done === steps.length) return null;
  return (
    <section className="panel onboarding">
      <div className="sectionhead">
        <div>
          <p className="eyebrow">
            PRONTO PER L’USO · {done} DI {steps.length}
          </p>
          <h2>{title}</h2>
        </div>
        <button
          className="textbutton"
          aria-label="Nascondi la guida"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(KEY, '1');
            } catch {}
          }}
        >
          <X size={18} />
        </button>
      </div>
      <div className="onboardingbar">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol>
        {steps.map(s => (
          <li key={s.title} className={s.done ? 'done' : ''}>
            <span className="onboardingcheck">{s.done && <Check size={14} />}</span>
            <span>
              <strong>{s.title}</strong>
              <small>{s.text}</small>
            </span>
            {!s.done && (
              <button className="button secondary compact" onClick={() => onTab(s.tab)}>
                {s.cta}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
