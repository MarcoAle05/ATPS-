# Lector de códigos de barras

Inventario para un negocio pequeño que se lleva escaneando códigos de barras con la cámara del celular, desde el navegador y sin instalar nada. Corre en Cloudflare (Workers, D1 y Durable Objects) y tiene un asistente que responde preguntas sobre el inventario.

## Qué hace

- **Escanear.** El lector usa la cámara del celular ([ZXing](https://github.com/zxing-js/browser)). Un código nuevo registra el producto con cantidad 0, y uno ya registrado suma 1. Si la cámara no lee, el código se escribe a mano.
- **Autollenado del nombre.** El nombre se busca en Open Food Facts, Open Beauty Facts y Open Products Facts. Si no aparece, se escribe a mano.
- **Cuentas y roles.**
  - `admin`: una sola cuenta, la del dueño, creada la primera vez con un código de configuración.
  - `editor`: autorizado por el administrador.
  - `lector`: así queda quien se registra; puede consultar, pero no sumar.
- **Tiempo real.** Cada cambio de producto o de cuenta aparece al instante en todas las pantallas abiertas.
- **Asistente.**
  - Es un chat, solo para el administrador, que responde preguntas sobre el inventario con datos de la base.
  - Usa DeepSeek por medio de LangChain.js.
  - Solo consulta: no agrega, edita ni elimina productos.
  - Cada pregunta queda en un registro de ejecuciones.
- **Evals.** Un examen en Python mide qué tan bien responde el asistente contra listas preparadas por el dueño.

Todo está en español: la interfaz, los mensajes de error y el código.

## Tecnologías

| Parte | Tecnología |
|---|---|
| Servidor | Cloudflare Workers (JavaScript, sin paso de compilación) |
| Base de datos | Cloudflare D1 (SQLite) |
| Tiempo real | Durable Objects con WebSockets |
| Interfaz | HTML, CSS y JavaScript sin framework |
| Asistente | LangChain.js con DeepSeek (Gemini también está conectado, sin usarse) |
| Evals | Python con `uv`, `httpx`, `langchain-deepseek` y `pydantic` |

## Estructura

| Carpeta o archivo | Contenido |
|---|---|
| `src/` | El Worker: rutas de la API, cuentas, productos, tiempo real y asistente |
| `public/` | La interfaz. `public/js/validacion.js` lo comparten el navegador y el Worker |
| `migrations/` | El esquema de D1 |
| `evals/` | Los evals del asistente: casos, calificación, evaluador y resultados |
| `pruebas/banco-cpu.mjs` | Mide el CPU del asistente con el modelo y D1 simulados |
| `pruebas/comprobar-clasificador.mjs` | Prueba un clasificador con una sola llamada real, antes de una corrida completa |
| `plan/` y `PLAN.md` | El plan del asistente, una etapa por archivo |
| `CLAUDE.md` | Arquitectura, comandos y restricciones del proyecto |
| `MEMORY.md` | Decisiones tomadas con el dueño, con fecha |
| `PRODUCT.md` y `DESIGN.md` | Para quién es el producto y su sistema visual |

## Correr en local

Requisitos: Node.js y npm. Para los evals, también Python 3.14 y [uv](https://docs.astral.sh/uv/).

1. Instala las dependencias:

   ```sh
   npm install
   ```

2. Crea un archivo `.dev.vars` en la raíz con estas variables. No se sube al repositorio.

   | Variable | Para qué sirve |
   |---|---|
   | `PIMIENTA` | Secreto para cifrar las contraseñas. Una cadena larga al azar, por ejemplo de `openssl rand -base64 32` |
   | `CODIGO_CONFIGURACION` | Código para crear la cuenta de administrador la primera vez |
   | `DEEPSEEK_API_KEY` | Clave de DeepSeek para el asistente (opcional) |
   | `GEMINI_API_KEY` | Clave de Google AI Studio (opcional) |

   Sin la clave de un proveedor, la app funciona igual, pero el asistente responde 503 a las preguntas para ese proveedor.

3. Aplica las migraciones a la base local y arranca el servidor:

   ```sh
   npm run db:migrar:local
   npm run dev
   ```

4. Abre <http://localhost:8787>, no `127.0.0.1`: la cookie de sesión lleva el prefijo `__Host-`. La primera vez la página pide el código de configuración para crear la cuenta de administrador.

## Publicar en tu propia cuenta de Cloudflare

1. Crea la base de datos y pon su id en `database_id` de `wrangler.jsonc`:

   ```sh
   npx wrangler d1 create lector-inventario
   ```

2. Aplica las migraciones en Cloudflare:

   ```sh
   npm run db:migrar
   ```

3. Guarda los secretos. Las claves de los modelos son opcionales:

   ```sh
   npx wrangler secret put PIMIENTA
   npx wrangler secret put CODIGO_CONFIGURACION
   npx wrangler secret put DEEPSEEK_API_KEY
   ```

4. Publica:

   ```sh
   npm run deploy
   ```

**Nunca cambies `PIMIENTA` después de crear cuentas:** dejaría inservibles todas las contraseñas guardadas.

El proyecto está pensado para el plan gratuito de Workers, que da 10 ms de CPU por petición. Por eso el trabajo en el servidor se mantiene al mínimo.

## Comandos

| Tarea | Comando |
|---|---|
| Servidor local | `npm run dev` |
| Migraciones locales | `npm run db:migrar:local` |
| Migraciones en Cloudflare | `npm run db:migrar` |
| Publicar | `npm run deploy` |
| Medir el CPU del asistente (sin gastar saldo) | `node pruebas/banco-cpu.mjs [corta\|larga\|…]` |
| Correr los evals (gasta saldo de DeepSeek) | `cd evals && uv run correr.py` |

No hay pruebas automatizadas ni linter. Para verificar un cambio: `node --check <archivo>` y probar contra `npm run dev`.

## Evals del asistente

`evals/correr.py` arma una base aparte, con las migraciones y el inventario de `evals/inventario.sql`, y arranca su propio servidor local. Hace cada pregunta de `evals/casos/` tres veces y califica las respuestas con código; un caso pasa solo si pasan las tres. Un agente evaluador explica cada fallo, pero no cambia la calificación.

| Opción | Qué hace |
|---|---|
| `--casos chicles,pastillas-menta` | Corre solo esos casos |
| `--repeticiones N` | Cambia el número de repeticiones |
| `--evaluador ninguno` | Califica sin llamar al evaluador |
| `--recalificar resultados/ARCHIVO.json` | Vuelve a calificar una corrida guardada, sin preguntar de nuevo |
| `--clasificador deepseek-v4-pro` | Usa otro modelo de DeepSeek para el clasificador en esta corrida |
| `--clasificador-razonamiento` | Hace que el clasificador razone antes de responder en esta corrida |

Las dos opciones del clasificador sirven para comparar clasificadores con el mismo examen sin tocar `wrangler.jsonc`: la corrida se lo pasa a su `wrangler dev` con `--var`, y lo que no se pida sale de `CLASIFICADOR_ASISTENTE`. El archivo de resultados guarda el clasificador pedido, y el visor lo muestra.

Antes de una corrida completa con un clasificador nuevo, conviene una sola llamada real para ver si el proveedor lo acepta, cuánto tarda y cuántos tokens gasta. También gasta saldo, pero una sola llamada:

```sh
node pruebas/comprobar-clasificador.mjs '{"proveedor":"deepseek","modelo":"deepseek-v4-pro"}'
```

Cada corrida deja un archivo en `evals/resultados/`. El primero (`2026-11-16_145431.json`) es la línea base contra la que se miden las mejoras.

Para ver una corrida en detalle, con qué hizo cada agente en cada pregunta, usa el visor desde `evals/`:

```sh
uv run visor.py                                # la corrida más reciente
uv run visor.py resultados/ARCHIVO.json        # esa corrida
```

Arma una página HTML en `evals/visor/` y la abre en el navegador; con `--no-abrir` solo dice dónde quedó. En cada repetición separa lo que hizo el conversador (herramientas, respuesta y tokens), el clasificador (cada producto que juzgó, contra la lista del dueño), la calificación por código (la que decide si pasa) y el evaluador (qué leyó y cómo explicó cada fallo). No gasta saldo, y la carpeta `evals/visor/` no se sube: la página se vuelve a generar desde el JSON.

Las corridas también se pueden ver en la app, en el apartado «Evals», que solo ve el administrador. Se publican a mano, desde `evals/`:

```sh
uv run subir.py resultados/ARCHIVO.json            # publica esa corrida (sin archivo, la más reciente)
uv run subir.py --borrar 2026-11-16_181130         # la quita
```

`subir.py` arma la página con el visor, la sube a Workers KV (binding `EVALS`) y rehace la lista de corridas. Sin más opciones escribe en el KV local de `npm run dev`; con `--remoto`, en la app publicada, con la sesión de Wrangler del dueño. El Worker solo lee esas páginas y las devuelve sin scripts.

## Licencia

[MIT](LICENSE).
