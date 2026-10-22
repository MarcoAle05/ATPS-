// Inventario: consultas a D1 y rutas de productos.
import { ErrorApi, json, exigir, leerJson } from './http.js';
import {
  validarCodigo,
  validarNombre,
  validarPrecio,
  validarCantidad,
  sanitizarNombre,
  esEanUpc,
} from '../public/js/validacion.js';
import { avisarCambioDeProducto } from './tiempo-real.js';

function aProducto(fila) {
  if (!fila) return null;
  return {
    codigo: fila.codigo,
    nombre: fila.nombre,
    precio: fila.precio_centavos / 100,
    cantidad: fila.cantidad,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

const codigoDe = (params) => exigir(validarCodigo(params[0]), 'codigo');
const noRegistrado = () => new ErrorApi(404, 'Producto no registrado.');

export async function listar({ env }) {
  const { results } = await env.DB.prepare('SELECT * FROM productos ORDER BY creado_en DESC, rowid DESC').all();
  return json(results.map(aProducto));
}

export async function obtener({ env, params }) {
  const fila = await env.DB.prepare('SELECT * FROM productos WHERE codigo = ?').bind(codigoDe(params)).first();
  if (!fila) throw noRegistrado();
  return json(aProducto(fila));
}

export async function crear(contexto) {
  const { request, env } = contexto;
  const datos = await leerJson(request);
  const codigo = exigir(validarCodigo(datos.codigo), 'codigo');
  const nombre = exigir(validarNombre(datos.nombre), 'nombre');
  const precioCentavos = exigir(validarPrecio(datos.precio), 'precio');
  const fila = await env.DB.prepare(`
    INSERT INTO productos (codigo, nombre, precio_centavos, cantidad) VALUES (?, ?, ?, 0)
    ON CONFLICT (codigo) DO NOTHING
    RETURNING *`).bind(codigo, nombre, precioCentavos).first();
  if (!fila) throw new ErrorApi(409, 'Ese código ya está registrado.', { campo: 'codigo' });
  avisarCambioDeProducto(contexto, codigo);
  return json(aProducto(fila), 201);
}

export async function actualizar(contexto) {
  const { request, env, params } = contexto;
  const codigo = codigoDe(params);
  const datos = await leerJson(request);
  const nombre = exigir(validarNombre(datos.nombre), 'nombre');
  const precioCentavos = exigir(validarPrecio(datos.precio), 'precio');
  const cantidad = exigir(validarCantidad(datos.cantidad), 'cantidad');
  const fila = await env.DB.prepare(`
    UPDATE productos SET nombre = ?, precio_centavos = ?, cantidad = ?, actualizado_en = datetime('now')
    WHERE codigo = ? RETURNING *`).bind(nombre, precioCentavos, cantidad, codigo).first();
  if (!fila) throw noRegistrado();
  avisarCambioDeProducto(contexto, codigo);
  return json(aProducto(fila));
}

async function ajustarCantidad(env, codigo, delta) {
  return env.DB.prepare(`
    UPDATE productos SET cantidad = cantidad + ?1, actualizado_en = datetime('now')
    WHERE codigo = ?2 AND cantidad + ?1 BETWEEN 0 AND 9007199254740991
    RETURNING *`).bind(delta, codigo).first();
}

// Leer un código ya registrado suma 1 a su cantidad.
export async function escanear(contexto) {
  const codigo = codigoDe(contexto.params);
  const fila = await ajustarCantidad(contexto.env, codigo, 1);
  if (!fila) throw noRegistrado();
  avisarCambioDeProducto(contexto, codigo);
  return json(aProducto(fila));
}

// Botones −/+ del inventario.
export async function ajustar(contexto) {
  const { request, env, params } = contexto;
  const codigo = codigoDe(params);
  const { delta } = await leerJson(request);
  if (delta !== 1 && delta !== -1) throw new ErrorApi(400, 'El ajuste debe ser +1 o -1.');
  const fila = await ajustarCantidad(env, codigo, delta);
  if (fila) {
    avisarCambioDeProducto(contexto, codigo);
    return json(aProducto(fila));
  }
  if (!(await env.DB.prepare('SELECT 1 FROM productos WHERE codigo = ?').bind(codigo).first())) throw noRegistrado();
  throw new ErrorApi(409, 'La cantidad no puede ser negativa.', { campo: 'cantidad' });
}

export async function eliminar(contexto) {
  const codigo = codigoDe(contexto.params);
  const { meta } = await contexto.env.DB.prepare('DELETE FROM productos WHERE codigo = ?').bind(codigo).run();
  if (meta.changes === 0) throw noRegistrado();
  avisarCambioDeProducto(contexto, codigo);
  return json(null, 204);
}

// ---------- Búsqueda del nombre en internet ----------

// Bases públicas y gratuitas de Open Food Facts, en orden de preferencia.
const FUENTES = [
  { fuente: 'Open Food Facts', url: 'https://world.openfoodfacts.org' },
  { fuente: 'Open Beauty Facts', url: 'https://world.openbeautyfacts.org' },
  { fuente: 'Open Products Facts', url: 'https://world.openproductsfacts.org' },
];

async function buscarEn({ fuente, url }, codigo) {
  const respuesta = await fetch(
    `${url}/api/v2/product/${codigo}.json?fields=product_name,product_name_es,generic_name,brands`,
    {
      headers: { 'User-Agent': 'LectorCodigoBarras/2.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!respuesta.ok) return null;
  const { status, product } = await respuesta.json();
  if (status !== 1 || !product) return null;

  const nombre = sanitizarNombre(product.product_name_es || product.product_name || product.generic_name);
  if (!nombre) return null;
  const marca = sanitizarNombre(String(product.brands ?? '').split(',')[0]) || null;
  // Sugerir "nombre + marca" cuando el nombre no la menciona ya
  // (basta una palabra: "Coca Cola Original" ya menciona "COCA COLA SERVICES SA NV").
  const palabrasNombre = new Set(nombre.toLowerCase().split(' '));
  const mencionaMarca = marca?.toLowerCase().split(' ').some((p) => p.length >= 3 && palabrasNombre.has(p));
  const conMarca = marca && !mencionaMarca ? sanitizarNombre(`${nombre} ${marca}`) : '';
  return { nombre: conMarca || nombre, marca, fuente };
}

export async function buscarEnInternet({ params }) {
  const codigo = codigoDe(params);
  if (!esEanUpc(codigo)) return json({ nombre: null });
  // Se consultan todas a la vez, pero se responde con la primera en orden de preferencia
  // que tenga el producto, sin esperar a las de menor prioridad.
  const busquedas = FUENTES.map((f) => buscarEn(f, codigo).catch(() => null));
  for (const busqueda of busquedas) {
    const encontrado = await busqueda;
    if (encontrado) return json(encontrado);
  }
  return json({ nombre: null });
}
