// Contraseñas, sesiones y límite de intentos.
import { ErrorApi } from './http.js';

// PBKDF2-SHA256 con 100 000 iteraciones: el máximo que permite Web Crypto en Workers.
// Antes de derivar, la contraseña pasa por HMAC con PIMIENTA (un secreto que no está en la base de datos),
// así un robo de la base de datos sola no basta para probar contraseñas.
const ITERACIONES = 100_000;
const DURACION_SESION = 7 * 24 * 3600; // se renueva con el uso
const VIDA_MAXIMA_SESION = 30 * 24 * 3600; // después hay que volver a iniciar sesión
export const COOKIE_SESION = '__Host-sesion';

const codificador = new TextEncoder();

const aBase64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const desdeBase64Url = (texto) =>
  Uint8Array.from(atob(texto.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const aHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256(texto) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', codificador.encode(texto)));
}

function iguales(a, b) {
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

function secreto(env, nombre) {
  const valor = env[nombre];
  if (typeof valor !== 'string' || valor.length < 16) throw new Error(`Falta el secreto ${nombre}`);
  return valor;
}

async function derivar(contrasena, sal, iteraciones, env) {
  const claveHmac = await crypto.subtle.importKey(
    'raw', codificador.encode(secreto(env, 'PIMIENTA')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mezcla = await crypto.subtle.sign('HMAC', claveHmac, codificador.encode(contrasena.normalize('NFC')));
  const base = await crypto.subtle.importKey('raw', mezcla, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, base, 256);
  return new Uint8Array(bits);
}

export async function crearHash(contrasena, env) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(contrasena, sal, ITERACIONES, env);
  return `pbkdf2-sha256$${ITERACIONES}$${aBase64Url(sal)}$${aBase64Url(hash)}`;
}

// Si el correo no existe se calcula igual un hash, para que la respuesta tarde lo mismo
// y no delate qué correos están registrados.
const HASH_FICTICIO = `pbkdf2-sha256$${ITERACIONES}$${'A'.repeat(22)}$${'A'.repeat(43)}`;

export async function verificarContrasena(contrasena, almacenado, env) {
  const [algoritmo, iteraciones, sal, hash] = (almacenado ?? HASH_FICTICIO).split('$');
  if (algoritmo !== 'pbkdf2-sha256') return false;
  const calculado = await derivar(contrasena, desdeBase64Url(sal), Number(iteraciones), env);
  return iguales(calculado, desdeBase64Url(hash)) && Boolean(almacenado);
}

export async function codigoConfiguracionValido(codigo, env) {
  const normalizar = (texto) => texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const [a, b] = await Promise.all([sha256(normalizar(codigo)), sha256(normalizar(secreto(env, 'CODIGO_CONFIGURACION')))]);
  return iguales(a, b);
}

// ---------- Sesiones ----------

const cookie = (valor, maxAge) => `${COOKIE_SESION}=${valor}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export const cookieBorrada = () => cookie('', 0);

function leerCookie(request, nombre) {
  for (const parte of (request.headers.get('Cookie') ?? '').split(';')) {
    const [clave, ...valor] = parte.trim().split('=');
    if (clave === nombre) return valor.join('=');
  }
  return null;
}

export async function crearSesion(env, usuarioId) {
  const token = aBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const id = aHex(await sha256(token));
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sesiones WHERE expira_en <= datetime('now')`),
    env.DB.prepare(`INSERT INTO sesiones (id, usuario_id, expira_en) VALUES (?, ?, datetime('now', ?))`)
      .bind(id, usuarioId, `+${DURACION_SESION} seconds`),
    env.DB.prepare(`UPDATE usuarios SET ultimo_acceso = datetime('now') WHERE id = ?`).bind(usuarioId),
  ]);
  return cookie(token, DURACION_SESION);
}

// Devuelve el usuario dueño de la cookie, o null. Renueva la sesión como mucho una vez por hora.
export async function leerSesion(request, env) {
  const token = leerCookie(request, COOKIE_SESION);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const id = aHex(await sha256(token));
  const fila = await env.DB.prepare(`
    SELECT u.id, u.nombre, u.correo, u.rol, u.estado, u.creado_en, u.autorizado_en, u.ultimo_acceso,
           s.ultima_actividad < datetime('now', '-1 hour') AS renovar
    FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.id = ?1 AND s.expira_en > datetime('now') AND s.creada_en > datetime('now', ?2)
      AND u.estado = 'activo'`)
    .bind(id, `-${VIDA_MAXIMA_SESION} seconds`)
    .first();
  if (!fila) return null;

  let cookieRenovada = null;
  if (fila.renovar) {
    await env.DB.prepare(`UPDATE sesiones SET ultima_actividad = datetime('now'), expira_en = datetime('now', ?) WHERE id = ?`)
      .bind(`+${DURACION_SESION} seconds`, id)
      .run();
    cookieRenovada = cookie(token, DURACION_SESION);
  }
  const { renovar, ...usuario } = fila;
  return { usuario, sesionId: id, cookieRenovada };
}

export async function borrarSesion(env, sesionId) {
  await env.DB.prepare('DELETE FROM sesiones WHERE id = ?').bind(sesionId).run();
}

// ---------- Límite de intentos ----------

const ahora = () => Math.floor(Date.now() / 1000);

export async function comprobarLimite(env, clave, maximo, ventana) {
  const fila = await env.DB.prepare('SELECT COUNT(*) AS n, MIN(momento) AS primero FROM intentos WHERE clave = ? AND momento > ?')
    .bind(clave, ahora() - ventana)
    .first();
  if (fila.n < maximo) return;
  const espera = Math.max(60, fila.primero + ventana - ahora());
  const minutos = Math.ceil(espera / 60);
  throw new ErrorApi(429, `Demasiados intentos. Vuelve a intentarlo en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`, {
    cabeceras: { 'Retry-After': String(espera) },
  });
}

export async function anotarIntento(env, ...claves) {
  const momento = ahora();
  await env.DB.batch([
    ...claves.map((clave) => env.DB.prepare('INSERT INTO intentos (clave, momento) VALUES (?, ?)').bind(clave, momento)),
    env.DB.prepare('DELETE FROM intentos WHERE momento < ?').bind(momento - 86400),
  ]);
}

export async function olvidarIntentos(env, clave) {
  await env.DB.prepare('DELETE FROM intentos WHERE clave = ?').bind(clave).run();
}
