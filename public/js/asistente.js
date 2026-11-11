// Asistente del inventario (solo administrador): diálogo de chat sobre POST /api/asistente.
// La conversación vive en la memoria de esta página: se pierde al recargar o al cerrar sesión.
// La respuesta llega como flujo de eventos "data: {json}" separados por una línea en blanco:
// texto (fragmento), consulta (el modelo consultó el inventario), fin y error.
import { $, errorDeRespuesta, SIN_CONEXION, icono, animar, EASE_OUT, reducirMovimiento } from './comun.js';
import {
  validarConversacion,
  ASISTENTE_MENSAJES_MAX,
  ASISTENTE_PREGUNTA_MAX,
  ASISTENTE_CUERPO_MAX,
} from './validacion.js';

const el = {
  boton: $('btn-asistente'),
  dialogo: $('asistente'),
  mensajes: $('asistente-mensajes'),
  vacio: $('asistente-vacio'),
  conversacion: $('asistente-conversacion'),
  anuncio: $('asistente-anuncio'),
  formulario: $('asistente-formulario'),
  pregunta: $('asistente-pregunta'),
  enviar: $('btn-asistente-enviar'),
  contador: $('asistente-contador'),
  limite: $('asistente-limite'),
  nueva: $('btn-asistente-nueva'),
  cerrar: $('btn-asistente-cerrar'),
};

const CONSULTANDO = 'Consultando el inventario…';
const ESPERANDO = 'Preparando la respuesta…';
const CERCA_DEL_FINAL = 64; // px: si el usuario está a esta distancia del final, se sigue la respuesta
const panelLateral = window.matchMedia('(min-width: 860px)');

// turnos: [{ pregunta, respuesta, estado, error, controlador, descartado, nodos }]
// estado del turno: esperando | consultando | escribiendo | completo | detenido | interrumpido | error
const estado = { turnos: [], enCurso: null, cerrando: null, alFinal: true, posicion: 0, iniciado: false };

// ---------- Abrir y cerrar ----------

// Hoja inferior en celular (entra desde abajo) y panel lateral en escritorio (entra desde la derecha).
// Mismos valores que el resto de la app: 12 px y desenfoque de 4 px; con movimiento reducido, solo opacidad.
function fotogramasDialogo() {
  if (reducirMovimiento.matches) return [{ opacity: 0 }, { opacity: 1 }];
  const desde = panelLateral.matches ? 'translateX(12px)' : 'translateY(12px)';
  return [
    { opacity: 0, transform: desde, filter: 'blur(4px)' },
    { opacity: 1, transform: 'none', filter: 'blur(0px)' },
  ];
}

function animarFondo(fotogramas, opciones) {
  try {
    return el.dialogo.animate(fotogramas, { ...opciones, pseudoElement: '::backdrop' });
  } catch {
    return null; // navegador sin animación de ::backdrop: el fondo aparece sin transición
  }
}

function abrir() {
  if (estado.cerrando) {
    // Se volvió a abrir mientras se cerraba: se cancela la salida y queda abierto.
    estado.cerrando.forEach((animacion) => animacion?.cancel());
    estado.cerrando = null;
    return;
  }
  if (el.dialogo.open) return;
  el.dialogo.showModal();
  el.mensajes.scrollTop = estado.alFinal ? el.mensajes.scrollHeight : estado.posicion;
  animar(el.dialogo, fotogramasDialogo(), { duration: 300, easing: EASE_OUT });
  animarFondo([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: EASE_OUT });
  el.pregunta.focus();
}

// Cerrar no cancela la respuesta en curso: sigue llegando y está ahí al volver a abrir.
async function cerrar() {
  if (!el.dialogo.open || estado.cerrando) return;
  const opciones = { duration: 150, easing: EASE_OUT, fill: 'forwards' };
  const animaciones = [
    animar(el.dialogo, fotogramasDialogo().reverse(), opciones),
    animarFondo([{ opacity: 1 }, { opacity: 0 }], opciones),
  ];
  estado.cerrando = animaciones;
  try {
    await Promise.all(animaciones.map((animacion) => animacion?.finished));
  } catch {
    return; // se canceló porque se volvió a abrir
  }
  if (estado.cerrando !== animaciones) return;
  el.dialogo.close();
}

function alCerrar() {
  estado.cerrando?.forEach((animacion) => animacion?.cancel());
  estado.cerrando = null;
  el.boton.focus({ preventScroll: true });
}

// Clic en el fondo oscurecido (fuera de la hoja): cierra.
function clicEnFondo(evento) {
  if (evento.target !== el.dialogo) return;
  const caja = el.dialogo.getBoundingClientRect();
  const dentro = evento.clientX >= caja.left && evento.clientX <= caja.right
    && evento.clientY >= caja.top && evento.clientY <= caja.bottom;
  if (!dentro) cerrar();
}

// ---------- Desplazamiento ----------

const cercaDelFinal = () =>
  el.mensajes.scrollHeight - el.mensajes.scrollTop - el.mensajes.clientHeight <= CERCA_DEL_FINAL;

// Aplica un cambio a la conversación y sigue el final solo si el usuario ya estaba cerca de él.
function conSeguimiento(cambio, { forzar = false } = {}) {
  const seguir = forzar || (el.dialogo.open ? cercaDelFinal() : estado.alFinal);
  cambio();
  if (!seguir) return;
  estado.alFinal = true;
  if (el.dialogo.open) el.mensajes.scrollTop = el.mensajes.scrollHeight;
}

function recordarPosicion() {
  if (!el.dialogo.open) return;
  estado.alFinal = cercaDelFinal();
  estado.posicion = el.mensajes.scrollTop;
}

// ---------- Campo de la pregunta ----------

function ajustarAltura() {
  // Crece con el texto hasta el máximo de la hoja de estilos; después se desplaza.
  el.pregunta.style.height = 'auto';
  el.pregunta.style.height = `${el.pregunta.scrollHeight + 2}px`; // + borde de 1 px arriba y abajo
}

function actualizarContador() {
  const largo = el.pregunta.value.length; // en las mismas unidades que maxlength
  el.contador.hidden = largo < ASISTENTE_PREGUNTA_MAX * 0.8;
  el.contador.textContent = `${largo}/${ASISTENTE_PREGUNTA_MAX}`;
  const enTope = largo >= ASISTENTE_PREGUNTA_MAX;
  el.contador.dataset.tope = String(enTope);
  el.limite.textContent = enTope
    ? `Llegaste al máximo de ${ASISTENTE_PREGUNTA_MAX} caracteres. Resume la pregunta o divídela en dos.`
    : '';
}

function actualizarControles() {
  const enCurso = Boolean(estado.enCurso);
  el.enviar.dataset.activa = String(enCurso);
  el.enviar.setAttribute('aria-label', enCurso ? 'Detener la respuesta' : 'Enviar pregunta');
  // aria-disabled y no disabled: el botón conserva el foco cuando termina una respuesta con el campo vacío.
  el.enviar.setAttribute('aria-disabled', String(!enCurso && el.pregunta.value.trim() === ''));
  el.nueva.disabled = estado.turnos.length === 0;
  el.vacio.hidden = estado.turnos.length > 0;
}

// ---------- Turnos en pantalla ----------

function crearTurno(pregunta) {
  const item = document.createElement('li');
  item.className = 'turno';

  const textoPregunta = document.createElement('p');
  textoPregunta.className = 'pregunta';
  const quien = document.createElement('span');
  quien.className = 'solo-lector';
  quien.textContent = 'Tu pregunta: ';
  textoPregunta.append(quien, pregunta);

  const respuesta = document.createElement('div');
  respuesta.className = 'respuesta';
  const parrafo = document.createElement('p');
  parrafo.className = 'respuesta-texto';
  const quienResponde = document.createElement('span');
  quienResponde.className = 'solo-lector';
  quienResponde.textContent = 'Respuesta: ';
  const texto = document.createTextNode('');
  parrafo.append(quienResponde, texto);
  parrafo.hidden = true;

  const progreso = document.createElement('p');
  progreso.className = 'respuesta-progreso';
  const progresoTexto = document.createElement('span');
  progreso.append(icono('loader', 'icono girando'), progresoTexto);

  const cierre = document.createElement('div'); // nota de incompleta, error y «Reintentar»
  cierre.className = 'respuesta-cierre';
  respuesta.append(parrafo, progreso, cierre);
  item.append(textoPregunta, respuesta);

  return {
    pregunta,
    respuesta: '',
    estado: 'esperando',
    error: null,
    controlador: null,
    descartado: false,
    nodos: { item, parrafo, texto, progreso, progresoTexto, cierre },
  };
}

function mostrarProgreso(turno, texto) {
  turno.nodos.progresoTexto.textContent = texto;
  turno.nodos.progreso.hidden = false;
}

const tieneTexto = (turno) => turno.respuesta.trim() !== '';

function pintarCierre(turno) {
  const { cierre } = turno.nodos;
  const partes = [];
  const incompleta = turno.estado !== 'completo' && tieneTexto(turno);
  if (turno.estado === 'detenido') {
    partes.push(crearNota(incompleta ? 'Detuviste la respuesta: quedó incompleta.' : 'Detuviste la respuesta antes de que empezara.'));
  } else if (turno.estado === 'interrumpido' || turno.estado === 'error') {
    if (incompleta) partes.push(crearNota('Respuesta incompleta.'));
    const alerta = document.createElement('p');
    alerta.className = 'aviso respuesta-error';
    alerta.dataset.tono = 'peligro';
    alerta.setAttribute('role', 'alert');
    const mensaje = document.createElement('span');
    mensaje.textContent = turno.estado === 'interrumpido' ? 'La respuesta se interrumpió.' : turno.error;
    alerta.append(icono('alert'), mensaje);
    partes.push(alerta);
  }
  // «Reintentar» si no llegó una respuesta completa por un fallo, o si se detuvo antes de empezar.
  const puedeReintentar = turno.estado === 'interrumpido' || turno.estado === 'error'
    || (turno.estado === 'detenido' && !tieneTexto(turno));
  if (puedeReintentar) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton chico respuesta-reintentar';
    boton.append(icono('refresh'), 'Reintentar');
    boton.addEventListener('click', () => reintentar(turno));
    partes.push(boton);
  }
  cierre.replaceChildren(...partes);
}

function crearNota(texto) {
  const nota = document.createElement('p');
  nota.className = 'respuesta-nota';
  nota.textContent = texto;
  return nota;
}

// Solo el último turno puede reintentarse: al hacer otra pregunta, los botones anteriores se quitan
// (la pregunta y su error siguen a la vista).
function quitarReintentos() {
  for (const boton of el.conversacion.querySelectorAll('.respuesta-reintentar')) boton.remove();
}

// ---------- Historial que se reenvía ----------

// Solo entran los turnos con texto de respuesta (completa o parcial). Se recorta desde lo más viejo hasta
// cumplir el máximo de mensajes y de tamaño del servidor; la última pregunta siempre se conserva y lo que
// queda empieza con una pregunta.
function historialPara(turnoActual) {
  const mensajes = [];
  for (const turno of estado.turnos) {
    if (turno === turnoActual) break;
    if (!tieneTexto(turno)) continue;
    mensajes.push({ rol: 'usuario', texto: turno.pregunta }, { rol: 'asistente', texto: turno.respuesta });
  }
  mensajes.push({ rol: 'usuario', texto: turnoActual.pregunta });
  const cabe = () => mensajes.length <= ASISTENTE_MENSAJES_MAX
    && JSON.stringify({ mensajes }).length <= ASISTENTE_CUERPO_MAX;
  while (mensajes.length > 1 && !cabe()) {
    mensajes.shift();
    while (mensajes.length > 1 && mensajes[0].rol !== 'usuario') mensajes.shift();
  }
  return mensajes;
}

// ---------- Enviar y recibir ----------

function enviar(entrada) {
  if (estado.enCurso) return;
  const pregunta = entrada.trim();
  if (pregunta === '') return;
  quitarReintentos();
  const turno = crearTurno(pregunta);
  estado.turnos.push(turno);
  conSeguimiento(() => el.conversacion.append(turno.nodos.item), { forzar: true });
  el.pregunta.value = '';
  ajustarAltura();
  actualizarContador();
  responder(turno);
}

function reintentar(turno) {
  if (estado.enCurso || turno !== estado.turnos.at(-1)) return;
  turno.respuesta = '';
  turno.error = null;
  turno.nodos.texto.data = '';
  turno.nodos.parrafo.hidden = true;
  turno.nodos.cierre.replaceChildren();
  el.pregunta.focus(); // el botón «Reintentar» desaparece: el foco no debe perderse
  responder(turno);
}

function detener() {
  estado.enCurso?.controlador?.abort();
}

function nuevaConversacion() {
  for (const turno of estado.turnos) turno.descartado = true;
  estado.enCurso?.controlador?.abort();
  estado.enCurso = null;
  estado.turnos = [];
  estado.alFinal = true;
  estado.posicion = 0;
  el.conversacion.replaceChildren();
  el.anuncio.textContent = '';
  actualizarControles();
  el.pregunta.focus();
}

function ponerEstado(turno, nuevo) {
  turno.estado = nuevo;
  if (nuevo === 'esperando') mostrarProgreso(turno, ESPERANDO);
  else if (nuevo === 'consultando') mostrarProgreso(turno, CONSULTANDO);
  else turno.nodos.progreso.hidden = true;
}

function agregarTexto(turno, fragmento) {
  conSeguimiento(() => {
    turno.respuesta += fragmento;
    turno.nodos.texto.appendData(fragmento); // el texto que llega no se anima
    turno.nodos.parrafo.hidden = false;
    if (turno.estado !== 'escribiendo') ponerEstado(turno, 'escribiendo');
  });
}

// Lee un bloque del flujo: solo cuentan las líneas "data:".
function leerEvento(bloque) {
  const datos = bloque
    .split('\n')
    .filter((linea) => linea.startsWith('data:'))
    .map((linea) => linea.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!datos) return null;
  try {
    return JSON.parse(datos);
  } catch {
    return null;
  }
}

// Devuelve 'fin' o 'error' cuando el flujo terminó; undefined mientras sigue.
function aplicarEvento(turno, evento) {
  switch (evento?.tipo) {
    case 'texto':
      if (typeof evento.texto === 'string' && evento.texto) agregarTexto(turno, evento.texto);
      return undefined;
    case 'consulta':
      conSeguimiento(() => ponerEstado(turno, 'consultando'));
      if (el.anuncio.textContent !== CONSULTANDO) el.anuncio.textContent = CONSULTANDO;
      return undefined;
    case 'fin':
      return 'fin';
    case 'error':
      turno.error = typeof evento.error === 'string' && evento.error ? evento.error : 'El asistente no pudo responder. Intenta de nuevo.';
      return 'error';
    default:
      return undefined;
  }
}

async function responder(turno) {
  const mensajes = historialPara(turno);
  const controlador = new AbortController();
  turno.controlador = controlador;
  estado.enCurso = turno;
  el.anuncio.textContent = '';
  conSeguimiento(() => ponerEstado(turno, 'esperando'));
  actualizarControles();

  // Red de seguridad: lo mismo que revisa el servidor, para no gastar una petición en un 400.
  const revision = validarConversacion(mensajes);
  if (!revision.ok) {
    terminar(turno, 'error', revision.error);
    return;
  }

  let respuesta;
  try {
    respuesta = await fetch('/api/asistente', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensajes: revision.valor }),
      signal: controlador.signal,
    });
  } catch {
    if (controlador.signal.aborted) terminar(turno, 'detenido');
    else terminar(turno, 'error', SIN_CONEXION);
    return;
  }

  if (!respuesta.ok) {
    // Errores antes del flujo (400, 413, 429, 502, 503, 504): JSON con el mensaje ya redactado.
    const datos = await respuesta.json().catch(() => null);
    const error = errorDeRespuesta(respuesta, datos); // con sin-sesion o sin-permiso, inicio.js recarga la página
    if (controlador.signal.aborted) terminar(turno, 'detenido');
    else terminar(turno, 'error', error.message);
    return;
  }

  const lector = respuesta.body.getReader();
  const decodificador = new TextDecoder();
  let resto = '';
  let final;
  try {
    while (!final) {
      const { value, done } = await lector.read();
      if (done) break;
      resto += decodificador.decode(value, { stream: true });
      let corte;
      while (!final && (corte = resto.indexOf('\n\n')) !== -1) {
        const bloque = resto.slice(0, corte);
        resto = resto.slice(corte + 2);
        if (!turno.descartado) final = aplicarEvento(turno, leerEvento(bloque));
      }
    }
  } catch {
    // Se detuvo (abort) o se cortó la conexión a la mitad.
  }
  if (final) lector.cancel().catch(() => {});

  if (final === 'fin') terminar(turno, 'completo');
  else if (final === 'error') terminar(turno, 'error', turno.error);
  // Sin «fin» ni «error»: Cloudflare pudo cortar la petición (por ejemplo, por el límite de CPU).
  else terminar(turno, controlador.signal.aborted ? 'detenido' : 'interrumpido');
}

function terminar(turno, final, error = null) {
  if (turno.descartado) return; // «Nueva conversación» ya lo quitó
  turno.controlador = null;
  if (estado.enCurso === turno) estado.enCurso = null;
  turno.error = error ?? turno.error;
  conSeguimiento(() => {
    ponerEstado(turno, final);
    pintarCierre(turno);
  });
  if (final === 'completo') el.anuncio.textContent = turno.respuesta.trim();
  else if (el.anuncio.textContent === CONSULTANDO) el.anuncio.textContent = '';
  actualizarControles();
}

// ---------- Arranque ----------

export function iniciarAsistente() {
  if (estado.iniciado) return;
  estado.iniciado = true;
  el.pregunta.maxLength = ASISTENTE_PREGUNTA_MAX;
  el.boton.hidden = false;

  el.boton.addEventListener('click', abrir);
  el.cerrar.addEventListener('click', cerrar);
  el.dialogo.addEventListener('click', clicEnFondo);
  // Esc: se cierra con la misma animación. Si el navegador no deja cancelar el cierre, se cierra al instante.
  el.dialogo.addEventListener('cancel', (evento) => {
    evento.preventDefault();
    cerrar();
  });
  el.dialogo.addEventListener('close', alCerrar);
  el.mensajes.addEventListener('scroll', recordarPosicion, { passive: true });

  el.nueva.addEventListener('click', nuevaConversacion);
  el.vacio.addEventListener('click', (evento) => {
    const sugerencia = evento.target.closest('.sugerencia');
    if (!sugerencia) return;
    enviar(sugerencia.textContent);
    // La sugerencia desaparece con el estado vacío. Con teclado (detail 0) el foco pasa al campo;
    // con el dedo no, para que el teclado del celular no tape la respuesta.
    if (evento.detail === 0) el.pregunta.focus();
  });

  el.formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    if (estado.enCurso) detener();
    else if (el.pregunta.value.trim() === '') el.pregunta.focus(); // pregunta vacía: no se envía
    else enviar(el.pregunta.value);
  });
  el.pregunta.addEventListener('keydown', (evento) => {
    // Enter envía; Mayús+Enter hace un salto de línea. No interfiere al escribir con un método de entrada (IME).
    if (evento.key !== 'Enter' || evento.shiftKey || evento.isComposing || evento.keyCode === 229) return;
    evento.preventDefault();
    if (!estado.enCurso) enviar(el.pregunta.value);
  });
  el.pregunta.addEventListener('input', () => {
    ajustarAltura();
    actualizarContador();
    actualizarControles();
  });
  actualizarContador();
  actualizarControles();
}
