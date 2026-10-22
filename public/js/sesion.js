// Pantalla de acceso: iniciar sesión, crear cuenta y configuración inicial del administrador.
import {
  validarCorreo,
  validarNombrePersona,
  validarContrasena,
  revisarContrasena,
  validarCodigoConfiguracion,
} from './validacion.js';
import { $, api, ponerAviso, quitarAviso, icono } from './comun.js';

const el = {
  acceso: $('acceso'),
  subtitulo: $('acceso-subtitulo'),
  pestanas: $('pestanas'),
  tabEntrar: $('tab-entrar'),
  tabRegistro: $('tab-registro'),
  formEntrar: $('form-entrar'),
  formRegistro: $('form-registro'),
  formConfigurar: $('form-configurar'),
  avisoEntrar: $('aviso-entrar'),
};

const SUBTITULOS = {
  entrar: 'Inicia sesión para ver el inventario.',
  registro: 'Crea tu cuenta. El administrador decidirá si puedes registrar y editar productos.',
  configurar: 'Configura la aplicación por primera vez.',
};

let alEntrar = () => {};
let conectado = false;

// ---------- Campos ----------

function conectarVerContrasena(boton) {
  const input = $(boton.getAttribute('aria-controls'));
  boton.addEventListener('click', () => {
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    boton.dataset.activa = String(mostrar);
    boton.setAttribute('aria-pressed', String(mostrar));
    boton.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
}

const ETIQUETA_FUERZA = ['', 'Débil', 'Aceptable', 'Buena', 'Excelente'];

// Medidor de seguridad y lista de requisitos que se actualizan mientras se escribe.
// Sin animación de movimiento: se escribe muchas veces seguidas, solo cambia el color.
function conectarMedidor(prefijo) {
  const input = $(`${prefijo}-contrasena`);
  const medidor = $(`${prefijo}-medidor`);
  const lista = $(`${prefijo}-requisitos`);
  const etiqueta = document.createElement('p');
  etiqueta.className = 'medidor-texto';
  etiqueta.setAttribute('aria-hidden', 'true');
  medidor.after(etiqueta);

  const contexto = () => ({ nombre: $(`${prefijo}-nombre`).value, correo: $(`${prefijo}-correo`).value });
  const elementos = new Map();
  for (const requisito of revisarContrasena('').requisitos) {
    const item = document.createElement('li');
    const texto = document.createElement('span');
    texto.textContent = requisito.texto;
    const estadoLector = document.createElement('span');
    estadoLector.className = 'solo-lector';
    item.append(icono('circle'), texto, estadoLector);
    lista.append(item);
    elementos.set(requisito.id, { item, estadoLector });
  }

  const actualizar = () => {
    const vacio = input.value === '';
    const { requisitos, fuerza } = revisarContrasena(input.value, contexto());
    medidor.dataset.fuerza = vacio ? '0' : String(fuerza);
    etiqueta.textContent = vacio ? '' : `Seguridad: ${ETIQUETA_FUERZA[fuerza] || 'Débil'}`;
    for (const { id, ok } of requisitos) {
      const { item, estadoLector } = elementos.get(id);
      const cumplido = ok && !vacio;
      if (item.dataset.ok !== String(cumplido)) {
        item.dataset.ok = String(cumplido);
        item.querySelector('svg').replaceWith(icono(cumplido ? 'circle-check' : 'circle'));
      }
      estadoLector.textContent = cumplido ? ' (cumplido)' : ' (pendiente)';
    }
  };
  for (const campo of ['contrasena', 'nombre', 'correo']) {
    $(`${prefijo}-${campo}`).addEventListener('input', actualizar);
  }
  actualizar();
}

// Formulario con validación en vivo (después de tocar cada campo), envío con estado de carga
// y errores del servidor mostrados bajo el campo correspondiente.
function conectarFormulario({ form, prefijo, campos, boton, textoCargando, enviar }) {
  const tocados = new Set();
  const textoBoton = boton.querySelector('.boton-texto');
  const textoOriginal = textoBoton.textContent;
  const errorGeneral = $(`error-${prefijo}`);
  const nodos = Object.fromEntries(
    Object.keys(campos).map((nombre) => [nombre, { input: $(`${prefijo}-${nombre}`), error: $(`error-${prefijo}-${nombre}`) }]),
  );

  const valores = () => Object.fromEntries(Object.entries(nodos).map(([nombre, { input }]) => [nombre, input.value]));

  const revisar = () => {
    const datos = valores();
    const resultados = {};
    for (const [nombre, validar] of Object.entries(campos)) {
      const resultado = validar(datos[nombre], datos);
      const visible = !resultado.ok && tocados.has(nombre);
      nodos[nombre].error.textContent = visible ? resultado.error : '';
      nodos[nombre].input.setAttribute('aria-invalid', String(visible));
      resultados[nombre] = resultado;
    }
    return resultados;
  };

  for (const [nombre, { input }] of Object.entries(nodos)) {
    const marcar = () => {
      tocados.add(nombre);
      errorGeneral.textContent = '';
      revisar();
    };
    input.addEventListener('input', () => {
      // Contraseña nueva y confirmación: mientras se escriben, guía la lista de requisitos;
      // el error en texto aparece al salir del campo o al enviar. Lo demás se revisa desde la primera tecla.
      const esperar = (nombre === 'confirmacion' || (nombre === 'contrasena' && prefijo !== 'entrar')) && !tocados.has(nombre);
      if (esperar) revisar();
      else marcar();
    });
    // Si el foco va al botón de enviar, el error se muestra al enviar: mostrarlo aquí
    // movería el botón entre presionar y soltar, y el clic se perdería.
    input.addEventListener('blur', (evento) => {
      if (input.value !== '' && evento.relatedTarget !== boton) marcar();
    });
  }

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (boton.disabled) return;
    for (const nombre of Object.keys(campos)) tocados.add(nombre);
    const resultados = revisar();
    const invalido = Object.keys(campos).find((nombre) => !resultados[nombre].ok);
    if (invalido) {
      nodos[invalido].input.focus();
      return;
    }

    boton.disabled = true;
    boton.dataset.activa = 'true';
    textoBoton.textContent = textoCargando;
    errorGeneral.textContent = '';
    try {
      const { usuario } = await enviar(valores());
      // No dejar contraseñas escritas en la página al salir de esta pantalla.
      for (const { input } of Object.values(nodos)) if (input.type === 'password') input.value = '';
      el.acceso.hidden = true;
      alEntrar(usuario);
    } catch (error) {
      const nodo = nodos[error.campo];
      if (nodo) {
        nodo.error.textContent = error.message;
        nodo.input.setAttribute('aria-invalid', 'true');
        nodo.input.focus();
      } else {
        errorGeneral.textContent = error.message;
      }
      // Si alguien configuró la app mientras tanto, mostrar el inicio de sesión.
      if (error.codigo === 'ya-configurado') mostrarAcceso({ configurado: true, aviso: error.message });
    } finally {
      boton.disabled = false;
      boton.dataset.activa = 'false';
      textoBoton.textContent = textoOriginal;
    }
  });
}

const requerido = (mensaje) => (valor) => (valor === '' ? { ok: false, error: mensaje } : { ok: true, valor });
const confirmacion = (valor, datos) =>
  valor === '' ? { ok: false, error: 'Vuelve a escribir la contraseña.' }
  : valor !== datos.contrasena ? { ok: false, error: 'Las contraseñas no coinciden.' }
  : { ok: true, valor };
const contrasenaNueva = (valor, datos) => validarContrasena(valor, { nombre: datos.nombre, correo: datos.correo });

// ---------- Pestañas ----------

function seleccionarPestana(nombre, { enfocar = false } = {}) {
  const entrar = nombre === 'entrar';
  for (const [tab, activa] of [[el.tabEntrar, entrar], [el.tabRegistro, !entrar]]) {
    tab.setAttribute('aria-selected', String(activa));
    tab.tabIndex = activa ? 0 : -1;
  }
  el.formEntrar.hidden = !entrar;
  el.formRegistro.hidden = entrar;
  el.subtitulo.textContent = SUBTITULOS[nombre];
  if (enfocar) (entrar ? el.tabEntrar : el.tabRegistro).focus();
}

function conectarPestanas() {
  el.tabEntrar.addEventListener('click', () => seleccionarPestana('entrar'));
  el.tabRegistro.addEventListener('click', () => seleccionarPestana('registro'));
  el.pestanas.addEventListener('keydown', (evento) => {
    const teclas = { ArrowLeft: 'entrar', ArrowRight: 'registro', Home: 'entrar', End: 'registro' };
    const destino = teclas[evento.key];
    if (!destino) return;
    evento.preventDefault();
    seleccionarPestana(destino, { enfocar: true });
  });
}

// ---------- Conexión ----------

function conectar() {
  for (const boton of document.querySelectorAll('.ver-contrasena')) conectarVerContrasena(boton);
  conectarMedidor('registro');
  conectarMedidor('configurar');
  conectarPestanas();

  conectarFormulario({
    form: el.formEntrar,
    prefijo: 'entrar',
    boton: $('btn-entrar'),
    textoCargando: 'Entrando…',
    campos: { correo: validarCorreo, contrasena: requerido('Escribe tu contraseña.') },
    enviar: (datos) => api('/api/login', { method: 'POST', body: datos }),
  });

  conectarFormulario({
    form: el.formRegistro,
    prefijo: 'registro',
    boton: $('btn-registro'),
    textoCargando: 'Creando cuenta…',
    campos: { nombre: validarNombrePersona, correo: validarCorreo, contrasena: contrasenaNueva, confirmacion },
    enviar: (datos) => api('/api/registro', { method: 'POST', body: datos }),
  });

  conectarFormulario({
    form: el.formConfigurar,
    prefijo: 'configurar',
    boton: $('btn-configurar'),
    textoCargando: 'Creando administrador…',
    campos: {
      codigo: validarCodigoConfiguracion,
      nombre: validarNombrePersona,
      correo: validarCorreo,
      contrasena: contrasenaNueva,
      confirmacion,
    },
    enviar: (datos) => api('/api/configurar', { method: 'POST', body: datos }),
  });
}

// configurado: ya existe la cuenta de administrador. aviso: mensaje opcional (sesión terminada, etc.).
export function mostrarAcceso({ configurado, aviso, alEntrar: callback }) {
  if (callback) alEntrar = callback;
  if (!conectado) {
    conectar();
    conectado = true;
  }
  el.pestanas.hidden = !configurado;
  el.formConfigurar.hidden = configurado;
  if (configurado) {
    seleccionarPestana('entrar');
  } else {
    el.formEntrar.hidden = true;
    el.formRegistro.hidden = true;
    el.subtitulo.textContent = SUBTITULOS.configurar;
  }
  if (aviso) ponerAviso(el.avisoEntrar, { texto: aviso, icono: 'info' });
  else quitarAviso(el.avisoEntrar);
  el.acceso.hidden = false;
  $(configurado ? 'entrar-correo' : 'configurar-codigo').focus({ preventScroll: true });
}
