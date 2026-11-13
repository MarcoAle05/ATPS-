// Herramientas de solo lectura que el asistente (asistente.js) puede pedir: consultan la tabla productos en D1.
// La etapa de embeddings ampliará este archivo; asistente.js solo usa DEFINICIONES, crearHerramientas y ejecutarLlamada.
//
// Los argumentos los escribe el modelo: son datos no confiables. Se validan con zod y, si algo no sirve,
// la herramienta responde { error } para que el modelo corrija, sin romper la petición.
// Totales y valores se calculan aquí para que el modelo nunca tenga que sumar ni multiplicar.
//
// Cada ToolMessage lleva en artifact un resumen del resultado para el registro de ejecuciones
// (ejecuciones-asistente.js). El artifact no se le manda al modelo.
import { tool } from '@langchain/core/tools';
import { ToolMessage } from '@langchain/core/messages';
import * as z from 'zod';

const LIMITE_POR_DEFECTO = 10;
const LIMITE_MAXIMO = 25;
const TEXTO_MAX = 100;
const PALABRAS_MAX = 8;
// Más allá de esto ningún filtro de precio cambia el resultado (el precio máximo es 10 000 pesos).
const CENTAVOS_TOPE = 1e12;

// ORDER BY de cada opción. El SQL sale de este mapa fijo, nunca del texto del modelo.
const ORDENES = {
  nombre: 'plegado, nombre, codigo',
  cantidad_asc: 'cantidad ASC, plegado, codigo',
  cantidad_desc: 'cantidad DESC, plegado, codigo',
  precio_asc: 'precio_centavos ASC, plegado, codigo',
  precio_desc: 'precio_centavos DESC, plegado, codigo',
  recientes: 'creado_en DESC, fila DESC',
};

// lower() de SQLite solo cubre ASCII: las letras acentuadas se pasan a su letra base con replace(),
// así "cafe" encuentra "Café" sin agregar una columna nueva. Son constantes del código, no datos del modelo.
const PLIEGUES = [['a', 'áàâäã'], ['e', 'éèêë'], ['i', 'íìîï'], ['o', 'óòôöõ'], ['u', 'úùûü'], ['n', 'ñ'], ['c', 'ç'], ['y', 'ýÿ']];
const NOMBRE_PLEGADO = PLIEGUES
  .flatMap(([base, letras]) => [...letras, ...letras.toUpperCase()].map((letra) => [letra, base]))
  .reduce((sql, [letra, base]) => `replace(${sql}, '${letra}', '${base}')`, 'lower(nombre)');
const PRODUCTOS = `(SELECT rowid AS fila, codigo, nombre, precio_centavos, cantidad, creado_en, ${NOMBRE_PLEGADO} AS plegado FROM productos)`;

// Mismo pliegue en JavaScript para el texto buscado: sin acentos y en minúsculas.
const plegar = (texto) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const CODIGO_POSIBLE = /^[\x21-\x7E]{1,64}$/;

const pesos = (centavos) => Math.round(centavos) / 100;

// ---------- Esquemas (también son la descripción que recibe el modelo) ----------

const esquemaBusqueda = z.strictObject({
  texto: z.string().max(TEXTO_MAX).optional()
    .describe('Palabras del nombre del producto, o un código de barras exacto. Deben aparecer todas las palabras. No distingue mayúsculas ni acentos. Omítelo para no filtrar por nombre.'),
  cantidad_min: z.number().int().min(0).optional().describe('Cantidad mínima en existencia (entero).'),
  cantidad_max: z.number().int().min(0).optional().describe('Cantidad máxima en existencia (entero). Usa 0 para ver solo los agotados.'),
  precio_min: z.number().min(0).optional().describe('Precio mínimo en pesos.'),
  precio_max: z.number().min(0).optional().describe('Precio máximo en pesos.'),
  orden: z.enum(Object.keys(ORDENES)).optional()
    .describe('Orden de los productos devueltos. Por defecto, nombre. recientes = los registrados más recientemente.'),
  // Más de LIMITE_MAXIMO no es error: se acota.
  limite: z.number().int().min(1).optional().describe(`Cuántos productos devolver, de 1 a ${LIMITE_MAXIMO}. Por defecto ${LIMITE_POR_DEFECTO}.`),
});

// Sin parámetros. Si el modelo manda alguno, se ignora: no cambia el resultado.
const esquemaResumen = z.object({});

// ---------- Consultas ----------

function filtroDeBusqueda(argumentos) {
  const condiciones = [];
  const valores = [];

  const texto = argumentos.texto?.normalize('NFC').trim() ?? '';
  if (texto) {
    const palabras = [...new Set(plegar(texto).split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
    const esCodigo = CODIGO_POSIBLE.test(texto);
    if (palabras.length > PALABRAS_MAX) return { error: `Usa como máximo ${PALABRAS_MAX} palabras en texto.` };
    if (!palabras.length && !esCodigo) return { error: 'texto debe tener letras o números.' };
    const enNombre = palabras.map(() => 'instr(plegado, ?) > 0').join(' AND ');
    if (esCodigo && enNombre) {
      condiciones.push(`(codigo = ? OR (${enNombre}))`);
      valores.push(texto, ...palabras);
    } else if (esCodigo) {
      condiciones.push('codigo = ?');
      valores.push(texto);
    } else {
      condiciones.push(`(${enNombre})`);
      valores.push(...palabras);
    }
  }

  const { cantidad_min: cantidadMin, cantidad_max: cantidadMax, precio_min: precioMin, precio_max: precioMax } = argumentos;
  if (cantidadMin !== undefined && cantidadMax !== undefined && cantidadMin > cantidadMax) {
    return { error: 'cantidad_min no puede ser mayor que cantidad_max.' };
  }
  if (precioMin !== undefined && precioMax !== undefined && precioMin > precioMax) {
    return { error: 'precio_min no puede ser mayor que precio_max.' };
  }
  if (cantidadMin !== undefined) {
    condiciones.push('cantidad >= ?');
    valores.push(cantidadMin);
  }
  if (cantidadMax !== undefined) {
    condiciones.push('cantidad <= ?');
    valores.push(cantidadMax);
  }
  // Precio en pesos → centavos enteros, redondeando hacia dentro del rango pedido.
  if (precioMin !== undefined) {
    condiciones.push('precio_centavos >= ?');
    valores.push(Math.min(Math.ceil(precioMin * 100 - 1e-6), CENTAVOS_TOPE));
  }
  if (precioMax !== undefined) {
    condiciones.push('precio_centavos <= ?');
    valores.push(Math.min(Math.floor(precioMax * 100 + 1e-6), CENTAVOS_TOPE));
  }
  return { donde: condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '', valores };
}

async function buscarProductos(env, argumentos) {
  const filtro = filtroDeBusqueda(argumentos);
  if (filtro.error) return { error: filtro.error };
  const limite = Math.min(argumentos.limite ?? LIMITE_POR_DEFECTO, LIMITE_MAXIMO);
  const orden = ORDENES[argumentos.orden ?? 'nombre'];
  // TOTAL() en vez de SUM(): nunca falla por desbordamiento de enteros.
  const [agregado, lista] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS total, TOTAL(cantidad) AS unidades, TOTAL(precio_centavos * cantidad) AS valor_centavos
      FROM ${PRODUCTOS} ${filtro.donde}`).bind(...filtro.valores),
    env.DB.prepare(`SELECT codigo, nombre, precio_centavos, cantidad FROM ${PRODUCTOS} ${filtro.donde} ORDER BY ${orden} LIMIT ?`)
      .bind(...filtro.valores, limite),
  ]);
  const totales = agregado.results[0];
  return {
    total: totales.total,
    unidades: Math.round(totales.unidades),
    valor: pesos(totales.valor_centavos),
    productos: lista.results.map((fila) => ({
      codigo: fila.codigo,
      nombre: fila.nombre,
      precio: pesos(fila.precio_centavos),
      cantidad: fila.cantidad,
      valor: pesos(fila.precio_centavos * fila.cantidad),
    })),
  };
}

async function resumirInventario(env) {
  const fila = await env.DB.prepare(`
    SELECT COUNT(*) AS productos, TOTAL(cantidad) AS unidades, TOTAL(precio_centavos * cantidad) AS valor_centavos,
           TOTAL(cantidad = 0) AS agotados, MIN(precio_centavos) AS minimo, MAX(precio_centavos) AS maximo,
           AVG(precio_centavos) AS promedio
    FROM productos`).first();
  const opcional = (centavos) => (centavos === null ? null : pesos(centavos));
  return {
    productos: fila.productos,
    unidades: Math.round(fila.unidades),
    valor_total: pesos(fila.valor_centavos),
    agotados: Math.round(fila.agotados),
    precio_minimo: opcional(fila.minimo),
    precio_maximo: opcional(fila.maximo),
    precio_promedio: opcional(fila.promedio),
  };
}

// ---------- Herramientas para el modelo ----------

// Lo que el modelo ve de cada herramienta. asistente.js también lo usa para calcular la versión de las instrucciones.
const BUSCAR = {
  name: 'buscar_productos',
  description: 'Busca productos del inventario por nombre o código, cantidad y precio. '
    + 'Devuelve total (productos que coinciden), unidades (suma de sus cantidades), valor (suma de precio por cantidad, en pesos) '
    + 'y hasta "limite" productos con codigo, nombre, precio, cantidad y valor. Los totales cubren todas las coincidencias, '
    + 'no solo los productos devueltos. Precios y valores en pesos.',
  schema: esquemaBusqueda,
};
const RESUMEN = {
  name: 'resumen_inventario',
  description: 'Resumen de todo el inventario: productos registrados, unidades en existencia, valor_total (en pesos), '
    + 'agotados (productos con cantidad 0) y precio mínimo, máximo y promedio (promedio simple de los precios de los productos, en pesos).',
  schema: esquemaResumen,
};
export const DEFINICIONES = [BUSCAR, RESUMEN];

// Resumen para el registro: los totales y qué códigos se devolvieron, sin nombres ni precios.
const resumirBusqueda = ({ total, unidades, valor, productos }) =>
  ({ total, unidades, valor, codigos: productos.map((producto) => producto.codigo) });

// Una falla de D1 no debe romper la conversación: el modelo recibe el error y lo explica.
// Devuelve [contenido para el modelo, resumen para el registro] (responseFormat 'content_and_artifact').
async function consultar(accion, resumir) {
  let resultado;
  try {
    resultado = await accion();
  } catch (error) {
    console.error('Asistente: falló una consulta al inventario:', error);
    resultado = { error: 'No se pudo consultar el inventario en este momento.' };
  }
  return [JSON.stringify(resultado), resultado.error ? { error: resultado.error } : resumir(resultado)];
}

// Se crean por petición porque necesitan env.DB.
export function crearHerramientas(env) {
  return [
    tool((argumentos) => consultar(() => buscarProductos(env, argumentos), resumirBusqueda), {
      ...BUSCAR,
      responseFormat: 'content_and_artifact',
    }),
    tool(() => consultar(() => resumirInventario(env), (resumen) => resumen), {
      ...RESUMEN,
      responseFormat: 'content_and_artifact',
    }),
  ];
}

const TIPOS = { string: 'texto', number: 'un número', int: 'un número entero', object: 'un objeto' };

function describirProblema(problema) {
  const campo = problema.path.join('.') || 'los argumentos';
  switch (problema.code) {
    case 'unrecognized_keys':
      return `Parámetros desconocidos: ${problema.keys.join(', ')}.`;
    case 'invalid_type':
      return `${campo} debe ser ${TIPOS[problema.expected] ?? problema.expected}.`;
    case 'too_small':
      return `${campo} debe ser como mínimo ${problema.minimum}.`;
    case 'too_big':
      return problema.origin === 'string'
        ? `${campo} debe tener como máximo ${problema.maximum} caracteres.`
        : `${campo} debe ser como máximo ${problema.maximum}.`;
    case 'invalid_value':
      return `${campo} debe ser uno de: ${problema.values.join(', ')}.`;
    default:
      return `${campo} no es válido.`;
  }
}

// Ejecuta una llamada del modelo y devuelve el ToolMessage de respuesta, con el resumen para el registro en artifact.
// Nunca lanza por culpa de los argumentos.
// llamada: { id, name, args } de tool_calls, o { id, name, invalida: true } si los argumentos no eran JSON.
export async function ejecutarLlamada(herramientas, llamada) {
  const responder = (resultado) =>
    new ToolMessage({ content: JSON.stringify(resultado), artifact: resultado, tool_call_id: llamada.id, name: llamada.name });
  const herramienta = herramientas.find((h) => h.name === llamada.name);
  if (!herramienta) {
    return responder({ error: `No existe esa herramienta. Usa ${herramientas.map((h) => h.name).join(' o ')}.` });
  }
  if (llamada.invalida) return responder({ error: 'Los argumentos no son JSON válido.' });
  // Los modelos suelen mandar null en los parámetros opcionales que no usan: se toman como ausentes.
  const argumentos = llamada.args && typeof llamada.args === 'object' && !Array.isArray(llamada.args)
    ? Object.fromEntries(Object.entries(llamada.args).filter(([, valor]) => valor !== null))
    : llamada.args;
  const revision = herramienta.schema.safeParse(argumentos);
  if (!revision.success) return responder({ error: revision.error.issues.map(describirProblema).join(' ') });
  return herramienta.invoke({ ...llamada, args: revision.data, type: 'tool_call' });
}
