// Reglas de validación compartidas por el navegador (app.js) y el Worker (src/).
// Cada validador devuelve { ok: true, valor } o { ok: false, error }.

export const NOMBRE_MAX = 250;
export const PRECIO_MAX = 10000;
export const CODIGO_MAX = 64;

// Letras de cualquier idioma (con hasta 3 marcas de acento pegadas a la letra), dígitos y espacios.
// Nada de emojis, símbolos ni signos de puntuación.
const NOMBRE_PERMITIDO = /^(?:\p{L}[\p{Mn}\p{Mc}]{0,3}|[0-9 ])+$/u;
// Selectores de variación: marcas invisibles que convierten letras o dígitos en emojis (como el emoji de la tecla 1).
const SELECTOR_VARIACION = /[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/u;
const SELECTORES_VARIACION = new RegExp(SELECTOR_VARIACION.source, 'gu');
const CODIGO_PERMITIDO = /^[\x21-\x7E]+$/;
const PRECIO_TEXTO = /^\d+(?:\.\d{1,2})?$/;
const ENTERO_TEXTO = /^\d+$/;

const ok = (valor) => ({ ok: true, valor });
const falla = (error) => ({ ok: false, error });

const longitud = (texto) => [...texto].length;

function normalizarEspacios(texto) {
  return texto.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function validarNombre(entrada) {
  if (typeof entrada !== 'string') return falla('Escribe el nombre del producto.');
  const nombre = normalizarEspacios(entrada);
  if (nombre === '') return falla('Escribe el nombre del producto.');
  if (longitud(nombre) > NOMBRE_MAX) {
    return falla(`El nombre no puede pasar de ${NOMBRE_MAX} caracteres.`);
  }
  if (SELECTOR_VARIACION.test(nombre) || !NOMBRE_PERMITIDO.test(nombre)) {
    return falla('Usa solo letras, números y espacios (sin emojis ni caracteres especiales).');
  }
  return ok(nombre);
}

// Convierte un nombre de origen externo (Open Food Facts) en uno que cumpla validarNombre,
// o devuelve '' si no queda nada aprovechable. Ej.: "Coca-Cola® 600 ml" → "Coca Cola 600 ml".
export function sanitizarNombre(entrada) {
  if (typeof entrada !== 'string') return '';
  let texto = entrada
    .normalize('NFC')
    .replace(SELECTORES_VARIACION, '')
    .replace(/\p{Me}/gu, '')
    .replace(/[^\p{L}\p{Mn}\p{Mc}0-9 ]/gu, ' ')
    // Acentos sueltos que no van pegados a una letra.
    .replace(/(^|[^\p{L}\p{Mn}\p{Mc}])[\p{Mn}\p{Mc}]+/gu, '$1')
    // Más de 3 acentos sobre la misma letra.
    .replace(/(\p{L}[\p{Mn}\p{Mc}]{3})[\p{Mn}\p{Mc}]+/gu, '$1');
  texto = normalizarEspacios(texto);
  texto = [...texto].slice(0, NOMBRE_MAX).join('').trim();
  const resultado = validarNombre(texto);
  return resultado.ok ? resultado.valor : '';
}

// Acepta número o texto ("12.50"). Devuelve el precio en centavos enteros.
export function validarPrecio(entrada) {
  let precio;
  if (typeof entrada === 'number') {
    precio = entrada;
  } else if (typeof entrada === 'string') {
    const texto = entrada.trim();
    if (texto === '') return falla('Escribe el precio.');
    if (texto.startsWith('-')) return falla('El precio no puede ser negativo.');
    if (!PRECIO_TEXTO.test(texto)) {
      return falla('Escribe un precio válido, con máximo 2 decimales (ej. 25.50).');
    }
    precio = Number(texto);
  } else {
    return falla('Escribe el precio.');
  }
  if (!Number.isFinite(precio)) return falla('El precio debe ser un número finito.');
  if (precio < 0) return falla('El precio no puede ser negativo.');
  if (precio > PRECIO_MAX) return falla('El precio no puede ser mayor a $10,000.00.');
  const centavos = Math.round(precio * 100);
  if (Math.abs(precio * 100 - centavos) > 1e-6) {
    return falla('El precio puede tener máximo 2 decimales.');
  }
  return ok(centavos);
}

export function validarCantidad(entrada) {
  let cantidad;
  if (typeof entrada === 'number') {
    cantidad = entrada;
  } else if (typeof entrada === 'string' && ENTERO_TEXTO.test(entrada.trim())) {
    cantidad = Number(entrada.trim());
  } else if (typeof entrada === 'string' && entrada.trim().startsWith('-')) {
    return falla('La cantidad no puede ser negativa.');
  } else {
    return falla('Escribe una cantidad entera (0, 1, 2…).');
  }
  if (cantidad < 0) return falla('La cantidad no puede ser negativa.');
  if (!Number.isSafeInteger(cantidad)) return falla('Escribe una cantidad entera (0, 1, 2…).');
  return ok(cantidad);
}

export function validarCodigo(entrada) {
  if (typeof entrada !== 'string') return falla('Escribe o escanea un código de barras.');
  const codigo = entrada.trim();
  if (codigo === '') return falla('Escribe o escanea un código de barras.');
  if (codigo.length > CODIGO_MAX) return falla(`El código no puede pasar de ${CODIGO_MAX} caracteres.`);
  if (!CODIGO_PERMITIDO.test(codigo)) {
    return falla('El código solo puede tener letras, números y símbolos básicos, sin espacios.');
  }
  return ok(codigo);
}

// EAN-8, UPC-A (12), EAN-13 y GTIN-14: los que existen en las bases de productos.
export function esEanUpc(codigo) {
  return /^\d{8,14}$/.test(codigo);
}

// ---------- Cuentas ----------

export const NOMBRE_PERSONA_MAX = 60;
export const CONTRASENA_MIN = 10;
export const CONTRASENA_MAX = 128;

// Parte local y dominio en ASCII; sin puntos al inicio, al final ni seguidos.
const CORREO = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
// Palabras de letras separadas por un espacio, guion o apóstrofo (María José, Ana-Lucía, O'Neill).
const NOMBRE_PERSONA = /^\p{L}+(?:[ '-]\p{L}+)*$/u;

export function validarCorreo(entrada) {
  if (typeof entrada !== 'string' || entrada.trim() === '') return falla('Escribe tu correo.');
  const correo = entrada.trim().toLowerCase();
  if (correo.length > 254) return falla('El correo es demasiado largo.');
  if (!CORREO.test(correo) || correo.includes('..')) {
    return falla('Escribe un correo válido, como nombre@ejemplo.com.');
  }
  return ok(correo);
}

export function validarNombrePersona(entrada) {
  if (typeof entrada !== 'string') return falla('Escribe tu nombre.');
  const nombre = normalizarEspacios(entrada);
  if (nombre === '') return falla('Escribe tu nombre.');
  const largo = longitud(nombre);
  if (largo < 2) return falla('Tu nombre debe tener al menos 2 letras.');
  if (largo > NOMBRE_PERSONA_MAX) return falla(`Tu nombre no puede pasar de ${NOMBRE_PERSONA_MAX} caracteres.`);
  if (!NOMBRE_PERSONA.test(nombre)) {
    return falla('Usa solo letras y espacios (se permiten guion y apóstrofo entre palabras).');
  }
  return ok(nombre);
}

// Contraseñas demasiado usadas que cumplen el largo mínimo.
const COMUNES = new Set([
  '1234567890', '0123456789', '0987654321', '9876543210', '1234567891', '12345678910', '1111111111',
  'contraseña', 'contrasena', 'contraseña1', 'contrasena1', 'contraseña123', 'contrasena123',
  'password12', 'password123', 'password1234', 'passw0rd123', 'qwertyuiop', 'qwerty1234', 'qwerty12345',
  'asdfghjkl1', '1q2w3e4r5t', '1qaz2wsx3edc', 'zaq12wsxcde', 'abc1234567', 'abcd123456', 'iloveyou12',
  'teamo12345', 'tequiero12', 'administrador', 'admin12345', 'admin123456', 'bienvenido', 'bienvenido1',
  'superman12', 'futbol1234', 'america123', 'mexico1234', 'guadalupe1', 'princesa12', 'holahola12',
  'inventario', 'inventario1', 'inventario123', 'lectorcodigo', 'codigodebarras',
]);
const SERIES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjklñ', 'zxcvbnm'];

function esSecuencia(texto) {
  return SERIES.some((serie) => serie.includes(texto) || [...serie].reverse().join('').includes(texto));
}

// Revisa cada requisito por separado: la pantalla de registro los muestra en vivo.
// fuerza: 0 a 4. Si falta algún requisito, nunca pasa de 1.
export function revisarContrasena(entrada, { nombre = '', correo = '' } = {}) {
  const texto = typeof entrada === 'string' ? entrada : '';
  const largo = longitud(texto);
  const minusculas = texto.toLowerCase();
  const tieneLetra = /\p{L}/u.test(texto);
  const tieneOtro = /[\p{N}]|[^\p{L}\p{N}\s]/u.test(texto);
  const clases = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u].filter((r) => r.test(texto)).length;
  // Sin acentos ni mayúsculas, para que "Perez" cuente igual que "Pérez".
  const plano = (t) => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const usuarioCorreo = plano(correo).split('@')[0];
  const partesPersonales = [
    ...plano(nombre).split(/[\s'-]+/),
    usuarioCorreo,
    ...usuarioCorreo.split(/[._%+-]+/),
  ].filter((parte) => parte.length >= 3);
  const personal = partesPersonales.some((parte) => plano(texto).includes(parte));
  const comun = COMUNES.has(minusculas) || /^(.)\1+$/u.test(texto) || esSecuencia(minusculas);

  const requisitos = [
    { id: 'largo', texto: `Entre ${CONTRASENA_MIN} y ${CONTRASENA_MAX} caracteres`, ok: largo >= CONTRASENA_MIN && largo <= CONTRASENA_MAX },
    { id: 'variedad', texto: 'Letras con números o símbolos (o 16 caracteres o más)', ok: (tieneLetra && tieneOtro) || largo >= 16 },
    { id: 'personal', texto: 'Sin tu nombre ni tu correo', ok: largo > 0 && !personal },
    { id: 'comun', texto: 'No es una contraseña común', ok: largo > 0 && !comun },
  ];

  let fuerza = 0;
  if (largo >= CONTRASENA_MIN) fuerza++;
  if (largo >= 14) fuerza++;
  if (clases >= 3) fuerza++;
  if (largo >= 18 || clases === 4) fuerza++;
  if (requisitos.some((r) => !r.ok)) fuerza = Math.min(fuerza, 1);
  return { requisitos, fuerza };
}

const MENSAJES_CONTRASENA = {
  largo: `La contraseña debe tener entre ${CONTRASENA_MIN} y ${CONTRASENA_MAX} caracteres.`,
  variedad: 'Combina letras con números o símbolos, o usa 16 caracteres o más.',
  personal: 'La contraseña no debe incluir tu nombre ni tu correo.',
  comun: 'Esa contraseña es demasiado común. Elige otra.',
};

export function validarContrasena(entrada, contexto) {
  if (typeof entrada !== 'string' || entrada === '') return falla('Escribe una contraseña.');
  if (/^\s|\s$/u.test(entrada)) return falla('La contraseña no puede empezar ni terminar con espacios.');
  if (/\p{Cc}/u.test(entrada)) return falla('La contraseña tiene caracteres no permitidos.');
  const fallido = revisarContrasena(entrada, contexto).requisitos.find((r) => !r.ok);
  return fallido ? falla(MENSAJES_CONTRASENA[fallido.id]) : ok(entrada);
}

// Código de un solo uso para crear la cuenta de administrador (16 letras y números, con o sin guiones).
export function validarCodigoConfiguracion(entrada) {
  const codigo = typeof entrada === 'string' ? entrada.toUpperCase().replace(/[\s-]/g, '') : '';
  if (codigo === '') return falla('Escribe el código de configuración.');
  if (!/^[A-Z0-9]{16}$/.test(codigo)) return falla('El código tiene 16 letras y números (por ejemplo, ABCD-EFGH-JKLM-NPQR).');
  return ok(codigo);
}

// ---------- Asistente ----------

// El navegador guarda la conversación y la manda completa en cada pregunta.
export const ASISTENTE_MENSAJES_MAX = 20;
export const ASISTENTE_PREGUNTA_MAX = 500;
export const ASISTENTE_RESPUESTA_MAX = 4000;
// Tamaño máximo del cuerpo de POST /api/asistente (como lo mide leerJson en el Worker).
// Si la conversación no cabe, el navegador debe quitar los mensajes más viejos.
export const ASISTENTE_CUERPO_MAX = 32 * 1024;

const LIMITES_ASISTENTE = { usuario: ASISTENTE_PREGUNTA_MAX, asistente: ASISTENTE_RESPUESTA_MAX };
const CONVERSACION_INVALIDA = 'La conversación no tiene un formato válido. Empieza una nueva.';

// Solo existen los roles "usuario" y "asistente": el navegador no puede mandar mensajes de sistema ni de herramienta.
// Devuelve los mensajes con el texto en NFC y sin espacios en los extremos (los saltos de línea internos se conservan).
export function validarConversacion(entrada) {
  if (!Array.isArray(entrada) || entrada.length === 0) return falla('Escribe una pregunta.');
  if (entrada.length > ASISTENTE_MENSAJES_MAX) {
    return falla(`La conversación es demasiado larga (máximo ${ASISTENTE_MENSAJES_MAX} mensajes). Empieza una nueva.`);
  }
  const mensajes = [];
  for (const mensaje of entrada) {
    if (!mensaje || typeof mensaje !== 'object' || Array.isArray(mensaje)) return falla(CONVERSACION_INVALIDA);
    const { rol, texto } = mensaje;
    if (!Object.hasOwn(LIMITES_ASISTENTE, rol) || typeof texto !== 'string') return falla(CONVERSACION_INVALIDA);
    const limpio = texto.normalize('NFC').replace(/\r\n?/g, '\n').trim();
    if (limpio === '') return falla(rol === 'usuario' ? 'Escribe una pregunta.' : CONVERSACION_INVALIDA);
    if (longitud(limpio) > LIMITES_ASISTENTE[rol]) {
      return falla(rol === 'usuario'
        ? `La pregunta no puede pasar de ${ASISTENTE_PREGUNTA_MAX} caracteres.`
        : 'Una respuesta anterior es demasiado larga. Empieza una nueva conversación.');
    }
    mensajes.push({ rol, texto: limpio });
  }
  if (mensajes.at(-1).rol !== 'usuario') return falla('El último mensaje debe ser tu pregunta.');
  return ok(mensajes);
}

// Quién hace la pregunta: el chat de la página (valor por defecto; la interfaz no lo envía) o los evals.
// Queda en el registro de ejecuciones (columna origen).
export const ASISTENTE_ORIGENES = ['chat', 'eval'];

export function validarOrigenAsistente(entrada) {
  if (entrada === undefined) return ok('chat');
  if (!ASISTENTE_ORIGENES.includes(entrada)) return falla('El origen de la pregunta debe ser "chat" o "eval".');
  return ok(entrada);
}

// Qué modelo responde: un identificador corto de la lista MODELOS_ASISTENTE (wrangler.jsonc), como "deepseek"
// o "gemini". Aquí solo se revisa el formato; que esté en la lista lo comprueba el Worker. Sin él, undefined:
// el Worker usa el primero de la lista. La interfaz no lo envía.
const FORMATO_MODELO_ASISTENTE = /^[a-z0-9-]{1,32}$/;

export function validarModeloAsistente(entrada) {
  if (entrada === undefined) return ok(undefined);
  if (typeof entrada !== 'string' || !FORMATO_MODELO_ASISTENTE.test(entrada)) {
    return falla('El modelo debe ser un identificador de la lista de modelos del asistente, como "deepseek".');
  }
  return ok(entrada);
}
