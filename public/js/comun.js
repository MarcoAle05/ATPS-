// Utilidades compartidas: API, formatos, movimiento, iconos y "mantener presionado".

export const $ = (id) => document.getElementById(id);

export const formatoEntero = new Intl.NumberFormat('es-MX');
const formatoDecimal = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const formatoPrecio = (precio) => `$${formatoDecimal.format(precio)}`;
const formatoFecha = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
// D1 guarda fechas UTC como "AAAA-MM-DD HH:MM:SS".
export const formatearFecha = (texto) => (texto ? formatoFecha.format(new Date(`${texto.replace(' ', 'T')}Z`)) : '');

// Si el servidor dice que la sesión terminó o que cambiaron los permisos, avisa a inicio.js.
export async function api(url, { method = 'GET', body } = {}) {
  const opciones = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    opciones.headers = { 'Content-Type': 'application/json' };
    opciones.body = JSON.stringify(body);
  }
  let respuesta;
  try {
    respuesta = await fetch(url, opciones);
  } catch {
    throw new Error('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');
  }
  const datos = respuesta.status === 204 ? null : await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    // Sin mensaje propio (p. ej., Cloudflare cortó la petición por límite de recursos): pedir reintentar.
    const mensaje = datos?.error
      || (respuesta.status >= 500 ? 'El servidor no pudo responder. Inténtalo de nuevo en unos segundos.' : `Error ${respuesta.status}`);
    const error = new Error(mensaje);
    error.status = respuesta.status;
    error.campo = datos?.campo;
    error.codigo = datos?.codigo;
    if (datos?.codigo === 'sin-sesion') window.dispatchEvent(new CustomEvent('sesion-perdida'));
    if (datos?.codigo === 'sin-permiso') window.dispatchEvent(new CustomEvent('permisos-cambiados'));
    throw error;
  }
  return datos;
}

// ---------- Movimiento ----------
// Mismos valores que styles.css: entra en 300ms (12px + desenfoque 4px), sale en 150ms.
// Con "reducir movimiento" solo cambia la opacidad.

export const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_ICONO = 'cubic-bezier(0.2, 0, 0, 1)';
const SVG_NS = 'http://www.w3.org/2000/svg';

export const fotogramasEntrada = () =>
  reducirMovimiento.matches
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { opacity: 0, transform: 'translateY(12px)', filter: 'blur(4px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0px)' },
      ];

export const fotogramasSalida = () =>
  reducirMovimiento.matches
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
        { opacity: 1, transform: 'none', filter: 'blur(0px)' },
        { opacity: 0, transform: 'translateY(-12px)', filter: 'blur(4px)' },
      ];

export function animar(nodo, fotogramas, opciones) {
  return typeof nodo.animate === 'function' ? nodo.animate(fotogramas, opciones) : null;
}

export function animarEntrada(nodo) {
  return animar(nodo, fotogramasEntrada(), { duration: 300, easing: EASE_OUT });
}

export function animarSalida(nodo) {
  const animacion = animar(nodo, fotogramasSalida(), { duration: 150, easing: EASE_OUT, fill: 'forwards' });
  return animacion ? animacion.finished.catch(() => {}) : Promise.resolve();
}

// Cambio de icono por estado: escala 0.25 → 1, opacidad y desenfoque.
export function animarIcono(nodo) {
  const fotogramas = reducirMovimiento.matches
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { opacity: 0, transform: 'scale(0.25)', filter: 'blur(4px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0px)' },
      ];
  animar(nodo, fotogramas, { duration: 300, easing: EASE_ICONO });
}

export function desplazarHasta(nodo) {
  nodo.scrollIntoView({ behavior: reducirMovimiento.matches ? 'auto' : 'smooth', block: 'nearest' });
}

// Al cambiar el tema del sistema, evita que todas las transiciones de color se disparen a la vez.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const raiz = document.documentElement;
  raiz.classList.add('sin-transiciones');
  void document.body.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => raiz.classList.remove('sin-transiciones')));
});

// ---------- Iconos y botones ----------

export function icono(nombre, clase = 'icono') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', clase);
  svg.setAttribute('aria-hidden', 'true');
  const uso = document.createElementNS(SVG_NS, 'use');
  uso.setAttribute('href', `#i-${nombre}`);
  svg.append(uso);
  return svg;
}

// Aviso con icono. tono: 'exito' | 'acento' | 'peligro' | ''.
export function ponerAviso(nodo, { texto, icono: nombreIcono, tono = '' }) {
  const iconoAnterior = nodo.dataset.icono;
  nodo.dataset.tono = tono;
  nodo.dataset.icono = nombreIcono;
  const svg = icono(nombreIcono, nombreIcono === 'loader' ? 'icono girando' : 'icono');
  const etiqueta = document.createElement('span');
  etiqueta.textContent = texto;
  nodo.replaceChildren(svg, etiqueta);
  if (iconoAnterior && iconoAnterior !== nombreIcono) animarIcono(svg);
}

export function quitarAviso(nodo) {
  delete nodo.dataset.icono;
  nodo.replaceChildren();
}

export function crearBoton({ icono: nombreIcono, texto, accion, clases = '' }) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = `boton ${clases}`.trim();
  if (accion) boton.dataset.accion = accion;
  if (nombreIcono) boton.append(icono(nombreIcono));
  if (texto) boton.append(texto);
  return boton;
}

// Botón destructivo: hay que mantenerlo presionado (ratón, dedo, Espacio o Enter) 2 s.
// Un relleno rojo avanza mientras se sostiene; al soltar antes, regresa rápido.
const DURACION_SOSTENER = 2000;

export function crearBotonSostener({ texto, ayudaId, alCompletar, alSoltarAntes }) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton chico sostener';
  boton.dataset.accion = 'eliminar';
  boton.setAttribute('aria-describedby', ayudaId);
  const base = document.createElement('span');
  base.className = 'sostener-base';
  base.append(icono('trash'), texto);
  const relleno = document.createElement('span');
  relleno.className = 'sostener-relleno';
  relleno.setAttribute('aria-hidden', 'true');
  relleno.append(icono('trash'), texto);
  boton.append(base, relleno);

  let temporizador = null;
  const iniciar = () => {
    if (temporizador || boton.disabled) return;
    boton.classList.add('sosteniendo');
    temporizador = setTimeout(() => {
      temporizador = null;
      boton.classList.remove('sosteniendo');
      alCompletar(boton);
    }, DURACION_SOSTENER);
  };
  const soltar = () => {
    if (!temporizador) return;
    clearTimeout(temporizador);
    temporizador = null;
    boton.classList.remove('sosteniendo');
    alSoltarAntes?.(boton);
  };
  boton.addEventListener('pointerdown', (evento) => {
    if (evento.button === 0) iniciar();
  });
  for (const tipo of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) {
    boton.addEventListener(tipo, soltar);
  }
  boton.addEventListener('keydown', (evento) => {
    if (evento.key !== ' ' && evento.key !== 'Enter') return;
    evento.preventDefault();
    if (!evento.repeat) iniciar();
  });
  boton.addEventListener('keyup', (evento) => {
    if (evento.key === ' ' || evento.key === 'Enter') soltar();
  });
  boton.addEventListener('contextmenu', (evento) => evento.preventDefault());
  return boton;
}

// Resalta la ayuda de "mantener presionado" cuando alguien solo hace clic.
const recordatorios = new WeakMap();
export function recordarSostener(ayuda, anuncio, texto) {
  ayuda.dataset.recordar = '';
  anuncio.textContent = texto;
  clearTimeout(recordatorios.get(ayuda));
  recordatorios.set(ayuda, setTimeout(() => delete ayuda.dataset.recordar, 2000));
}

export function crearChip(cantidad, singular, plural, tono) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  if (tono) chip.dataset.tono = tono;
  const numero = document.createElement('strong');
  numero.textContent = formatoEntero.format(cantidad);
  chip.append(numero, ` ${cantidad === 1 ? singular : plural}`);
  return chip;
}

export function iniciales(nombre) {
  const palabras = nombre.trim().split(/\s+/);
  const letras = palabras.length > 1 ? [palabras[0], palabras.at(-1)] : [palabras[0]];
  return letras.map((p) => [...p][0] ?? '').join('').toUpperCase();
}

export const TEXTO_ROL = { lector: 'Solo lectura', editor: 'Autorizado', admin: 'Administrador' };
export const TONO_ROL = { lector: '', editor: 'exito', admin: 'acento' };
