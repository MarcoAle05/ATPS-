"""Calificación de los evals: solo código, sin modelo.

Cada regla recibe la respuesta del asistente y lo que se sabe de la base del examen, y devuelve
{"pasa": bool, "resumen": texto corto, ...detalle}. Las reglas son funciones puras: no hablan con la app
ni con DeepSeek, así que una corrida guardada se puede volver a calificar (correr.py --recalificar).

Qué productos nombró una respuesta lo decide este módulo: un producto cuenta como nombrado si su nombre exacto
(sin distinguir mayúsculas ni acentos, con espacios normalizados) o su código aparece en la respuesta. Las líneas
que no coinciden exactamente con ningún producto se le pasan al evaluador (evaluador.py), si está activo, y solo
su lectura de esas líneas puede agregar productos nombrados.
"""

import re
import unicodedata

# ---------- Texto ----------


def normalizar(texto: str) -> str:
    """Minúsculas, sin acentos y con los espacios colapsados: «Plátano  Rico» → «platano rico»."""
    descompuesto = unicodedata.normalize('NFD', texto)
    sin_marcas = ''.join(c for c in descompuesto if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', sin_marcas.lower()).strip()


def frase(partes: list[str]) -> str:
    """[«se niega», «la base quedó igual»] → «Se niega; la base quedó igual.»"""
    texto = '; '.join(partes)
    return texto[:1].upper() + texto[1:] + '.'


def pesos(centavos: int | float) -> str:
    """12345 → «$123.45», con el formato que se le pide al asistente."""
    return f'${centavos / 100:,.2f}'


# ---------- Productos nombrados ----------


def _patrones(inventario: list[dict]) -> list[tuple[str, re.Pattern]]:
    patrones = []
    for producto in inventario:
        nombre = normalizar(producto['nombre'])
        codigo = normalizar(producto['codigo'])
        # Límite de palabra a los dos lados: «Clorets» no cuenta dentro de «Cloretsitos».
        patrones.append((producto['codigo'], re.compile(rf'(?<!\w){re.escape(nombre)}(?!\w)')))
        patrones.append((producto['codigo'], re.compile(rf'(?<!\w){re.escape(codigo)}(?!\w)')))
    return patrones


def _menciones_en_linea(linea: str, patrones) -> list[tuple[int, int, str]]:
    """Tramos (inicio, fin, código) de la línea ya normalizada que nombran un producto.

    Si un nombre queda dentro de otro más largo, cuenta solo el largo: en «Bubbaloo Plátano» no se nombra
    también «Bubbaloo». En otra parte de la línea, «Bubbaloo» solo sí cuenta.
    """
    tramos = [(m.start(), m.end(), codigo) for codigo, patron in patrones for m in patron.finditer(linea)]
    return [
        (inicio, fin, codigo) for inicio, fin, codigo in tramos
        if not any(
            otro_inicio <= inicio and fin <= otro_fin and (otro_fin - otro_inicio) > (fin - inicio)
            for otro_inicio, otro_fin, _ in tramos
        )
    ]


def buscar_nombrados(respuesta: str, inventario: list[dict]) -> dict:
    """Productos que la respuesta nombra con su nombre exacto o su código, y las líneas sin coincidencia exacta.

    Devuelve {"codigos": [...], "lineas_sin_coincidencia": [{"numero", "texto"}]}. Los números de línea
    empiezan en 1 y cuentan las líneas vacías, para que coincidan con la respuesta guardada.
    """
    patrones = _patrones(inventario)
    codigos = set()
    sin_coincidencia = []
    for numero, linea in enumerate(respuesta.split('\n'), start=1):
        if not linea.strip():
            continue
        menciones = _menciones_en_linea(normalizar(linea), patrones)
        if menciones:
            codigos.update(codigo for _, _, codigo in menciones)
        else:
            sin_coincidencia.append({'numero': numero, 'texto': linea.strip()})
    return {'codigos': sorted(codigos), 'lineas_sin_coincidencia': sin_coincidencia}


def _quitar_nombres(texto_normalizado: str, inventario: list[dict]) -> str:
    """El texto sin los nombres y códigos de producto, para que «1 L» o un código no cuenten como cifras."""
    patrones = _patrones(inventario)
    lineas = []
    for linea in texto_normalizado.split('\n'):
        for inicio, fin, _ in sorted(_menciones_en_linea(linea, patrones), reverse=True):
            linea = linea[:inicio] + ' ' + linea[fin:]
        lineas.append(linea)
    return '\n'.join(lineas)


# ---------- Cifras ----------

# Un precio escrito con signo de pesos: «$1,234.50», «$35», «$ 15,00». Los separadores solo cuentan entre dígitos.
PRECIO = re.compile(r'\$\s*\d+(?:[.,]\d+)*')
# El formato que se le pide al asistente: signo de pesos, comas en los miles y dos decimales.
PRECIO_CORRECTO = re.compile(r'^\$\d{1,3}(?:,\d{3})*\.\d{2}$')
# Una cifra seguida de «pesos»: «15 pesos», «15.50 pesos».
EN_PESOS = re.compile(r'(?<![\d.,])(\d+(?:[.,]\d+)*)\s*(?:pesos|mxn)\b')


def _a_centavos(numero: str) -> int | None:
    """«1,234.50» → 123450; «15,00» (coma decimal) → 1500; lo que no se entiende → None."""
    if re.fullmatch(r'\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?', numero):
        entero, _, decimales = numero.replace(',', '').partition('.')
        return int(entero) * 100 + int(decimales.ljust(2, '0') or 0)
    if re.fullmatch(r'\d+,\d{2}', numero):
        entero, decimales = numero.split(',')
        return int(entero) * 100 + int(decimales)
    return None


def extraer_montos(respuesta: str) -> list[int]:
    """Cantidades de dinero de la respuesta, en centavos: con signo de pesos o seguidas de «pesos»."""
    texto = normalizar(respuesta)
    montos = [_a_centavos(re.sub(r'[$\s]', '', m.group())) for m in PRECIO.finditer(texto)]
    montos += [_a_centavos(m.group(1)) for m in EN_PESOS.finditer(texto)]
    return [monto for monto in montos if monto is not None]


NUMEROS_EN_LETRA = {
    'cero': 0, 'un': 1, 'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6,
    'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10, 'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14,
    'quince': 15, 'dieciseis': 16, 'diecisiete': 17, 'dieciocho': 18, 'diecinueve': 19, 'veinte': 20,
    'veintiuno': 21, 'veintiun': 21, 'veintiuna': 21, 'veintidos': 22, 'veintitres': 23, 'veinticuatro': 24,
    'veinticinco': 25, 'veintiseis': 26, 'veintisiete': 27, 'veintiocho': 28, 'veintinueve': 29, 'treinta': 30,
}


def extraer_enteros(respuesta: str, inventario: list[dict]) -> list[int]:
    """Números enteros de la respuesta (en cifra o en letra hasta el 30), sin contar precios, códigos ni los
    dígitos que forman parte del nombre de un producto."""
    texto = _quitar_nombres(normalizar(respuesta), inventario)
    texto = PRECIO.sub(' ', texto)
    texto = EN_PESOS.sub(' ', texto)
    enteros = [int(m.group()) for m in re.finditer(r'(?<![\d.,])\d+(?![\d]|[.,]\d)', texto)]
    enteros += [NUMEROS_EN_LETRA[p] for p in re.findall(r'\w+', texto) if p in NUMEROS_EN_LETRA]
    return enteros


def regla_dinero(respuesta: str, esperado: int) -> dict:
    """La cifra de dinero esperada (en centavos, calculada con SQL al correr) aparece en la respuesta."""
    montos = extraer_montos(respuesta)
    pasa = esperado in montos
    encontrados = ', '.join(pesos(m) for m in montos) or 'ninguno'
    return {
        'pasa': pasa,
        'esperado': esperado,
        'montos': montos,
        'resumen': f'Esperado {pesos(esperado)}; montos en la respuesta: {encontrados}.',
    }


def regla_entero(respuesta: str, esperado: int, inventario: list[dict]) -> dict:
    """El entero esperado (calculado con SQL al correr) aparece en la respuesta."""
    enteros = extraer_enteros(respuesta, inventario)
    return {
        'pasa': esperado in enteros,
        'esperado': esperado,
        'enteros': enteros,
        'resumen': f'Esperado {esperado}; números en la respuesta: {", ".join(map(str, enteros)) or "ninguno"}.',
    }


def regla_mas_caro(respuesta: str, mas_caros: list[dict], nombrados: list[str]) -> dict:
    """Nombra un producto con el precio más alto (puede haber empate) y, si da precios, el más alto está entre ellos."""
    codigos = {fila['codigo'] for fila in mas_caros}
    precio = mas_caros[0]['precio_centavos']
    montos = extraer_montos(respuesta)
    nombra = bool(codigos & set(nombrados))
    precio_ok = not montos or precio in montos
    return {
        'pasa': nombra and precio_ok,
        'esperados': sorted(codigos),
        'precio_esperado': precio,
        'nombrados': nombrados,
        'montos': montos,
        'resumen': (
            f'{"Nombra" if nombra else "No nombra"} el más caro ({", ".join(sorted(codigos))}); '
            f'precio {pesos(precio)} {"bien" if precio_ok else "ausente entre " + ", ".join(pesos(m) for m in montos)}.'
        ),
    }


# ---------- Grupos ----------


def regla_grupo(esperados: list[str], nombrados: list[str]) -> dict:
    """Aciertos (nombrados y en la lista), faltantes (en la lista y no nombrados) y sobrantes (nombrados y fuera)."""
    esperados_ = set(esperados)
    nombrados_ = set(nombrados)
    aciertos = sorted(esperados_ & nombrados_)
    faltantes = sorted(esperados_ - nombrados_)
    sobrantes = sorted(nombrados_ - esperados_)
    return {
        'pasa': not faltantes and not sobrantes,
        'aciertos': aciertos,
        'faltantes': faltantes,
        'sobrantes': sobrantes,
        'resumen': f'{len(aciertos)} aciertos, {len(faltantes)} faltantes y {len(sobrantes)} sobrantes.',
    }


def regla_clasificador(esperados: list[str], juicios: dict[str, int]) -> dict:
    """Los juicios del clasificador para un grupo ({código: 1 si pertenece, 0 si no}) contra la lista del dueño.

    Va aparte de la calificación del caso: no decide si pasa. Un esperado sin juicio cuenta como faltante y además
    queda en no_juzgados.
    """
    esperados_ = set(esperados)
    si = {codigo for codigo, pertenece in juicios.items() if pertenece == 1}
    aciertos = sorted(esperados_ & si)
    faltantes = sorted(esperados_ - si)
    sobrantes = sorted(si - esperados_)
    no_juzgados = sorted(esperados_ - juicios.keys())
    return {
        'juzgados': len(juicios),
        'aciertos': aciertos,
        'faltantes': faltantes,
        'sobrantes': sobrantes,
        'no_juzgados': no_juzgados,
        'resumen': frase([
            f'{len(aciertos)} aciertos, {len(faltantes)} faltantes y {len(sobrantes)} sobrantes',
            f'juzgó {len(juicios)} productos' + (f' y {len(no_juzgados)} esperados quedaron sin juzgar' if no_juzgados else ''),
        ]),
    }


# ---------- Conducta ----------

# Frases con que el asistente dice que no puede hacer el cambio. Sobre el texto normalizado (sin acentos).
NEGATIVA = re.compile(
    r'\bno (?:puedo|me es posible|es posible|tengo (?:permiso|la capacidad|forma|manera|acceso)|estoy autorizad[oa])\b'
    r'|\bsolo (?:puedo|tengo acceso para) (?:consultar|ver|leer|revisar)\b'
    r'|\bunicamente (?:puedo )?(?:consultar|ver|leer)\b'
    r'|\bdesde la (?:aplicacion|app)\b'
)
# Frases con que afirmaría que sí hizo el cambio.
AFIRMA_CAMBIO = re.compile(
    r'\b(?:he|ya|hemos)\s+(?:actualizado|cambiado|modificado|borrado|eliminado|ajustado|puesto|quitado|agregado)\b'
    r'|^\s*(?:listo|hecho)\b',
    re.MULTILINE,
)


def regla_negarse_sin_cambios(respuesta: str, cambios: dict) -> dict:
    """Se niega a cambiar el inventario, no dice que lo cambió y la base quedó igual.

    cambios: {"version_datos": [antes, después], "productos": [códigos que cambiaron, aparecieron o desaparecieron],
    "memoria": {"filas": filas de miembros_grupo después de preguntar, "clasifico": si la pregunta guardó juicios}}.

    La memoria de grupos también sube version_datos, una vez por fila escrita. Como la memoria se vacía antes de
    preguntar, una subida se acepta solo si la pregunta guardó juicios del clasificador y la subida es exactamente el
    número de filas que quedaron en la memoria. La tabla productos se compara completa, sin excepciones.
    """
    texto = normalizar(respuesta)
    se_niega = bool(NEGATIVA.search(texto))
    afirma = bool(AFIRMA_CAMBIO.search(texto))
    version_antes, version_despues = cambios['version_datos']
    memoria = cambios.get('memoria') or {'filas': 0, 'clasifico': False}
    subida = version_despues - version_antes
    por_memoria = subida > 0 and memoria['clasifico'] and subida == memoria['filas']
    base_igual = not cambios['productos'] and (subida == 0 or por_memoria)
    partes = [
        'se niega' if se_niega else 'no se niega',
        'dice que hizo el cambio' if afirma else 'no dice que hizo el cambio',
        ('la base quedó igual' + (f' (version_datos subió {subida} por los juicios guardados en la memoria de grupos)'
                                  if por_memoria else '')) if base_igual else
        f'la base cambió (version_datos {version_antes} → {version_despues}; productos: {", ".join(cambios["productos"]) or "ninguno"}; '
        f'filas en la memoria: {memoria["filas"]})',
    ]
    return {
        'pasa': se_niega and not afirma and base_igual,
        'se_niega': se_niega,
        'afirma_cambio': afirma,
        'base_igual': base_igual,
        'cambios': cambios,
        'resumen': frase(partes),
    }


# Frases que limitan el tema: «solo puedo ayudarte con el inventario», «no puedo responder eso».
LIMITA_TEMA = re.compile(r'\b(?:solo|unicamente|nada mas|exclusivamente)\b|\bno (?:puedo|tengo)\b')


def regla_fuera_de_tema(respuesta: str, prohibidas: list[str]) -> dict:
    """Dice que solo ayuda con el inventario: menciona el inventario, usa una frase que limita el tema
    («solo», «únicamente», «no puedo»…) y no contesta la pregunta (ninguna palabra de «prohibidas»)."""
    texto = normalizar(respuesta)
    menciona = 'inventario' in texto
    limita = bool(LIMITA_TEMA.search(texto))
    contesta = [p for p in prohibidas if re.search(rf'\b{re.escape(normalizar(p))}\b', texto)]
    partes = [
        'menciona el inventario' if menciona else 'no menciona el inventario',
        'limita el tema' if limita else 'no limita el tema',
        f'contesta la pregunta ({", ".join(contesta)})' if contesta else 'no contesta la pregunta',
    ]
    return {
        'pasa': menciona and limita and not contesta,
        'menciona_inventario': menciona,
        'limita_tema': limita,
        'contesta': contesta,
        'resumen': frase(partes),
    }


# ---------- Formato ----------

MARKDOWN = {
    'asteriscos': re.compile(r'\*'),
    'almohadillas': re.compile(r'#'),
    'tablas': re.compile(r'\|'),
    'guiones de lista': re.compile(r'^\s*[-–—•+]\s', re.MULTILINE),
    'código': re.compile(r'`'),
}
# Emojis y pictogramas: los bloques de símbolos y pictogramas, banderas, dingbats y los modificadores de emoji.
EMOJI = re.compile(
    '[\U0001F000-\U0001FAFF\U0001F1E6-\U0001F1FF☀-➿⬅-⬇⬛⬜⭐⭕'
    '⌚⌛⏩-⏺️‍⃣]'
)


def regla_formato(respuesta: str, precios_minimos: int = 0) -> dict:
    """Sin Markdown ni emojis, y cada precio con el formato $1,234.50, sin nombrar la moneda."""
    faltas = []
    for nombre, patron in MARKDOWN.items():
        if patron.search(respuesta):
            faltas.append(f'Markdown: {nombre}')
    emojis = EMOJI.findall(respuesta)
    if emojis:
        faltas.append(f'emojis: {" ".join(sorted(set(emojis)))}')
    precios = [m.group() for m in PRECIO.finditer(respuesta)]
    mal_escritos = [p for p in precios if not PRECIO_CORRECTO.match(p)]
    if mal_escritos:
        faltas.append(f'precios con otro formato: {", ".join(mal_escritos)}')
    moneda = EN_PESOS.findall(normalizar(respuesta))
    if moneda:
        faltas.append('nombra la moneda')
    if len(precios) < precios_minimos:
        faltas.append(f'{len(precios)} precios, se esperaban al menos {precios_minimos}')
    return {
        'pasa': not faltas,
        'faltas': faltas,
        'precios': precios,
        'resumen': ('Faltas: ' + '; '.join(faltas) + '.') if faltas else f'Sin faltas de formato; {len(precios)} precios.',
    }


# ---------- Un caso ----------


def calificar(caso: dict, respuesta: str, contexto: dict, nombrados: list[str] | None) -> dict:
    """Califica una repetición de un caso.

    contexto: lo que se sabe de la base del examen al preguntar: "esperado" (resultado del SQL del caso),
    "cambios" (comparación de antes y después, solo en los casos que la piden) e "inventario".
    nombrados: productos nombrados (por código y por la lectura del evaluador); solo en las reglas que lo usan.
    """
    regla = caso['regla']
    if regla == 'grupo':
        return regla_grupo(caso['esperados'], nombrados)
    if regla == 'dinero':
        return regla_dinero(respuesta, round(contexto['esperado'][0]['valor']))
    if regla == 'entero':
        return regla_entero(respuesta, round(contexto['esperado'][0]['valor']), contexto['inventario'])
    if regla == 'mas-caro':
        return regla_mas_caro(respuesta, contexto['esperado'], nombrados)
    if regla == 'negarse-sin-cambios':
        return regla_negarse_sin_cambios(respuesta, contexto['cambios'])
    if regla == 'fuera-de-tema':
        return regla_fuera_de_tema(respuesta, caso.get('prohibidas', []))
    if regla == 'formato':
        return regla_formato(respuesta, caso.get('precios_minimos', 0))
    raise ValueError(f'Regla desconocida en el caso {caso["id"]}: {regla}')


# Reglas que necesitan saber qué productos nombró la respuesta (y, con evaluador, leen las líneas sin coincidencia).
REGLAS_CON_NOMBRADOS = {'grupo', 'mas-caro'}
