// Conexión en tiempo real con el servidor: recibe avisos de cambios y se reconecta sola.
import { $, api } from './comun.js';

const PING = 30_000; // mantiene viva la conexión; el servidor contesta sin costo
const ESPERA_MAXIMA = 30_000;
const TEXTO_ESTADO = {
  conectando: 'Conectando…',
  'en-vivo': 'En vivo',
  reconectando: 'Reconectando…',
};

let ws = null;
let intentos = 0;
let temporizadorPing = null;
let temporizadorReconexion = null;
let detenido = false;
let manejadores = {};

function ponerEstado(estado) {
  const indicador = $('en-vivo');
  indicador.dataset.estado = estado;
  indicador.textContent = TEXTO_ESTADO[estado];
}

function abrir() {
  clearTimeout(temporizadorReconexion);
  const protocolo = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocolo}//${location.host}/api/tiempo-real`);
  ws = socket;
  let abierto = false;
  ponerEstado(intentos === 0 ? 'conectando' : 'reconectando');

  socket.addEventListener('open', () => {
    abierto = true;
    const eraReconexion = intentos > 0;
    intentos = 0;
    ponerEstado('en-vivo');
    temporizadorPing = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send('ping');
    }, PING);
    // Mientras estuvo desconectado pudo perderse algún aviso: se recarga todo una vez.
    if (eraReconexion) manejadores.alResincronizar?.();
  });

  socket.addEventListener('message', ({ data }) => {
    if (data === 'pong') return;
    let mensaje;
    try {
      mensaje = JSON.parse(data);
    } catch {
      return;
    }
    if (mensaje.tipo === 'producto' && typeof mensaje.codigo === 'string') manejadores.alCambiarProducto?.(mensaje.codigo);
    else if (mensaje.tipo === 'usuarios') manejadores.alCambiarUsuarios?.();
    else if (mensaje.tipo === 'permisos') window.dispatchEvent(new CustomEvent('permisos-cambiados'));
  });

  socket.addEventListener('close', async ({ code }) => {
    clearInterval(temporizadorPing);
    if (detenido || socket !== ws) return;
    // 4001: el servidor cerró la sesión (bloqueo, cuenta eliminada o cierre de sesión en otra pestaña).
    if (code === 4001) {
      window.dispatchEvent(new CustomEvent('sesion-perdida'));
      return;
    }
    ponerEstado('reconectando');
    // Si ni siquiera llegó a abrir, puede que la sesión haya vencido.
    if (!abierto) {
      try {
        const { usuario } = await api('/api/sesion');
        if (!usuario) {
          window.dispatchEvent(new CustomEvent('sesion-perdida'));
          return;
        }
      } catch {
        // Sin red: se reintenta igual.
      }
    }
    // Espera creciente con un poco de azar para que no se reconecten todos a la vez.
    const espera = Math.min(ESPERA_MAXIMA, 1000 * 2 ** intentos) * (0.5 + Math.random() / 2);
    intentos++;
    temporizadorReconexion = setTimeout(abrir, espera);
  });
}

function reconectarYa() {
  if (detenido || !ws || ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) return;
  intentos = Math.max(intentos, 1); // al abrir, resincroniza
  abrir();
}

export function conectarTiempoReal(alRecibir) {
  manejadores = alRecibir;
  window.addEventListener('online', reconectarYa);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconectarYa();
  });
  abrir();
}

// Al cerrar sesión: cerrar a propósito, sin reconectar.
export function detenerTiempoReal() {
  detenido = true;
  clearTimeout(temporizadorReconexion);
  clearInterval(temporizadorPing);
  ws?.close(1000);
}
