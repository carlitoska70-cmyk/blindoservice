'use client';
import { useState } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Item = readonly [string, string, LucideIcon];

// Phone navigation: the four most used sections, the rest under "Altro".
export default function BottomNav({
  items,
  primary,
  tab,
  onTab,
}: {
  items: readonly Item[];
  primary: string[];
  tab: string;
  onTab: (tab: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const main = items.filter(([id]) => primary.includes(id));
  const more = items.filter(([id]) => !primary.includes(id));
  const go = (id: string) => {
    setOpen(false);
    onTab(id);
    window.scrollTo({ top: 0 });
  };
  return (
    <>
      {open && (
        <div className="bottommore" role="dialog" aria-label="Altre sezioni">
          {more.map(([id, title, Icon]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => go(id)}>
              <Icon size={19} /> {title}
            </button>
          ))}
        </div>
      )}
      <nav className="bottomnav" aria-label="Sezioni">
        {main.map(([id, title, Icon]) => (
          <button
            key={id}
            className={tab === id && !open ? 'active' : ''}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => go(id)}
          >
            <Icon size={21} />
            <span>{title}</span>
          </button>
        ))}
        <button
          className={open || more.some(([id]) => id === tab) ? 'active' : ''}
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
        >
          {open ? <X size={21} /> : <MoreHorizontal size={21} />}
          <span>Altro</span>
        </button>
      </nav>
    </>
  );
}
