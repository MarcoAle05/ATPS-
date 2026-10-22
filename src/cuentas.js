// Registro, inicio de sesión, configuración inicial y administración de cuentas.
import { ErrorApi, json, exigir, leerJson } from './http.js';
import {
  validarCorreo,
  validarNombrePersona,
  validarContrasena,
  validarCodigoConfiguracion,
  CONTRASENA_MAX,
} from '../public/js/validacion.js';
import {
  crearHash,
  verificarContrasena,
  codigoConfiguracionValido,
  crearSesion,
  borrarSesion,
  cookieBorrada,
  comprobarLimite,
  anotarIntento,
  olvidarIntentos,
} from './seguridad.js';
import { avisarCambioDeUsuarios, avisarCambioDePermisos, desconectar } from './tiempo-real.js';

const MINUTO = 60;
const HORA = 3600;
const CORREO_EN_USO = 'Ya existe una cuenta con ese correo. Inicia sesión.';

const ipDe = (request) => request.headers.get('CF-Connecting-IP') ?? 'local';

export function aUsuarioPublico(fila) {
  return {
    id: fila.id,
    nombre: fila.nombre,
    correo: fila.correo,
    rol: fila.rol,
    estado: fila.estado,
    creadoEn: fila.creado_en,
    autorizadoEn: fila.autorizado_en,
    ultimoAcceso: fila.ultimo_acceso,
  };
}

async function hayAdministrador(env) {
  return Boolean(await env.DB.prepare(`SELECT 1 FROM usuarios WHERE rol = 'admin'`).first());
}

// Mismas reglas para registrarse y para crear la cuenta de administrador.
function validarAlta(datos) {
  const nombre = exigir(validarNombrePersona(datos.nombre), 'nombre');
  const correo = exigir(validarCorreo(datos.correo), 'correo');
  const contrasena = exigir(validarContrasena(datos.contrasena, { nombre, correo }), 'contrasena');
  if (datos.confirmacion !== datos.contrasena) {
    throw new ErrorApi(400, 'Las contraseñas no coinciden.', { campo: 'confirmacion' });
  }
  return { nombre, correo, contrasena };
}

const esDuplicado = (error) => /UNIQUE/i.test(String(error?.message));

export async function sesionActual({ env, usuario }) {
  return json({ usuario: usuario ? aUsuarioPublico(usuario) : null, configurado: await hayAdministrador(env) });
}

// Crea la cuenta de administrador. Solo funciona una vez y exige el código secreto de configuración.
export async function configurar({ request, env }) {
  const claveIp = `configurar-ip:${ipDe(request)}`;
  await comprobarLimite(env, claveIp, 5, HORA);
  const datos = await leerJson(request);
  if (await hayAdministrador(env)) {
    throw new ErrorApi(409, 'La cuenta de administrador ya existe. Inicia sesión.', { codigo: 'ya-configurado' });
  }
  const codigo = exigir(validarCodigoConfiguracion(datos.codigo), 'codigo');
  if (!(await codigoConfiguracionValido(codigo, env))) {
    await anotarIntento(env, claveIp);
    throw new ErrorApi(403, 'El código de configuración no es correcto.', { campo: 'codigo' });
  }
  const { nombre, correo, contrasena } = validarAlta(datos);
  const hash = await crearHash(contrasena, env);
  let fila;
  try {
    fila = await env.DB.prepare(
      `INSERT INTO usuarios (nombre, correo, hash, rol, autorizado_en) VALUES (?, ?, ?, 'admin', datetime('now')) RETURNING *`,
    ).bind(nombre, correo, hash).first();
  } catch (error) {
    if (esDuplicado(error)) throw new ErrorApi(409, 'La cuenta de administrador ya existe. Inicia sesión.', { codigo: 'ya-configurado' });
    throw error;
  }
  await olvidarIntentos(env, claveIp);
  return json({ usuario: aUsuarioPublico(fila) }, 201, { 'Set-Cookie': await crearSesion(env, fila.id) });
}

// Las cuentas nuevas siempre empiezan como "lector": solo pueden ver el inventario.
export async function registrar(contexto) {
  const { request, env } = contexto;
  const claveIp = `registro-ip:${ipDe(request)}`;
  await comprobarLimite(env, claveIp, 10, HORA);
  await anotarIntento(env, claveIp);
  const datos = await leerJson(request);
  if (!(await hayAdministrador(env))) {
    throw new ErrorApi(409, 'La aplicación todavía no está configurada.', { codigo: 'sin-configurar' });
  }
  const { nombre, correo, contrasena } = validarAlta(datos);
  if (await env.DB.prepare('SELECT 1 FROM usuarios WHERE correo = ?').bind(correo).first()) {
    throw new ErrorApi(409, CORREO_EN_USO, { campo: 'correo' });
  }
  const hash = await crearHash(contrasena, env);
  let fila;
  try {
    fila = await env.DB.prepare('INSERT INTO usuarios (nombre, correo, hash) VALUES (?, ?, ?) RETURNING *')
      .bind(nombre, correo, hash)
      .first();
  } catch (error) {
    if (esDuplicado(error)) throw new ErrorApi(409, CORREO_EN_USO, { campo: 'correo' });
    throw error;
  }
  avisarCambioDeUsuarios(contexto); // aparece al instante en el panel del administrador
  return json({ usuario: aUsuarioPublico(fila) }, 201, { 'Set-Cookie': await crearSesion(env, fila.id) });
}

export async function iniciarSesion({ request, env }) {
  const datos = await leerJson(request);
  const correo = exigir(validarCorreo(datos.correo), 'correo');
  if (typeof datos.contrasena !== 'string' || datos.contrasena === '') {
    throw new ErrorApi(400, 'Escribe tu contraseña.', { campo: 'contrasena' });
  }
  const claveCorreo = `login:${correo}`;
  const claveIp = `login-ip:${ipDe(request)}`;
  await comprobarLimite(env, claveCorreo, 5, 15 * MINUTO);
  await comprobarLimite(env, claveIp, 20, 15 * MINUTO);

  const fila = await env.DB.prepare('SELECT * FROM usuarios WHERE correo = ?').bind(correo).first();
  // Una contraseña más larga que el máximo nunca puede ser válida; no se calcula su hash.
  const valida = datos.contrasena.length <= CONTRASENA_MAX * 4 && (await verificarContrasena(datos.contrasena, fila?.hash, env));
  if (!fila || !valida) {
    await anotarIntento(env, claveCorreo, claveIp);
    throw new ErrorApi(401, 'Correo o contraseña incorrectos.');
  }
  if (fila.estado !== 'activo') {
    throw new ErrorApi(403, 'Tu cuenta está bloqueada. Habla con el administrador.', { codigo: 'bloqueado' });
  }
  await olvidarIntentos(env, claveCorreo);
  return json({ usuario: aUsuarioPublico(fila) }, 200, { 'Set-Cookie': await crearSesion(env, fila.id) });
}

export async function cerrarSesion(contexto) {
  const { env, sesionId } = contexto;
  await borrarSesion(env, sesionId);
  desconectar(contexto, `sesion:${sesionId}`);
  return json(null, 204, { 'Set-Cookie': cookieBorrada() });
}

// ---------- Administración (solo administrador) ----------

export async function listarUsuarios({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT id, nombre, correo, rol, estado, creado_en, autorizado_en, ultimo_acceso FROM usuarios ORDER BY creado_en DESC, id DESC',
  ).all();
  return json(results.map(aUsuarioPublico));
}

async function cuentaModificable(env, params) {
  const id = Number(params[0]);
  if (!Number.isSafeInteger(id)) throw new ErrorApi(400, 'Ese usuario no es válido.');
  const objetivo = await env.DB.prepare('SELECT id, rol FROM usuarios WHERE id = ?').bind(id).first();
  if (!objetivo) throw new ErrorApi(404, 'Ese usuario no existe.');
  if (objetivo.rol === 'admin') throw new ErrorApi(403, 'La cuenta de administrador no se puede modificar.');
  return id;
}

export async function actualizarUsuario(contexto) {
  const { request, env, params, usuario } = contexto;
  const id = await cuentaModificable(env, params);
  const { accion } = await leerJson(request);
  const sentencias = {
    autorizar: () => [
      env.DB.prepare(`UPDATE usuarios SET rol = 'editor', autorizado_en = datetime('now'), autorizado_por = ? WHERE id = ? AND rol <> 'admin' RETURNING *`).bind(usuario.id, id),
    ],
    revocar: () => [
      env.DB.prepare(`UPDATE usuarios SET rol = 'lector', autorizado_en = NULL, autorizado_por = NULL WHERE id = ? AND rol <> 'admin' RETURNING *`).bind(id),
    ],
    // Bloquear cierra también todas sus sesiones abiertas.
    bloquear: () => [
      env.DB.prepare(`UPDATE usuarios SET estado = 'bloqueado' WHERE id = ? AND rol <> 'admin' RETURNING *`).bind(id),
      env.DB.prepare('DELETE FROM sesiones WHERE usuario_id = ?').bind(id),
    ],
    desbloquear: () => [
      env.DB.prepare(`UPDATE usuarios SET estado = 'activo' WHERE id = ? AND rol <> 'admin' RETURNING *`).bind(id),
    ],
  };
  if (typeof accion !== 'string' || !Object.hasOwn(sentencias, accion)) {
    throw new ErrorApi(400, 'Acción no válida.');
  }
  const [resultado] = await env.DB.batch(sentencias[accion]());
  const fila = resultado.results[0];
  if (!fila) throw new ErrorApi(404, 'Ese usuario no existe.');
  // Bloqueado: se cortan sus conexiones. Otros cambios: su página se recarga con los permisos nuevos.
  if (accion === 'bloquear') desconectar(contexto, `usuario:${id}`);
  else avisarCambioDePermisos(contexto, id);
  return json(aUsuarioPublico(fila));
}

export async function eliminarUsuario(contexto) {
  const { env, params } = contexto;
  const id = await cuentaModificable(env, params);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sesiones WHERE usuario_id = ?').bind(id),
    env.DB.prepare(`DELETE FROM usuarios WHERE id = ? AND rol <> 'admin'`).bind(id),
  ]);
  desconectar(contexto, `usuario:${id}`);
  return json(null, 204);
}
