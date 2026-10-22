// Panel de usuarios (solo administrador): autorizar, quitar autorización, bloquear y eliminar cuentas.
import {
  $,
  api,
  formatearFecha,
  iniciales,
  crearBoton,
  crearBotonSostener,
  recordarSostener,
  crearChip,
  animarEntrada,
  animarSalida,
  ponerAviso,
  quitarAviso,
  icono,
  TEXTO_ROL,
  TONO_ROL,
} from './comun.js';

const el = {
  panel: $('panel-usuarios'),
  titulo: $('titulo-usuarios'),
  resumen: $('resumen-usuarios'),
  grupos: $('grupos-usuarios'),
  aviso: $('aviso-usuarios'),
  error: $('error-usuarios'),
  anuncio: $('anuncio-usuarios'),
  ayuda: $('ayuda-eliminar-usuario'),
  btnActualizar: $('btn-actualizar-usuarios'),
};

const estado = { usuarios: [], ocupados: new Set() };

const GRUPOS = [
  {
    titulo: 'Pendientes de autorización',
    vacio: 'No hay cuentas esperando autorización.',
    incluye: (u) => u.estado === 'activo' && u.rol === 'lector',
  },
  {
    titulo: 'Autorizados',
    vacio: 'Todavía no has autorizado ninguna cuenta.',
    incluye: (u) => u.estado === 'activo' && u.rol === 'editor',
  },
  { titulo: 'Bloqueados', vacio: null, incluye: (u) => u.estado === 'bloqueado' },
];

const MENSAJES = {
  autorizar: (n) => ({ texto: `${n} ya puede registrar y editar productos.`, icono: 'user-check', tono: 'exito' }),
  revocar: (n) => ({ texto: `${n} vuelve a tener solo lectura.`, icono: 'user-minus' }),
  bloquear: (n) => ({ texto: `${n} quedó bloqueado y se cerraron sus sesiones.`, icono: 'lock', tono: 'peligro' }),
  desbloquear: (n) => ({ texto: `${n} puede volver a iniciar sesión.`, icono: 'lock-open' }),
};

function avisar(aviso) {
  ponerAviso(el.aviso, aviso);
  el.anuncio.textContent = aviso.texto;
}

function crearInsignia(texto, tono) {
  const insignia = document.createElement('span');
  insignia.className = 'insignia';
  if (tono) insignia.dataset.tono = tono;
  insignia.textContent = texto;
  return insignia;
}

function crearFilaUsuario(usuario) {
  const fila = document.createElement('li');
  fila.className = 'usuario';
  fila.dataset.id = String(usuario.id);

  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = iniciales(usuario.nombre);

  const nombre = document.createElement('p');
  nombre.className = 'usuario-nombre';
  nombre.append(usuario.nombre, ' ', crearInsignia(TEXTO_ROL[usuario.rol], TONO_ROL[usuario.rol]));
  if (usuario.estado === 'bloqueado') nombre.append(' ', crearInsignia('Bloqueado', 'peligro'));

  const detalle = document.createElement('p');
  detalle.className = 'usuario-detalle';
  const fechas = [`Se registró el ${formatearFecha(usuario.creadoEn)}`];
  if (usuario.ultimoAcceso) fechas.push(`Último acceso: ${formatearFecha(usuario.ultimoAcceso)}`);
  const correo = document.createElement('span');
  correo.className = 'usuario-correo';
  correo.textContent = usuario.correo;
  detalle.append(correo);
  for (const fecha of fechas) {
    const separador = document.createElement('span');
    separador.className = 'separador';
    separador.textContent = ' · ';
    const parte = document.createElement('span');
    parte.className = 'sin-corte';
    parte.textContent = fecha;
    detalle.append(separador, parte);
  }

  const datos = document.createElement('div');
  datos.className = 'usuario-datos';
  datos.append(nombre, detalle);

  const acciones = document.createElement('div');
  acciones.className = 'acciones-fila';
  const boton = (accion, iconoBoton, texto, clases = 'chico') => {
    const b = crearBoton({ icono: iconoBoton, texto, accion, clases });
    b.setAttribute('aria-label', `${texto} a ${usuario.nombre}`);
    return b;
  };
  if (usuario.estado === 'bloqueado') {
    acciones.append(boton('desbloquear', 'lock-open', 'Desbloquear'));
  } else if (usuario.rol === 'lector') {
    acciones.append(boton('autorizar', 'user-check', 'Autorizar', 'chico primario'), boton('bloquear', 'lock', 'Bloquear'));
  } else {
    acciones.append(boton('revocar', 'user-minus', 'Quitar autorización'), boton('bloquear', 'lock', 'Bloquear'));
  }
  const eliminar = crearBotonSostener({
    texto: 'Eliminar',
    ayudaId: 'ayuda-eliminar-usuario',
    alCompletar: () => eliminarUsuario(usuario.id),
    alSoltarAntes: () => recordarSostener(el.ayuda, el.anuncio, 'Mantén presionado el botón Eliminar para borrar la cuenta.'),
  });
  eliminar.setAttribute('aria-label', `Eliminar la cuenta de ${usuario.nombre} (mantén presionado)`);
  acciones.append(eliminar);

  fila.append(avatar, datos, acciones);
  return fila;
}

function crearGrupo({ titulo, vacio, incluye }) {
  const miembros = estado.usuarios.filter(incluye);
  if (miembros.length === 0 && !vacio) return null;
  const grupo = document.createElement('section');
  grupo.className = 'grupo';
  const encabezado = document.createElement('h3');
  encabezado.append(titulo);
  if (miembros.length) encabezado.append(' ', crearInsignia(String(miembros.length)));
  grupo.append(encabezado);
  if (miembros.length === 0) {
    const nada = document.createElement('p');
    nada.className = 'grupo-vacio';
    nada.textContent = vacio;
    grupo.append(nada);
  } else {
    const lista = document.createElement('ul');
    lista.className = 'lista-usuarios';
    lista.append(...miembros.map(crearFilaUsuario));
    grupo.append(lista);
  }
  return grupo;
}

function pintar() {
  if (estado.usuarios.length === 0) {
    const nada = document.createElement('div');
    nada.className = 'vista vista-centrada';
    const marcoIcono = document.createElement('div');
    marcoIcono.className = 'vista-icono';
    marcoIcono.append(icono('users'));
    const titulo = document.createElement('p');
    titulo.className = 'vista-titulo';
    titulo.textContent = 'Nadie más se ha registrado';
    const texto = document.createElement('p');
    texto.className = 'vista-texto';
    texto.textContent = 'Comparte el enlace de la aplicación. Las cuentas nuevas aparecerán aquí para que las autorices.';
    nada.append(marcoIcono, titulo, texto);
    el.grupos.replaceChildren(nada);
  } else {
    el.grupos.replaceChildren(...GRUPOS.map(crearGrupo).filter(Boolean));
  }
  const pendientes = estado.usuarios.filter(GRUPOS[0].incluye).length;
  el.resumen.replaceChildren(
    ...(pendientes ? [crearChip(pendientes, 'pendiente', 'pendientes', 'acento')] : []),
    crearChip(estado.usuarios.length, 'cuenta', 'cuentas'),
  );
  el.ayuda.hidden = estado.usuarios.length === 0;
}

const filaDe = (id) => el.grupos.querySelector(`li[data-id="${id}"]`);

async function cargar() {
  try {
    // El administrador no aparece en la lista: su cuenta no se puede modificar.
    const antes = new Set(estado.usuarios.map((u) => u.id));
    const primeraVez = antes.size === 0 && !el.grupos.hasChildNodes();
    estado.usuarios = (await api('/api/usuarios')).filter((u) => u.rol !== 'admin');
    el.error.textContent = '';
    // Volver a pintar sin perder el botón que tenía el foco.
    const activo = document.activeElement;
    const filaActiva = activo?.closest?.('#grupos-usuarios li');
    const foco = filaActiva && activo.dataset.accion ? [filaActiva.dataset.id, activo.dataset.accion] : null;
    pintar();
    if (foco) el.grupos.querySelector(`li[data-id="${foco[0]}"] [data-accion="${foco[1]}"]`)?.focus({ preventScroll: true });
    // Las cuentas que acaban de registrarse entran con animación.
    if (!primeraVez) {
      for (const u of estado.usuarios) if (!antes.has(u.id)) animarEntrada(filaDe(u.id));
    }
  } catch (error) {
    el.error.textContent = `No se pudo cargar la lista de usuarios: ${error.message}`;
  }
}

async function accionUsuario(evento) {
  const boton = evento.target.closest('button[data-accion]');
  if (!boton || boton.dataset.accion === 'eliminar') return;
  const id = Number(boton.closest('li').dataset.id);
  const { accion } = boton.dataset;
  if (estado.ocupados.has(id)) return;
  estado.ocupados.add(id);
  el.error.textContent = '';
  try {
    const actualizado = await api(`/api/usuarios/${id}`, { method: 'PATCH', body: { accion } });
    estado.usuarios = estado.usuarios.map((u) => (u.id === id ? actualizado : u));
    pintar();
    avisar(MENSAJES[accion](actualizado.nombre));
    // La cuenta cambia de grupo: entra en su nuevo lugar y el foco la sigue.
    const fila = filaDe(id);
    if (fila) {
      animarEntrada(fila);
      fila.querySelector('button[data-accion]')?.focus({ preventScroll: true });
    }
  } catch (error) {
    el.error.textContent = error.message;
    await cargar();
  } finally {
    estado.ocupados.delete(id);
  }
}

async function eliminarUsuario(id) {
  const usuario = estado.usuarios.find((u) => u.id === id);
  const fila = filaDe(id);
  if (!usuario || !fila) return;
  el.error.textContent = '';
  try {
    await api(`/api/usuarios/${id}`, { method: 'DELETE' });
  } catch (error) {
    el.error.textContent = error.message;
    await cargar();
    return;
  }
  const teniaFoco = fila.contains(document.activeElement);
  await animarSalida(fila);
  estado.usuarios = estado.usuarios.filter((u) => u.id !== id);
  pintar();
  avisar({ texto: `Se eliminó la cuenta de ${usuario.nombre}.`, icono: 'trash' });
  if (teniaFoco) el.titulo.focus();
}

// Se llama cuando alguien se registra (aviso en tiempo real) o tras una reconexión.
export const recargarUsuarios = () => cargar();

export function iniciarUsuarios() {
  el.panel.hidden = false;
  quitarAviso(el.aviso);
  el.grupos.addEventListener('click', accionUsuario);
  el.btnActualizar.addEventListener('click', async () => {
    el.btnActualizar.disabled = true;
    await cargar();
    el.btnActualizar.disabled = false;
  });
  // Al volver a la pestaña, mostrar registros nuevos sin tener que recargar.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') cargar();
  });
  cargar();
}
