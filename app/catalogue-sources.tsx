import { catalogueSources, catalogueResearchDate, inspectionCatalogue } from '@/lib/inspection-catalogue';
export default function CatalogueSources() {
  return (
    <section className="panel">
      <h2>Fonti della ricerca documentale</h2>
      <p className="muted" style={{ margin: '12px 0' }}>
        {inspectionCatalogue.length} voci organizzative · ricerca del {catalogueResearchDate}. I riferimenti
        sostengono le aree del catalogo; le condizioni del singolo locale e gli aggiornamenti successivi
        richiedono verifica. Le voci da approfondire e quelle precedenti sono indicate separatamente.
      </p>
      <details>
        <summary>Consulta i riferimenti ufficiali</summary>
        {catalogueSources.map(s => (
          <div key={s.id} style={{ padding: '14px 0', borderBottom: '1px solid #e3eaf3' }}>
            <a className="textbutton" href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>
            <p className="smallnote">
              {s.reference} · {s.scope}
              <br />
              {s.note}
            </p>
          </div>
        ))}
      </details>
    </section>
  );
}
