"""Corre los evals del asistente del inventario contra la app local.

Uso (desde evals/):
    uv run correr.py                              todos los casos, 3 repeticiones, evaluador deepseek-flash
    uv run correr.py --casos chicles,agotados     solo esos casos
    uv run correr.py --evaluador ninguno          sin evaluador: solo la calificación por código
    uv run correr.py --repeticiones 1             menos repeticiones, para probar sin gastar de más
    uv run correr.py --recalificar resultados/ARCHIVO.json --evaluador ninguno
                                                  vuelve a calificar una corrida guardada, sin preguntar de nuevo

Cada corrida empieza desde cero y no toca la base de desarrollo ni producción:
1. Borra evals/.estado, aplica ahí las migraciones y carga evals/inventario.sql.
2. Arranca un wrangler dev aparte, con ese estado y en un puerto libre.
3. Crea la cuenta de administrador del examen con /api/configurar (el código sale de .dev.vars) y usa su sesión.
4. Hace cada pregunta, con origen "eval" y modelo "deepseek", y lee su fila de ejecuciones_asistente en la base
   del examen. Antes de cada repetición vacía la memoria de grupos (memoria fría: cada repetición mide al
   clasificador desde cero) y borra los intentos del asistente, para no chocar con el límite de 30 mensajes cada
   10 minutos. Después de cada pregunta lee lo que quedó en la memoria.
5. Califica (calificar.py), con el evaluador si está activo (evaluador.py), guarda el archivo de la corrida en
   evals/resultados/ y apaga el servidor. En los casos de grupo califica aparte los juicios del clasificador; eso
   no decide si el caso pasa: lo decide la respuesta.

En la consola solo sale un resumen. Las claves y el código de configuración de .dev.vars nunca se imprimen ni se
escriben en archivos. Qué hizo cada agente en cada pregunta se ve con uv run visor.py resultados/ARCHIVO.json.
"""

import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

import calificar
import evaluador as modulo_evaluador

CARPETA = Path(__file__).resolve().parent  # evals/
RAIZ = CARPETA.parent
ESTADO = CARPETA / '.estado'
CASOS = CARPETA / 'casos'
RESULTADOS = CARPETA / 'resultados'
INVENTARIO_SQL = CARPETA / 'inventario.sql'
DEV_VARS = RAIZ / '.dev.vars'
WRANGLER = RAIZ / 'node_modules' / '.bin' / 'wrangler'
BASE = 'lector-inventario'

MODELO_CONVERSADOR = 'deepseek'  # id de MODELOS_ASISTENTE en wrangler.jsonc
REPETICIONES = 3
CATEGORIAS = ['cifras', 'grupos', 'formato', 'conducta']  # orden de la corrida: lo que puede cambiar la base, al final
# aprendizaje: el sistema podrá aprender de él (etapa 5); reserva: nunca se le corrige. Los casos que no son de grupo
# son de reserva porque de ellos no se aprende nada.
TIPOS = {'aprendizaje', 'reserva'}
REGLAS = {'grupo', 'dinero', 'entero', 'mas-caro', 'negarse-sin-cambios', 'fuera-de-tema', 'formato'}

# Sin métricas de Wrangler; CI=1 hace que las migraciones se apliquen sin preguntar.
ENTORNO_WRANGLER = {**os.environ, 'WRANGLER_SEND_METRICS': 'false', 'NO_COLOR': '1'}

FOTO_BASE = [
    "SELECT valor FROM contadores WHERE nombre = 'version_datos'",
    'SELECT codigo, nombre, precio_centavos, cantidad, creado_en, actualizado_en FROM productos ORDER BY codigo',
]
# Memoria fría y sin intentos del asistente: va antes de cada repetición.
VACIAR = ['DELETE FROM miembros_grupo', 'DELETE FROM grupos', "DELETE FROM intentos WHERE clave LIKE 'asistente:%'"]
# Lo que quedó en la memoria de grupos después de una pregunta (antes estaba vacía).
MEMORIA = ('SELECT g.nombre AS grupo, m.codigo, m.pertenece, m.origen FROM miembros_grupo AS m '
           'JOIN grupos AS g ON g.id = m.grupo_id ORDER BY g.nombre, m.codigo')
# Solo para --alterar-base: un cambio a mano que la comparación de antes y después debe detectar.
ALTERACION = "UPDATE productos SET precio_centavos = precio_centavos + 100 WHERE codigo = '80941385'"

CAMPOS_EJECUCION = (
    'id, origen, modelo, version_instrucciones, version_datos, resultado, motivo, llamadas, duracion_ms, '
    'tokens_entrada, tokens_salida, tokens_cache, herramientas'
)


class ErrorEvals(Exception):
    """Un problema que impide seguir con la corrida. El mensaje se muestra tal cual."""


# ---------- .dev.vars ----------


def leer_dev_vars() -> dict:
    """Los valores de .dev.vars. Nunca se imprimen ni se escriben en otro archivo."""
    if not DEV_VARS.exists():
        raise ErrorEvals(f'Falta {DEV_VARS}: los evals necesitan CODIGO_CONFIGURACION y DEEPSEEK_API_KEY.')
    valores = {}
    for linea in DEV_VARS.read_text().splitlines():
        linea = linea.strip()
        if not linea or linea.startswith('#') or '=' not in linea:
            continue
        clave, valor = linea.split('=', 1)
        valor = valor.strip()
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in '"\'':
            valor = valor[1:-1]
        valores[clave.strip()] = valor
    for clave in ('CODIGO_CONFIGURACION', 'DEEPSEEK_API_KEY'):
        if not valores.get(clave):
            raise ErrorEvals(f'Falta {clave} en .dev.vars.')
    return valores


# ---------- Base del examen (wrangler d1 --local --persist-to evals/.estado) ----------


def _wrangler(*argumentos: str, entorno: dict | None = None, tiempo: int = 120) -> str:
    if not WRANGLER.exists():
        raise ErrorEvals('No está Wrangler en node_modules. Corre npm install en la carpeta del proyecto.')
    proceso = subprocess.run(
        [str(WRANGLER), *argumentos], cwd=RAIZ, capture_output=True, text=True,
        env=entorno or ENTORNO_WRANGLER, stdin=subprocess.DEVNULL, timeout=tiempo,
    )
    if proceso.returncode != 0:
        salida = (proceso.stderr or proceso.stdout).strip().splitlines()[-8:]
        raise ErrorEvals(f'wrangler {argumentos[0]} {argumentos[1]} falló:\n' + '\n'.join(salida))
    return proceso.stdout


def sql(*sentencias: str) -> list[list[dict]]:
    """Ejecuta las sentencias en la base del examen y devuelve las filas de cada una, en orden."""
    salida = _wrangler('d1', 'execute', BASE, '--local', '--persist-to', str(ESTADO), '--json',
                       '--command', '; '.join(sentencias))
    inicio = salida.find('[')
    return [bloque['results'] for bloque in json.loads(salida[inicio:])]


def preparar_base() -> None:
    """Base nueva: borra el estado anterior, aplica las migraciones y carga el inventario del examen."""
    if ESTADO.exists():
        shutil.rmtree(ESTADO)
    ESTADO.mkdir(parents=True)
    _wrangler('d1', 'migrations', 'apply', BASE, '--local', '--persist-to', str(ESTADO),
              entorno={**ENTORNO_WRANGLER, 'CI': '1'})
    _wrangler('d1', 'execute', BASE, '--local', '--persist-to', str(ESTADO), '--file', str(INVENTARIO_SQL))


def foto() -> dict:
    version, productos = sql(*FOTO_BASE)
    return {'version_datos': version[0]['valor'], 'productos': productos}


def clasifico(herramientas: list[dict] | None) -> bool:
    """Si la pregunta guardó juicios del clasificador (productos_del_grupo con una clasificación que salió bien)."""
    return any(
        h.get('nombre') == 'productos_del_grupo'
        and ((h.get('resultado') or {}).get('clasificacion') or {}).get('revisados', 0) > 0
        for h in herramientas or []
    )


def comparar(antes: dict, despues: dict, memoria: list[dict], herramientas: list[dict] | None) -> dict:
    """Qué cambió en la base: version_datos [antes, después], los códigos de productos que cambiaron y qué escribió
    la pregunta en la memoria de grupos (que estaba vacía antes de preguntar)."""
    a = {p['codigo']: p for p in antes['productos']}
    d = {p['codigo']: p for p in despues['productos']}
    distintos = sorted(c for c in a.keys() | d.keys() if a.get(c) != d.get(c))
    return {
        'version_datos': [antes['version_datos'], despues['version_datos']],
        'productos': distintos,
        'memoria': {'filas': len(memoria), 'clasifico': clasifico(herramientas)},
    }


def leer_ejecucion(ejecucion: str, extras: list[str]) -> tuple[dict | None, list[list[dict]]]:
    """La fila de ejecuciones_asistente (se escribe con waitUntil, justo después del flujo) y las filas de las
    consultas extra, leídas en la misma llamada a Wrangler."""
    if not re.fullmatch(r'[0-9a-f-]{36}', ejecucion or ''):
        return None, sql(*extras)
    consulta = f"SELECT {CAMPOS_EJECUCION} FROM ejecuciones_asistente WHERE id = '{ejecucion}'"
    for _ in range(8):
        bloques = sql(consulta, *extras)
        if bloques[0]:
            fila = bloques[0][0]
            fila['herramientas'] = json.loads(fila['herramientas'])
            return fila, bloques[1:]
        time.sleep(0.5)
    return None, bloques[1:]


# ---------- Servidor del examen ----------


def puerto_libre() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class Servidor:
    """Un wrangler dev aparte, con el estado de evals/.estado. Su registro queda en evals/.estado/wrangler-dev.log."""

    def __init__(self):
        self.proceso = None
        self.url = None

    def arrancar(self) -> None:
        puerto, inspector = puerto_libre(), puerto_libre()
        self.url = f'http://localhost:{puerto}'
        self.registro = open(ESTADO / 'wrangler-dev.log', 'w')
        self.proceso = subprocess.Popen(
            [str(WRANGLER), 'dev', '--port', str(puerto), '--inspector-port', str(inspector),
             '--persist-to', str(ESTADO), '--show-interactive-dev-session=false'],
            cwd=RAIZ, stdin=subprocess.DEVNULL, stdout=self.registro, stderr=subprocess.STDOUT,
            env=ENTORNO_WRANGLER, start_new_session=True,  # su propio grupo, para apagar también a workerd
        )
        limite = time.monotonic() + 90
        while time.monotonic() < limite:
            if self.proceso.poll() is not None:
                raise ErrorEvals('wrangler dev se cerró al arrancar. Revisa evals/.estado/wrangler-dev.log.')
            try:
                if httpx.get(f'{self.url}/api/sesion', timeout=2).status_code == 200:
                    return
            except httpx.TransportError:
                pass
            time.sleep(0.5)
        raise ErrorEvals('wrangler dev no respondió en 90 s. Revisa evals/.estado/wrangler-dev.log.')

    def apagar(self) -> None:
        if self.proceso is None or self.proceso.poll() is not None:
            return
        try:
            os.killpg(self.proceso.pid, signal.SIGTERM)
            self.proceso.wait(15)
        except subprocess.TimeoutExpired:
            os.killpg(self.proceso.pid, signal.SIGKILL)
            self.proceso.wait()
        except ProcessLookupError:
            pass
        self.registro.close()


def crear_administrador(url: str, codigo_configuracion: str) -> str:
    """Crea la cuenta de administrador del examen y devuelve el token de su sesión (cookie __Host-sesion)."""
    contrasena = secrets.token_urlsafe(24)  # de un solo uso: cada corrida crea su base y su cuenta
    respuesta = httpx.post(f'{url}/api/configurar', timeout=30, json={
        'codigo': codigo_configuracion,
        'nombre': 'Evaluador',
        'correo': 'evaluador@evals.test',
        'contrasena': contrasena,
        'confirmacion': contrasena,
    })
    if respuesta.status_code != 201:
        raise ErrorEvals(f'No se pudo crear la cuenta de administrador del examen ({respuesta.status_code}): '
                         f'{respuesta.json().get("error")}')
    token = re.search(r'__Host-sesion=([A-Za-z0-9_-]{43})', respuesta.headers.get('set-cookie', ''))
    if not token:
        raise ErrorEvals('/api/configurar no devolvió la cookie de sesión.')
    return token.group(1)


def preguntar(cliente: httpx.Client, pregunta: str) -> dict:
    """Una pregunta nueva, sin historial, como la primera de una conversación en el navegador."""
    cuerpo = {'mensajes': [{'rol': 'usuario', 'texto': pregunta}], 'origen': 'eval', 'modelo': MODELO_CONVERSADOR}
    texto, consultas, error, fin = [], 0, None, False
    with cliente.stream('POST', '/api/asistente', json=cuerpo) as respuesta:
        ejecucion = respuesta.headers.get('x-ejecucion')
        if respuesta.status_code != 200 or not respuesta.headers.get('content-type', '').startswith('text/event-stream'):
            respuesta.read()
            try:
                error = respuesta.json().get('error')
            except ValueError:
                error = None
            return {'respuesta': '', 'error': f'{respuesta.status_code}: {error}', 'ejecucion': ejecucion, 'consultas': 0}
        for linea in respuesta.iter_lines():
            if not linea.startswith('data: '):
                continue
            evento = json.loads(linea[6:])
            if evento['tipo'] == 'texto':
                texto.append(evento['texto'])
            elif evento['tipo'] == 'consulta':
                consultas += 1
            elif evento['tipo'] == 'error':
                error = evento['error']
            elif evento['tipo'] == 'fin':
                fin = True
    if not fin and not error:
        error = 'El flujo terminó sin evento fin.'
    return {'respuesta': ''.join(texto), 'error': error, 'ejecucion': ejecucion, 'consultas': consultas}


# ---------- Casos ----------


def cargar_casos(ids: list[str] | None) -> list[dict]:
    casos = []
    for archivo in sorted(CASOS.glob('*.json')):
        caso = json.loads(archivo.read_text())
        faltan = [c for c in ('id', 'categoria', 'pregunta', 'regla', 'tipo') if c not in caso]
        if faltan or caso['regla'] not in REGLAS or caso['categoria'] not in CATEGORIAS or caso['tipo'] not in TIPOS:
            raise ErrorEvals(f'El caso {archivo.name} no es válido (faltan {faltan}, o la regla, la categoría o el tipo no existen).')
        if caso['regla'] == 'grupo' and not (caso.get('grupo') and caso.get('esperados')):
            raise ErrorEvals(f'El caso {archivo.name} es de grupo y le falta grupo o esperados.')
        if caso['regla'] in ('dinero', 'entero', 'mas-caro') and not caso.get('esperado_sql'):
            raise ErrorEvals(f'El caso {archivo.name} necesita esperado_sql.')
        casos.append(caso)
    if ids:
        disponibles = {c['id'] for c in casos}
        desconocidos = [i for i in ids if i not in disponibles]
        if desconocidos:
            raise ErrorEvals(f'Casos desconocidos: {", ".join(desconocidos)}. Hay: {", ".join(sorted(disponibles))}.')
        casos = [c for c in casos if c['id'] in ids]
    return sorted(casos, key=lambda c: (CATEGORIAS.index(c['categoria']), c['id']))


# ---------- Calificación de una repetición ----------


def resumir_consultas(herramientas: list[dict], inventario: list[dict]) -> tuple[str, set[str]]:
    """Las consultas del asistente en texto, para el evaluador, y los códigos que llegó a ver."""
    nombres = {p['codigo']: p['nombre'] for p in inventario}
    lineas, vistos = [], set()
    for h in herramientas:
        resultado = h.get('resultado') or {}
        argumentos = json.dumps(h.get('argumentos'), ensure_ascii=False)
        if h.get('nombre') == 'productos_del_grupo' and 'codigos' in resultado:
            vistos.update(resultado['codigos'])
            lista = ', '.join(nombres.get(c, c) for c in resultado['codigos']) or 'ninguno'
            clasificacion = resultado.get('clasificacion')
            if not clasificacion:
                juicio = 'no llamó al clasificador'
            elif clasificacion.get('error'):
                juicio = f'el clasificador falló ({clasificacion["error"]}) con {clasificacion["enviados"]} productos y no se guardó nada'
            else:
                juicio = f'el clasificador juzgó {clasificacion["revisados"]} productos y dijo que {clasificacion["pertenecen"]} son del grupo'
            lineas.append(f'- {h["nombre"]} {argumentos}: grupo «{resultado["grupo"]}»; {juicio}; '
                          f'{resultado["total"]} miembros, {resultado.get("sin_revisar", 0)} sin revisar; devolvió: {lista}')
        elif 'codigos' in resultado:
            vistos.update(resultado['codigos'])
            lista = ', '.join(nombres.get(c, c) for c in resultado['codigos']) or 'ninguno'
            lineas.append(f'- {h["nombre"]} {argumentos}: {resultado["total"]} coincidencias; devolvió: {lista}')
        elif 'error' in resultado:
            lineas.append(f'- {h["nombre"]} {argumentos}: error ({resultado["error"]})')
        else:
            lineas.append(f'- {h["nombre"]} {argumentos}: totales del inventario, sin lista de productos')
    return '\n'.join(lineas) or 'Ninguna.', vistos


def juicios_por_grupo(memoria: list[dict] | None) -> dict[str, dict[str, int]]:
    """{grupo: {código: pertenece}} de las filas de la memoria leídas después de preguntar."""
    grupos = {}
    for fila in memoria or []:
        grupos.setdefault(fila['grupo'], {})[fila['codigo']] = fila['pertenece']
    return grupos


def calificar_clasificador(caso: dict, rep: dict) -> dict:
    """Los juicios del clasificador para el grupo que pidió el conversador, contra los esperados del caso.

    El grupo sale del resumen de productos_del_grupo en herramientas (ya normalizado). Si pidió varios, se califica
    cada uno. No cambia si el caso pasa.
    """
    llamadas = [h for h in rep.get('herramientas') or [] if h.get('nombre') == 'productos_del_grupo']
    if not llamadas:
        return {'llamo': False, 'grupos': [], 'resumen': 'El conversador no llamó a productos_del_grupo.'}
    juicios = juicios_por_grupo(rep.get('memoria'))
    grupos = []
    for llamada in llamadas:
        resultado = llamada.get('resultado') or {}
        if 'grupo' not in resultado or any(g['grupo'] == resultado['grupo'] for g in grupos):
            continue
        clasificacion = resultado.get('clasificacion') or {}
        grupos.append({
            'grupo': resultado['grupo'],
            **calificar.regla_clasificador(caso['esperados'], juicios.get(resultado['grupo'], {})),
            **({'error': clasificacion['error']} if clasificacion.get('error') else {}),
        })
    if not grupos:
        return {'llamo': True, 'grupos': [], 'resumen': 'El conversador llamó a productos_del_grupo, pero sin un grupo válido.'}
    return {'llamo': True, 'grupos': grupos, 'resumen': ' '.join(f'«{g["grupo"]}»: {g["resumen"]}' for g in grupos)}


def lo_que_dijo_el_clasificador(codigo: str, clasificador: dict | None, juicios: dict) -> str:
    """sí, no o no lo juzgó, por cada grupo que pidió el conversador; para el evaluador."""
    if not clasificador or not clasificador['grupos']:
        return 'no lo juzgó (el asistente no pidió ningún grupo)'
    partes = []
    for grupo in clasificador['grupos']:
        pertenece = juicios.get(grupo['grupo'], {}).get(codigo)
        texto = 'no lo juzgó' if pertenece is None else 'sí' if pertenece == 1 else 'no'
        partes.append(texto if len(clasificador['grupos']) == 1 else f'{grupo["grupo"]}: {texto}')
    return '; '.join(partes)


def calificar_repeticion(caso: dict, rep: dict, inventario: list[dict], evaluador) -> dict:
    """Detalle de la calificación de una repetición. rep trae respuesta, error, herramientas, memoria y contexto."""
    if rep['error']:
        detalle = {'pasa': False, 'resumen': f'El asistente no respondió: {rep["error"]}'}
        if rep['contexto'].get('cambios'):
            detalle['cambios'] = rep['contexto']['cambios']
        return detalle
    respuesta = rep['respuesta']
    nombrados = None
    lectura = None
    busqueda = None
    if caso['regla'] in calificar.REGLAS_CON_NOMBRADOS:
        busqueda = calificar.buscar_nombrados(respuesta, inventario)
        nombrados = set(busqueda['codigos'])
        if evaluador and busqueda['lineas_sin_coincidencia']:
            lectura = evaluador.leer_lineas(busqueda['lineas_sin_coincidencia'], inventario)
            for linea in lectura['lecturas']:
                nombrados.update(linea['codigos'])
    contexto = {**rep['contexto'], 'inventario': inventario}
    detalle = calificar.calificar(caso, respuesta, contexto, sorted(nombrados) if nombrados is not None else None)
    if busqueda is not None:
        detalle['nombrados_por_codigo'] = busqueda['codigos']
        detalle['lineas_sin_coincidencia'] = busqueda['lineas_sin_coincidencia']
        if lectura is not None:
            detalle['lecturas_evaluador'] = lectura['lecturas']
            if lectura['error']:
                detalle.setdefault('errores_evaluador', []).append(lectura['error'])
    if caso['regla'] == 'grupo':
        detalle['clasificador'] = calificar_clasificador(caso, rep)
    if evaluador and caso['regla'] == 'grupo' and not detalle['pasa']:
        consultas, vistos = resumir_consultas(rep.get('herramientas') or [], inventario)
        nombres = {p['codigo']: p['nombre'] for p in inventario}
        juicios = juicios_por_grupo(rep.get('memoria'))
        fallos = [
            {'codigo': c, 'nombre': nombres.get(c, c), 'tipo': tipo, 'visto': c in vistos,
             'clasificador': lo_que_dijo_el_clasificador(c, detalle['clasificador'], juicios)}
            for tipo, codigos in (('faltante', detalle['faltantes']), ('sobrante', detalle['sobrantes']))
            for c in codigos
        ]
        explicacion = evaluador.explicar_fallos(caso, respuesta, fallos, consultas)
        detalle['explicaciones'] = explicacion['explicaciones']
        if explicacion['error']:
            detalle.setdefault('errores_evaluador', []).append(explicacion['error'])
    return detalle


# ---------- Corrida ----------


def correr_caso(caso: dict, cliente: httpx.Client, inventario: list[dict], evaluador, repeticiones: int,
                alterar_base: bool, avance) -> dict:
    compara_base = caso['regla'] == 'negarse-sin-cambios'
    esperado = None
    reps = []
    for numero in range(1, repeticiones + 1):
        avance(f'{caso["id"]} {numero}/{repeticiones}')
        # Memoria fría y sin intentos (el límite es de 30 mensajes cada 10 minutos por usuario). La foto de antes va
        # después de vaciar la memoria, que también sube version_datos.
        primera = numero == 1 and caso.get('esperado_sql')
        bloques = sql(*VACIAR, *([caso['esperado_sql']] if primera else []), *(FOTO_BASE if compara_base else []))
        if primera:
            esperado = bloques[len(VACIAR)]
        antes = {'version_datos': bloques[-2][0]['valor'], 'productos': bloques[-1]} if compara_base else None
        salida = preguntar(cliente, caso['pregunta'])
        if alterar_base and compara_base:
            sql(ALTERACION)
        fila, bloques = leer_ejecucion(salida['ejecucion'], [*(FOTO_BASE if compara_base else []), MEMORIA])
        memoria = bloques[-1]
        herramientas = (fila or {}).get('herramientas')
        cambios = None
        if compara_base:
            despues = {'version_datos': bloques[0][0]['valor'], 'productos': bloques[1]}
            cambios = comparar(antes, despues, memoria, herramientas)
        rep = {
            'repeticion': numero,
            'respuesta': salida['respuesta'],
            'error': salida['error'],
            'ejecucion': salida['ejecucion'],
            'fila': {k: v for k, v in (fila or {}).items() if k not in ('id', 'herramientas')} or None,
            'herramientas': herramientas,
            'memoria': memoria,
            'contexto': {'esperado': esperado, 'cambios': cambios},
        }
        rep['detalle'] = calificar_repeticion(caso, rep, inventario, evaluador)
        rep['pasa'] = rep['detalle']['pasa']
        reps.append(rep)
    return {**caso, 'pasa': all(r['pasa'] for r in reps), 'repeticiones': reps}


def info_app() -> dict:
    def git(*argumentos):
        return subprocess.run(['git', '-C', str(RAIZ), *argumentos], capture_output=True, text=True).stdout.strip()
    return {
        'commit': git('rev-parse', '--short', 'HEAD'),
        'cambios_sin_commit': bool(git('status', '--porcelain', '--', 'src', 'public/js', 'migrations', 'wrangler.jsonc')),
    }


def resumen_tokens(casos: list[dict]) -> dict:
    total = {'preguntas': 0, 'sin_fila': 0, 'tokens_entrada': 0, 'tokens_salida': 0, 'tokens_cache': 0, 'duracion_ms': 0}
    for caso in casos:
        for rep in caso['repeticiones']:
            total['preguntas'] += 1
            fila = rep.get('fila')
            if not fila:
                total['sin_fila'] += 1
                continue
            for campo in ('tokens_entrada', 'tokens_salida', 'tokens_cache', 'duracion_ms'):
                total[campo] += fila.get(campo) or 0
    return total


def resumen_clasificador(casos: list[dict]) -> dict:
    """Llamadas y tokens del clasificador, sacados del resumen de productos_del_grupo de cada fila (las columnas de
    tokens de la fila son solo del conversador)."""
    total = {'llamadas': 0, 'errores': 0, 'sin_tokens': 0, 'tokens_entrada': 0, 'tokens_salida': 0, 'tokens_cache': 0,
             'duracion_ms': 0, 'modelos': set(), 'versiones': set()}
    for caso in casos:
        for rep in caso['repeticiones']:
            for h in rep.get('herramientas') or []:
                clasificacion = (h.get('resultado') or {}).get('clasificacion') if h.get('nombre') == 'productos_del_grupo' else None
                if not clasificacion:
                    continue
                total['llamadas'] += 1
                total['errores'] += bool(clasificacion.get('error'))
                total['duracion_ms'] += clasificacion.get('duracion_ms') or 0
                if clasificacion.get('modelo'):
                    total['modelos'].add(clasificacion['modelo'])
                if clasificacion.get('version'):
                    total['versiones'].add(clasificacion['version'])
                tokens = clasificacion.get('tokens')
                if not tokens:
                    total['sin_tokens'] += 1
                    continue
                total['tokens_entrada'] += tokens.get('entrada') or 0
                total['tokens_salida'] += tokens.get('salida') or 0
                total['tokens_cache'] += tokens.get('cache') or 0
    return {**total, 'modelos': sorted(total['modelos']), 'versiones': sorted(total['versiones'])}


def guardar(datos: dict, sufijo: str = '') -> Path:
    RESULTADOS.mkdir(exist_ok=True)
    momento = datetime.fromisoformat(datos['fecha']).strftime('%Y-%m-%d_%H%M%S')
    archivo = RESULTADOS / f'{momento}{sufijo}.json'
    archivo.write_text(json.dumps(datos, ensure_ascii=False, indent=2) + '\n')
    return archivo


def crear_evaluador(nombre: str, dev_vars: dict | None):
    if nombre == 'ninguno':
        return None
    return modulo_evaluador.Evaluador(nombre, (dev_vars or leer_dev_vars())['DEEPSEEK_API_KEY'])


def correr(argumentos) -> tuple[dict, Path]:
    casos = cargar_casos(argumentos.casos)
    dev_vars = leer_dev_vars()
    evaluador = crear_evaluador(argumentos.evaluador, dev_vars)
    avance = (lambda texto: print(f'\r\033[K{texto}…', end='', file=sys.stderr, flush=True)) if sys.stderr.isatty() else (lambda texto: None)

    avance('preparando la base del examen')
    preparar_base()
    inicial = foto()
    inventario = [{k: p[k] for k in ('codigo', 'nombre', 'precio_centavos', 'cantidad')} for p in inicial['productos']]
    servidor = Servidor()
    resultados = []
    try:
        avance('arrancando wrangler dev')
        servidor.arrancar()
        token = crear_administrador(servidor.url, dev_vars['CODIGO_CONFIGURACION'])
        with httpx.Client(base_url=servidor.url, headers={'Cookie': f'__Host-sesion={token}'},
                          timeout=httpx.Timeout(10, read=120)) as cliente:
            for caso in casos:
                resultados.append(correr_caso(caso, cliente, inventario, evaluador, argumentos.repeticiones,
                                              argumentos.alterar_base, avance))
    finally:
        avance('apagando wrangler dev')
        servidor.apagar()
        if sys.stderr.isatty():
            print('\r\033[K', end='', file=sys.stderr)

    filas = [r['fila'] for c in resultados for r in c['repeticiones'] if r.get('fila')]
    clasificador = resumen_clasificador(resultados)
    datos = {
        'fecha': datetime.now().astimezone().isoformat(timespec='seconds'),
        'configuracion': {
            'conversador': {
                'id': MODELO_CONVERSADOR,
                'modelos': sorted({f['modelo'] for f in filas}),
                'versiones_instrucciones': sorted({f['version_instrucciones'] for f in filas}),
            },
            'clasificador': {k: clasificador[k] for k in ('modelos', 'versiones')},
            'evaluador': evaluador.descripcion() if evaluador else None,
            'repeticiones': argumentos.repeticiones,
            'casos': [c['id'] for c in casos],
            'alterar_base': argumentos.alterar_base,
            'inventario': {
                'archivo': 'evals/inventario.sql',
                'huella': hashlib.sha256(INVENTARIO_SQL.read_bytes()).hexdigest()[:16],
                'productos': len(inventario),
                'version_datos': inicial['version_datos'],
            },
            'app': info_app(),
        },
        'resumen': {
            'casos': len(resultados),
            'pasan': sum(c['pasa'] for c in resultados),
            'conversador': resumen_tokens(resultados),
            'clasificador': {k: v for k, v in clasificador.items() if k not in ('modelos', 'versiones')},
            'evaluador': evaluador.uso if evaluador else None,
        },
        'inventario': inventario,
        'casos': resultados,
    }
    return datos, guardar(datos, '-alterada' if argumentos.alterar_base else '')


def recalificar(argumentos) -> tuple[dict, Path]:
    """Vuelve a calificar una corrida guardada con otro evaluador (o ninguno), sin preguntarle al asistente."""
    origen = Path(argumentos.recalificar)
    anterior = json.loads(origen.read_text())
    evaluador = crear_evaluador(argumentos.evaluador, None)
    inventario = anterior['inventario']
    resultados = []
    for caso in anterior['casos']:
        reps = []
        for rep in caso['repeticiones']:
            rep = {**rep}
            rep['detalle'] = calificar_repeticion(caso, rep, inventario, evaluador)
            rep['pasa'] = rep['detalle']['pasa']
            reps.append(rep)
        resultados.append({**caso, 'pasa': all(r['pasa'] for r in reps), 'repeticiones': reps})
    datos = {
        **anterior,
        'fecha': datetime.now().astimezone().isoformat(timespec='seconds'),
        'recalificada_de': origen.name,
        'configuracion': {**anterior['configuracion'], 'evaluador': evaluador.descripcion() if evaluador else None},
        'resumen': {
            **anterior['resumen'],
            'pasan': sum(c['pasa'] for c in resultados),
            'evaluador': evaluador.uso if evaluador else None,
        },
        'casos': resultados,
    }
    return datos, guardar(datos, '-recalificada')


# ---------- Resumen en la consola ----------


def cuantos(lista: list, palabra: str) -> str:
    return f'{len(lista)} {palabra}{"" if len(lista) == 1 else "s"}'


def miles(n: int) -> str:
    return f'{n:,}'.replace(',', ' ')


def imprimir_resumen(datos: dict, archivo: Path) -> None:
    config = datos['configuracion']
    conversador = config['conversador']
    evaluador = config['evaluador']
    print(f'Evals del asistente · {datos["fecha"]}' + (f' · recalificada de {datos["recalificada_de"]}' if datos.get('recalificada_de') else ''))
    clasificador = config.get('clasificador') or {}
    print(f'Conversador: {", ".join(conversador["modelos"]) or "sin filas"} '
          f'(instrucciones {", ".join(conversador["versiones_instrucciones"]) or "?"}) · '
          + (f'Clasificador: {", ".join(clasificador["modelos"])} (versión {", ".join(clasificador["versiones"])}) · '
             if clasificador.get('modelos') else '')
          + f'Evaluador: {evaluador["modelo"] if evaluador else "ninguno"} · {config["repeticiones"]} repeticiones'
          + (' · BASE ALTERADA A PROPÓSITO' if config.get('alterar_base') else ''))
    resumen = datos['resumen']
    porcentaje = round(100 * resumen['pasan'] / resumen['casos']) if resumen['casos'] else 0
    print(f'\nPasan {resumen["pasan"]} de {resumen["casos"]} casos ({porcentaje} %).\n')
    for caso in datos['casos']:
        bien = sum(r['pasa'] for r in caso['repeticiones'])
        print(f'  {caso["categoria"]:<9} {caso["id"]:<22} {"pasa " if caso["pasa"] else "falla"}  {bien}/{len(caso["repeticiones"])}')

    nombres = {p['codigo']: p['nombre'] for p in datos['inventario']}
    for caso in datos['casos']:
        if caso['regla'] != 'grupo':
            continue
        print(f'\n{caso["id"]} ({caso["tipo"]}): {len(caso["esperados"])} esperados')
        for rep in caso['repeticiones']:
            detalle = rep['detalle']
            if 'aciertos' not in detalle:
                print(f'  Repetición {rep["repeticion"]}: {detalle["resumen"]}')
                continue
            print(f'  Repetición {rep["repeticion"]}: {cuantos(detalle["aciertos"], "acierto")}, '
                  f'{cuantos(detalle["faltantes"], "faltante")}, {cuantos(detalle["sobrantes"], "sobrante")}')
            for etiqueta, codigos in (('Faltan', detalle['faltantes']), ('Sobran', detalle['sobrantes'])):
                if codigos:
                    print(f'    {etiqueta}: {", ".join(nombres.get(c, c) for c in codigos)}')
            clasificador = detalle.get('clasificador')
            if not clasificador:
                continue
            if not clasificador['grupos']:
                print(f'    Clasificador: {clasificador["resumen"]}')
            for grupo in clasificador['grupos']:
                print(f'    Clasificador («{grupo["grupo"]}», juzgó {grupo["juzgados"]}): '
                      f'{cuantos(grupo["aciertos"], "acierto")}, {cuantos(grupo["faltantes"], "faltante")}, '
                      f'{cuantos(grupo["sobrantes"], "sobrante")}' + (f' · falló: {grupo["error"]}' if grupo.get('error') else ''))
                for etiqueta, codigos in (('Faltan', grupo['faltantes']), ('Sobran', grupo['sobrantes'])):
                    if codigos:
                        print(f'      {etiqueta}: {", ".join(nombres.get(c, c) for c in codigos)}')

    tokens = resumen['conversador']
    print(f'\nTokens del conversador: {miles(tokens["tokens_entrada"])} de entrada '
          f'({miles(tokens["tokens_cache"])} desde la caché) y {miles(tokens["tokens_salida"])} de salida, '
          f'en {tokens["preguntas"]} preguntas' + (f' ({tokens["sin_fila"]} sin fila)' if tokens['sin_fila'] else '') + '.')
    if resumen.get('clasificador'):
        uso = resumen['clasificador']
        print(f'Tokens del clasificador: {miles(uso["tokens_entrada"])} de entrada ({miles(uso["tokens_cache"])} desde la caché) '
              f'y {miles(uso["tokens_salida"])} de salida, en {uso["llamadas"]} llamadas'
              + (f' ({uso["errores"]} con error)' if uso['errores'] else '') + '.')
    if resumen.get('evaluador'):
        uso = resumen['evaluador']
        print(f'Tokens del evaluador: {miles(uso["tokens_entrada"])} de entrada ({miles(uso["tokens_cache"])} desde la caché) '
              f'y {miles(uso["tokens_salida"])} de salida, en {uso["llamadas"]} llamadas'
              + (f' ({uso["errores"]} con error)' if uso['errores'] else '') + '.')
    print(f'Resultados: {archivo.relative_to(RAIZ)}')
    print(f'Detalle por agente: uv run visor.py {archivo.relative_to(CARPETA)}')


def main() -> int:
    parser = argparse.ArgumentParser(description='Evals del asistente del inventario.')
    parser.add_argument('--casos', type=lambda t: [c.strip() for c in t.split(',') if c.strip()],
                        help='ids de los casos separados por comas (por defecto, todos)')
    parser.add_argument('--evaluador', choices=['ninguno', *modulo_evaluador.CONFIGURACIONES], default='deepseek-flash')
    parser.add_argument('--repeticiones', type=int, default=REPETICIONES,
                        help=f'veces que se pregunta cada caso (por defecto {REPETICIONES}); pasa si pasan todas')
    parser.add_argument('--recalificar', metavar='ARCHIVO', help='vuelve a calificar una corrida guardada, sin preguntar')
    parser.add_argument('--alterar-base', action='store_true',
                        help='solo para probar los evals: en los casos de conducta cambia un precio a mano después de '
                             'preguntar, para comprobar que la comparación de antes y después lo detecta')
    argumentos = parser.parse_args()
    if argumentos.repeticiones < 1:
        parser.error('--repeticiones debe ser al menos 1')

    # Un SIGTERM también apaga el servidor del examen (pasa por el finally de correr).
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        datos, archivo = recalificar(argumentos) if argumentos.recalificar else correr(argumentos)
    except ErrorEvals as error:
        print(f'Error: {error}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('\nCorrida interrumpida: el servidor del examen se apagó y no se guardaron resultados.', file=sys.stderr)
        return 130
    imprimir_resumen(datos, archivo)
    return 0


if __name__ == '__main__':
    sys.exit(main())
