// Apartado «Evals»: las páginas de los resultados de los evals, para el administrador (rutas de nivel admin en
// worker.js). Las arma evals/visor.py en la computadora del dueño y las sube evals/subir.py a Workers KV (binding
// EVALS): la página de cada corrida en corrida/<nombre> y la lista de las publicadas en indice. Aquí no se arma
// ninguna página de evals: cada ruta hace una sola lectura de KV y devuelve el HTML tal cual.
//
// Estas rutas se abren navegando, no con fetch, así que sus errores también son páginas (paginaDeError, que usa el
// catch de worker.js para los caminos /api/evals), no el JSON de las demás rutas.
// Las cabeceras prohíben scripts y recursos externos aunque una página trajera algo sin escapar.
import { ErrorApi } from './http.js';

// El nombre del archivo de evals/resultados/ sin .json: 2026-11-16_181130, o con sufijo (-recalificada, -alterada).
const NOMBRE_CORRIDA = /^\d{4}-\d{2}-\d{2}_\d{6}(-[a-z]+)?$/;

// Los caminos cuyas respuestas son páginas, también las de error.
export const CAMINO_EVALS = /^\/api\/evals(\/|$)/;

const CABECERAS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

const pagina = (html, status = 200) => new Response(html, { status, headers: CABECERAS });

function kv(env) {
  if (!env.EVALS) throw new ErrorApi(503, 'Los evals no están configurados en este servidor.');
  return env.EVALS;
}

// GET /api/evals: la lista de corridas publicadas.
export async function indice({ env }) {
  const html = await kv(env).get('indice');
  return pagina(html ?? PAGINA_SIN_CORRIDAS);
}

// GET /api/evals/<nombre>: la página de una corrida. Un nombre que no tiene la forma esperada no llega a KV.
export async function corrida({ env, params: [nombre] }) {
  if (!NOMBRE_CORRIDA.test(nombre)) return pagina(PAGINAS[404], 404);
  const html = await kv(env).get(`corrida/${nombre}`);
  return html === null ? pagina(PAGINAS[404], 404) : pagina(html);
}

// ---------- Páginas fijas ----------
// Textos fijos: no llevan nada de la petición, así que no hay nada que escapar.

const ESTILO = `:root{color-scheme:light dark;--fondo:oklch(0.975 0.004 255);--superficie:oklch(1 0 0);--texto:oklch(0.23 0.015 260);--suave:oklch(0.5 0.015 260);--borde:oklch(0.92 0.006 260);--acento:oklch(0.5 0.19 262)}
@media (prefers-color-scheme:dark){:root{--fondo:oklch(0.16 0.01 260);--superficie:oklch(0.205 0.012 260);--texto:oklch(0.94 0.005 260);--suave:oklch(0.72 0.012 260);--borde:oklch(0.3 0.012 260);--acento:oklch(0.76 0.12 262)}}
*{box-sizing:border-box}body{margin:0;background:var(--fondo);color:var(--texto);font:400 1rem/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
main{max-width:36rem;margin:0 auto;padding:48px 16px}section{background:var(--superficie);border:1px solid var(--borde);border-radius:16px;padding:20px}
h1{font-size:1.25rem;font-weight:650;margin:0 0 8px}p{margin:0 0 12px}.suave{color:var(--suave)}code{font-family:ui-monospace,'SF Mono','Cascadia Code',monospace;font-size:0.875rem;overflow-wrap:anywhere}
a{color:var(--acento);text-underline-offset:2px}a:focus-visible{outline:2px solid var(--acento);outline-offset:2px;border-radius:4px}nav p{margin:0}`;

function armar(titulo, cuerpo, enlaces) {
  const nav = enlaces.map(([href, texto]) => `<a href="${href}">${texto}</a>`).join(' · ');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta name="color-scheme" content="light dark"><title>${titulo} · Evals</title><style>${ESTILO}</style></head>`
    + `<body><main><section><h1>${titulo}</h1>${cuerpo}<nav><p>${nav}</p></nav></section></main></body></html>`;
}

const A_LA_APP = ['/', 'Volver a la app'];
const A_LA_LISTA = ['/api/evals', 'Volver a la lista'];

const PAGINA_SIN_CORRIDAS = armar('Todavía no hay corridas publicadas',
  '<p>Las corridas se publican desde la computadora donde corren los evals, en la carpeta <code>evals/</code>:</p>'
  + '<p><code>uv run subir.py resultados/ARCHIVO.json</code></p>'
  + '<p class="suave">Así se sube al servidor local de <code>npm run dev</code>. Para la app publicada se agrega '
  + '<code>--remoto</code>. Sin archivo, se sube la corrida más reciente.</p>',
  [A_LA_APP]);

const PAGINAS = {
  400: armar('La dirección no es válida', '<p>Revisa el enlace o vuelve a la lista de corridas.</p>', [A_LA_LISTA, A_LA_APP]),
  401: armar('Inicia sesión como administrador',
    '<p>Los evals solo los ve el administrador. Inicia sesión en la app y vuelve a abrir «Evals».</p>', [['/', 'Ir a la app']]),
  403: armar('Solo el administrador puede ver los evals',
    '<p>Tu cuenta no tiene permiso para ver esta página.</p>', [A_LA_APP]),
  404: armar('Esa corrida no está publicada',
    '<p>Puede que el enlace esté mal o que la corrida se haya quitado.</p>', [A_LA_LISTA, A_LA_APP]),
  405: armar('Esta dirección solo se puede abrir', '<p>Las páginas de los evals solo se ven: no reciben datos.</p>',
    [A_LA_LISTA, A_LA_APP]),
  503: armar('Los evals no están disponibles',
    '<p>Este servidor todavía no tiene dónde guardar los evals.</p>', [A_LA_APP]),
  500: armar('No se pudo mostrar esta página', '<p>Intenta de nuevo en un momento.</p>', [A_LA_LISTA, A_LA_APP]),
};

// La página de error de un camino /api/evals: el estado del ErrorApi (401, 403, 404…) o 500 si fue otra cosa.
export function paginaDeError(error) {
  const status = error instanceof ErrorApi ? error.status : 500;
  const html = PAGINAS[status] ?? PAGINAS[status >= 500 ? 500 : 400];
  return pagina(html, status);
}
