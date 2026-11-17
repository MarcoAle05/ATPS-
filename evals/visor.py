"""Visor de los resultados de los evals: una página HTML que muestra qué hizo cada agente en cada pregunta.

Uso (desde evals/):
    uv run visor.py                                        la corrida más reciente de resultados/
    uv run visor.py resultados/ARCHIVO.json                esa corrida
    uv run visor.py resultados/ARCHIVO.json --no-abrir     solo escribe la página y dice la ruta

Escribe evals/visor/ARCHIVO.html y la abre en el navegador. La carpeta visor/ no se sube: el JSON de la corrida es
la única fuente, y la página se puede borrar y volver a generar. Solo usa la biblioteca estándar: no hace llamadas de
red, no lee .dev.vars, no arranca la app y no gasta saldo.

La página tiene el encabezado de la corrida, los agentes con sus tokens, un índice de casos y, en cada repetición de
cada caso, un bloque por quien actuó:
- Conversador (modelo): las herramientas que usó, con sus argumentos y lo que devolvieron, la respuesta y sus tokens.
- Clasificador (modelo): cada producto que juzgó para el grupo, contra la lista del dueño.
- Calificación por código (calificar.py): no es un modelo, y es lo que decide si la repetición pasa.
- Evaluador (modelo): qué leyó en las líneas dudosas y cómo explicó cada fallo.

Las repeticiones que fallan salen abiertas y las que pasan, plegadas. Todo texto que viene del archivo pasa por
html.escape: las respuestas las escribió un modelo y los nombres vienen del inventario. La página no lleva JavaScript
ni recursos externos. Un campo que falta en el archivo (por ejemplo, la memoria en las corridas anteriores a la
etapa 4) se omite o se explica en una línea.
"""

import argparse
import html
import json
import re
import sys
import unicodedata
import webbrowser
from datetime import datetime
from pathlib import Path

CARPETA = Path(__file__).resolve().parent  # evals/
RESULTADOS = CARPETA / 'resultados'
VISOR = CARPETA / 'visor'

MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
         'noviembre', 'diciembre']

# Qué pide cada regla de calificar.py, en llano.
REGLAS = {
    'grupo': 'nombra exactamente los productos de la lista del dueño, sin faltantes ni sobrantes.',
    'dinero': 'la cifra de dinero esperada, calculada con SQL al correr, aparece en la respuesta.',
    'entero': 'el número esperado, calculado con SQL al correr, aparece en la respuesta.',
    'mas-caro': 'nombra el producto más caro y, si da precios, el suyo está entre ellos.',
    'negarse-sin-cambios': 'se niega, no dice que hizo el cambio y la base queda igual.',
    'fuera-de-tema': 'dice que solo ayuda con el inventario y no contesta la pregunta.',
    'formato': 'sin Markdown ni emojis, y cada precio con el formato $1,234.50.',
}
TIPOS = {
    'aprendizaje': 'el sistema podrá aprender de este caso.',
    'reserva': 'nunca se le corrige al sistema: mide sin darle la respuesta.',
}
# Reglas en las que el evaluador lee las líneas sin coincidencia exacta (calificar.REGLAS_CON_NOMBRADOS).
REGLAS_CON_NOMBRADOS = {'grupo', 'mas-caro'}
# Campos del detalle que no son de una regla: van en el bloque del evaluador o del clasificador.
CLAVES_APARTE = {'pasa', 'resumen', 'nombrados_por_codigo', 'lineas_sin_coincidencia', 'lecturas_evaluador',
                 'errores_evaluador', 'explicaciones', 'clasificador'}


class ErrorVisor(Exception):
    pass


# ---------- Texto ----------


def e(valor) -> str:
    """Escapa para HTML todo lo que viene del archivo."""
    return html.escape(str(valor), quote=True)


def plegar(texto: str) -> str:
    """Minúsculas, sin acentos y con los espacios colapsados, para ordenar y comparar nombres."""
    sin_marcas = ''.join(c for c in unicodedata.normalize('NFD', str(texto)) if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', sin_marcas.lower()).strip()


def ancla(texto) -> str:
    return re.sub(r'[^a-z0-9]+', '-', plegar(texto)).strip('-') or 'caso'


def es_numero(valor) -> bool:
    return isinstance(valor, (int, float)) and not isinstance(valor, bool)


def miles(n) -> str:
    if not es_numero(n):
        return e(n) if n is not None else 'sin dato'
    texto = f'{n:,.2f}' if isinstance(n, float) and not n.is_integer() else f'{int(n):,}'
    return texto.replace(',', ' ')


def pesos(valor) -> str:
    """Pesos (como en los resúmenes de las herramientas) → «$1,234.50»."""
    return f'${valor:,.2f}' if es_numero(valor) else e(valor)


def centavos(valor) -> str:
    """Centavos (como en la calificación) → «$1,234.50»."""
    return pesos(valor / 100) if es_numero(valor) else e(valor)


def duracion(ms) -> str:
    if not es_numero(ms):
        return 'sin dato'
    if ms < 1000:
        return f'{ms:.0f} ms'
    if ms < 60_000:
        return f'{ms / 1000:.1f} s'
    minutos, segundos = divmod(round(ms / 1000), 60)
    return f'{minutos} min {segundos} s'


def tokens(entrada, cache, salida) -> str:
    if entrada is None and salida is None:
        return 'sin datos de uso'
    texto = f'{miles(entrada)} de entrada'
    if cache is not None:
        texto += f' ({miles(cache)} desde la caché)'
    return texto + f' · {miles(salida)} de salida'


def fecha_legible(iso) -> str | None:
    try:
        momento = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return None
    return f'{momento.day} de {MESES[momento.month - 1]} de {momento.year}, {momento:%H:%M}'


def valor(v) -> str:
    """Un valor cualquiera del archivo, escapado: textos entre comillas latinas y lo demás como JSON."""
    if isinstance(v, str):
        return f'«{e(v)}»'
    return e(json.dumps(v, ensure_ascii=False))


def si_no(v) -> str:
    return 'sí' if v else 'no'


def marca(pasa) -> str:
    return '<span class="marca pasa">Pasa</span>' if pasa else '<span class="marca falla">Falla</span>'


def cod(texto) -> str:
    return f'<span class="cod">{e(texto)}</span>'


def dl(filas, clase='datos') -> str:
    """filas: [(término, valor en HTML ya escapado)]. Las filas con valor None se omiten."""
    partes = ''.join(f'<div><dt>{t}</dt><dd>{v}</dd></div>' for t, v in filas if v is not None)
    return f'<dl class="{clase}">{partes}</dl>' if partes else ''


def bloque(clase: str, quien: str, que: str, cuerpo: str) -> str:
    return (f'<section class="bloque {clase}"><header class="bloque-cabeza"><h4>{quien}</h4>'
            f'<p class="que">{que}</p></header>{cuerpo}</section>')


def lista_de(diccionario) -> dict:
    return diccionario if isinstance(diccionario, dict) else {}


# ---------- Página ----------


class Pagina:
    def __init__(self, datos: dict, archivo: Path):
        self.datos = datos
        self.archivo = archivo
        self.config = lista_de(datos.get('configuracion'))
        self.resumen = lista_de(datos.get('resumen'))
        self.inventario = [p for p in datos.get('inventario') or [] if isinstance(p, dict)]
        self.nombres = {p.get('codigo'): p.get('nombre') for p in self.inventario}
        self.casos = [c for c in datos.get('casos') or [] if isinstance(c, dict)]
        self.tiene_clasificador = 'clasificador' in self.config or bool(self.resumen.get('clasificador'))
        self.evaluador = self.config.get('evaluador')
        self.anclas = []
        for numero, caso in enumerate(self.casos, start=1):
            base = f'caso-{ancla(caso.get("id", numero))}'
            self.anclas.append(base if base not in self.anclas else f'{base}-{numero}')

    # ----- Productos -----

    def nombre(self, codigo) -> str:
        return self.nombres.get(codigo) or str(codigo)

    def producto(self, codigo) -> str:
        """Nombre con el código en letra pequeña."""
        nombre = self.nombres.get(codigo)
        if nombre is None:
            return f'{cod(codigo)} <span class="suave">(no está en el inventario del archivo)</span>'
        return f'{e(nombre)} {cod(codigo)}'

    def ordenar(self, codigos) -> list:
        return sorted(codigos, key=lambda c: (plegar(self.nombre(c)), str(c)))

    def lista(self, codigos, vacio='Ninguno.') -> str:
        if not codigos:
            return f'<p class="suave">{vacio}</p>'
        return '<ul class="productos">' + ''.join(f'<li>{self.producto(c)}</li>' for c in self.ordenar(codigos)) + '</ul>'

    def nombres_seguidos(self, codigos) -> str:
        """Solo los nombres, en el orden dado (el de la herramienta)."""
        return ', '.join(e(self.nombre(c)) for c in codigos)

    # ----- Encabezado -----

    def encabezado(self) -> str:
        total = self.resumen.get('casos', len(self.casos))
        pasan = self.resumen.get('pasan', sum(bool(c.get('pasa')) for c in self.casos))
        repeticiones = self.config.get('repeticiones')
        app = lista_de(self.config.get('app'))
        inventario = lista_de(self.config.get('inventario'))
        recalificada = self.datos.get('recalificada_de')
        alterada = self.config.get('alterar_base')

        texto_app = None
        if app:
            texto_app = f'commit {cod(app.get("commit", "?"))}, ' + (
                '<strong>con cambios sin commit</strong>: la app no era exactamente ese commit'
                if app.get('cambios_sin_commit') else 'sin cambios fuera del commit')
        texto_base = None
        if inventario or alterada is not None:
            texto_base = (f'{miles(inventario.get("productos"))} productos de {cod(inventario.get("archivo", "?"))}, '
                          if inventario else '')
            texto_base += ('<strong class="aviso">alterada a propósito</strong> (<span class="cod">--alterar-base</span>): '
                           'en los casos de conducta se cambió un precio a mano después de preguntar, para probar la '
                           'comparación de antes y después' if alterada else 'sin alterar')
        filas = [
            ('Archivo', cod(self.archivo.name)),
            ('Recalificación', f'sí, de {cod(recalificada)}: las respuestas son las de esa corrida; la calificación y '
                               'el evaluador se volvieron a correr' if recalificada else None),
            ('App', texto_app),
            ('Repeticiones', f'{e(repeticiones)} por caso' if repeticiones is not None else None),
            ('Base del examen', texto_base),
        ]
        titulo = 'Recalificación' if recalificada else 'Corrida'
        fecha = fecha_legible(self.datos.get('fecha'))
        titulo += f' del {fecha}' if fecha else ' sin fecha legible'
        return (f'<header class="corrida"><p class="sobre">Evals del asistente</p>'
                f'<h1>{titulo}</h1>'
                f'<p class="veredicto">Pasan {e(pasan)} de {e(total)} casos.</p>'
                f'<p class="suave">Un caso pasa solo si pasan todas sus repeticiones. Quien decide si una repetición '
                f'pasa es la calificación por código, no un modelo.</p>'
                f'{dl(filas)}</header>')

    # ----- Agentes -----

    def tarjeta(self, clase: str, nombre: str, que: str, papel: str, filas) -> str:
        return (f'<article class="agente {clase}"><h3>{nombre}</h3><p class="que">{que}</p>'
                f'<p class="papel">{papel}</p>{dl(filas, "datos apilada")}</article>')

    def agentes(self) -> str:
        conversador = lista_de(self.config.get('conversador'))
        uso = lista_de(self.resumen.get('conversador'))
        modelos = ', '.join(conversador.get('modelos') or []) or 'sin filas'
        versiones = ', '.join(conversador.get('versiones_instrucciones') or []) or 'sin dato'
        preguntas = None
        if 'preguntas' in uso:
            preguntas = miles(uso['preguntas']) + (f' ({miles(uso["sin_fila"])} sin fila en el registro)'
                                                    if uso.get('sin_fila') else '')
        tarjetas = [self.tarjeta(
            'conversador', 'Conversador', f'modelo {e(modelos)}',
            'Responde la pregunta: decide qué herramientas usar para consultar el inventario y escribe la respuesta.',
            [('Versión de instrucciones', cod(versiones)),
             ('Preguntas', preguntas),
             ('Tokens', tokens(uso.get('tokens_entrada'), uso.get('tokens_cache'), uso.get('tokens_salida')) if uso else None),
             ('Tiempo total', duracion(uso.get('duracion_ms')) if 'duracion_ms' in uso else None)])]

        papel = ('Juzga qué productos pertenecen a un grupo (chicle, pastilla de menta…) cuando el conversador usa '
                 '<span class="cod">productos_del_grupo</span>. Sus juicios quedan en la memoria de grupos.')
        if not self.tiene_clasificador:
            tarjetas.append(self.tarjeta('clasificador', 'Clasificador', 'sin datos',
                                         papel + ' Esta corrida no registra clasificador.', []))
        else:
            clasificador = lista_de(self.config.get('clasificador'))
            uso = lista_de(self.resumen.get('clasificador'))
            llamadas = uso.get('llamadas')
            filas = [
                ('Versión', cod(', '.join(clasificador.get('versiones') or []) or 'sin dato')),
                ('Llamadas', miles(llamadas) + (f' ({miles(uso["errores"])} con error)' if uso.get('errores') else '')
                 if llamadas is not None else None),
                ('Tokens', tokens(uso.get('tokens_entrada'), uso.get('tokens_cache'), uso.get('tokens_salida'))
                 if llamadas else None),
                ('Tiempo total', duracion(uso.get('duracion_ms')) if llamadas else None),
            ]
            if not llamadas:
                papel += ' En esta corrida no intervino.'
            tarjetas.append(self.tarjeta('clasificador', 'Clasificador',
                                         f'modelo {e(", ".join(clasificador.get("modelos") or []) or "sin dato")}',
                                         papel, filas))

        papel = ('Lee las líneas de la respuesta que el código no reconoce y explica cada fallo de los casos de grupo. '
                 'No decide si un caso pasa.')
        if not self.evaluador:
            tarjetas.append(self.tarjeta('evaluador', 'Evaluador', 'sin evaluador',
                                         papel + ' Esta corrida fue sin evaluador: solo calificó el código.', []))
        else:
            evaluador = lista_de(self.evaluador)
            uso = lista_de(self.resumen.get('evaluador'))
            parametros = []
            if 'temperatura' in evaluador:
                parametros.append(f'temperatura {e(evaluador["temperatura"])}')
            if evaluador.get('razonamiento'):
                parametros.append(f'razonamiento {e(evaluador["razonamiento"])}')
            filas = [
                ('Versión', cod(evaluador.get('version', 'sin dato'))),
                ('Parámetros', ', '.join(parametros) or None),
                ('Llamadas', miles(uso['llamadas']) + (f' ({miles(uso["errores"])} con error)' if uso.get('errores') else '')
                 if 'llamadas' in uso else None),
                ('Tokens', tokens(uso.get('tokens_entrada'), uso.get('tokens_cache'), uso.get('tokens_salida')) if uso else None),
            ]
            tarjetas.append(self.tarjeta('evaluador', 'Evaluador', f'modelo {e(evaluador.get("modelo", "sin dato"))}',
                                         papel, filas))

        tarjetas.append(self.tarjeta(
            'codigo', 'Calificación por código', '<span class="cod">calificar.py</span> · no es un modelo',
            'Decide si cada repetición pasa, con reglas fijas escritas en Python. No gasta tokens.', []))
        return (f'<section class="agentes" aria-labelledby="quien"><h2 id="quien">Quién hizo qué</h2>'
                f'<div class="tarjetas">{"".join(tarjetas)}</div>'
                f'<p class="suave nota">Los tokens son los que informó cada modelo. El archivo no guarda precios, así '
                f'que esta página no calcula dólares.</p></section>')

    # ----- Índice -----

    def indice(self) -> str:
        if not self.casos:
            return '<section id="indice"><h2>Casos</h2><p>El archivo no tiene casos.</p></section>'
        filas = []
        for caso, destino in zip(self.casos, self.anclas):
            reps = caso.get('repeticiones') or []
            bien = sum(bool(r.get('pasa')) for r in reps if isinstance(r, dict))
            filas.append(
                f'<tr><td class="c-categoria" data-etiqueta="Categoría">{e(caso.get("categoria", ""))}</td>'
                f'<td class="c-caso"><a href="#{destino}">{e(caso.get("id", "sin id"))}</a></td>'
                f'<td class="c-pregunta">{e(caso.get("pregunta", ""))}</td>'
                f'<td class="c-resultado">{marca(caso.get("pasa"))}</td>'
                f'<td class="c-pasan num" data-etiqueta="Pasan">{bien}/{len(reps)}</td></tr>')
        return (f'<section id="indice" aria-labelledby="titulo-indice"><h2 id="titulo-indice">Casos</h2>'
                f'<table class="indice"><thead><tr><th scope="col">Categoría</th><th scope="col">Caso</th>'
                f'<th scope="col">Pregunta</th><th scope="col">Resultado</th><th scope="col">Repeticiones que pasan</th>'
                f'</tr></thead><tbody>{"".join(filas)}</tbody></table></section>')

    # ----- Un caso -----

    def caso(self, caso: dict, destino: str, numero: int) -> str:
        reps = [r for r in caso.get('repeticiones') or [] if isinstance(r, dict)]
        bien = sum(bool(r.get('pasa')) for r in reps)
        regla = caso.get('regla')
        tipo = caso.get('tipo')
        prohibidas = caso.get('prohibidas') or []
        meta = [
            ('Regla', f'{cod(regla)}: {e(REGLAS[regla])}' if regla in REGLAS else (cod(regla) if regla else None)),
            ('Tipo', f'{e(tipo)}: {e(TIPOS[tipo])}' if tipo in TIPOS else (e(tipo) if tipo else None)),
            ('Grupo', f'«{e(caso["grupo"])}»' if caso.get('grupo') else None),
            ('Cifra esperada', f'se calcula con SQL al correr: <code>{e(caso["esperado_sql"])}</code>'
             if caso.get('esperado_sql') else None),
            ('Precios', f'al menos {e(caso["precios_minimos"])}' if caso.get('precios_minimos') else None),
            ('No debe decir', ', '.join(e(p) for p in prohibidas) if prohibidas else None),
        ]
        lista_dueno = ''
        if 'esperados' in caso:
            esperados = caso.get('esperados') or []
            otros = len([p for p in self.inventario if p.get('codigo') not in set(esperados)])
            lista_dueno = (f'<h3>Lista del dueño: {len(esperados)} productos</h3>{self.lista(esperados)}'
                           f'<p class="suave">Los otros {otros} productos del inventario cuentan como «no».</p>')
        cuerpo = []
        for rep in reps:
            try:
                cuerpo.append(self.repeticion(caso, rep, destino))
            except Exception as error:  # un campo raro no debe romper la página entera
                cuerpo.append(f'<p class="alerta">No se pudo mostrar la repetición {e(rep.get("repeticion", "?"))}: '
                              f'{e(type(error).__name__)}: {e(error)}</p>')
        if not reps:
            cuerpo.append('<p class="suave">El caso no tiene repeticiones en el archivo.</p>')
        return (f'<section class="caso" id="{destino}" aria-labelledby="{destino}-titulo">'
                f'<header class="caso-cabeza"><p class="sobre">Caso {numero} de {len(self.casos)} · '
                f'{e(caso.get("categoria", "sin categoría"))}</p>'
                f'<h2 id="{destino}-titulo">{e(caso.get("id", "sin id"))} {marca(caso.get("pasa"))} '
                f'<span class="cuenta">{bien} de {len(reps)} repeticiones pasan</span></h2>'
                f'<p class="pregunta">{e(caso.get("pregunta", ""))}</p>{dl(meta)}{lista_dueno}</header>'
                f'{"".join(cuerpo)}<p class="volver"><a href="#indice">Volver al índice</a></p></section>')

    def repeticion(self, caso: dict, rep: dict, destino: str) -> str:
        pasa = bool(rep.get('pasa'))
        detalle = lista_de(rep.get('detalle'))
        numero = rep.get('repeticion', '?')
        bloques = [
            self.bloque_conversador(rep),
            self.bloque_clasificador(caso, rep),
            self.bloque_calificacion(caso, rep, detalle),
            self.bloque_evaluador(caso, rep, detalle),
        ]
        return (f'<details class="rep" id="{destino}-{ancla(numero)}"{"" if pasa else " open"}><summary>'
                f'<span class="rep-titulo">Repetición {e(numero)}</span> {marca(pasa)} '
                f'<span class="rep-resumen">{e(detalle.get("resumen", ""))}</span></summary>'
                f'<div class="bloques">{"".join(b for b in bloques if b)}</div></details>')

    # ----- Conversador -----

    def bloque_conversador(self, rep: dict) -> str:
        fila = lista_de(rep.get('fila'))
        partes = []
        if rep.get('error'):
            partes.append(f'<p class="alerta">No respondió: {e(rep["error"])}</p>')
        if fila:
            resultado = e(fila.get('resultado', 'sin dato')) + (f' ({e(fila["motivo"])})' if fila.get('motivo') else '')
            partes.append(dl([
                ('Resultado', resultado),
                ('Llamadas al modelo', miles(fila.get('llamadas'))),
                ('Duración', duracion(fila.get('duracion_ms'))),
                ('Tokens', tokens(fila.get('tokens_entrada'), fila.get('tokens_cache'), fila.get('tokens_salida'))),
            ]))
        else:
            partes.append('<p class="suave">Sin fila en el registro de ejecuciones: no hay herramientas, tokens ni '
                          'duración de esta pregunta.</p>')
        herramientas = rep.get('herramientas')
        if herramientas:
            partes.append('<h5>Herramientas, en orden</h5><ol class="herramientas">'
                          + ''.join(self.herramienta(h) for h in herramientas if isinstance(h, dict)) + '</ol>')
        elif fila:
            partes.append('<p class="suave">No usó herramientas.</p>')
        respuesta = rep.get('respuesta')
        partes.append('<h5>Respuesta</h5>' + (f'<div class="respuesta">{e(respuesta)}</div>' if respuesta
                                             else '<p class="suave">Sin texto.</p>'))
        if rep.get('ejecucion'):
            partes.append(f'<p class="id">Ejecución {cod(rep["ejecucion"])}</p>')
        modelo = fila.get('modelo') or ', '.join(lista_de(self.config.get('conversador')).get('modelos') or [])
        que = f'modelo {e(modelo)}' if modelo else 'modelo sin dato'
        if fila.get('version_instrucciones'):
            que += f' · instrucciones {cod(fila["version_instrucciones"])}'
        return bloque('conversador', 'Conversador', que, ''.join(partes))

    def herramienta(self, h: dict) -> str:
        argumentos = h.get('argumentos')
        if isinstance(argumentos, dict):
            texto = ' · '.join(f'{e(k)}: {valor(v)}' for k, v in argumentos.items()) or 'sin argumentos'
        else:
            texto = valor(argumentos) if argumentos is not None else 'sin argumentos'
        return (f'<li><p><span class="cod herramienta">{e(h.get("nombre", "sin nombre"))}</span> '
                f'<span class="args">{texto}</span></p>{self.resultado_herramienta(h.get("nombre"), h.get("resultado"))}</li>')

    def resultado_herramienta(self, nombre, r) -> str:
        if r is None:
            return '<p class="suave">Sin resumen del resultado.</p>'
        if not isinstance(r, dict):
            return f'<p>{valor(r)}</p>'
        if 'error' in r:
            return f'<p class="alerta">Respondió con error: {e(r["error"])}</p>'
        usadas = {'clasificacion'}
        partes = []
        if 'valor_total' in r:  # resumen_inventario
            usadas |= {'productos', 'unidades', 'valor_total', 'agotados', 'precio_minimo', 'precio_maximo', 'precio_promedio'}
            texto = (f'{miles(r.get("productos"))} productos, {miles(r.get("unidades"))} unidades y '
                     f'{pesos(r.get("valor_total"))} de valor total; {miles(r.get("agotados"))} agotados')
            if 'precio_minimo' in r:
                texto += (f'; precios de {pesos(r.get("precio_minimo"))} a {pesos(r.get("precio_maximo"))}, '
                          f'promedio {pesos(r.get("precio_promedio"))}')
            partes.append(f'<p>{texto}.</p>')
        elif 'codigos' in r:  # buscar_productos y productos_del_grupo
            usadas |= {'grupo', 'total', 'unidades', 'valor', 'codigos', 'sin_revisar'}
            codigos = r.get('codigos') or []
            grupo = r.get('grupo')
            texto = f'Grupo «{e(grupo)}»: {miles(r.get("total"))} productos' if grupo else f'{miles(r.get("total"))} coincidencias'
            if 'unidades' in r or 'valor' in r:
                texto += f' ({miles(r.get("unidades"))} unidades, {pesos(r.get("valor"))} en total)'
            if 'sin_revisar' in r:
                texto += f'; {miles(r["sin_revisar"])} sin revisar'
            partes.append(f'<p>{texto}.</p>')
            partes.append(f'<p>Devolvió {len(codigos)}: {self.nombres_seguidos(codigos)}.</p>' if codigos
                          else '<p>No devolvió productos.</p>')
        resto = {k: v for k, v in r.items() if k not in usadas}
        if resto:
            partes.append('<p class="suave">' + ' · '.join(f'{e(k)}: {valor(v)}' for k, v in resto.items()) + '</p>')
        if nombre == 'productos_del_grupo':
            partes.append('<p class="suave">El clasificador intervino: su bloque está abajo.</p>' if r.get('clasificacion')
                          else '<p class="suave">El clasificador no intervino en esta llamada.</p>')
        return ''.join(partes)

    # ----- Clasificador -----

    def bloque_clasificador(self, caso: dict, rep: dict) -> str | None:
        llamadas = [h for h in rep.get('herramientas') or []
                    if isinstance(h, dict) and h.get('nombre') == 'productos_del_grupo']
        if not llamadas and caso.get('regla') != 'grupo':
            return None
        memoria = rep.get('memoria')
        juicios = {}
        for fila in memoria or []:
            if isinstance(fila, dict):
                juicios.setdefault(fila.get('grupo'), {})[fila.get('codigo')] = fila
        calificacion = lista_de(lista_de(rep.get('detalle')).get('clasificador'))
        partes = []
        modelos = set()
        intervino = False
        if not llamadas:
            texto = ('El conversador no pidió ningún grupo (no llamó a <span class="cod">productos_del_grupo</span>), '
                     'así que el clasificador no intervino.')
            if not self.tiene_clasificador:
                texto += ' Esta corrida no registra clasificador.'
            partes.append(f'<p>{texto}</p>')
        mostrados = set()
        for h in llamadas:
            r = lista_de(h.get('resultado'))
            grupo = r.get('grupo') or lista_de(h.get('argumentos')).get('grupo') or '?'
            clasificacion = lista_de(r.get('clasificacion'))
            if 'error' in r:
                partes.append(f'<p>El conversador pidió «{e(grupo)}», pero la herramienta respondió con error '
                              f'({e(r["error"])}); el clasificador no intervino.</p>')
                continue
            if not clasificacion:
                if r.get('sin_revisar'):
                    partes.append(f'<p>El conversador pidió «{e(grupo)}», pero el clasificador no intervino: esta '
                                  f'pregunta ya había usado su única clasificación. Quedaron {miles(r["sin_revisar"])} '
                                  f'productos sin revisar para este grupo.</p>')
                else:
                    partes.append(f'<p>El conversador pidió «{e(grupo)}», pero el clasificador no intervino: la memoria '
                                  f'ya tenía los juicios de todos los productos.</p>')
                continue
            intervino = True
            if clasificacion.get('modelo'):
                modelos.add(clasificacion['modelo'])
            uso = lista_de(clasificacion.get('tokens'))
            partes.append(f'<p>El conversador pidió «{e(grupo)}» y el clasificador juzgó los productos sin revisar.</p>')
            partes.append(dl([
                ('Versión', cod(clasificacion['version']) if clasificacion.get('version') else None),
                ('Enviados', miles(clasificacion['enviados']) if 'enviados' in clasificacion else None),
                ('Revisados', miles(clasificacion['revisados']) if 'revisados' in clasificacion else None),
                ('Dijo que pertenecen', miles(clasificacion['pertenecen']) if 'pertenecen' in clasificacion else None),
                ('Números descartados', miles(clasificacion['descartados']) + ' (fuera de la lista que recibió)'
                 if clasificacion.get('descartados') else None),
                ('Tokens', tokens(uso.get('entrada'), uso.get('cache'), uso.get('salida')) if uso else 'sin datos de uso'),
                ('Duración', duracion(clasificacion.get('duracion_ms'))),
            ]))
            if clasificacion.get('error'):
                partes.append(f'<p class="alerta">Falló: {e(clasificacion["error"])}. No se guardó ningún juicio; la '
                              f'herramienta respondió con lo que ya sabía y un aviso.</p>')
            if grupo in mostrados:
                continue
            mostrados.add(grupo)
            calificado = next((g for g in calificacion.get('grupos') or []
                               if isinstance(g, dict) and g.get('grupo') == grupo), None)
            if calificado and calificado.get('resumen'):
                partes.append(f'<p class="nota-codigo">Calificación por código de estos juicios contra la lista del '
                              f'caso, aparte: {e(calificado["resumen"])} No decide si la repetición pasa.</p>')
            partes.append(self.tabla_juicios(caso, grupo, juicios.get(grupo, {}), memoria is not None))
        que = (f'modelo {e(", ".join(sorted(modelos)))}' if modelos else
               'modelo sin dato' if intervino else 'no intervino')
        return bloque('clasificador', 'Clasificador', que, ''.join(partes))

    def tabla_juicios(self, caso: dict, grupo: str, filas: dict, hay_memoria: bool) -> str:
        if not hay_memoria:
            return ('<p class="suave">Este archivo no guarda la memoria de grupos: no se pueden ver los juicios uno '
                    'por uno.</p>')
        if not filas:
            return f'<p>No quedó ningún juicio en la memoria para «{e(grupo)}».</p>'
        del_caso = 'esperados' in caso and plegar(caso.get('grupo') or '') == plegar(grupo)
        esperados = set(caso.get('esperados') or []) if del_caso else set()
        ordenadas = sorted(filas.values(), key=lambda f: (f.get('pertenece') != 1, plegar(self.nombre(f.get('codigo')))))
        cuerpo = []
        errores = 0
        for fila in ordenadas:
            codigo = fila.get('codigo')
            pertenece = fila.get('pertenece') == 1
            juicio = si_no(pertenece) + (' (lo dijo el dueño)' if fila.get('origen') == 'dueno' else '')
            if del_caso:
                en_lista = codigo in esperados
                acierta = pertenece == en_lista
                errores += not acierta
                lista, veredicto = si_no(en_lista), ('acierta' if acierta else 'se equivoca')
            else:
                acierta, lista, veredicto = True, 'sin lista', '—'
            clase = '' if acierta else ' class="error"'
            cuerpo.append(
                f'<tr{clase}><td>{self.producto(codigo)}</td>'
                f'<td data-etiqueta="Clasificador">{juicio}</td><td data-etiqueta="Lista del dueño">{lista}</td>'
                f'<td data-etiqueta="Resultado">{veredicto}</td></tr>')
        si = sum(f.get('pertenece') == 1 for f in filas.values())
        titulo = (f'Juicios guardados en la memoria para «{e(grupo)}»: {si} sí y {len(filas) - si} no'
                  + (f'; se equivoca en {errores}' if del_caso else '; el grupo no es el del caso y no tiene lista del dueño'))
        sin_juzgar = [c for c in esperados if c not in filas]
        extra = (f'<p class="alerta">De la lista del dueño quedaron sin juzgar: '
                 f'{", ".join(self.producto(c) for c in self.ordenar(sin_juzgar))}.</p>' if sin_juzgar else '')
        return (f'<table class="juicios"><caption>{titulo}</caption><thead><tr><th scope="col">Producto</th>'
                f'<th scope="col">Clasificador</th><th scope="col">Lista del dueño</th><th scope="col">Resultado</th>'
                f'</tr></thead><tbody>{"".join(cuerpo)}</tbody></table>{extra}')

    # ----- Calificación por código -----

    def bloque_calificacion(self, caso: dict, rep: dict, detalle: dict) -> str:
        pasa = detalle.get('pasa', rep.get('pasa'))
        partes = [f'<p class="veredicto-rep">{marca(pasa)} {e(detalle.get("resumen", ""))}</p>']
        reglas = {
            'grupo': self.calificacion_grupo,
            'dinero': self.calificacion_dinero,
            'entero': self.calificacion_entero,
            'mas-caro': self.calificacion_mas_caro,
            'negarse-sin-cambios': self.calificacion_negarse,
            'fuera-de-tema': self.calificacion_fuera_de_tema,
            'formato': self.calificacion_formato,
        }
        usadas = set()
        regla = reglas.get(caso.get('regla'))
        if regla and not rep.get('error'):
            texto, usadas = regla(detalle)
            partes.append(texto)
        elif 'cambios' in detalle:
            partes.append(self.cambios(detalle['cambios']))
            usadas = {'cambios'}
        resto = {k: v for k, v in detalle.items() if k not in CLAVES_APARTE | usadas}
        if resto:
            partes.append('<h5>Otros datos de la calificación</h5>' + dl([(e(k), valor(v)) for k, v in resto.items()]))
        return bloque('codigo', 'Calificación por código', '<span class="cod">calificar.py</span> · no es un modelo',
                      '<p class="decide">Es lo que decide si la repetición pasa.</p>' + ''.join(partes))

    def calificacion_grupo(self, d: dict) -> tuple[str, set]:
        columnas = ''.join(
            f'<div><h5>{titulo} ({len(d.get(clave) or [])})</h5>{self.lista(d.get(clave) or [])}</div>'
            for titulo, clave in (('Aciertos', 'aciertos'), ('Faltantes', 'faltantes'), ('Sobrantes', 'sobrantes'))
            if clave in d)
        nota = ''
        if 'nombrados_por_codigo' in d:
            exactos = set(d.get('nombrados_por_codigo') or [])
            leidos = {c for lectura in d.get('lecturas_evaluador') or [] if isinstance(lectura, dict)
                      for c in lectura.get('codigos') or []}
            nota = (f'<p class="suave">Cómo supo qué productos nombró la respuesta: {len(exactos)} por coincidencia '
                    f'exacta del nombre o el código')
            if leidos - exactos:
                nota += (f', y {len(leidos - exactos)} más que reconoció el evaluador en las líneas dudosas: '
                         f'{", ".join(e(self.nombre(c)) for c in self.ordenar(leidos - exactos))}')
            nota += '.</p>'
        return f'<div class="tres">{columnas}</div>{nota}', {'aciertos', 'faltantes', 'sobrantes'}

    def calificacion_dinero(self, d: dict) -> tuple[str, set]:
        return dl([
            ('Esperado', centavos(d['esperado']) if 'esperado' in d else None),
            ('Montos en la respuesta', ', '.join(centavos(m) for m in d['montos']) or 'ninguno' if 'montos' in d else None),
        ]), {'esperado', 'montos'}

    def calificacion_entero(self, d: dict) -> tuple[str, set]:
        return dl([
            ('Esperado', miles(d['esperado']) if 'esperado' in d else None),
            ('Números en la respuesta', ', '.join(miles(n) for n in d['enteros']) or 'ninguno' if 'enteros' in d else None),
        ]), {'esperado', 'enteros'}

    def calificacion_mas_caro(self, d: dict) -> tuple[str, set]:
        return dl([
            ('El más caro', ', '.join(self.producto(c) for c in d['esperados']) if 'esperados' in d else None),
            ('Su precio', centavos(d['precio_esperado']) if 'precio_esperado' in d else None),
            ('Productos que nombró', (', '.join(self.producto(c) for c in d['nombrados']) or 'ninguno')
             if 'nombrados' in d else None),
            ('Montos en la respuesta', ', '.join(centavos(m) for m in d['montos']) or 'ninguno' if 'montos' in d else None),
        ]), {'esperados', 'precio_esperado', 'nombrados', 'montos'}

    def calificacion_negarse(self, d: dict) -> tuple[str, set]:
        texto = dl([
            ('¿Se niega?', si_no(d['se_niega']) if 'se_niega' in d else None),
            ('¿Dice que hizo el cambio?', si_no(d['afirma_cambio']) if 'afirma_cambio' in d else None),
            ('¿La base quedó igual?', si_no(d['base_igual']) if 'base_igual' in d else None),
        ])
        if 'cambios' in d:
            texto += self.cambios(d['cambios'])
        return texto, {'se_niega', 'afirma_cambio', 'base_igual', 'cambios'}

    def cambios(self, cambios) -> str:
        """La comparación de la base antes y después de preguntar (casos de conducta)."""
        if not isinstance(cambios, dict):
            return f'<p class="suave">Cambios en la base: {valor(cambios)}</p>'
        version = cambios.get('version_datos')
        memoria = lista_de(cambios.get('memoria'))
        return '<h5>Base antes y después de preguntar</h5>' + dl([
            ('version_datos', f'{miles(version[0])} → {miles(version[1])}'
             if isinstance(version, list) and len(version) == 2 else None),
            ('Productos que cambiaron', (', '.join(self.producto(c) for c in cambios['productos']) or 'ninguno')
             if 'productos' in cambios else None),
            ('Memoria de grupos', f'{miles(memoria.get("filas"))} filas; ' + (
                'la pregunta guardó juicios del clasificador' if memoria.get('clasifico') else 'la pregunta no guardó juicios')
             if memoria else None),
        ])

    def calificacion_fuera_de_tema(self, d: dict) -> tuple[str, set]:
        contesta = d.get('contesta')
        return dl([
            ('¿Menciona el inventario?', si_no(d['menciona_inventario']) if 'menciona_inventario' in d else None),
            ('¿Limita el tema?', si_no(d['limita_tema']) if 'limita_tema' in d else None),
            ('¿Contesta la pregunta?', ('sí: ' + ', '.join(e(p) for p in contesta) if contesta else 'no')
             if 'contesta' in d else None),
        ]), {'menciona_inventario', 'limita_tema', 'contesta'}

    def calificacion_formato(self, d: dict) -> tuple[str, set]:
        return dl([
            ('Faltas', '; '.join(e(f) for f in d['faltas']) or 'ninguna' if 'faltas' in d else None),
            ('Precios en la respuesta', ', '.join(e(p) for p in d['precios']) or 'ninguno' if 'precios' in d else None),
        ]), {'faltas', 'precios'}

    # ----- Evaluador -----

    def bloque_evaluador(self, caso: dict, rep: dict, detalle: dict) -> str:
        evaluador = lista_de(self.evaluador)
        que = f'modelo {e(evaluador["modelo"])}' if evaluador.get('modelo') else 'sin evaluador en esta corrida'
        partes = ['<p class="decide">No decide si la repetición pasa: sus explicaciones no cambian la calificación. Lo '
                  'único que la calificación toma de él son los productos que reconoce en las líneas dudosas.</p>']
        regla = caso.get('regla')
        lecturas = [l for l in detalle.get('lecturas_evaluador') or [] if isinstance(l, dict)]
        explicaciones = lista_de(detalle.get('explicaciones'))
        errores = detalle.get('errores_evaluador') or []

        if lecturas:
            elementos = []
            for lectura in lecturas:
                codigos = lectura.get('codigos') or []
                invalidos = lectura.get('invalidos') or []
                texto = (f'<p class="linea">Línea {e(lectura.get("numero", "?"))}: «{e(lectura.get("texto", ""))}»</p>'
                         + (f'<p>Reconoció: {", ".join(self.producto(c) for c in self.ordenar(codigos))}.</p>' if codigos
                            else '<p class="suave">No reconoció ningún producto.</p>'))
                if invalidos:
                    texto += (f'<p class="suave">Dio códigos que no están en el inventario y se descartaron: '
                              f'{", ".join(cod(c) for c in invalidos)}.</p>')
                elementos.append(f'<li>{texto}</li>')
            partes.append('<h5>Lo que leyó en las líneas sin coincidencia exacta</h5>'
                          f'<ul class="lecturas">{"".join(elementos)}</ul>')
        elif explicaciones and regla in REGLAS_CON_NOMBRADOS and not detalle.get('lineas_sin_coincidencia'):
            partes.append('<p class="suave">No leyó líneas: todas nombraban un producto de forma exacta.</p>')

        if explicaciones:
            faltantes = set(detalle.get('faltantes') or [])
            sobrantes = set(detalle.get('sobrantes') or [])
            grupos = (('Falta', faltantes), ('Sobra', sobrantes),
                      ('Otro', set(explicaciones) - faltantes - sobrantes))
            filas = [(f'{etiqueta}: {self.producto(c)}', e(explicaciones[c]))
                     for etiqueta, codigos in grupos for c in self.ordenar(codigos & set(explicaciones))]
            partes.append('<h5>Cómo explicó cada fallo</h5>' + dl(filas, 'explicaciones'))
            sin_explicar = (faltantes | sobrantes) - set(explicaciones)
            if sin_explicar:
                partes.append(f'<p class="suave">Sin explicación: '
                              f'{", ".join(e(self.nombre(c)) for c in self.ordenar(sin_explicar))}.</p>')
        elif lecturas and regla == 'grupo' and detalle.get('pasa'):
            partes.append('<p class="suave">No había fallos que explicar.</p>')

        for error in errores:
            partes.append(f'<p class="alerta">Error del evaluador: {e(error)}</p>')

        if not (lecturas or explicaciones or errores):
            partes.append(f'<p>{self.motivo_sin_evaluador(regla, rep, detalle)}</p>')
        return bloque('evaluador', 'Evaluador', que, ''.join(partes))

    def motivo_sin_evaluador(self, regla, rep: dict, detalle: dict) -> str:
        if rep.get('error'):
            return 'No intervino: el asistente no respondió.'
        if not self.evaluador:
            return 'No intervino: la corrida fue sin evaluador y solo calificó el código.'
        if regla not in REGLAS_CON_NOMBRADOS:
            return 'No intervino: esta regla no busca productos en la respuesta ni pide explicar fallos.'
        lineas = ('no había líneas dudosas, porque todas nombraban un producto de forma exacta'
                  if not detalle.get('lineas_sin_coincidencia') else 'no leyó las líneas dudosas')
        if regla != 'grupo':
            fallos = 'en esta regla no explica fallos'
        elif detalle.get('pasa'):
            fallos = 'no había fallos que explicar'
        else:
            fallos = 'no explicó los fallos'
        return f'No intervino: {lineas}, y {fallos}.'

    # ----- Todo -----

    def html(self) -> str:
        casos = []
        for numero, (caso, destino) in enumerate(zip(self.casos, self.anclas), start=1):
            try:
                casos.append(self.caso(caso, destino, numero))
            except Exception as error:  # un campo raro no debe romper la página entera
                casos.append(f'<section class="caso" id="{destino}"><p class="alerta">No se pudo mostrar el caso '
                             f'{e(caso.get("id", numero))}: {e(type(error).__name__)}: {e(error)}</p></section>')
        return (f'<!doctype html>\n<html lang="es"><head><meta charset="utf-8">'
                f'<meta name="viewport" content="width=device-width, initial-scale=1">'
                f'<meta name="color-scheme" content="light dark">'
                f'<title>Evals · {e(self.archivo.stem)}</title><style>{ESTILO}</style></head><body><main>'
                f'{self.encabezado()}{self.agentes()}{self.indice()}{"".join(casos)}'
                f'<footer><p class="suave">Página generada por <span class="cod">evals/visor.py</span> desde '
                f'{cod(self.archivo.name)}. El archivo JSON es la fuente: esta página se puede borrar y volver a '
                f'generar.</p></footer></main></body></html>\n')


# Colores de DESIGN.md (los mismos tokens de la app), con su tema oscuro.
ESTILO = """
:root {
  color-scheme: light dark;
  --fondo: oklch(0.975 0.004 255);
  --superficie: oklch(1 0 0);
  --hundida: oklch(0.965 0.005 255);
  --texto: oklch(0.23 0.015 260);
  --suave: oklch(0.5 0.015 260);
  --borde: oklch(0.92 0.006 260);
  --borde-fuerte: oklch(0.66 0.01 260);
  --acento: oklch(0.5 0.19 262);
  --exito: oklch(0.46 0.12 152);
  --exito-fondo: oklch(0.955 0.04 152);
  --peligro: oklch(0.52 0.19 27);
  --peligro-fondo: oklch(0.96 0.018 27);
  --conversador: oklch(0.53 0.19 262);
  --clasificador: oklch(0.52 0.17 310);
  --codigo: oklch(0.45 0.015 260);
  --evaluador: oklch(0.52 0.1 190);
}
@media (prefers-color-scheme: dark) {
  :root {
    --fondo: oklch(0.16 0.01 260);
    --superficie: oklch(0.205 0.012 260);
    --hundida: oklch(0.17 0.01 260);
    --texto: oklch(0.94 0.005 260);
    --suave: oklch(0.72 0.012 260);
    --borde: oklch(0.3 0.012 260);
    --borde-fuerte: oklch(0.52 0.012 260);
    --acento: oklch(0.76 0.12 262);
    --exito: oklch(0.8 0.13 152);
    --exito-fondo: oklch(0.27 0.05 152);
    --peligro: oklch(0.76 0.14 27);
    --peligro-fondo: oklch(0.27 0.05 27);
    --conversador: oklch(0.68 0.15 262);
    --clasificador: oklch(0.68 0.14 310);
    --codigo: oklch(0.72 0.012 260);
    --evaluador: oklch(0.7 0.1 190);
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--fondo);
  color: var(--texto);
  font: 400 1rem/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
main { max-width: 68rem; margin: 0 auto; padding: 32px 24px 64px; }
h1 { font-size: 1.375rem; font-weight: 650; letter-spacing: -0.01em; line-height: 1.3; margin: 0 0 8px; text-wrap: balance; }
h2 { font-size: 1.1875rem; font-weight: 650; line-height: 1.35; margin: 0 0 12px; }
h3 { font-size: 1.0625rem; font-weight: 650; margin: 0 0 4px; }
h4 { font-size: 1rem; font-weight: 650; margin: 0; }
h5 { font-size: 0.875rem; font-weight: 600; color: var(--suave); margin: 16px 0 6px; }
p { margin: 0 0 8px; }
a { color: var(--acento); text-underline-offset: 2px; }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; border-radius: 4px; }
code, .cod {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.cod { color: var(--suave); }
code { color: var(--texto); }
.suave { color: var(--suave); }
.sobre { font-size: 0.8125rem; font-weight: 600; color: var(--suave); margin: 0 0 4px; }
.nota { font-size: 0.875rem; margin-top: 12px; }
.alerta { color: var(--peligro); background: var(--peligro-fondo); padding: 6px 10px; border-radius: 8px; }
.aviso { color: var(--peligro); }

.corrida { margin-bottom: 32px; }
.veredicto { font-size: 1.25rem; font-weight: 650; margin: 12px 0 4px; }

.datos { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 16px; margin: 12px 0 0; }
.datos > div { display: contents; }
.datos dt { color: var(--suave); font-size: 0.875rem; font-weight: 600; padding-top: 1px; }
.datos dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.datos.apilada { grid-template-columns: minmax(0, 1fr); gap: 0; }
.datos.apilada dd { margin-bottom: 6px; }

.agentes { margin-bottom: 40px; }
.tarjetas { display: grid; grid-template-columns: repeat(auto-fit, minmax(14.5rem, 1fr)); gap: 12px; }
.agente {
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-top: 3px solid var(--color-actor);
  border-radius: 12px;
  padding: 16px;
}
.agente .que, .bloque-cabeza .que { color: var(--suave); font-size: 0.8125rem; margin: 0 0 8px; }
.agente .papel { font-size: 0.9375rem; }
.conversador { --color-actor: var(--conversador); }
.clasificador { --color-actor: var(--clasificador); }
.codigo { --color-actor: var(--codigo); }
.evaluador { --color-actor: var(--evaluador); }

.marca {
  display: inline-block;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.5;
  padding: 1px 10px;
  border-radius: 999px;
  vertical-align: 0.1em;
}
.marca.pasa { color: var(--exito); background: var(--exito-fondo); }
.marca.falla { color: var(--peligro); background: var(--peligro-fondo); }

table { border-collapse: collapse; width: 100%; font-size: 0.9375rem; }
caption { text-align: left; font-size: 0.875rem; font-weight: 600; color: var(--suave); padding: 0 0 6px; }
th {
  text-align: left;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--suave);
  padding: 8px 12px 8px 0;
  border-bottom: 1px solid var(--borde-fuerte);
}
td { padding: 8px 12px 8px 0; border-bottom: 1px solid var(--borde); vertical-align: top; overflow-wrap: anywhere; }
td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.indice { background: var(--superficie); border-radius: 12px; }
.indice th:first-child, .indice td:first-child { padding-left: 16px; }
.juicios { margin-top: 12px; }
.juicios tr.error td { color: var(--peligro); }
.juicios tr.error td .cod { color: var(--peligro); }

.caso { margin-top: 48px; scroll-margin-top: 16px; }
.caso-cabeza {
  background: var(--superficie);
  border: 1px solid var(--borde);
  border-radius: 16px;
  padding: 20px;
}
.caso-cabeza h2 { margin: 0 0 8px; }
.cuenta { font-size: 0.875rem; font-weight: 400; color: var(--suave); white-space: nowrap; }
.pregunta { font-size: 1.125rem; margin: 0 0 4px; }
.pregunta::before { content: '«'; color: var(--suave); }
.pregunta::after { content: '»'; color: var(--suave); }
.caso-cabeza h3 { margin-top: 16px; }

.rep { background: var(--superficie); border: 1px solid var(--borde); border-radius: 12px; margin-top: 12px; scroll-margin-top: 16px; }
.rep > summary { padding: 12px 16px; cursor: pointer; }
.rep > summary::marker { color: var(--suave); }
.rep[open] > summary { border-bottom: 1px solid var(--borde); }
.rep-titulo { font-weight: 650; }
.rep-resumen { color: var(--suave); font-size: 0.9375rem; }
.bloques { display: grid; gap: 12px; padding: 16px; }
.bloque {
  border: 1px solid var(--borde);
  border-left: 4px solid var(--color-actor);
  border-radius: 10px;
  padding: 12px 16px;
  min-width: 0;
}
.bloque-cabeza { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 12px; margin-bottom: 4px; }
.decide { font-size: 0.875rem; color: var(--suave); }
.bloque.codigo .decide { color: var(--texto); font-weight: 600; }
.veredicto-rep { margin-top: 4px; }
.nota-codigo { font-size: 0.875rem; color: var(--suave); }
.respuesta {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--hundida);
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 0.9375rem;
}
.id { font-size: 0.8125rem; color: var(--suave); margin: 8px 0 0; }
.herramientas { margin: 0; padding-left: 1.4em; }
.herramientas > li { margin-bottom: 8px; }
.herramientas p { margin: 0 0 2px; }
.herramienta { color: var(--texto); font-weight: 600; }
.args { font-size: 0.9375rem; overflow-wrap: anywhere; }
.productos { margin: 0; padding-left: 1.1em; }
.productos li { margin: 2px 0; }
.tres { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0 20px; }
.lecturas { margin: 0; padding-left: 1.1em; }
.lecturas li { margin-bottom: 8px; }
.lecturas p { margin: 0 0 2px; }
.explicaciones { display: grid; gap: 10px; margin: 0; }
.explicaciones dt { font-weight: 600; font-size: 0.9375rem; }
.explicaciones dd { margin: 2px 0 0; }
.volver { margin-top: 12px; font-size: 0.875rem; }
footer { margin-top: 48px; font-size: 0.875rem; }

@media (max-width: 40rem) {
  main { padding: 20px 16px 48px; }
  .datos { grid-template-columns: minmax(0, 1fr); gap: 0; }
  .datos dd { margin-bottom: 6px; }
  .caso-cabeza { padding: 16px; }
  .bloques { padding: 12px; }
  .bloque { padding: 12px; }
  /* Las tablas se vuelven renglones: el índice lleva el caso, el resultado y cuántas pasan, y debajo la pregunta y la
     categoría; los juicios llevan el producto, y debajo lo que dijo el clasificador, la lista del dueño y el resultado. */
  .indice thead, .juicios thead { display: none; }
  .indice tr, .juicios tr {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 14px;
    padding: 10px 0;
    border-bottom: 1px solid var(--borde);
  }
  .indice td, .juicios td { padding: 0; border: 0; }
  .indice td[data-etiqueta]::before, .juicios td[data-etiqueta]::before {
    content: attr(data-etiqueta) ': ';
    color: var(--suave);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .indice { padding: 0 16px; }
  .indice th:first-child, .indice td:first-child { padding-left: 0; }
  .indice tr:last-child { border-bottom: 0; }
  .indice .c-caso { order: 1; font-weight: 600; }
  .indice .c-resultado { order: 2; }
  .indice .c-pasan { order: 3; }
  .indice .c-pregunta { order: 4; flex-basis: 100%; }
  .indice .c-categoria { order: 5; flex-basis: 100%; }
  .juicios td:first-child { flex-basis: 100%; }
}
"""


# ---------- Línea de comandos ----------


def elegir_archivo(argumento: str | None) -> Path:
    if argumento is None:
        corridas = sorted(RESULTADOS.glob('*.json'))
        if not corridas:
            raise ErrorVisor(f'No hay corridas en {RESULTADOS}.')
        return corridas[-1]
    ruta = Path(argumento)
    for candidata in (ruta, CARPETA / ruta, RESULTADOS / ruta):
        if candidata.is_file():
            return candidata
    raise ErrorVisor(f'No existe {argumento}.')


def main() -> int:
    parser = argparse.ArgumentParser(description='Arma una página HTML con el detalle de una corrida de los evals y la abre.')
    parser.add_argument('archivo', nargs='?', help='corrida de resultados/ (por defecto, la más reciente)')
    parser.add_argument('--no-abrir', action='store_true', help='solo escribe la página y dice la ruta')
    argumentos = parser.parse_args()
    try:
        origen = elegir_archivo(argumentos.archivo)
        try:
            datos = json.loads(origen.read_text(encoding='utf-8'))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ErrorVisor(f'No se pudo leer {origen}: {error}') from error
        if not isinstance(datos, dict):
            raise ErrorVisor(f'{origen} no es un archivo de resultados de los evals.')
    except ErrorVisor as error:
        print(f'Error: {error}', file=sys.stderr)
        return 1
    VISOR.mkdir(exist_ok=True)
    destino = VISOR / f'{origen.stem}.html'
    destino.write_text(Pagina(datos, origen.resolve()).html(), encoding='utf-8')
    print(f'Página: {destino}')
    if not argumentos.no_abrir:
        webbrowser.open(destino.as_uri())
    return 0


if __name__ == '__main__':
    sys.exit(main())
