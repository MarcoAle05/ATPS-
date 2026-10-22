// Respuestas JSON y errores de la API.

export class ErrorApi extends Error {
  constructor(status, mensaje, { campo, codigo, cabeceras } = {}) {
    super(mensaje);
    this.status = status;
    this.campo = campo;
    this.codigo = codigo;
    this.cabeceras = cabeceras;
  }
}

const CABECERAS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(datos, status = 200, cabeceras = {}) {
  const cuerpo = status === 204 ? null : JSON.stringify(datos);
  return new Response(cuerpo, { status, headers: { ...CABECERAS, ...cabeceras } });
}

export function respuestaDeError(error) {
  return json({ error: error.message, campo: error.campo, codigo: error.codigo }, error.status, error.cabeceras);
}

export function exigir(resultado, campo) {
  if (!resultado.ok) throw new ErrorApi(400, resultado.error, { campo });
  return resultado.valor;
}

const TAMANO_MAXIMO = 10 * 1024;

export async function leerJson(request) {
  const tipo = request.headers.get('Content-Type') ?? '';
  if (!tipo.toLowerCase().startsWith('application/json')) {
    throw new ErrorApi(415, 'Envía los datos en formato JSON.');
  }
  const texto = await request.text();
  if (texto.length > TAMANO_MAXIMO) throw new ErrorApi(413, 'Los datos enviados son demasiado grandes.');
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new ErrorApi(400, 'Los datos enviados no son JSON válido.');
  }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    throw new ErrorApi(400, 'Envía los datos en formato JSON.');
  }
  return datos;
}
