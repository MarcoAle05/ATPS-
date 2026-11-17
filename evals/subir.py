"""Publica las corridas de los evals en el apartado «Evals» de la app, que solo ve el administrador.

Uso (desde evals/):
    uv run subir.py                              publica la corrida más reciente de resultados/
    uv run subir.py resultados/ARCHIVO.json      publica esa corrida
    uv run subir.py --borrar NOMBRE              quita una corrida (NOMBRE: el del archivo, sin .json)
    uv run subir.py ... --remoto                 lo mismo, pero en la app publicada (producción)

Sin --remoto escribe en el KV local de wrangler dev (.wrangler/state, el de npm run dev), así que se puede probar
todo en local. Con --remoto escribe en el espacio de Workers KV de producción, con la sesión de Wrangler del dueño.

Qué hace al publicar:
1. Arma la página de la corrida con visor.py, con el enlace «Volver a la lista», y la sube a la clave
   corrida/NOMBRE con sus metadatos (fecha, cuántos casos pasan, modelos, si el clasificador razonó, si hubo
   evaluador y si es una recalificación; KV no admite más de 1 024 bytes).
2. Rehace la lista de corridas (clave indice) con las claves corrida/ que ya hay y sus metadatos, más la que acaba de
   subir: el listado de KV puede tardar en mostrar un cambio reciente, así que esa se agrega a mano. Van de la más
   nueva a la más vieja. Al borrar, la quitada se saca a mano de la lista.

El Worker (src/evals.js) solo lee estas dos claves y devuelve el HTML tal cual. Solo usa la biblioteca estándar y el
wrangler de node_modules; no lee .dev.vars ni ningún secreto. El NOMBRE tiene que tener la forma que acepta el
Worker (AAAA-MM-DD_HHMMSS, con un sufijo opcional como -recalificada), que es la de los archivos de resultados/.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import visor

CARPETA = Path(__file__).resolve().parent  # evals/
RAIZ = CARPETA.parent
WRANGLER = RAIZ / 'node_modules' / '.bin' / 'wrangler'
WRANGLER_JSONC = RAIZ / 'wrangler.jsonc'
BINDING = 'EVALS'
PREFIJO = 'corrida/'
INDICE = 'indice'
METADATOS_MAX = 1024  # bytes, límite de Workers KV
# La misma expresión que NOMBRE_CORRIDA en src/evals.js: un nombre que el Worker no acepta no se sube.
NOMBRE_CORRIDA = re.compile(r'^\d{4}-\d{2}-\d{2}_\d{6}(-[a-z]+)?$')
ID_PROVISIONAL = 'reemplazar-con-el-id-de-produccion'  # el de wrangler.jsonc hasta crear el espacio en producción

ENTORNO = {**os.environ, 'WRANGLER_SEND_METRICS': 'false', 'NO_COLOR': '1'}


class ErrorSubir(Exception):
    pass


def wrangler_kv(*argumentos: str, remoto: bool) -> str:
    """Un comando wrangler kv sobre el espacio EVALS, local o remoto. Devuelve su salida."""
    comando = [str(WRANGLER), 'kv', *argumentos, '--binding', BINDING, '--remote' if remoto else '--local']
    resultado = subprocess.run(comando, cwd=RAIZ, capture_output=True, text=True, env=ENTORNO)
    if resultado.returncode != 0:
        salida = (resultado.stderr.strip() or resultado.stdout.strip())[-1500:]
        raise ErrorSubir(f'Falló wrangler kv {" ".join(argumentos[:2])}:\n{salida}')
    return resultado.stdout


def listar(remoto: bool) -> dict[str, dict]:
    """{nombre: metadatos} de las corridas publicadas (claves corrida/…)."""
    salida = wrangler_kv('key', 'list', '--prefix', PREFIJO, remoto=remoto)
    try:
        claves = json.loads(salida[salida.index('['):])
    except ValueError as error:
        raise ErrorSubir('No se entendió la lista de claves que devolvió wrangler.') from error
    return {c['name'][len(PREFIJO):]: c.get('metadata') or {} for c in claves if c.get('name', '').startswith(PREFIJO)}


def subir_texto(clave: str, texto: str, remoto: bool, metadatos: dict | None = None) -> None:
    """Sube texto a una clave desde un archivo temporal (una página no cabe cómoda en la línea de comandos)."""
    with tempfile.TemporaryDirectory() as carpeta:
        archivo = Path(carpeta) / 'pagina.html'
        archivo.write_text(texto, encoding='utf-8')
        extra = ['--metadata', json.dumps(metadatos, ensure_ascii=False, separators=(',', ':'))] if metadatos else []
        wrangler_kv('key', 'put', clave, '--path', str(archivo), *extra, remoto=remoto)


def rehacer_indice(corridas: dict[str, dict], remoto: bool) -> int:
    ordenadas = [{'nombre': n, 'metadatos': corridas[n]} for n in sorted(corridas, reverse=True)]
    subir_texto(INDICE, visor.armar_lista(ordenadas), remoto)
    return len(ordenadas)


def comprobar_nombre(nombre: str) -> None:
    if not NOMBRE_CORRIDA.match(nombre):
        raise ErrorSubir(f'«{nombre}» no tiene la forma AAAA-MM-DD_HHMMSS (con un sufijo opcional, como '
                         '-recalificada) de los archivos de resultados/: la app no lo abriría.')


def comprobar_remoto() -> None:
    if ID_PROVISIONAL in WRANGLER_JSONC.read_text():
        raise ErrorSubir('wrangler.jsonc todavía tiene el id provisional del espacio EVALS. Primero crea el espacio en '
                         'producción (npx wrangler kv namespace create EVALS) y pon su id en kv_namespaces.')


def publicar(archivo: str | None, remoto: bool) -> str:
    origen = visor.elegir_archivo(archivo)
    nombre = origen.stem
    comprobar_nombre(nombre)
    try:
        datos = json.loads(origen.read_text(encoding='utf-8'))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ErrorSubir(f'No se pudo leer {origen}: {error}') from error
    if not isinstance(datos, dict):
        raise ErrorSubir(f'{origen} no es un archivo de resultados de los evals.')
    metadatos = visor.resumen_para_lista(datos)
    tamano = len(json.dumps(metadatos, ensure_ascii=False, separators=(',', ':')).encode())
    if tamano > METADATOS_MAX:
        raise ErrorSubir(f'Los metadatos de la corrida ocupan {tamano} bytes; KV admite {METADATOS_MAX}.')
    pagina = visor.Pagina(datos, origen.resolve(), enlace_lista=visor.LISTA_EN_LA_APP).html()
    subir_texto(f'{PREFIJO}{nombre}', pagina, remoto, metadatos)
    corridas = listar(remoto)
    corridas[nombre] = metadatos  # por si el listado todavía no la muestra
    total = rehacer_indice(corridas, remoto)
    return (f'Publicada {nombre} ({len(pagina.encode()) // 1024} KB, {tamano} bytes de metadatos). '
            f'La lista tiene {total} {"corrida" if total == 1 else "corridas"}.')


def borrar(nombre: str, remoto: bool) -> str:
    comprobar_nombre(nombre)
    corridas = listar(remoto)
    estaba = nombre in corridas
    wrangler_kv('key', 'delete', f'{PREFIJO}{nombre}', remoto=remoto)
    corridas.pop(nombre, None)  # por si el listado todavía la muestra
    total = rehacer_indice(corridas, remoto)
    return (f'{"Quitada" if estaba else "No estaba publicada"}: {nombre}. '
            f'La lista tiene {total} {"corrida" if total == 1 else "corridas"}.')


def main() -> int:
    parser = argparse.ArgumentParser(description='Publica o quita corridas de los evals en el apartado «Evals» de la app.')
    parser.add_argument('archivo', nargs='?', help='corrida de resultados/ (por defecto, la más reciente)')
    parser.add_argument('--borrar', metavar='NOMBRE', help='quita esa corrida (el nombre del archivo, sin .json)')
    parser.add_argument('--remoto', action='store_true',
                        help='escribe en la app publicada (producción); sin esto, en el KV local de wrangler dev')
    argumentos = parser.parse_args()
    if argumentos.borrar and argumentos.archivo:
        parser.error('--borrar no lleva archivo: solo el nombre de la corrida')
    donde = 'la app publicada (producción)' if argumentos.remoto else 'el KV local de wrangler dev'
    try:
        if argumentos.remoto:
            comprobar_remoto()
        print(f'Escribiendo en {donde}…', file=sys.stderr)
        mensaje = borrar(argumentos.borrar, argumentos.remoto) if argumentos.borrar else publicar(argumentos.archivo, argumentos.remoto)
    except (ErrorSubir, visor.ErrorVisor) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 1
    print(mensaje)
    print(f'Se ve en {"la app publicada" if argumentos.remoto else "http://localhost:8787"}{visor.LISTA_EN_LA_APP}, '
          'como administrador.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
