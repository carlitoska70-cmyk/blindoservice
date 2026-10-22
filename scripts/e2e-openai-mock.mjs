// Local stand-in for the OpenAI API used only by the end-to-end tests.
import http from 'node:http';

const LINES = [
  'Buongiorno, polizia municipale. Mi faccia vedere la SCIA per favore.',
  'Se non me la fa vedere subito le chiudo il locale oggi stesso.',
  'Va bene, adesso controllo anche la planimetria.',
];
let n = 0;
const port = Number(process.env.E2E_OPENAI_PORT || 8798);

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c.length < 200000 ? c : ''));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/audio/transcriptions') {
        res.end(JSON.stringify({ text: LINES[n++ % LINES.length] }));
        return;
      }
      if (req.url === '/v1/responses') {
        if (body.includes('osservatorio')) {
          const news = {
            notizie: [
              {
                titolo: 'Nuovo regolamento dehors',
                fonte: 'Comune di Palermo',
                url: 'https://www.comune.palermo.it/dehors',
                sintesi: 'Cambiano le regole per i dehors.',
                perche: 'Hai un dehors su area pedonale.',
                azioni: ['Verifica la concessione'],
                rilevanza: 'alta',
              },
            ],
          };
          res.end(
            JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(news) }] }] }),
          );
          return;
        }
        const report = body.includes('rapporto finale');
        const out = report
          ? {
              motivo: 'Verifica della SCIA',
              sintesi: 'Richiesta della SCIA con prospettazione di chiusura immediata.',
              possibiliViolazioni: [
                {
                  titolo: 'Minaccia di chiusura immediata',
                  descrizione: 'Chiusura prospettata senza provvedimento.',
                  citazione: 'le chiudo il locale oggi stesso',
                  riferimento: '',
                  gravita: 'alta',
                  verifica: 'Ascoltare la registrazione',
                },
              ],
              puntiForza: [{ testo: 'SCIA esibita dal portale', citazione: 'Mi faccia vedere la SCIA' }],
              azioni: ['Chiedere copia del verbale'],
            }
          : {
              question: 'Mi faccia vedere la SCIA',
              answer: 'Certo, la SCIA è nel portale: cerchi “scia”.',
              documents: [],
              searchHint: 'scia',
              caution: 'Legga con calma il verbale prima di firmarlo.',
              urgency: 'normale',
            };
        res.end(
          JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(out) }] }] }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  })
  .listen(port, '127.0.0.1');
