// Modelos del asistente: qué proveedores hay, sus parámetros fijos y cómo se crea el modelo de LangChain de cada uno.
// La lista de modelos permitidos está en wrangler.jsonc (MODELOS_ASISTENTE): [{ id, proveedor, modelo }], y el
// primero es el de uso normal. Aquí solo vive lo que depende del código, no de la configuración.
import { ChatDeepSeek } from '@langchain/deepseek';
// Ya viene en el Worker: @langchain/deepseek la usa por dentro.
import { ChatOpenAICompletions } from '@langchain/openai';

// Gemini, por su API compatible con OpenAI, exige que cada llamada de herramienta vuelva en el historial con la
// firma de su razonamiento (tool_calls[].extra_content.google.thought_signature); sin ella responde 400.
// El conversor de mensajes de LangChain rearma las llamadas sin extra_content. responder guarda las llamadas tal como
// llegaron en additional_kwargs.tool_calls, y esta clase vuelve a poner la firma, por id, justo antes de enviar.
// Una instancia sirve a una sola pregunta y sus llamadas van una tras otra, así que firmas no se mezcla.
class ModeloGemini extends ChatOpenAICompletions {
  async *_streamResponseChunks(mensajes, opciones, gestor) {
    this.firmas = new Map();
    for (const mensaje of mensajes) {
      for (const llamada of mensaje.additional_kwargs?.tool_calls ?? []) {
        if (llamada?.id && llamada.extra_content) this.firmas.set(llamada.id, llamada.extra_content);
      }
    }
    yield* super._streamResponseChunks(mensajes, opciones, gestor);
  }

  completionWithRetry(peticion, opciones) {
    if (this.firmas?.size) {
      for (const mensaje of peticion.messages ?? []) {
        for (const llamada of mensaje.tool_calls ?? []) {
          const extra = this.firmas.get(llamada.id);
          if (extra) llamada.extra_content = extra;
        }
      }
    }
    return super.completionWithRetry(peticion, opciones);
  }
}

// Parámetros fijos de cada proveedor. Entran en la versión de las instrucciones de sus modelos (asistente.js):
// cambiar los de uno no cambia la versión del otro.
export const PROVEEDORES = {
  deepseek: {
    nombre: 'DeepSeek',
    clave: 'DEEPSEEK_API_KEY',
    url: 'https://api.deepseek.com',
    Clase: ChatDeepSeek,
    parametros: {
      temperature: 0.2,
      maxTokens: 800,
      // Sin razonamiento: menos espera y menos CPU. Con razonamiento y herramientas, DeepSeek exige que se le
      // devuelva reasoning_content, y el conversor de LangChain no lo manda. modelKwargs va tal cual en el cuerpo.
      modelKwargs: { thinking: { type: 'disabled' } },
    },
  },
  gemini: {
    nombre: 'Gemini',
    clave: 'GEMINI_API_KEY',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    Clase: ModeloGemini,
    parametros: {
      // Sin temperatura: Google pide no cambiar la de los modelos Gemini 3.x (por debajo de 1 pueden repetirse).
      maxTokens: 800,
      // El razonamiento de Gemini 3.x no se puede apagar; 'minimal' es lo más bajo que acepta.
      modelKwargs: { reasoning_effort: 'minimal' },
    },
  },
};

// El modelo elegido de la lista de wrangler.jsonc: el de id, o el primero si id es undefined.
// Devuelve { id, proveedor, modelo }, null si id no está en la lista, o lanza si la lista no sirve.
export function elegirModelo(env, id) {
  const lista = env.MODELOS_ASISTENTE;
  if (!Array.isArray(lista) || lista.length === 0) throw new Error('MODELOS_ASISTENTE debe ser una lista con al menos un modelo.');
  const elegido = id === undefined ? lista[0] : lista.find((modelo) => modelo?.id === id);
  if (!elegido) return null;
  if (!Object.hasOwn(PROVEEDORES, elegido.proveedor) || typeof elegido.modelo !== 'string' || !elegido.modelo) {
    throw new Error(`MODELOS_ASISTENTE: el modelo "${String(elegido.id)}" no tiene un proveedor conocido o le falta el nombre.`);
  }
  return elegido;
}

// streamUsage: el uso de tokens llega en un fragmento extra al final de cada llamada y LangChain lo deja en usage_metadata.
export function crearModelo({ proveedor, modelo }, apiKey) {
  const { Clase, url, parametros } = PROVEEDORES[proveedor];
  return new Clase({
    apiKey, // explícita: en un Worker no hay process.env
    model: modelo,
    configuration: { baseURL: url },
    ...parametros,
    maxRetries: 1, // LangChain reintenta 6 veces por defecto: no cabría en los tiempos de espera
    streamUsage: true,
  });
}
