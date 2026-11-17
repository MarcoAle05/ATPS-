// Comprobación del clasificador (src/clasificador.js) con una sola llamada real, antes de gastar en una corrida
// completa de los evals: por ejemplo, para ver si el proveedor acepta un modelo nuevo o el razonamiento junto con la
// salida JSON, cuánto tarda y cuántos tokens gasta.
//
// GASTA SALDO: hace una llamada real a DeepSeek. Usa la clave DEEPSEEK_API_KEY de .dev.vars, que nunca imprime ni
// escribe.
//
// Uso, desde la raíz del worktree:
//   node pruebas/comprobar-clasificador.mjs '<CLASIFICADOR_ASISTENTE en JSON>' [grupo] [--guardar ARCHIVO]
// Ejemplos:
//   node pruebas/comprobar-clasificador.mjs '{"proveedor":"deepseek","modelo":"deepseek-flash","razonamiento":true}'
//   node pruebas/comprobar-clasificador.mjs '{"proveedor":"deepseek","modelo":"deepseek-v4-pro"}' "pastilla de menta"
//
// Juzga los 19 productos de evals/inventario.sql, ordenados por código como en la app, para el grupo (por defecto
// «chicle»), con el mismo código que usa el Worker (clasificar()). Imprime la petición (sin cabeceras ni el texto de
// los mensajes), la respuesta del proveedor (estado, finish_reason, contenido, uso y cuánto razonó) y el resultado
// de clasificar() con los nombres de los productos que dijo que pertenecen. Con --guardar escribe eso mismo en
// ARCHIVO, junto con el texto completo del razonamiento, si lo hubo; conviene que ARCHIVO quede fuera del repositorio.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clasificar } from '../src/clasificador.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const argumentos = process.argv.slice(2);
const posGuardar = argumentos.indexOf('--guardar');
const guardar = posGuardar >= 0 ? argumentos.splice(posGuardar, 2)[1] : null;
const [configTexto, grupo = 'chicle'] = argumentos;
let config;
try {
  config = JSON.parse(configTexto);
} catch {
  console.error('Uso: node pruebas/comprobar-clasificador.mjs \'<CLASIFICADOR_ASISTENTE en JSON>\' [grupo] [--guardar ARCHIVO]');
  process.exit(1);
}

// La clave, como la lee evals/correr.py: NOMBRE=valor, con comillas opcionales. Nunca se imprime.
function claveDeDevVars() {
  for (const linea of readFileSync(`${RAIZ}.dev.vars`, 'utf8').split('\n')) {
    const recortada = linea.trim();
    if (!recortada.startsWith('DEEPSEEK_API_KEY=')) continue;
    let valor = recortada.slice('DEEPSEEK_API_KEY='.length).trim();
    if (valor.length >= 2 && valor[0] === valor.at(-1) && `"'`.includes(valor[0])) valor = valor.slice(1, -1);
    return valor;
  }
  return null;
}
const clave = claveDeDevVars();
if (!clave) {
  console.error('Falta DEEPSEEK_API_KEY en .dev.vars.');
  process.exit(1);
}

// Código y nombre de cada INSERT de evals/inventario.sql (en SQL, una comilla dentro de un texto va doble).
const productos = [...readFileSync(`${RAIZ}evals/inventario.sql`, 'utf8')
  .matchAll(/VALUES\('((?:[^']|'')*)','((?:[^']|'')*)'/g)]
  .map(([, codigo, nombre]) => ({ codigo: codigo.replaceAll("''", "'"), nombre: nombre.replaceAll("''", "'") }))
  .sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0)); // el orden de SIN_REVISAR

// Lo que sale y lo que vuelve por la red, sin cabeceras (ahí va la clave).
const capturado = { peticiones: [], estado: null, respuesta: null };
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, opciones = {}) => {
  const cuerpo = JSON.parse(opciones.body);
  const { messages, ...resto } = cuerpo;
  capturado.peticiones.push({ url: String(url), ...resto, mensajes: messages.map((m) => ({ rol: m.role, caracteres: m.content.length })) });
  const respuesta = await fetchOriginal(url, opciones);
  capturado.estado = respuesta.status;
  capturado.respuesta = await respuesta.clone().json().catch(() => null);
  return respuesta;
};

const resultado = await clasificar({
  env: { CLASIFICADOR_ASISTENTE: config, DEEPSEEK_API_KEY: clave },
  grupo,
  nombres: productos.map((p) => p.nombre),
});
const mensaje = capturado.respuesta?.choices?.[0]?.message ?? {};
const resumen = {
  configuracion: config,
  grupo,
  productos: productos.length,
  peticiones: capturado.peticiones,
  estado_http: capturado.estado,
  modelo_que_respondio: capturado.respuesta?.model ?? null,
  finish_reason: capturado.respuesta?.choices?.[0]?.finish_reason ?? null,
  contenido: mensaje.content ?? null,
  razonamiento_caracteres: mensaje.reasoning_content?.length ?? 0,
  uso: capturado.respuesta?.usage ?? null,
  error_del_proveedor: capturado.respuesta?.error ?? null,
  resultado: {
    ...resultado,
    pertenecen: resultado.pertenecen ? [...resultado.pertenecen].map((i) => productos[i].nombre) : undefined,
  },
};
console.log(JSON.stringify(resumen, null, 2));
if (guardar) {
  writeFileSync(guardar, JSON.stringify({ ...resumen, razonamiento_texto: mensaje.reasoning_content ?? null }, null, 2) + '\n');
  console.log(`Guardado en ${guardar}`);
}
