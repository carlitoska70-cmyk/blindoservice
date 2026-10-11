'use client';
import '../fascicolo/print.css';
import './poster.css';
import { useEffect, useState } from 'react';
import { qrSvg } from '@/lib/qr';
import { Printer } from 'lucide-react';
import { api } from '../_presidio/shared';

// A4 poster for the premises: the QR always encodes this site's own /accesso address.
export default function Poster() {
  const [name, setName] = useState(''),
    [url, setUrl] = useState('');
  useEffect(() => {
    setUrl(location.origin + '/accesso');
    api()
      .then(d => setName(d.profile.name))
      .catch(() => {});
  }, []);
  if (!url) return null;
  const local = /^http:\/\/(localhost|127\.0\.0\.1)/.test(url);
  return (
    <main className="print-page poster">
      <div className="print-actions">
        <button className="button primary" onClick={() => window.print()}>
          <Printer size={16} /> Stampa il cartello
        </button>
        <span>Formato A4. Prima di affiggerlo, inquadra il QR con un telefono e verifica che si apra.</span>
      </div>
      {local && (
        <p className="notice error">
          Stai usando la versione locale: questo QR punta a {url}, che un telefono non può raggiungere. Stampa
          il cartello dal sito pubblicato.
        </p>
      )}
      <section className="poster-sheet">
        <p className="eyebrow">{name || 'PRESIDIO'}</p>
        <h1>Controlli e verifiche documentali</h1>
        <div className="poster-qr" dangerouslySetInnerHTML={{ __html: qrSvg(url) }} />
        <ol>
          <li>Inquadra il codice con la fotocamera del telefono.</li>
          <li>Compila nome, ufficio, ruolo e oggetto del controllo.</li>
          <li>Il responsabile verifica la richiesta e abilita i documenti pertinenti.</li>
        </ol>
        <p className="poster-url">{url}</p>
        <p className="poster-note">
          In alternativa, i documenti possono essere esibiti direttamente dal responsabile. La compilazione
          non sostituisce l’identificazione prevista dalla procedura dell’ente.
        </p>
      </section>
    </main>
  );
}
