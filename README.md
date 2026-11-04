# Registro como proveedor — agente conversacional

Agente que automatiza la preparación de registros de **Periferia IT Group** como proveedor:
lee la solicitud del cliente, llena el formulario en el formato pedido (Excel, PDF o valores para
portal), reúne los soportes y deja un paquete listo para la firma del representante legal.

El agente **nunca firma, nunca envía correos y nunca opera portales**. Prepara; una persona decide.

- **Reto**: Reto técnico 01 · Periferia IT Group.
- **Runtime**: Bun (TypeScript estricto, sin `any`).
- **Modelo**: OpenRouter con `anthropic/claude-sonnet-5.5` (también admite la API directa de Anthropic); incluye un modo `mock` para probar sin clave.
- **Demo sin modelo**: `bun run demo.ts`.

## Arranque rápido

Requisitos: [Bun](https://bun.sh) 1.1 o superior.

```bash
bun install
cp .env.example .env        # en Windows: Copy-Item .env.example .env
# edita .env y define OPENROUTER_API_KEY (empieza por sk-or-)
bun run dev
```

Abre <http://localhost:3000>.

OpenRouter cobra por uso: carga saldo en <https://openrouter.ai/credits> y confirma que el id
`anthropic/claude-sonnet-5.5` está disponible en tu cuenta. Conviene poner un límite de gasto a la
clave. Si el modelo cambia de id, ajusta `OPENROUTER_MODEL` sin tocar el código.

Si no tienes clave del modelo, puedes probar el ciclo completo y el front con el agente guion:

```bash
# .env
LLM_PROVIDER=mock
```

### Un solo comando (alternativa con Docker)

```bash
docker compose up --build
```

Requiere un `.env` en la raíz. El contenedor sirve el front y la API en el puerto 3000.

## Variables de entorno

Todas se leen en el backend. La clave nunca se envía al front, no se registra en logs y no aparece
en ninguna respuesta.

| Variable | Obligatoria | Por defecto | Uso |
|---|---|---|---|
| `LLM_PROVIDER` | No | `openrouter` | `openrouter`, `anthropic` o `mock`. |
| `OPENROUTER_API_KEY` | Sí con `openrouter` | — | Clave de OpenRouter (`sk-or-...`). |
| `OPENROUTER_MODEL` | No | `anthropic/claude-sonnet-5.5` | Modelo del catálogo de OpenRouter. |
| `OPENROUTER_APP_URL` | No | vacía | URL pública de la app; solo identifica la app ante OpenRouter. |
| `OPENROUTER_BASE_URL` | No | `https://openrouter.ai/api/v1` | Endpoint de OpenRouter. |
| `ANTHROPIC_API_KEY` | Sí con `anthropic` | — | Alternativa: API directa de Anthropic. |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-4-6` | Modelo para la alternativa directa. |
| `PORT` | No | `3000` | Puerto HTTP. |
| `AGENT_MAX_ITERATIONS` | No | `25` | Tope de iteraciones herramienta → modelo por turno. |
| `AGENT_MAX_OUTPUT_TOKENS` | No | `4096` | Tokens máximos de salida por llamada (incluye razonamiento). |
| `SESSION_TOKEN_LIMIT` | No | `200000` | Tope de tokens por sesión. |
| `LLM_TIMEOUT_MS` | No | `60000` | Timeout de cada llamada al modelo. |
| `MAX_MESSAGE_CHARS` | No | `4000` | Largo máximo del mensaje del usuario. |
| `RATE_LIMIT_PER_MINUTE` | No | `20` | Solicitudes por minuto y por IP. |
| `FECHA_REFERENCIA` | No | fecha real | Fecha ISO para evaluar vigencias. Usa `2026-09-03` para reproducir el PRD. |
| `ACCESS_KEY` | No | vacía | Si se define, la API exige `x-access-key`. |

## Demo sin modelo

```bash
bun run demo.ts
```

Recorre los cuatro casos de `fixtures/reto-01/casos/`, llama a las herramientas en orden y escribe
`out/<caso>/`. No usa red ni claves. Limpia `out/` al inicio y devuelve código 1 si una
verificación falla.

Con `FECHA_REFERENCIA=2026-09-03` (fecha del PRD) el resultado esperado es:

| Caso | Formato | Llenos | Faltantes | Confirmar | Listo para firma |
|---|---|---|---|---|---|
| `co-industrias-delta` | xlsx | 17 | 0 | 0 | sí |
| `ec-corp-andina` | pdf | 13 | 1 | 1 | no (soporte ausente) |
| `hn-agroexport-sula` | xlsx | 9 | 1 | 1 | no (parafiscales vencido) |
| `pa-logistica-istmo` | portal | 5 | 0 | 1 | sí |

Con la fecha real (posterior al 30 de septiembre de 2026), la Cámara de Comercio y los parafiscales
quedan vencidos y **todos** los casos que los exigen quedan `listo_para_firma = false`. Eso es
correcto: no se modifican los fixtures.

## Calidad

```bash
bun run typecheck   # TypeScript estricto
bun test            # 41 pruebas
bun run check:modulo
```

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation }`. |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión. |
| `GET` | `/api/health` | `{ ok, provider, model, llmConfigured }`. Nunca expone claves. |
| `GET` | `/api/out/<ruta>` | Descarga de artefactos bajo `out/` (contención de rutas). |
| `GET` | `/` | Front de chat. |

Ejemplo:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "content-type: application/json" \
  -d "{\"sessionId\":\"demo\",\"message\":\"Procesa el caso ec-corp-andina. No envíes nada todavía.\"}"
```

Si `ACCESS_KEY` está definida, añade `-H "x-access-key: <clave>"`.

## Arquitectura

```
web/ (HTML + JS) ──HTTP──▶ src/server.ts ──▶ src/agent/loop.ts
                                             ├── src/agent/registry.ts  (zod → JSON schema)
                                             ├── src/llm/adapter.ts     (interfaz)
                                             │   └── openrouter.ts | anthropic.ts | mock.ts
                                             └── src/tools/proveedor.ts
                                                  └── fixtures/ (solo lectura)
                                                  └── out/      (escritura)
```

- Comportamiento: `agent/prompt.md`.
- Conocimiento: `src/knowledge/registro-proveedor.md` (se concatena al system prompt).
- Ejecución: `src/tools/proveedor.ts` (herramientas `proveedor_*`).
- El servidor no contiene reglas de negocio ni prompts embebidos.

Artefactos generados por caso:

```
out/<caso>/
├── formulario.xlsx | formulario.pdf | valores-portal.md
├── reporte-faltantes.md
├── mapeo.json
├── log.jsonl
├── ENVIO-SIMULADO.md          (solo tras confirmación)
└── paquete/
    ├── formulario.*
    ├── soportes/
    ├── checklist.md
    ├── borrador-correo.md
    └── estado.json
```

## Despliegue (Render, plan gratuito)

El repositorio incluye `Dockerfile`. En Render:

1. Sube el repositorio a GitHub.
2. **New → Web Service → Build and deploy from a Git repository** y elige el repo.
3. Runtime: **Docker**. Plan: **Free**.
4. Variables: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` y, recomendable, `ACCESS_KEY`.
   No definas `FECHA_REFERENCIA` si quieres la fecha real.
5. Health check path: `/api/health`. Instancias: **1**.
6. Copia la URL pública en este README.

Notas del plan gratuito de Render: el servicio se duerme tras 15 minutos sin tráfico y tarda
alrededor de un minuto en despertar; el disco es efímero, así que `out/` y las sesiones se pierden
al reiniciar. Para la defensa, abre la URL unos minutos antes. También sirve `docker compose up` o
un túnel estable como respaldo.

- **Link de prueba**: <https://reto-01-registro-proveedor-8tmm.onrender.com/>
- **Clave de acceso**: `1231` (campo con el candado, arriba a la derecha)

## Seguridad y límites

- La clave del modelo solo vive en el backend. No se escribe en `out/`, logs ni respuestas.
- `fixtures/` es de solo lectura; las herramientas no ejecutan shell ni acceden a red.
- Tope de iteraciones, de tokens por sesión, largo de mensaje y rate limit por IP.
- Las rutas de descarga se validan contra `out/` para evitar path traversal.
- El contenido de `solicitud.cuerpo` se trata como dato no confiable (sin prompt injection).
- Los datos de los fixtures son ficticios.
- No hay autenticación multiusuario ni base de datos: es un reto, no producción.

## Módulo reutilizable (bonus)

`modulo/` contiene `agent.md`, `tools/proveedor.ts` (con `_lib`) y
`skill/registro-proveedor/SKILL.md`. Se genera desde las mismas piezas que usa la app:

```bash
bun run build:modulo
bun run check:modulo   # falla si hay divergencia
```

Ver `modulo/README.md` para integrarlo en otra plataforma de agentes.

## Documentación

- `SOLUCION.md`: planteamiento, decisiones, supuestos, cobertura y riesgos.
- `PRD.md`: enunciado del reto.
