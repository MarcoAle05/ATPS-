"""El agente evaluador de los evals, con LangChain para Python.

Trabaja solo durante los evals, justo después de cada respuesta, y nunca califica: la cuenta la hace calificar.py.
Hace dos cosas:

1. Lee las líneas de una respuesta que no coinciden exactamente con ningún producto y dice a qué productos del
   inventario se refieren, o a ninguno, solo entre las opciones del inventario. Esta lectura sí puede contar
   como nombrado.
2. Explica en una frase cada faltante y cada sobrante de un caso de grupo. Lo que diga no cambia la calificación.

Tiene su propia configuración (modelo, parámetros e instrucciones), distinta de la del conversador del Worker.
Habla directo con DeepSeek, con la clave DEEPSEEK_API_KEY de .dev.vars, sin pasar por la app.
"""

import hashlib
import json
import os

# Nada de trazas a LangSmith ni a otro servicio: lo que se manda va solo a DeepSeek.
os.environ['LANGSMITH_TRACING'] = 'false'
os.environ['LANGCHAIN_TRACING_V2'] = 'false'

from langchain_core.messages import HumanMessage, SystemMessage  # noqa: E402
from langchain_deepseek import ChatDeepSeek  # noqa: E402
from pydantic import BaseModel, Field, SecretStr  # noqa: E402

# Configuraciones que se pueden elegir con --evaluador. Por decisión del dueño (2026-11-16), por ahora solo
# deepseek-flash. Temperatura 0 para que lea igual cada vez, y sin razonamiento, como el conversador.
CONFIGURACIONES = {
    'deepseek-flash': {
        'proveedor': 'deepseek',
        'url': 'https://api.deepseek.com',
        'modelo': 'deepseek-flash',
        'temperatura': 0,
        'max_tokens': 1500,
        # Va tal cual en el cuerpo de la petición: DeepSeek no razona antes de contestar.
        'cuerpo_extra': {'thinking': {'type': 'disabled'}},
    },
}

# ---------- Instrucciones ----------

INSTRUCCIONES_LINEAS = """Eres el evaluador de un examen del asistente del inventario de un negocio pequeño. No calificas: solo lees.

Recibes la lista de productos del inventario (código y nombre) y algunas líneas de una respuesta del asistente. Ninguna de esas líneas contiene exactamente el nombre ni el código de un producto. Para cada línea, di qué productos del inventario nombra.

Reglas:
- Solo puedes elegir códigos de la lista del inventario. Copia el código tal cual.
- Si la línea no nombra ningún producto, devuelve una lista vacía (ninguno). Así pasa con las líneas que solo presentan, resumen o cierran la respuesta, como «Estos son tus chicles:» o «¿Te ayudo con algo más?».
- Un producto cuenta si la línea lo nombra aunque sea con otras palabras, una abreviatura o una falta de ortografía, siempre que quede claro cuál es.
- Si la línea podría referirse a varios productos y no queda claro a cuál, no elijas ninguno de ellos.
- Si la línea nombra varios productos, inclúyelos todos.
- No juzgues si la respuesta es correcta ni si el producto pertenece a algún grupo. Solo identifica qué productos se nombran.
- Devuelve una lectura por cada línea que recibiste, con el mismo número de línea."""

INSTRUCCIONES_FALLOS = """Eres el evaluador de un examen del asistente del inventario de un negocio pequeño.

El examen le preguntó al asistente por un grupo de productos (por ejemplo, los chicles) y comparó su respuesta con la lista correcta del dueño. La calificación ya está hecha y no la cambias. Tu trabajo es explicar cada fallo:
- un faltante es un producto que sí pertenece al grupo y la respuesta no nombró;
- un sobrante es un producto que no pertenece al grupo y la respuesta sí nombró.

Para cada fallo, escribe una sola frase en español que diga por qué es probable que el asistente se equivocara. Apóyate en los hechos que se te dan:
- el nombre del producto: si dice o no a qué grupo pertenece, si se parece a productos de otro grupo o comparte marca con ellos;
- si el asistente llegó a ver el producto en sus consultas al inventario o nunca lo vio;
- qué dijo la respuesta sobre ese producto, si lo nombró.

Sé concreto y breve. No repitas la definición de faltante o sobrante; di la causa probable. Devuelve una explicación por cada fallo, con su código."""


# ---------- Salida estructurada ----------


class LecturaLinea(BaseModel):
    """Qué productos nombra una línea de la respuesta."""

    linea: int = Field(description='Número de la línea, tal como se te dio.')
    codigos: list[str] = Field(
        description='Códigos de los productos del inventario que nombra la línea. Lista vacía si no nombra ninguno.'
    )


class LecturaDeLineas(BaseModel):
    """Una lectura por cada línea recibida."""

    lecturas: list[LecturaLinea]


class Explicacion(BaseModel):
    """Por qué falló un producto."""

    codigo: str = Field(description='Código del producto, tal como se te dio.')
    explicacion: str = Field(description='Una sola frase en español con la causa probable del fallo.')


class ExplicacionDeFallos(BaseModel):
    """Una explicación por cada fallo recibido."""

    explicaciones: list[Explicacion]


# Versión de todo lo fijo del evaluador: configuración, instrucciones y esquemas. Cambia si cambia cualquiera.
VERSION = hashlib.sha256(json.dumps({
    'configuraciones': CONFIGURACIONES,
    'lineas': INSTRUCCIONES_LINEAS,
    'fallos': INSTRUCCIONES_FALLOS,
    'esquemas': [LecturaDeLineas.model_json_schema(), ExplicacionDeFallos.model_json_schema()],
}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def _lista_inventario(inventario: list[dict]) -> str:
    return '\n'.join(f'{p["codigo"]} | {p["nombre"]}' for p in inventario)


class Evaluador:
    """Un evaluador con una de las CONFIGURACIONES. Lleva la cuenta de sus tokens en self.uso."""

    def __init__(self, nombre: str, api_key: str):
        self.nombre = nombre
        self.configuracion = CONFIGURACIONES[nombre]
        c = self.configuracion
        modelo = ChatDeepSeek(
            model=c['modelo'],
            api_key=SecretStr(api_key),
            api_base=c['url'],
            temperature=c['temperatura'],
            max_tokens=c['max_tokens'],
            extra_body=c['cuerpo_extra'],
            max_retries=2,
            timeout=60,
        )
        # include_raw: así se lee el uso de tokens y un error de formato no tumba la corrida.
        self._lineas = modelo.with_structured_output(LecturaDeLineas, include_raw=True)
        self._fallos = modelo.with_structured_output(ExplicacionDeFallos, include_raw=True)
        self.uso = {'llamadas': 0, 'errores': 0, 'tokens_entrada': 0, 'tokens_salida': 0, 'tokens_cache': 0}

    def descripcion(self) -> dict:
        """Lo que va en el archivo de resultados para saber con qué se evaluó."""
        c = self.configuracion
        return {
            'nombre': self.nombre,
            'modelo': c['modelo'],
            'temperatura': c['temperatura'],
            'max_tokens': c['max_tokens'],
            'razonamiento': 'desactivado' if c['cuerpo_extra'].get('thinking', {}).get('type') == 'disabled' else 'activado',
            'version': VERSION,
        }

    def _llamar(self, cadena, mensajes) -> tuple[BaseModel | None, str | None]:
        """Devuelve (salida, error). Nunca lanza: un fallo del evaluador no debe detener los evals."""
        self.uso['llamadas'] += 1
        try:
            resultado = cadena.invoke(mensajes)
        except Exception as error:  # noqa: BLE001 — red, límite o rechazo del proveedor
            self.uso['errores'] += 1
            # Solo el tipo y el estado: el mensaje del SDK podría traer datos de la petición.
            estado = getattr(error, 'status_code', None)
            return None, f'{type(error).__name__}{f" {estado}" if estado else ""}'
        uso = getattr(resultado.get('raw'), 'usage_metadata', None) or {}
        self.uso['tokens_entrada'] += uso.get('input_tokens', 0)
        self.uso['tokens_salida'] += uso.get('output_tokens', 0)
        self.uso['tokens_cache'] += (uso.get('input_token_details') or {}).get('cache_read', 0) or 0
        if resultado.get('parsing_error') or resultado.get('parsed') is None:
            self.uso['errores'] += 1
            return None, 'La salida del evaluador no tiene el formato pedido.'
        return resultado['parsed'], None

    def leer_lineas(self, lineas: list[dict], inventario: list[dict]) -> dict:
        """Para cada línea {numero, texto}, qué productos nombra.

        Devuelve {"lecturas": [{"numero", "texto", "codigos", "invalidos"}], "error"}. Los códigos que no están
        en el inventario se descartan y quedan en "invalidos"; una línea sin lectura queda sin productos.
        """
        texto_lineas = '\n'.join(f'{l["numero"]}: {l["texto"]}' for l in lineas)
        salida, error = self._llamar(self._lineas, [
            SystemMessage(INSTRUCCIONES_LINEAS),
            HumanMessage(f'Inventario (código | nombre):\n{_lista_inventario(inventario)}\n\nLíneas de la respuesta:\n{texto_lineas}'),
        ])
        validos = {p['codigo'] for p in inventario}
        por_numero = {l.linea: l.codigos for l in salida.lecturas} if salida else {}
        lecturas = []
        for linea in lineas:
            codigos = por_numero.get(linea['numero'], [])
            lecturas.append({
                'numero': linea['numero'],
                'texto': linea['texto'],
                'codigos': sorted({c for c in codigos if c in validos}),
                'invalidos': sorted({c for c in codigos if c not in validos}),
            })
        return {'lecturas': lecturas, 'error': error}

    def explicar_fallos(self, caso: dict, respuesta: str, fallos: list[dict], consultas: str) -> dict:
        """Una frase por cada fallo {codigo, nombre, tipo: faltante|sobrante, visto: bool}.

        Devuelve {"explicaciones": {código: frase}, "error"}.
        """
        lista = '\n'.join(
            f'- {f["codigo"]} | {f["nombre"]} | {f["tipo"]} | '
            f'el asistente {"sí lo vio" if f["visto"] else "nunca lo vio"} en sus consultas'
            for f in fallos
        )
        salida, error = self._llamar(self._fallos, [
            SystemMessage(INSTRUCCIONES_FALLOS),
            HumanMessage(
                f'Grupo: {caso["grupo"]}\n'
                f'Pregunta al asistente: {caso["pregunta"]}\n\n'
                f'Respuesta del asistente:\n{respuesta}\n\n'
                f'Consultas que hizo el asistente al inventario:\n{consultas}\n\n'
                f'Fallos (código | nombre | tipo | si lo vio):\n{lista}'
            ),
        ])
        codigos = {f['codigo'] for f in fallos}
        explicaciones = {e.codigo: e.explicacion.strip() for e in salida.explicaciones if e.codigo in codigos} if salida else {}
        return {'explicaciones': explicaciones, 'error': error}
