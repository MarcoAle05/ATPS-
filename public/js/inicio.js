// Arranque: comprueba la sesión y muestra la pantalla de acceso o la aplicación según el rol.
import { $, api, iniciales, TEXTO_ROL, TONO_ROL } from './comun.js';
import { mostrarAcceso } from './sesion.js';
import { iniciarInventario, refrescarProducto, resincronizarInventario } from './app.js';
import { iniciarUsuarios, recargarUsuarios } from './usuarios.js';
import { conectarTiempoReal, detenerTiempoReal } from './tiempo-real.js';

const el = {
  carga: $('carga'),
  app: $('app'),
  avisoLector: $('aviso-lector'),
  avatar: $('cuenta-avatar'),
  nombre: $('cuenta-nombre'),
  rol: $('cuenta-rol'),
  btnSalir: $('btn-salir'),
};

const CLAVE_AVISO = 'aviso-acceso';
let recargando = false;

// Recarga la página para empezar de cero; el aviso se muestra en la pantalla de acceso.
function recargar(aviso) {
  if (recargando) return;
  recargando = true;
  if (aviso) sessionStorage.setItem(CLAVE_AVISO, aviso);
  location.reload();
}

function tomarAviso() {
  const aviso = sessionStorage.getItem(CLAVE_AVISO);
  sessionStorage.removeItem(CLAVE_AVISO);
  return aviso;
}

function mostrarApp(usuario) {
  el.app.dataset.rol = usuario.rol;
  el.avatar.textContent = iniciales(usuario.nombre);
  el.nombre.textContent = usuario.nombre;
  el.rol.textContent = TEXTO_ROL[usuario.rol];
  el.rol.dataset.tono = TONO_ROL[usuario.rol];
  el.avisoLector.hidden = usuario.rol !== 'lector';
  el.app.hidden = false;
  document.title = 'Inventario · Lector de códigos de barras';
  iniciarInventario(usuario);
  const esAdmin = usuario.rol === 'admin';
  if (esAdmin) iniciarUsuarios();
  conectarTiempoReal({
    alCambiarProducto: refrescarProducto,
    alCambiarUsuarios: esAdmin ? recargarUsuarios : undefined,
    alResincronizar: () => {
      resincronizarInventario();
      if (esAdmin) recargarUsuarios();
    },
  });
}

async function arrancar() {
  let sesion;
  try {
    sesion = await api('/api/sesion');
  } catch (error) {
    el.carga.hidden = true;
    mostrarAcceso({ configurado: true, aviso: error.message });
    return;
  }
  el.carga.hidden = true;
  if (sesion.usuario) mostrarApp(sesion.usuario);
  else mostrarAcceso({ configurado: sesion.configurado, aviso: tomarAviso(), alEntrar: mostrarApp });
}

el.btnSalir.addEventListener('click', async () => {
  el.btnSalir.disabled = true;
  detenerTiempoReal();
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    // Si falla, la cookie expira sola; igual se vuelve a la pantalla de acceso.
  }
  recargar('Cerraste sesión.');
});

window.addEventListener('sesion-perdida', () => recargar('Tu sesión terminó. Vuelve a iniciar sesión.'));
// El administrador cambió tus permisos: se recarga para mostrar lo que ahora puedes hacer.
window.addEventListener('permisos-cambiados', () => recargar());

arrancar();
