// Banco de CPU del asistente (src/asistente.js) con el proveedor del modelo y D1 simulados: sin red y sin gastar saldo.
// Está fuera de src/ y de public/: no entra en el Worker ni en los archivos estáticos.
//
// Uso: node pruebas/banco-cpu.mjs [escenario] [repeticiones] [opciones]
//   escenario:
//     corta     una consulta y 30 fragmentos de texto (por defecto)
//     larga     una consulta y 800 fragmentos
//     longitud  como corta, pero el modelo termina por max_tokens (resultado incompleta)
//     muchas    62 llamadas de herramienta: una con argumentos enormes, una que no es JSON y 60 normales
//     rechazo   el proveedor responde 401 a la primera llamada (resultado error, motivo proveedor-401)
//   repeticiones: peticiones calientes después de la fría (100 por defecto).
//   --carpeta <ruta>  mide otra copia del proyecto en vez de esta (ver «Antes y después» abajo).
//   --sin-cache       el proveedor no manda prompt_tokens_details: tokens_cache debe quedar en NULL.
//   --falla-version   falla la lectura de version_datos: la columna debe quedar en NULL.
//   --fila            imprime la fila que se escribiría en ejecuciones_asistente.
//
// Qué mide: process.threadCpuUsage() (solo el hilo principal, como el CPU de un Worker) desde que entra a
// conversar() hasta que terminan el flujo y las tareas de waitUntil. La primera petición del proceso es «fría»
// (JIT sin calentar); «caliente» es la mediana de las siguientes. D1 responde con datos fijos: en un Worker es E/S
// y no cuenta como CPU. Las cifras dependen de la máquina y de su carga: compara solo corridas hechas igual y a la vez.
//
// Antes y después de un cambio (ejemplo con el commit 11fd5bc como «antes»):
//   mkdir -p /tmp/antes && git archive 11fd5bc src public/js package.json | tar -x -C /tmp/antes
//   ln -s "$PWD/node_modules" /tmp/antes/node_modules
//   for i in 1 2 3 4 5 6 7; do node pruebas/banco-cpu.mjs larga --carpeta /tmp/antes; node pruebas/banco-cpu.mjs larga; done
// y toma la mediana de caliente_ms de cada lado. Referencia del 2026-11-13 (Node 26, 7 procesos intercalados,
// etapa 1 del asistente): corta ≈ 3.0 ms y larga ≈ 19–20 ms.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const argumentos = process.argv.slice(2);
const bandera = (nombre) => argumentos.includes(nombre);
const valorDe = (nombre) => {
  const i = argumentos.indexOf(nombre);
  return i >= 0 ? argumentos[i + 1] : undefined;
};
const sueltos = argumentos.filter((a, i) => !a.startsWith('--') && !argumentos[i - 1]?.startsWith('--carpeta'));
const [escenario = 'corta', repeticionesTexto = '100'] = sueltos;
const repeticiones = Number(repeticionesTexto);
const ESCENARIOS = ['corta', 'larga', 'longitud', 'muchas', 'rechazo'];
if (!ESCENARIOS.includes(escenario) || !Number.isInteger(repeticiones) || repeticiones < 1) {
  console.error(`Uso: node pruebas/banco-cpu.mjs [${ESCENARIOS.join('|')}] [repeticiones ≥ 1] [opciones]. Ver el comentario inicial.`);
  process.exit(1);
}
const carpeta = path.resolve(valorDe('--carpeta') ?? fileURLToPath(new URL('..', import.meta.url)));
const medirCpu = process.threadCpuUsage ? (antes) => process.threadCpuUsage(antes) : (antes) => process.cpuUsage(antes);

// ---------- Proveedor simulado: SSE con el formato de la API de chat de DeepSeek (compatible con OpenAI) ----------
const codificador = new TextEncoder();
const base = { id: 'sim', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', system_fingerprint: 'fp' };
const evento = (datos) => codificador.encode(`data: ${JSON.stringify({ ...base, ...datos })}\n\n`);
const delta = (d, fin = null) => evento({ choices: [{ index: 0, delta: d, logprobs: null, finish_reason: fin }] });
const FIN = codificador.encode('data: [DONE]\n\n');

function rondaHerramienta() {
  return [
    delta({ role: 'assistant', content: '' }),
    delta({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'buscar_productos', arguments: '' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: '{"cantidad_max":' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: ' 0}' } }] }),
    delta({}, 'tool_calls'),
  ];
}

function rondaMuchas() {
  const llamadas = [
    { name: 'buscar_productos', arguments: JSON.stringify({ texto: 'x'.repeat(5000) }) },
    { name: 'resumen_inventario', arguments: '{no es json' },
  ];
  for (let i = 0; i < 60; i++) {
    llamadas.push({ name: 'buscar_productos', arguments: JSON.stringify({ texto: `producto ${i} `.repeat(15) }) });
  }
  return [
    delta({ role: 'assistant', content: '' }),
    ...llamadas.map((funcion, index) => delta({ tool_calls: [{ index, id: `call_${index}`, type: 'function', function: funcion }] })),
    delta({}, 'tool_calls'),
  ];
}

function rondaTexto(fragmentos, fin) {
  const trozos = [delta({ role: 'assistant', content: '' })];
  for (let i = 0; i < fragmentos; i++) trozos.push(delta({ content: i % 10 === 9 ? 'uno\n' : 'dos ' }));
  trozos.push(delta({ content: '' }, fin));
  return trozos;
}

// El uso llega en un fragmento final sin choices, solo si la petición pide stream_options.include_usage.
function uso(entrada, salida, cache) {
  const detalle = bandera('--sin-cache')
    ? {}
    : { prompt_tokens_details: { cached_tokens: cache }, prompt_cache_hit_tokens: cache, prompt_cache_miss_tokens: entrada - cache };
  return evento({ choices: [], usage: { prompt_tokens: entrada, completion_tokens: salida, total_tokens: entrada + salida, ...detalle } });
}

const FRAGMENTOS = { corta: 30, larga: 800, longitud: 30, muchas: 30 };
globalThis.fetch = async (_url, init) => {
  if (escenario === 'rechazo') {
    return new Response(JSON.stringify({ error: { message: 'Authentication Fails (simulado)', type: 'authentication_error' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  const cuerpo = JSON.parse(init.body);
  const yaConsulto = cuerpo.messages.some((m) => m.role === 'tool');
  const trozos = yaConsulto
    ? rondaTexto(FRAGMENTOS[escenario], escenario === 'longitud' ? 'length' : 'stop')
    : escenario === 'muchas' ? rondaMuchas() : rondaHerramienta();
  if (cuerpo.stream_options?.include_usage) trozos.push(yaConsulto ? uso(1310, 34, 1152) : uso(1223, 24, 1024));
  trozos.push(FIN);
  let i = 0;
  const flujo = new ReadableStream({
    pull(controlador) {
      if (i < trozos.length) controlador.enqueue(trozos[i++]);
      else controlador.close();
    },
  });
  return new Response(flujo, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

// ---------- D1 simulado: respuestas fijas para cada consulta que hace el asistente ----------
const AGOTADOS = [
  { codigo: '7501000000011', nombre: 'Arroz', precio_centavos: 3200, cantidad: 0 },
  { codigo: '7501000000028', nombre: 'Atun', precio_centavos: 2450, cantidad: 0 },
  { codigo: '7501000000035', nombre: 'Chocolate', precio_centavos: 1800, cantidad: 0 },
  { codigo: '7501000000042', nombre: 'Jabon', precio_centavos: 2100, cantidad: 0 },
];
const filas = [];

function sentencia(sql) {
  const s = {
    valores: [],
    bind(...valores) {
      s.valores = valores;
      return s;
    },
    async first(columna) {
      if (sql.includes('FROM intentos')) return { n: 0, primero: null };
      if (sql.includes('FROM contadores')) {
        if (bandera('--falla-version')) throw new Error('D1 simulado: fallo al leer contadores');
        return columna ? 42 : { valor: 42 };
      }
      return { productos: 15, unidades: 163, valor_centavos: 673520, agotados: 4, minimo: 1000, maximo: 14900, promedio: 5000 };
    },
    async all() {
      return { results: [] };
    },
    async run() {
      return { meta: { changes: 1 } };
    },
    // Lo que devuelve dentro de un batch.
    resultado() {
      if (sql.includes('COUNT(*) AS total')) return { results: [{ total: 4, unidades: 0, valor_centavos: 0 }] };
      if (sql.includes('SELECT codigo, nombre')) return { results: AGOTADOS };
      if (sql.startsWith('INSERT INTO ejecuciones_asistente')) {
        const columnas = sql.match(/\(([^)]*)\)\s*VALUES/)[1].split(',').map((c) => c.trim());
        filas.push(Object.fromEntries(columnas.map((c, i) => [c, s.valores[i]])));
      }
      return { results: [], meta: { changes: 1 } };
    },
  };
  return s;
}

const env = {
  DEEPSEEK_API_KEY: 'simulada',
  MODELO_ASISTENTE: 'deepseek-flash',
  DB: { prepare: sentencia, batch: async (lista) => lista.map((s) => s.resultado()) },
};

// ---------- Peticiones ----------
const { conversar } = await import(pathToFileURL(path.join(carpeta, 'src/asistente.js')).href);

async function unaPeticion() {
  const pendientes = [];
  const ejecucion = { waitUntil: (promesa) => pendientes.push(promesa) };
  const request = new Request('http://localhost:8787/api/asistente', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mensajes: [{ rol: 'usuario', texto: '¿Qué productos están agotados?' }] }),
  });
  const antes = medirCpu();
  let estado;
  let texto = '';
  try {
    const respuesta = await conversar({ request, env, ejecucion, usuario: { id: 1, rol: 'admin' } });
    estado = respuesta.status;
    texto = await respuesta.text();
  } catch (error) {
    if (typeof error?.status !== 'number') throw error;
    estado = error.status; // ErrorApi: la respuesta sería un error JSON
  }
  await Promise.all(pendientes);
  const gasto = medirCpu(antes);
  return { ms: (gasto.user + gasto.system) / 1000, estado, texto };
}

const fria = await unaPeticion();
const calientes = [];
for (let i = 0; i < repeticiones; i++) calientes.push((await unaPeticion()).ms);
calientes.sort((a, b) => a - b);

console.log(JSON.stringify({
  carpeta: path.basename(carpeta),
  escenario,
  medida: process.threadCpuUsage ? 'hilo principal' : 'proceso completo (Node sin threadCpuUsage)',
  fria_ms: +fria.ms.toFixed(2),
  caliente_ms: +calientes[Math.floor(calientes.length / 2)].toFixed(2),
  estado_http: fria.estado,
  eventos_sse: fria.texto.split('\n\n').filter(Boolean).length,
  filas_escritas: filas.length,
}));

if (bandera('--fila')) {
  const fila = filas[0];
  if (!fila) {
    console.log('fila: (esta versión del código no escribe filas)');
  } else {
    const recorte = (t, n) => (typeof t === 'string' && t.length > n ? `${t.slice(0, n)}… (${t.length} en total)` : t);
    console.log('fila:', JSON.stringify({ ...fila, respuesta: recorte(fila.respuesta, 60), herramientas: recorte(fila.herramientas, 300) }));
  }
}
