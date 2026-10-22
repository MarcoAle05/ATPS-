// Actualizaciones en tiempo real: cada página abierta mantiene un WebSocket con un único
// Durable Object. Cuando cambia un producto, se avisa a todos con el código que cambió y
// cada página pide el producto actualizado (así nunca se queda con un valor viejo, aunque
// dos cambios lleguen casi al mismo tiempo).
import { DurableObject } from 'cloudflare:workers';
import { ErrorApi } from './http.js';

const canal = (env) => env.DIFUSOR.getByName('inventario');

// Los avisos no deben retrasar ni romper la respuesta al usuario que hizo el cambio.
function enSegundoPlano({ env, ejecucion }, accion) {
  const promesa = accion(canal(env)).catch((error) => console.error('Tiempo real:', error));
  ejecucion.waitUntil(promesa);
}

export const avisarCambioDeProducto = (contexto, codigo) =>
  enSegundoPlano(contexto, (difusor) => difusor.enviar('todos', { tipo: 'producto', codigo }));

export const avisarCambioDeUsuarios = (contexto) =>
  enSegundoPlano(contexto, (difusor) => difusor.enviar('rol:admin', { tipo: 'usuarios' }));

export const avisarCambioDePermisos = (contexto, usuarioId) =>
  enSegundoPlano(contexto, (difusor) => difusor.enviar(`usuario:${usuarioId}`, { tipo: 'permisos' }));

// Cierra las conexiones de un usuario (bloqueado o eliminado) o de una sesión (cerrada).
export const desconectar = (contexto, etiqueta) =>
  enSegundoPlano(contexto, (difusor) => difusor.desconectar(etiqueta));

// GET /api/tiempo-real: la sesión ya se comprobó en worker.js antes de llegar aquí.
export async function conectar({ request, env, url, usuario, sesionId }) {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    throw new ErrorApi(426, 'Se esperaba una conexión WebSocket.');
  }
  // Evita que otra página use la cookie de sesión para escuchar el inventario.
  if (request.headers.get('Origin') !== url.origin) throw new ErrorApi(403, 'Solicitud no permitida.');
  const cabeceras = new Headers(request.headers);
  cabeceras.set('X-Etiquetas', JSON.stringify([`usuario:${usuario.id}`, `sesion:${sesionId}`, `rol:${usuario.rol}`]));
  return canal(env).fetch(new Request(request, { headers: cabeceras }));
}

export class Difusor extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Los pings del navegador se contestan sin despertar al objeto: no consumen tiempo de ejecución.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const etiquetas = JSON.parse(request.headers.get('X-Etiquetas') ?? '[]');
    const { 0: cliente, 1: servidor } = new WebSocketPair();
    // API de hibernación: el objeto puede dormir mientras las conexiones siguen abiertas.
    this.ctx.acceptWebSocket(servidor, etiquetas);
    return new Response(null, { status: 101, webSocket: cliente });
  }

  // Los navegadores solo envían pings (contestados arriba); cualquier otro mensaje se ignora.
  webSocketMessage() {}

  webSocketClose(ws) {
    try {
      ws.close();
    } catch {
      // Ya estaba cerrado.
    }
  }

  enviar(destino, mensaje) {
    const texto = JSON.stringify(mensaje);
    const sockets = destino === 'todos' ? this.ctx.getWebSockets() : this.ctx.getWebSockets(destino);
    for (const ws of sockets) {
      try {
        ws.send(texto);
      } catch {
        // Conexión cerrándose; el navegador se reconectará.
      }
    }
  }

  desconectar(etiqueta) {
    for (const ws of this.ctx.getWebSockets(etiqueta)) {
      try {
        ws.close(4001, 'Sesión terminada');
      } catch {
        // Ya estaba cerrado.
      }
    }
  }
}
