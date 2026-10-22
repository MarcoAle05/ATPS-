// Inventario: cámara, panel de producto, formulario y tabla.
// Quien tiene rol "lector" puede escanear para ver un producto, pero no sumar, registrar ni editar.
import {
  validarCodigo,
  validarNombre,
  validarPrecio,
  validarCantidad,
} from './validacion.js';
import {
  $,
  api,
  formatoEntero,
  formatoPrecio,
  animar,
  animarEntrada,
  animarSalida,
  fotogramasSalida,
  desplazarHasta,
  EASE_OUT,
  ponerAviso,
  icono,
  crearBoton,
  crearBotonSostener,
  recordarSostener,
  crearChip,
} from './comun.js';

const el = {
  visor: $('visor'),
  video: $('video'),
  captura: $('captura'),
  visorTexto: $('visor-texto'),
  indicador: $('indicador'),
  estadoCamara: $('estado-camara'),
  btnCamara: $('btn-camara'),
  btnCamaraTexto: $('btn-camara-texto'),
  cajaSelector: $('caja-selector'),
  selCamara: $('sel-camara'),
  formManual: $('form-manual'),
  codigoManual: $('codigo-manual'),
  errorManual: $('error-manual'),
  anuncio: $('anuncio'),
  vistas: {
    inicio: $('vista-inicio'),
    consulta: $('vista-consulta'),
    error: $('vista-error'),
    tarjeta: $('tarjeta'),
    formulario: $('form-producto'),
  },
  inicioTitulo: $('inicio-titulo'),
  inicioTexto: $('inicio-texto'),
  consultaTexto: $('consulta-texto'),
  errorTitulo: $('error-titulo'),
  errorTexto: $('error-texto'),
  btnReintentar: $('btn-reintentar'),
  tarjetaAviso: $('tarjeta-aviso'),
  tarjetaNombre: $('tarjeta-nombre'),
  tarjetaCodigo: $('tarjeta-codigo'),
  tarjetaPrecio: $('tarjeta-precio'),
  tarjetaCantidad: $('tarjeta-cantidad'),
  btnSiguiente: $('btn-siguiente'),
  btnSiguienteTexto: $('btn-siguiente-texto'),
  btnEditarTarjeta: $('btn-editar-tarjeta'),
  form: $('form-producto'),
  formAviso: $('form-aviso'),
  campoCodigo: $('campo-codigo'),
  campoNombre: $('campo-nombre'),
  contadorNombre: $('contador-nombre'),
  errorNombre: $('error-nombre'),
  campoPrecio: $('campo-precio'),
  errorPrecio: $('error-precio'),
  campoCantidad: $('campo-cantidad'),
  ayudaCantidad: $('ayuda-cantidad'),
  errorCantidad: $('error-cantidad'),
  errorFormulario: $('error-formulario'),
  btnGuardar: $('btn-guardar'),
  btnCancelar: $('btn-cancelar'),
  tituloInventario: $('titulo-inventario'),
  resumen: $('resumen'),
  errorInventario: $('error-inventario'),
  anuncioInventario: $('anuncio-inventario'),
  tabla: $('tabla'),
  filas: $('filas'),
  vacio: $('vacio'),
  ayudaEliminar: $('ayuda-eliminar'),
  subtitulo: $('subtitulo'),
  textoVacio: document.querySelector('#vacio .vista-texto'),
};

const estado = {
  puedeEditar: false, // rol editor o admin
  lector: null,
  controles: null,
  usarCamara: false, // el usuario activó la cámara; "Escanear siguiente" la vuelve a encender
  leyendo: false, // el lector acepta resultados
  consultando: false, // hay una lectura en proceso con el servidor
  modo: null, // 'nuevo' | 'editar' mientras el formulario está abierto
  codigoFormulario: null,
  cantidadAntesDeEditar: null,
  productoTarjeta: null,
  productos: [],
  ultimoCodigo: null,
  tocados: new Set(),
  busqueda: 0, // invalida autollenados que llegan tarde
};

const ruta = (codigo) => `/api/productos/${encodeURIComponent(codigo)}`;

// El número sale hacia arriba y el nuevo entra desde abajo.
function cancelarRodar(nodo) {
  for (const animacion of nodo.getAnimations?.() ?? []) animacion.cancel();
}

async function rodarNumero(nodo, texto, retraso) {
  cancelarRodar(nodo);
  const salida = animar(nodo, fotogramasSalida(), {
    duration: 150,
    delay: retraso,
    easing: EASE_OUT,
    fill: 'forwards',
  });
  try {
    await salida?.finished;
  } catch {
    return; // se canceló porque llegó otro valor
  }
  nodo.textContent = texto;
  salida.cancel();
  animarEntrada(nodo);
}

function anunciar(texto) {
  el.anuncio.textContent = texto;
}

// ---------- Cámara ----------

const TEXTO_INDICADOR = {
  apagado: 'Apagada',
  iniciando: 'Iniciando',
  escaneando: 'Escaneando',
  capturado: 'Código leído',
  error: 'Sin cámara',
};

function ponerEstadoVisor(nuevo) {
  el.visor.dataset.estado = nuevo;
  el.indicador.dataset.estado = nuevo;
  el.indicador.textContent = TEXTO_INDICADOR[nuevo];
}

function mostrarEstadoCamara(texto, esError = false) {
  el.estadoCamara.textContent = texto;
  el.estadoCamara.classList.toggle('error', esError);
}

function marcarBotonCamara(activa) {
  el.btnCamara.dataset.activa = String(activa);
  el.btnCamaraTexto.textContent = activa ? 'Apagar cámara' : 'Activar cámara';
}

function mensajeErrorCamara(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permiso de cámara denegado. Habilítalo desde el icono junto a la dirección de la página y vuelve a intentarlo.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No se encontró ninguna cámara en este equipo. Puedes escribir el código a mano.';
    case 'NotReadableError':
    case 'AbortError':
      return 'La cámara está siendo usada por otra aplicación. Ciérrala y vuelve a intentarlo.';
    default:
      return `No se pudo iniciar la cámara${error?.message ? ` (${error.message})` : ''}.`;
  }
}

function errorCamara(mensaje) {
  delete el.visor.dataset.captura;
  el.visorTexto.textContent = 'Cámara no disponible';
  ponerEstadoVisor('error');
  mostrarEstadoCamara(mensaje, true);
}

async function encenderCamara() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    errorCamara('Este navegador no permite usar la cámara en esta dirección. Abre la página con https://.');
    return;
  }
  if (!window.ZXingBrowser) {
    errorCamara('No se pudo cargar el lector de códigos. Recarga la página.');
    return;
  }
  estado.lector ??= new window.ZXingBrowser.BrowserMultiFormatReader(undefined, {
    delayBetweenScanAttempts: 100,
  });

  el.btnCamara.disabled = true;
  ponerEstadoVisor('iniciando');
  mostrarEstadoCamara('Solicitando permiso para usar la cámara…');

  const alLeer = (resultado) => {
    if (resultado) alDetectar(resultado.getText());
  };
  const idCamara = el.selCamara.value;
  try {
    estado.leyendo = true;
    estado.controles = idCamara
      ? await estado.lector.decodeFromVideoDevice(idCamara, el.video, alLeer)
      : await estado.lector.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } }, audio: false },
          el.video,
          alLeer,
        );
    estado.usarCamara = true;
    // Si ya se leyó un código mientras arrancaba, alDetectar apagó la lectura.
    if (!estado.leyendo) {
      estado.controles.stop();
      estado.controles = null;
      return;
    }
    delete el.visor.dataset.captura;
    marcarBotonCamara(true);
    ponerEstadoVisor('escaneando');
    mostrarEstadoCamara('Apunta al código de barras y mantenlo dentro del recuadro.');
    await cargarCamaras();
  } catch (error) {
    estado.leyendo = false;
    errorCamara(mensajeErrorCamara(error));
  } finally {
    el.btnCamara.disabled = false;
  }
}

function detenerLectura() {
  estado.leyendo = false;
  estado.controles?.stop();
  estado.controles = null;
  marcarBotonCamara(false);
}

function apagarCamara(texto = 'Cámara apagada') {
  detenerLectura();
  delete el.visor.dataset.captura;
  el.visorTexto.textContent = texto;
  ponerEstadoVisor('apagado');
}

async function cargarCamaras() {
  let camaras;
  try {
    camaras = await window.ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
  } catch {
    return;
  }
  const actual = el.video.srcObject?.getVideoTracks?.()[0]?.getSettings().deviceId;
  el.selCamara.replaceChildren(
    ...camaras.map((camara, i) => {
      const opcion = new Option(camara.label || `Cámara ${i + 1}`, camara.deviceId);
      opcion.selected = camara.deviceId === actual;
      return opcion;
    }),
  );
  el.cajaSelector.hidden = camaras.length < 2;
}

// Deja en pantalla el cuadro en el que se leyó el código.
function congelarCuadro() {
  const { videoWidth: ancho, videoHeight: alto } = el.video;
  if (!ancho || !alto) {
    delete el.visor.dataset.captura;
    return;
  }
  el.captura.width = ancho;
  el.captura.height = alto;
  el.captura.getContext('2d').drawImage(el.video, 0, 0, ancho, alto);
  el.visor.dataset.captura = '';
}

let audio;
function prepararAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    audio = null;
  }
}

function avisoLectura() {
  navigator.vibrate?.(80);
  if (!audio) return;
  const oscilador = audio.createOscillator();
  const volumen = audio.createGain();
  oscilador.frequency.value = 880;
  volumen.gain.value = 0.08;
  oscilador.connect(volumen).connect(audio.destination);
  oscilador.start();
  oscilador.stop(audio.currentTime + 0.12);
}

function alDetectar(texto) {
  if (!estado.leyendo || estado.consultando) return;
  congelarCuadro();
  detenerLectura();
  ponerEstadoVisor('capturado');
  avisoLectura();
  mostrarEstadoCamara('Código leído. Pulsa «Escanear siguiente» para leer otro.');
  procesarCodigo(texto);
}

// ---------- Panel de producto ----------

function mostrarVista(nombre) {
  const destino = el.vistas[nombre];
  for (const [clave, nodo] of Object.entries(el.vistas)) {
    if (clave !== nombre) nodo.hidden = true;
  }
  // Si ya estaba visible, se oculta un instante para que su entrada vuelva a reproducirse.
  if (!destino.hidden) {
    destino.hidden = true;
    void destino.offsetWidth;
  }
  destino.hidden = false;
  if (nombre !== 'inicio') desplazarHasta(destino.closest('.panel'));
}

function mostrarInicio(titulo, texto) {
  estado.modo = null;
  estado.busqueda++;
  el.inicioTitulo.textContent = titulo;
  el.inicioTexto.textContent = texto;
  mostrarVista('inicio');
}

// tono 'peligro' para fallos; 'info' para situaciones normales, como un código que aún no está registrado.
function mostrarError(mensaje, titulo = 'No se pudo leer el producto', { tono = 'peligro' } = {}) {
  estado.modo = null;
  const marcoIcono = el.vistas.error.querySelector('.vista-icono');
  marcoIcono.classList.toggle('peligro', tono === 'peligro');
  marcoIcono.replaceChildren(icono(tono === 'peligro' ? 'alert' : 'info'));
  el.errorTitulo.textContent = titulo;
  el.errorTexto.textContent = mensaje;
  mostrarVista('error');
  anunciar(mensaje);
}

async function procesarCodigo(texto) {
  if (estado.consultando) return;
  estado.modo = null;
  estado.busqueda++;
  const resultado = validarCodigo(texto);
  if (!resultado.ok) {
    mostrarError(`No se pudo usar el código leído: ${resultado.error}`);
    return;
  }
  const codigo = resultado.valor;
  el.consultaTexto.textContent = `Consultando ${codigo}…`;
  anunciar(`Consultando el código ${codigo}.`);
  // Solo se muestra "Consultando…" si tarda; así no parpadea cuando la respuesta es inmediata.
  const avisoLento = setTimeout(() => mostrarVista('consulta'), 150);
  estado.consultando = true;
  try {
    // Solo lectura: se consulta el producto sin sumar nada.
    if (!estado.puedeEditar) {
      const producto = await api(ruta(codigo));
      clearTimeout(avisoLento);
      estado.ultimoCodigo = codigo;
      mostrarTarjeta(producto, { texto: 'Solo lectura', icono: 'eye' });
      anunciar(`${producto.nombre}. Cantidad: ${producto.cantidad}.`);
      pintarInventario();
      return;
    }
    const producto = await api(`${ruta(codigo)}/escanear`, { method: 'POST' });
    clearTimeout(avisoLento);
    estado.ultimoCodigo = codigo;
    mostrarTarjeta(producto, { texto: '1 unidad', icono: 'plus', tono: 'exito' }, producto.cantidad - 1);
    anunciar(`${producto.nombre}. Cantidad: ${producto.cantidad}.`);
    await cargarInventario();
  } catch (error) {
    clearTimeout(avisoLento);
    if (error.status === 404 && estado.puedeEditar) abrirFormularioNuevo(codigo);
    else if (error.status === 404) {
      mostrarError('Este código todavía no está en el inventario.', 'Producto no registrado', { tono: 'info' });
    }
    else mostrarError(error.message);
  } finally {
    estado.consultando = false;
  }
}

function mostrarTarjeta(producto, aviso, cantidadAnterior) {
  estado.productoTarjeta = producto;
  estado.modo = null;
  ponerAviso(el.tarjetaAviso, aviso);
  el.tarjetaNombre.textContent = producto.nombre;
  el.tarjetaCodigo.textContent = producto.codigo;
  el.tarjetaPrecio.textContent = formatoPrecio(producto.precio);
  el.btnSiguienteTexto.textContent = estado.usarCamara ? 'Escanear siguiente' : 'Buscar otro código';
  el.btnEditarTarjeta.hidden = !estado.puedeEditar;

  const final = formatoEntero.format(producto.cantidad);
  const rueda = Number.isInteger(cantidadAnterior) && cantidadAnterior >= 0 && cantidadAnterior !== producto.cantidad;
  cancelarRodar(el.tarjetaCantidad);
  el.tarjetaCantidad.textContent = rueda ? formatoEntero.format(cantidadAnterior) : final;
  mostrarVista('tarjeta');
  // Muestra el valor anterior un momento y luego rueda al nuevo, cuando la tarjeta ya entró.
  if (rueda) rodarNumero(el.tarjetaCantidad, final, 300);
  el.btnSiguiente.focus({ preventScroll: true });
}

function escanearOtro() {
  if (estado.usarCamara) {
    mostrarInicio('Escaneando…', 'Apunta la cámara al siguiente código.');
    desplazarHasta(el.visor);
    encenderCamara();
  } else {
    mostrarInicio('Listo para otro código', 'Escribe el siguiente código para buscarlo.');
    el.codigoManual.focus();
  }
}

// ---------- Formulario ----------

const CAMPOS = {
  nombre: {
    input: el.campoNombre,
    error: el.errorNombre,
    validar: () => validarNombre(el.campoNombre.value),
  },
  precio: {
    input: el.campoPrecio,
    error: el.errorPrecio,
    validar: () =>
      el.campoPrecio.validity.badInput
        ? { ok: false, error: 'Escribe un precio válido (ej. 25.50).' }
        : validarPrecio(el.campoPrecio.value),
  },
  cantidad: {
    input: el.campoCantidad,
    error: el.errorCantidad,
    validar: () => {
      if (estado.modo === 'nuevo') return { ok: true, valor: 0 };
      return el.campoCantidad.validity.badInput
        ? { ok: false, error: 'Escribe una cantidad entera (0, 1, 2…).' }
        : validarCantidad(el.campoCantidad.value);
    },
  },
};

function actualizarFormulario() {
  const resultados = {};
  for (const [nombre, campo] of Object.entries(CAMPOS)) {
    const resultado = campo.validar();
    const visible = !resultado.ok && estado.tocados.has(nombre);
    campo.error.textContent = visible ? resultado.error : '';
    campo.input.setAttribute('aria-invalid', String(visible));
    resultados[nombre] = resultado;
  }
  el.contadorNombre.textContent = [...el.campoNombre.value].length;
  return resultados;
}

function abrirFormulario(modo, producto, aviso) {
  estado.modo = modo;
  estado.codigoFormulario = producto.codigo;
  estado.cantidadAntesDeEditar = producto.cantidad;
  estado.tocados.clear();
  estado.busqueda++;
  ponerAviso(el.formAviso, aviso);
  el.errorFormulario.textContent = '';
  el.campoCodigo.value = producto.codigo;
  el.campoNombre.value = producto.nombre;
  el.campoPrecio.value = producto.precio === null ? '' : producto.precio.toFixed(2);
  el.campoCantidad.value = String(producto.cantidad);
  el.campoCantidad.disabled = modo === 'nuevo';
  el.ayudaCantidad.textContent =
    modo === 'nuevo'
      ? 'Los productos nuevos empiezan en 0. Cada escaneo suma 1.'
      : 'Número entero, 0 o mayor.';
  actualizarFormulario();
  mostrarVista('formulario');
  el.campoNombre.focus({ preventScroll: true });
}

async function abrirFormularioNuevo(codigo) {
  abrirFormulario(
    'nuevo',
    { codigo, nombre: '', precio: null, cantidad: 0 },
    { texto: 'Producto nuevo · buscando el nombre en internet…', icono: 'loader', tono: 'acento' },
  );
  anunciar('Producto nuevo. Escribe el nombre y el precio.');
  const busqueda = estado.busqueda;
  let aviso;
  try {
    const encontrado = await api(`/api/buscar/${encodeURIComponent(codigo)}`);
    if (busqueda !== estado.busqueda) return;
    if (encontrado.nombre) {
      if (!estado.tocados.has('nombre') && el.campoNombre.value.trim() === '') {
        el.campoNombre.value = encontrado.nombre;
        actualizarFormulario();
        if (document.activeElement === el.campoNombre) el.campoPrecio.focus({ preventScroll: true });
      }
      aviso = {
        texto: `Nombre encontrado en ${encontrado.fuente}. Revísalo y escribe el precio.`,
        icono: 'globe',
        tono: 'exito',
      };
    } else {
      aviso = { texto: 'No se encontró en internet. Escribe el nombre y el precio.', icono: 'info' };
    }
  } catch {
    if (busqueda !== estado.busqueda) return;
    aviso = { texto: 'No se pudo buscar en internet. Escribe el nombre y el precio.', icono: 'info' };
  }
  ponerAviso(el.formAviso, aviso);
}

async function guardarFormulario(evento) {
  evento.preventDefault();
  for (const nombre of Object.keys(CAMPOS)) estado.tocados.add(nombre);
  const resultados = actualizarFormulario();
  const invalido = Object.keys(CAMPOS).find((nombre) => !resultados[nombre].ok);
  if (invalido) {
    CAMPOS[invalido].input.focus();
    return;
  }

  const modo = estado.modo;
  const codigo = estado.codigoFormulario;
  const datos = { nombre: resultados.nombre.valor, precio: resultados.precio.valor / 100 };
  el.btnGuardar.disabled = true;
  el.errorFormulario.textContent = '';
  try {
    const producto =
      modo === 'nuevo'
        ? await api('/api/productos', { method: 'POST', body: { codigo, ...datos } })
        : await api(ruta(codigo), { method: 'PUT', body: { ...datos, cantidad: resultados.cantidad.valor } });
    estado.ultimoCodigo = producto.codigo;
    if (modo === 'nuevo') {
      mostrarTarjeta(producto, { texto: 'Registrado con cantidad 0', icono: 'check', tono: 'acento' });
      anunciar(`${producto.nombre} registrado con cantidad 0.`);
    } else {
      mostrarTarjeta(producto, { texto: 'Cambios guardados', icono: 'check', tono: 'exito' }, estado.cantidadAntesDeEditar);
      anunciar(`Cambios guardados en ${producto.nombre}.`);
    }
    await cargarInventario();
  } catch (error) {
    const campo = CAMPOS[error.campo];
    if (campo && error.status === 400) {
      campo.error.textContent = error.message;
      campo.input.setAttribute('aria-invalid', 'true');
      campo.input.focus();
    } else {
      el.errorFormulario.textContent = error.message;
    }
  } finally {
    el.btnGuardar.disabled = false;
  }
}

// ---------- Inventario ----------
// Las filas se crean una vez por producto y luego solo se actualizan,
// así el foco no se pierde y solo las filas nuevas o eliminadas se animan.

const filasPorCodigo = new Map();

async function cargarInventario(opciones) {
  try {
    estado.productos = await api('/api/productos');
    el.errorInventario.textContent = '';
  } catch (error) {
    el.errorInventario.textContent = `No se pudo cargar el inventario: ${error.message}`;
    return;
  }
  pintarInventario(opciones);
}

function crearCelda(clase) {
  const celda = document.createElement('td');
  celda.setAttribute('role', 'cell');
  celda.className = clase;
  return celda;
}

function crearFila(codigo) {
  const fila = document.createElement('tr');
  fila.setAttribute('role', 'row');
  fila.dataset.codigo = codigo;
  const registro = {
    fila,
    codigo: crearCelda('col-codigo mono'),
    nombre: crearCelda('col-nombre'),
    precio: crearCelda('col-precio num'),
    valor: document.createElement('output'),
    ocupado: false,
  };
  const celdaCantidad = crearCelda('col-cantidad num');
  const celdaAcciones = crearCelda('col-acciones');

  if (estado.puedeEditar) {
    registro.restar = crearBoton({ icono: 'minus', accion: 'restar', clases: 'chico cuadrado' });
    registro.sumar = crearBoton({ icono: 'plus', accion: 'sumar', clases: 'chico cuadrado' });
    registro.editar = crearBoton({ icono: 'pencil', texto: 'Editar', accion: 'editar', clases: 'chico' });
    registro.eliminar = crearBotonSostener({
      texto: 'Eliminar',
      ayudaId: 'ayuda-eliminar',
      alCompletar: () => eliminarProducto(codigo),
      alSoltarAntes: () =>
        recordarSostener(el.ayudaEliminar, el.anuncioInventario, 'Mantén presionado el botón Eliminar para borrar el producto.'),
    });
    const ajuste = document.createElement('div');
    ajuste.className = 'ajuste';
    ajuste.append(registro.restar, registro.valor, registro.sumar);
    celdaCantidad.append(ajuste);
    const acciones = document.createElement('div');
    acciones.className = 'acciones-fila';
    acciones.append(registro.editar, registro.eliminar);
    celdaAcciones.append(acciones);
  } else {
    celdaCantidad.append(registro.valor);
  }

  fila.append(registro.codigo, registro.nombre, registro.precio, celdaCantidad, celdaAcciones);
  return registro;
}

function actualizarFila(registro, producto) {
  const { nombre } = producto;
  registro.codigo.textContent = producto.codigo;
  registro.nombre.textContent = nombre;
  registro.precio.textContent = formatoPrecio(producto.precio);
  registro.valor.textContent = formatoEntero.format(producto.cantidad);
  if (registro.restar) {
    registro.restar.disabled = producto.cantidad === 0;
    registro.restar.setAttribute('aria-label', `Restar 1 a ${nombre}`);
    registro.sumar.setAttribute('aria-label', `Sumar 1 a ${nombre}`);
    registro.editar.setAttribute('aria-label', `Editar ${nombre}`);
    registro.eliminar.setAttribute('aria-label', `Eliminar ${nombre} (mantén presionado)`);
  }
  registro.fila.classList.toggle('resaltado', producto.codigo === estado.ultimoCodigo);
}

function pintarResumen() {
  const { productos } = estado;
  const unidades = productos.reduce((total, p) => total + p.cantidad, 0);
  el.resumen.replaceChildren(
    ...(productos.length
      ? [crearChip(productos.length, 'producto', 'productos'), crearChip(unidades, 'unidad', 'unidades')]
      : []),
  );
}

function pintarInventario({ animarNuevas = true } = {}) {
  const { productos } = estado;
  const vigentes = new Set(productos.map((p) => p.codigo));
  for (const [codigo, registro] of filasPorCodigo) {
    if (!vigentes.has(codigo)) {
      registro.fila.remove();
      filasPorCodigo.delete(codigo);
    }
  }

  let anterior = null;
  for (const producto of productos) {
    let registro = filasPorCodigo.get(producto.codigo);
    const nueva = !registro;
    if (nueva) {
      registro = crearFila(producto.codigo);
      filasPorCodigo.set(producto.codigo, registro);
    }
    actualizarFila(registro, producto);
    const esperada = anterior ? anterior.nextElementSibling : el.filas.firstElementChild;
    if (esperada !== registro.fila) el.filas.insertBefore(registro.fila, esperada);
    if (nueva && animarNuevas) animarEntrada(registro.fila);
    anterior = registro.fila;
  }

  el.tabla.hidden = productos.length === 0;
  el.vacio.hidden = productos.length > 0;
  el.ayudaEliminar.hidden = productos.length === 0 || !estado.puedeEditar;
  pintarResumen();
}

function reemplazarProducto(producto) {
  estado.productos = estado.productos.map((p) => (p.codigo === producto.codigo ? producto : p));
  const tarjetaVisible = !el.vistas.tarjeta.hidden && estado.productoTarjeta?.codigo === producto.codigo;
  if (tarjetaVisible) {
    estado.productoTarjeta = producto;
    cancelarRodar(el.tarjetaCantidad);
    el.tarjetaCantidad.textContent = formatoEntero.format(producto.cantidad);
  }
}

function productoEnPanel() {
  if (estado.modo) return estado.codigoFormulario;
  return el.vistas.tarjeta.hidden ? null : estado.productoTarjeta?.codigo;
}

async function eliminarProducto(codigo) {
  const registro = filasPorCodigo.get(codigo);
  const producto = estado.productos.find((p) => p.codigo === codigo);
  if (!registro || !producto) return;
  el.errorInventario.textContent = '';
  eliminandoAqui.add(codigo);
  try {
    try {
      await api(ruta(codigo), { method: 'DELETE' });
    } catch (error) {
      el.errorInventario.textContent = error.message;
      await cargarInventario();
      return;
    }
    const teniaFoco = registro.fila.contains(document.activeElement);
    const vecina = registro.fila.nextElementSibling ?? registro.fila.previousElementSibling;
    await animarSalida(registro.fila);
    if (productoEnPanel() === codigo) mostrarInicio('Producto eliminado', 'Escanea o escribe otro código.');
    estado.productos = estado.productos.filter((p) => p.codigo !== codigo);
    pintarInventario();
    el.anuncioInventario.textContent = `${producto.nombre} eliminado del inventario.`;
    if (teniaFoco) {
      (vecina?.querySelector('[data-accion="eliminar"]') ?? el.tituloInventario).focus();
    }
  } finally {
    eliminandoAqui.delete(codigo);
  }
}

// ---------- Cambios hechos por otras personas (tiempo real) ----------

const consultasEnCurso = new Map(); // código → { otraVez } mientras se pide al servidor
const eliminandoAqui = new Set(); // eliminaciones propias: su animación ya se encarga de la fila
const destellos = new WeakMap();

const mismoProducto = (a, b) =>
  a.nombre === b.nombre && a.precio === b.precio && a.cantidad === b.cantidad && a.actualizadoEn === b.actualizadoEn;

// La fila cambiada se ilumina un instante (solo color, sin movimiento).
function destellar(fila) {
  fila.classList.add('cambio');
  clearTimeout(destellos.get(fila));
  destellos.set(fila, setTimeout(() => fila.classList.remove('cambio'), 1200));
}

// El aviso solo dice qué código cambió; se pide el producto al servidor para mostrar siempre
// su estado más reciente. Si llegan más avisos mientras tanto, se vuelve a pedir al terminar.
export async function refrescarProducto(codigo) {
  const enCurso = consultasEnCurso.get(codigo);
  if (enCurso) {
    enCurso.otraVez = true;
    return;
  }
  const marca = { otraVez: true };
  consultasEnCurso.set(codigo, marca);
  try {
    while (marca.otraVez) {
      marca.otraVez = false;
      let producto = null;
      try {
        producto = await api(ruta(codigo));
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      await aplicarCambioRemoto(codigo, producto);
    }
  } catch {
    // Sin red: al reconectar se vuelve a cargar todo el inventario.
  } finally {
    consultasEnCurso.delete(codigo);
  }
}

async function aplicarCambioRemoto(codigo, producto) {
  if (eliminandoAqui.has(codigo)) return;
  const anterior = estado.productos.find((p) => p.codigo === codigo);
  const registro = filasPorCodigo.get(codigo);

  if (!producto) {
    if (!anterior) return;
    const teniaFoco = registro?.fila.contains(document.activeElement);
    const vecina = registro?.fila.nextElementSibling ?? registro?.fila.previousElementSibling;
    if (registro) await animarSalida(registro.fila);
    estado.productos = estado.productos.filter((p) => p.codigo !== codigo);
    pintarInventario();
    if (productoEnPanel() === codigo) mostrarInicio('Producto eliminado', 'Otra persona lo eliminó del inventario.');
    el.anuncioInventario.textContent = `${anterior.nombre} se eliminó del inventario.`;
    if (teniaFoco) (vecina?.querySelector('button') ?? el.tituloInventario).focus();
    return;
  }

  // Si ya lo teníamos igual (por ejemplo, fue un cambio hecho desde esta misma página), no hay nada que hacer.
  if (anterior && mismoProducto(anterior, producto)) return;
  estado.productos = anterior
    ? estado.productos.map((p) => (p.codigo === codigo ? producto : p))
    : [producto, ...estado.productos];
  pintarInventario(); // una fila nueva entra con su animación
  if (anterior) destellar(filasPorCodigo.get(codigo).fila);

  if (!el.vistas.tarjeta.hidden && estado.productoTarjeta?.codigo === codigo) {
    estado.productoTarjeta = producto;
    el.tarjetaNombre.textContent = producto.nombre;
    el.tarjetaPrecio.textContent = formatoPrecio(producto.precio);
    if (anterior && anterior.cantidad !== producto.cantidad) {
      rodarNumero(el.tarjetaCantidad, formatoEntero.format(producto.cantidad), 0);
    }
  } else if (estado.modo && estado.codigoFormulario === codigo) {
    ponerAviso(
      el.formAviso,
      estado.modo === 'nuevo'
        ? { texto: 'Otra persona acaba de registrar este producto. Cancela y vuelve a escanearlo.', icono: 'info', tono: 'acento' }
        : { texto: 'Otra persona acaba de cambiar este producto. Si guardas, reemplazarás sus cambios.', icono: 'info', tono: 'acento' },
    );
  }
}

// Después de una reconexión, por si se perdió algún aviso.
export function resincronizarInventario() {
  return cargarInventario();
}

async function accionInventario(evento) {
  const boton = evento.target.closest('button[data-accion]');
  if (!boton || boton.dataset.accion === 'eliminar') return;
  const { codigo } = boton.closest('tr').dataset;
  const registro = filasPorCodigo.get(codigo);
  const producto = estado.productos.find((p) => p.codigo === codigo);
  if (!registro || !producto) return;
  el.errorInventario.textContent = '';

  if (boton.dataset.accion === 'editar') {
    abrirFormulario('editar', producto, { texto: 'Editar producto', icono: 'pencil' });
    return;
  }

  // −/+ se usan muchas veces seguidas: respuesta instantánea, sin animación.
  if (registro.ocupado) return;
  registro.ocupado = true;
  try {
    const delta = boton.dataset.accion === 'sumar' ? 1 : -1;
    const actualizado = await api(`${ruta(codigo)}/ajustar`, { method: 'POST', body: { delta } });
    reemplazarProducto(actualizado);
    actualizarFila(registro, actualizado);
    pintarResumen();
    if (boton.disabled) registro.sumar.focus();
  } catch (error) {
    el.errorInventario.textContent = error.message;
    await cargarInventario();
  } finally {
    registro.ocupado = false;
  }
}

// ---------- Inicio ----------

const TEXTOS_LECTOR = {
  subtitulo: 'Consulta el inventario y escanea un producto para ver sus datos.',
  inicio: 'Activa la cámara o escribe un código para ver los datos de un producto.',
  vacio: 'Cuando se registren productos, aparecerán aquí.',
};

export function iniciarInventario(usuario) {
  estado.puedeEditar = usuario.rol === 'editor' || usuario.rol === 'admin';
  if (!estado.puedeEditar) {
    el.subtitulo.textContent = TEXTOS_LECTOR.subtitulo;
    el.inicioTexto.textContent = TEXTOS_LECTOR.inicio;
    el.textoVacio.textContent = TEXTOS_LECTOR.vacio;
  }

  el.btnCamara.addEventListener('click', () => {
    prepararAudio();
    if (estado.controles) {
      apagarCamara();
      estado.usarCamara = false;
      mostrarEstadoCamara('La cámara está apagada.');
    } else {
      encenderCamara();
    }
  });

  el.selCamara.addEventListener('change', () => {
    if (!estado.controles) return;
    detenerLectura();
    encenderCamara();
  });

  el.formManual.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const resultado = validarCodigo(el.codigoManual.value);
    el.errorManual.textContent = resultado.ok ? '' : resultado.error;
    el.codigoManual.setAttribute('aria-invalid', String(!resultado.ok));
    if (!resultado.ok || estado.consultando) return;
    el.codigoManual.value = '';
    if (estado.controles) {
      apagarCamara('Lectura en pausa');
      mostrarEstadoCamara('Lectura en pausa. Pulsa «Escanear siguiente» para continuar.');
    }
    procesarCodigo(resultado.valor);
  });

  el.btnSiguiente.addEventListener('click', escanearOtro);
  el.btnReintentar.addEventListener('click', escanearOtro);

  el.btnEditarTarjeta.addEventListener('click', () => {
    if (estado.productoTarjeta) {
      abrirFormulario('editar', estado.productoTarjeta, { texto: 'Editar producto', icono: 'pencil' });
    }
  });

  for (const [nombre, campo] of Object.entries(CAMPOS)) {
    const marcar = () => {
      estado.tocados.add(nombre);
      el.errorFormulario.textContent = '';
      actualizarFormulario();
    };
    campo.input.addEventListener('input', marcar);
    // Si el foco va a Guardar, el error se muestra al enviar (evita que el botón se mueva bajo el clic).
    campo.input.addEventListener('blur', (evento) => {
      if (campo.input.value !== '' && evento.relatedTarget !== el.btnGuardar) marcar();
    });
  }

  el.form.addEventListener('submit', guardarFormulario);
  el.btnCancelar.addEventListener('click', () => {
    if (estado.modo === 'editar') mostrarInicio('Edición cancelada', 'No se guardaron cambios.');
    else mostrarInicio('Registro cancelado', 'No se guardó el producto. Escanea o escribe otro código.');
  });
  el.filas.addEventListener('click', accionInventario);

  // La primera carga entra con la página; las filas no se animan una por una.
  cargarInventario({ animarNuevas: false });
}
