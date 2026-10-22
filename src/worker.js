// Punto de entrada del Worker: las rutas /api/* pasan por aquí; el resto son archivos de public/.
import { ErrorApi, respuestaDeError, json } from './http.js';
import { leerSesion } from './seguridad.js';
import * as cuentas from './cuentas.js';
import * as productos from './productos.js';
import { conectar as conectarTiempoReal } from './tiempo-real.js';

export { Difusor } from './tiempo-real.js';

// Nivel mínimo para cada ruta: publico < lector (cualquier sesión) < editor (autorizado) < admin.
const NIVEL = { publico: 0, lector: 1, editor: 2, admin: 3 };

const RUTAS = [
  ['GET', /^\/api\/sesion$/, 'publico', cuentas.sesionActual],
  ['POST', /^\/api\/configurar$/, 'publico', cuentas.configurar],
  ['POST', /^\/api\/registro$/, 'publico', cuentas.registrar],
  ['POST', /^\/api\/login$/, 'publico', cuentas.iniciarSesion],
  ['POST', /^\/api\/logout$/, 'lector', cuentas.cerrarSesion],

  ['GET', /^\/api\/productos$/, 'lector', productos.listar],
  ['GET', /^\/api\/productos\/([^/]+)$/, 'lector', productos.obtener],
  ['POST', /^\/api\/productos$/, 'editor', productos.crear],
  ['PUT', /^\/api\/productos\/([^/]+)$/, 'editor', productos.actualizar],
  ['DELETE', /^\/api\/productos\/([^/]+)$/, 'editor', productos.eliminar],
  ['POST', /^\/api\/productos\/([^/]+)\/escanear$/, 'editor', productos.escanear],
  ['POST', /^\/api\/productos\/([^/]+)\/ajustar$/, 'editor', productos.ajustar],
  ['GET', /^\/api\/buscar\/([^/]+)$/, 'editor', productos.buscarEnInternet],
  ['GET', /^\/api\/tiempo-real$/, 'lector', conectarTiempoReal],

  ['GET', /^\/api\/usuarios$/, 'admin', cuentas.listarUsuarios],
  ['PATCH', /^\/api\/usuarios\/(\d{1,15})$/, 'admin', cuentas.actualizarUsuario],
  ['DELETE', /^\/api\/usuarios\/(\d{1,15})$/, 'admin', cuentas.eliminarUsuario],
];

function buscarRuta(metodo, camino) {
  let existeCamino = false;
  for (const [metodoRuta, patron, nivel, manejador] of RUTAS) {
    const coincidencia = patron.exec(camino);
    if (!coincidencia) continue;
    existeCamino = true;
    if (metodoRuta !== metodo) continue;
    try {
      return { nivel, manejador, params: coincidencia.slice(1).map(decodeURIComponent) };
    } catch {
      throw new ErrorApi(400, 'La dirección no es válida.');
    }
  }
  throw existeCamino ? new ErrorApi(405, 'Método no permitido.') : new ErrorApi(404, 'Ruta no encontrada.');
}

// Las peticiones que cambian datos deben venir de esta misma página (protección contra CSRF,
// junto con la cookie SameSite=Lax y la exigencia de JSON).
function verificarOrigen(request, url) {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origen = request.headers.get('Origin');
  const sitio = request.headers.get('Sec-Fetch-Site');
  if ((origen && origen !== url.origin) || sitio === 'cross-site') {
    throw new ErrorApi(403, 'Solicitud no permitida.');
  }
}

async function atender(request, env, ejecucion, url) {
  verificarOrigen(request, url);
  const ruta = buscarRuta(request.method, url.pathname);
  const sesion = await leerSesion(request, env);
  const usuario = sesion?.usuario ?? null;

  if (ruta.nivel !== 'publico') {
    if (!usuario) throw new ErrorApi(401, 'Inicia sesión para continuar.', { codigo: 'sin-sesion' });
    if (NIVEL[usuario.rol] < NIVEL[ruta.nivel]) {
      throw new ErrorApi(403, 'Tu cuenta no tiene permiso para hacer esto.', { codigo: 'sin-permiso' });
    }
  }

  const respuesta = await ruta.manejador({
    request, env, ejecucion, url, params: ruta.params, usuario, sesionId: sesion?.sesionId,
  });
  // 101 = conexión WebSocket aceptada: su respuesta no admite cabeceras nuevas.
  if (sesion?.cookieRenovada && respuesta.status !== 101 && !respuesta.headers.has('Set-Cookie')) {
    respuesta.headers.append('Set-Cookie', sesion.cookieRenovada);
  }
  return respuesta;
}

export default {
  async fetch(request, env, ejecucion) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await atender(request, env, ejecucion, url);
    } catch (error) {
      if (error instanceof ErrorApi) return respuestaDeError(error);
      console.error(error);
      return json({ error: 'Error interno del servidor.' }, 500);
    }
  },
};
