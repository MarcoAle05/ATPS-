// Banco de CPU del asistente (src/asistente.js) con el proveedor del modelo y D1 simulados: sin red y sin gastar saldo.
// Simula DeepSeek o, con --modelo gemini, Gemini por su API compatible con OpenAI.
// Está fuera de src/ y de public/: no entra en el Worker ni en los archivos estáticos.
//
// Uso: node pruebas/banco-cpu.mjs [escenario] [repeticiones] [opciones]
//   escenario:
//     corta     una consulta y 30 fragmentos de texto (por defecto)
//     larga     una consulta y 800 fragmentos
//     longitud  como corta, pero el modelo termina por max_tokens (resultado incompleta)
//     muchas    62 llamadas de herramienta: una con argumentos enormes, una que no es JSON y 60 normales
//     rechazo   el proveedor rechaza la clave en la primera llamada: DeepSeek con 401 y Gemini con 400
//               («Please pass a valid API key»). Resultado error, motivo proveedor-401 o proveedor-400.
//     cuota     el proveedor responde 429 a la primera llamada: DeepSeek por saturación («ocupado») y Gemini por
//               la cuota del día agotada, con el cuerpo que manda Google. Resultado error, motivo proveedor-429.
//     grupo          el conversador llama a productos_del_grupo («chicle») y el clasificador simulado, sin flujo,
//                    juzga 19 productos sin revisar. Una consulta y 30 fragmentos, como corta.
//     grupo-memoria  la misma pregunta con todos los productos ya juzgados: no se llama al clasificador.
//   repeticiones: peticiones calientes después de la fría (100 por defecto).
//   --modelo gemini   pide el modelo "gemini". El simulador imita a Gemini: firma en cada llamada de herramienta
//                     (extra_content.google.thought_signature), uso en cada fragmento y sin tokens de caché.
//                     Si una llamada vuelve sin su firma, responde 400 como Google.
//   --carpeta <ruta>  mide otra copia del proyecto en vez de esta (ver «Antes y después» abajo).
//   --sin-cache       el proveedor no manda prompt_tokens_details: tokens_cache debe quedar en NULL.
//   --falla-version   falla la lectura de version_datos: la columna debe quedar en NULL.
//   --fila            imprime la fila que se escribiría en ejecuciones_asistente (en grupo, con herramientas completas).
//   Solo con grupo y grupo-memoria:
//   --clasificador falla|corta|ilegible
//                     el clasificador responde 500 (con su reintento), corta su salida (finish_reason length) o
//                     devuelve algo que no es el JSON pedido. La pregunta debe terminar bien, sin guardar juicios.
//   --pendientes N    productos sin revisar al empezar (19 en grupo, 0 en grupo-memoria). Se juzgan 100 como máximo.
//   --dos-grupos      el conversador pide dos grupos en la misma ronda: el clasificador se llama una sola vez.
//   --herramienta     imprime lo que el conversador recibió de cada herramienta.
//
// Qué mide: process.threadCpuUsage() (solo el hilo principal, como el CPU de un Worker) desde que entra a
// conversar() hasta que terminan el flujo y las tareas de waitUntil. La primera petición del proceso es «fría»
// (JIT sin calentar). De las siguientes salen dos cifras: caliente_ms, la mediana de cada petición medida aparte,
// y caliente_media_ms, el CPU de todas juntas entre su número. El reloj de CPU del sistema puede tener resolución
// gruesa (en la máquina del dueño, ~1 ms: las medianas salen en múltiplos de 0.99), y la media no sufre ese redondeo.
// D1 responde con datos fijos: en un Worker es E/S y no cuenta como CPU. Las cifras dependen de la máquina y de su
// carga: compara solo corridas hechas igual y a la vez.
//
// Antes y después de un cambio (ejemplo con el commit 11fd5bc como «antes»):
//   mkdir -p /tmp/antes && git archive 11fd5bc src public/js package.json | tar -x -C /tmp/antes
//   ln -s "$PWD/node_modules" /tmp/antes/node_modules
//   for i in 1 2 3 4 5 6 7; do node pruebas/banco-cpu.mjs larga --carpeta /tmp/antes; node pruebas/banco-cpu.mjs larga; done
// y toma la mediana de caliente_media_ms (o de caliente_ms) de cada lado. Referencia del 2026-11-13 (Node 26, 7 procesos intercalados,
// etapa 1 del asistente): corta ≈ 3.0 ms y larga ≈ 19–20 ms. Del 2026-11-16 (etapa 4, misma forma, caliente_media_ms):
// corta ≈ 3.1 ms, larga ≈ 22 ms, grupo ≈ 4.2 ms y grupo-memoria ≈ 3.4 ms.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const argumentos = process.argv.slice(2);
const bandera = (nombre) => argumentos.includes(nombre);
const valorDe = (nombre) => {
  const i = argumentos.indexOf(nombre);
  return i >= 0 ? argumentos[i + 1] : undefined;
};
const CON_VALOR = ['--carpeta', '--modelo', '--clasificador', '--pendientes'];
const sueltos = argumentos.filter((a, i) => !a.startsWith('--') && !CON_VALOR.includes(argumentos[i - 1]));
const [escenario = 'corta', repeticionesTexto = '100'] = sueltos;
const repeticiones = Number(repeticionesTexto);
const ESCENARIOS = ['corta', 'larga', 'longitud', 'muchas', 'rechazo', 'cuota', 'grupo', 'grupo-memoria'];
if (!ESCENARIOS.includes(escenario) || !Number.isInteger(repeticiones) || repeticiones < 1) {
  console.error(`Uso: node pruebas/banco-cpu.mjs [${ESCENARIOS.join('|')}] [repeticiones ≥ 1] [opciones]. Ver el comentario inicial.`);
  process.exit(1);
}
const carpeta = path.resolve(valorDe('--carpeta') ?? fileURLToPath(new URL('..', import.meta.url)));
const gemini = valorDe('--modelo') === 'gemini';
if (valorDe('--modelo') !== undefined && !gemini) {
  console.error('--modelo solo admite "gemini" (sin la opción se simula DeepSeek).');
  process.exit(1);
}
const grupo = escenario.startsWith('grupo');
const fallaClasificador = valorDe('--clasificador');
if (fallaClasificador !== undefined && !['falla', 'corta', 'ilegible'].includes(fallaClasificador)) {
  console.error('--clasificador admite falla, corta o ilegible.');
  process.exit(1);
}
const PENDIENTES = Number(valorDe('--pendientes') ?? (escenario === 'grupo' ? 19 : 0));
if (!Number.isInteger(PENDIENTES) || PENDIENTES < 0) {
  console.error('--pendientes debe ser un entero ≥ 0.');
  process.exit(1);
}
const medirCpu = process.threadCpuUsage ? (antes) => process.threadCpuUsage(antes) : (antes) => process.cpuUsage(antes);

// ---------- Proveedor simulado: SSE con el formato de la API de chat compatible con OpenAI ----------
// DeepSeek: llamadas de herramienta en varios fragmentos con index, finish_reason tool_calls y el uso solo al final.
// Gemini (como respondió el 2026-11-13, pedido con el nombre gemini-3.5-flash, que Google atiende como
// gemini-3.6-flash): cada llamada entera en un fragmento, sin index y con su
// firma; finish_reason stop; el uso acumulado en cada fragmento y sin prompt_tokens_details.
const codificador = new TextEncoder();
const base = { id: 'sim', object: 'chat.completion.chunk', created: 1, model: gemini ? 'gemini-3.6-flash' : 'deepseek-flash' };
const evento = (datos) => codificador.encode(`data: ${JSON.stringify({ ...base, ...datos })}\n\n`);
const FIN = codificador.encode('data: [DONE]\n\n');
const FIRMA = 'firma-simulada-'.padEnd(144, 'x');
let usoGemini = null; // { entrada, salida } de la llamada en curso: Gemini lo repite en cada fragmento
function delta(d, fin = null) {
  const datos = { choices: [{ index: 0, delta: d, logprobs: null, finish_reason: fin }] };
  if (gemini && usoGemini) {
    usoGemini.salida += 1;
    datos.usage = { prompt_tokens: usoGemini.entrada, completion_tokens: usoGemini.salida, total_tokens: usoGemini.entrada + usoGemini.salida };
  }
  return evento(datos);
}
const llamadaGemini = (id, funcion) => ({ id, type: 'function', function: funcion, extra_content: { google: { thought_signature: FIRMA } } });

function rondaHerramienta() {
  if (gemini) {
    return [
      delta({ role: 'assistant', tool_calls: [llamadaGemini('call_1', { name: 'buscar_productos', arguments: '{"cantidad_max":0}' })] }),
      delta({}, 'stop'),
    ];
  }
  return [
    delta({ role: 'assistant', content: '' }),
    delta({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'buscar_productos', arguments: '' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: '{"cantidad_max":' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: ' 0}' } }] }),
    delta({}, 'tool_calls'),
  ];
}

function rondaGrupo() {
  const llamadas = [{ name: 'productos_del_grupo', arguments: '{"grupo":"chicle"}' }];
  if (bandera('--dos-grupos')) llamadas.push({ name: 'productos_del_grupo', arguments: '{"grupo":"pastilla de menta"}' });
  if (gemini) {
    return [delta({ role: 'assistant', tool_calls: llamadas.map((f, i) => llamadaGemini(`call_${i}`, f)) }), delta({}, 'stop')];
  }
  return [
    delta({ role: 'assistant', content: '' }),
    ...llamadas.map((funcion, index) => delta({ tool_calls: [{ index, id: `call_${index}`, type: 'function', function: funcion }] })),
    delta({}, 'tool_calls'),
  ];
}

// El clasificador, sin flujo: una respuesta chat.completion completa. Dice que pertenecen los números impares.
const clasificador = { llamadas: 0, enviados: [] };
function respuestaClasificador(cuerpo) {
  clasificador.llamadas++;
  const entrada = cuerpo.messages.at(-1).content;
  const numeros = [...entrada.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  clasificador.enviados.push(numeros.length);
  if (fallaClasificador === 'falla') {
    return new Response(JSON.stringify({ error: { message: 'Internal error (simulado)', type: 'server_error' } }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
  const impares = numeros.filter((n) => n % 2 === 1);
  const contenido = {
    corta: `{"pertenecen": [${impares.slice(0, 3).join(', ')}`,
    ilegible: 'Los productos del grupo son el 1 y el 3.',
  }[fallaClasificador] ?? JSON.stringify({ pertenecen: impares });
  return new Response(JSON.stringify({
    ...base,
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: contenido }, logprobs: null,
      finish_reason: fallaClasificador === 'corta' ? 'length' : 'stop' }],
    usage: { prompt_tokens: 420 + 9 * numeros.length, completion_tokens: 6 + numeros.length, total_tokens: 0,
      prompt_tokens_details: { cached_tokens: 384 } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function rondaMuchas() {
  const llamadas = [
    { name: 'buscar_productos', arguments: JSON.stringify({ texto: 'x'.repeat(5000) }) },
    { name: 'resumen_inventario', arguments: '{no es json' },
  ];
  for (let i = 0; i < 60; i++) {
    llamadas.push({ name: 'buscar_productos', arguments: JSON.stringify({ texto: `producto ${i} `.repeat(15) }) });
  }
  if (gemini) {
    // En paralelo, Google solo firma la primera llamada.
    return [
      delta({ role: 'assistant', tool_calls: llamadas.map((funcion, i) => (i === 0
        ? llamadaGemini(`call_${i}`, funcion)
        : { id: `call_${i}`, type: 'function', function: funcion })) }),
      delta({}, 'stop'),
    ];
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
  if (gemini) {
    return evento({ choices: [], usage: { prompt_tokens: entrada, completion_tokens: usoGemini.salida, total_tokens: entrada + usoGemini.salida } });
  }
  const detalle = bandera('--sin-cache')
    ? {}
    : { prompt_tokens_details: { cached_tokens: cache }, prompt_cache_hit_tokens: cache, prompt_cache_miss_tokens: entrada - cache };
  return evento({ choices: [], usage: { prompt_tokens: entrada, completion_tokens: salida, total_tokens: entrada + salida, ...detalle } });
}

const FRAGMENTOS = { corta: 30, larga: 800, longitud: 30, muchas: 30, grupo: 30, 'grupo-memoria': 30 };
const recibidas = []; // lo que el conversador recibió de las herramientas, en la petición fría
// Errores como los mandan los proveedores (los de Google, copiados de respuestas reales del 2026-11-14).
const ERRORES = {
  rechazo: gemini
    ? [400, [{ error: { code: 400, message: 'Please pass a valid API key', status: 'INVALID_ARGUMENT' } }]]
    : [401, { error: { message: 'Authentication Fails (simulado)', type: 'authentication_error' } }],
  cuota: gemini
    ? [429, [{ error: {
      code: 429,
      message: 'You exceeded your current quota (simulado). * Quota exceeded for metric: generativelanguage.googleapis.com/'
        + 'generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash, description: Generate content requests '
        + 'per day limit exceeded on Free Tier.',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{
          quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaDimensions: { model: 'gemini-3.6-flash' }, quotaValue: '20',
        }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '11973s' },
      ],
    } }]]
    : [429, { error: { message: 'Rate Limit Reached (simulado)', type: 'rate_limit_error' } }],
};

globalThis.fetch = async (_url, init) => {
  if (ERRORES[escenario]) {
    const [estado, cuerpoError] = ERRORES[escenario];
    return new Response(JSON.stringify(cuerpoError), { status: estado, headers: { 'content-type': 'application/json' } });
  }
  const cuerpo = JSON.parse(init.body);
  if (!cuerpo.stream) return respuestaClasificador(cuerpo);
  const yaConsulto = cuerpo.messages.some((m) => m.role === 'tool');
  if (yaConsulto) recibidas.push(...cuerpo.messages.filter((m) => m.role === 'tool').map((m) => m.content));
  if (gemini) {
    // Como Google: la primera llamada de cada ronda tiene que volver con su firma.
    const sinFirma = cuerpo.messages.some((m) => m.tool_calls?.length && !m.tool_calls[0].extra_content?.google?.thought_signature);
    if (sinFirma) {
      return new Response(JSON.stringify([{ error: { code: 400, message: 'Function call is missing a thought_signature in functionCall parts (simulado)' } }]), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    usoGemini = { entrada: yaConsulto ? 1012 : 904, salida: 0 };
  }
  const trozos = yaConsulto
    ? rondaTexto(FRAGMENTOS[escenario], escenario === 'longitud' ? 'length' : 'stop')
    : escenario === 'muchas' ? rondaMuchas() : grupo ? rondaGrupo() : rondaHerramienta();
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
// Memoria de grupos simulada: cuántos productos siguen sin revisar en la petición en curso y cuántos juicios se
// escribieron. Los miembros que se devuelven son fijos.
const memoria = { pendientes: PENDIENTES, juicios: 0, escrituras: 0 };
const MIEMBROS = [
  { codigo: '7501000000103', nombre: 'Producto de prueba 1', precio_centavos: 1500, cantidad: 2, confirmado: 0 },
  { codigo: '7501000000110', nombre: 'Producto de prueba 3', precio_centavos: 1200, cantidad: 0, confirmado: 1 },
  { codigo: '7501000000127', nombre: 'Producto de prueba 5', precio_centavos: 300, cantidad: 4, confirmado: 0 },
];

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
      if (sql.includes('miembros_grupo') || sql.startsWith('INSERT INTO grupos')) return resultadoGrupo(sql, s.valores);
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

function resultadoGrupo(sql, valores) {
  if (sql.startsWith('INSERT INTO grupos')) return { results: [], meta: { changes: 0 } };
  if (sql.startsWith('INSERT INTO miembros_grupo')) {
    const juicios = JSON.parse(valores.at(-1)).length;
    memoria.escrituras++;
    memoria.juicios += juicios;
    memoria.pendientes -= juicios;
    return { results: [], meta: { changes: juicios } };
  }
  if (sql.startsWith('SELECT p.codigo, p.nombre')) {
    const cuantos = Math.min(memoria.pendientes, valores.at(-1));
    return { results: Array.from({ length: cuantos }, (_, i) => ({ codigo: `75010000${String(i).padStart(5, '0')}`, nombre: `Producto de prueba ${i + 1}` })) };
  }
  if (sql.includes('COUNT(*) AS total')) return { results: [{ total: MIEMBROS.length, unidades: 6, valor_centavos: 4200 }] };
  if (sql.includes('confirmado FROM')) return { results: MIEMBROS };
  if (sql.includes('COUNT(*) AS n')) return { results: [{ n: memoria.pendientes }] };
  throw new Error(`D1 simulado: consulta de grupo desconocida: ${sql.slice(0, 80)}`);
}

const env = {
  DEEPSEEK_API_KEY: 'simulada',
  GEMINI_API_KEY: 'simulada',
  // La lista de wrangler.jsonc; MODELO_ASISTENTE es la variable de antes de la etapa 2, para medir copias viejas.
  MODELOS_ASISTENTE: [
    { id: 'deepseek', proveedor: 'deepseek', modelo: 'deepseek-flash' },
    { id: 'gemini', proveedor: 'gemini', modelo: 'gemini-3.6-flash' },
  ],
  MODELO_ASISTENTE: 'deepseek-flash',
  CLASIFICADOR_ASISTENTE: { proveedor: 'deepseek', modelo: 'deepseek-flash' },
  DB: { prepare: sentencia, batch: async (lista) => lista.map((s) => s.resultado()) },
};

// ---------- Peticiones ----------
const { conversar } = await import(pathToFileURL(path.join(carpeta, 'src/asistente.js')).href);

async function unaPeticion() {
  memoria.pendientes = PENDIENTES;
  const pendientes = [];
  const ejecucion = { waitUntil: (promesa) => pendientes.push(promesa) };
  const request = new Request('http://localhost:8787/api/asistente', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mensajes: [{ rol: 'usuario', texto: grupo ? '¿Qué productos son chicles?' : '¿Qué productos están agotados?' }], ...(gemini ? { modelo: 'gemini' } : {}) }),
  });
  const antes = medirCpu();
  let estado;
  let texto = '';
  let mensajeError;
  try {
    const respuesta = await conversar({ request, env, ejecucion, usuario: { id: 1, rol: 'admin' } });
    estado = respuesta.status;
    texto = await respuesta.text();
  } catch (error) {
    if (typeof error?.status !== 'number') throw error;
    estado = error.status; // ErrorApi: la respuesta sería un error JSON con este mensaje
    mensajeError = error.message;
  }
  await Promise.all(pendientes);
  const gasto = medirCpu(antes);
  return { ms: (gasto.user + gasto.system) / 1000, estado, texto, mensajeError };
}

const fria = await unaPeticion();
const memoriaFria = { ...memoria };
const clasificadorFrio = { llamadas: clasificador.llamadas, enviados: [...clasificador.enviados] };
const calientes = [];
const antesDelLote = medirCpu();
for (let i = 0; i < repeticiones; i++) calientes.push((await unaPeticion()).ms);
const lote = medirCpu(antesDelLote);
calientes.sort((a, b) => a - b);

console.log(JSON.stringify({
  carpeta: path.basename(carpeta),
  escenario,
  modelo: gemini ? 'gemini' : 'deepseek',
  medida: process.threadCpuUsage ? 'hilo principal' : 'proceso completo (Node sin threadCpuUsage)',
  fria_ms: +fria.ms.toFixed(2),
  caliente_ms: +calientes[Math.floor(calientes.length / 2)].toFixed(2),
  caliente_media_ms: +((lote.user + lote.system) / 1000 / repeticiones).toFixed(2),
  estado_http: fria.estado,
  ...(fria.mensajeError ? { mensaje_error: fria.mensajeError } : {}),
  eventos_sse: fria.texto.split('\n\n').filter(Boolean).length,
  filas_escritas: filas.length,
  ...(grupo ? {
    resultado_fila: filas[0]?.resultado,
    peticiones_al_clasificador_en_la_fria: clasificadorFrio.llamadas,
    productos_enviados_al_clasificador: clasificadorFrio.enviados,
    juicios_guardados_en_la_fria: memoriaFria.juicios,
    sin_revisar_al_terminar: memoriaFria.pendientes,
  } : {}),
}));

if (bandera('--herramienta')) {
  for (const contenido of recibidas.slice(0, bandera('--dos-grupos') ? 2 : 1)) console.log('herramienta:', contenido);
}

if (bandera('--fila')) {
  const fila = filas[0];
  if (!fila) {
    console.log('fila: (esta versión del código no escribe filas)');
  } else {
    const recorte = (t, n) => (typeof t === 'string' && t.length > n ? `${t.slice(0, n)}… (${t.length} en total)` : t);
    console.log('fila:', JSON.stringify({ ...fila, respuesta: recorte(fila.respuesta, 60), herramientas: grupo ? JSON.parse(fila.herramientas) : recorte(fila.herramientas, 300) }));
  }
}
