// Registro de ejecuciones del asistente: una fila en ejecuciones_asistente (migración 0002) por cada pregunta
// que llegó a llamar al modelo, termine como termine. Lo usarán los evals, las respuestas guardadas y el dueño
// para entender por qué algo falló. La pregunta y la respuesta solo quedan en la tabla, nunca en la consola.
// El modelo no tiene ninguna herramienta que lea esta tabla.

// Tamaño máximo del JSON de la columna herramientas, en unidades UTF-16 (nunca menos que los caracteres que
// cuenta SQLite). Es el mismo que el CHECK de la migración.
const HERRAMIENTAS_MAX = 16_000;
// Un elemento más grande que esto se guarda sin argumentos ni resultado (solo pasa con argumentos enormes del modelo).
const ELEMENTO_MAX = 4_000;
// Espacio para el elemento final { "omitidas": N }.
const RESERVA_OMITIDAS = 32;

const INSERTAR = `INSERT INTO ejecuciones_asistente (
    id, usuario_id, creada_en, origen, pregunta, mensajes_previos, respuesta, herramientas, modelo,
    version_instrucciones, version_datos, resultado, motivo, llamadas, duracion_ms,
    tokens_entrada, tokens_salida, tokens_cache)
  VALUES (?, ?, datetime(?, 'unixepoch'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const BORRAR_VIEJAS = `DELETE FROM ejecuciones_asistente WHERE creada_en < datetime('now', '-90 days')`;

// Huella de 64 bits (dos carriles de 32 bits, mezcla de cyrb53). No es criptográfica: solo sirve para notar que
// algo cambió. Es síncrona para poder calcularla al cargar el módulo, sin esperar a crypto.subtle.
function huella(texto) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i++) {
    const codigo = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ codigo, 2654435761);
    h2 = Math.imul(h2 ^ codigo, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

// Versión (16 caracteres hexadecimales) de un valor fijo: cambia si cambia cualquier parte de su JSON.
export const calcularVersion = (valor) => huella(JSON.stringify(valor));

// Nunca falla: si D1 no responde, la pregunta se responde igual y la columna queda en NULL.
async function leerVersionDatos(env) {
  try {
    return await env.DB.prepare(`SELECT valor FROM contadores WHERE nombre = 'version_datos'`).first('valor');
  } catch (error) {
    console.error('Asistente: no se pudo leer version_datos:', String(error?.message ?? error).slice(0, 200));
    return null;
  }
}

// JSON de la lista de herramientas: siempre válido y de HERRAMIENTAS_MAX como mucho.
// Si no cabe, se cortan elementos completos del final y el último elemento dice cuántos se omitieron.
function serializarHerramientas(lista) {
  const partes = [];
  let largo = 2; // los corchetes
  for (const [indice, elemento] of lista.entries()) {
    let parte = JSON.stringify(elemento);
    if (parte.length > ELEMENTO_MAX) {
      parte = JSON.stringify({ nombre: String(elemento.nombre).slice(0, 64), recortado: true });
    }
    if (largo + parte.length + 1 > HERRAMIENTAS_MAX - RESERVA_OMITIDAS) {
      partes.push(JSON.stringify({ omitidas: lista.length - indice }));
      break;
    }
    partes.push(parte);
    largo += parte.length + 1;
  }
  return `[${partes.join(',')}]`;
}

// Se abre justo antes de la primera llamada al modelo y empieza a leer version_datos en ese momento, a la vez
// que esa llamada. Quien lo abre debe esperar versionDatos antes de ejecutar cualquier consulta de herramienta:
// así la fila nunca queda con una versión más nueva que los datos con los que se respondió.
//
// La escritura se registra en waitUntil desde aquí, no al final: si el navegador se va a media respuesta,
// el Worker sigue vivo hasta escribir la fila. Nunca retrasa la respuesta y, si falla, solo se anota en la consola.
// cerrar() se llama una vez, al terminar; las llamadas siguientes no hacen nada.
export function abrirRegistro({ env, ejecucion, inicio, usuarioId, origen, pregunta, mensajesPrevios, modelo, versionInstrucciones }) {
  const id = crypto.randomUUID();
  const versionDatos = leerVersionDatos(env);
  let resolver;
  const cerrado = new Promise((resolve) => {
    resolver = resolve;
  });

  ejecucion.waitUntil(cerrado.then(async (final) => {
    try {
      const datos = [
        id, usuarioId, Math.floor(inicio / 1000), origen, pregunta, mensajesPrevios, final.respuesta,
        serializarHerramientas(final.herramientas), modelo, versionInstrucciones, await versionDatos,
        final.resultado, final.motivo ?? null, final.llamadas, final.duracionMs,
        final.tokens?.entrada ?? null, final.tokens?.salida ?? null, final.tokens?.cache ?? null,
      ];
      // Conservación de 90 días: lo viejo se borra en la misma transacción.
      await env.DB.batch([env.DB.prepare(INSERTAR).bind(...datos), env.DB.prepare(BORRAR_VIEJAS)]);
    } catch (error) {
      console.error(`Asistente: no se pudo guardar la ejecución ${id}:`, String(error?.message ?? error).slice(0, 200));
    }
  }));

  return {
    id,
    versionDatos,
    // final: { resultado, motivo, respuesta, herramientas, llamadas, tokens: { entrada, salida, cache } | null }
    cerrar: (final) => resolver({ ...final, duracionMs: Date.now() - inicio }),
  };
}
