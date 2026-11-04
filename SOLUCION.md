# SOLUCION.md — Agente conversacional «Registro como Proveedor»

## 1. Problema en una frase

La analista administrativa de Periferia transcribe a mano, entre 8 y 12 veces al mes, los mismos datos de la empresa en formularios Excel, PDF o portales de clientes, buscando soportes dispersos y armando el correo de respuesta; el agente lee la solicitud, llena el formulario desde el repositorio maestro, reúne los soportes y deja el paquete listo para la firma humana.

## 2. Arquitectura

```
┌──────────────────────┐   HTTP (mismo origen)   ┌──────────────────────────────┐
│ web/                 │ ──────────────────────▶ │ src/server.ts                │
│ - historial          │ ◀────────────────────── │ - POST /api/chat             │
│ - tool calls         │                         │ - GET  /api/sessions/:id     │
│ - confirmación       │                         │ - GET  /api/health           │
│ - descargas          │                         │ - GET  /api/out/*            │
└──────────────────────┘                         └──────────────┬───────────────┘
                                                                │
                                                ┌───────────────▼───────────────┐
                                                │ src/agent/loop.ts             │
                                                │ bucle, topes, confirmación    │
                                                │ src/agent/registry.ts         │
                                                │ zod → JSON schema             │
                                                │ src/agent/session.ts          │
                                                │ memoria + out/sessions/*.json │
                                                └───────┬───────────────┬───────┘
                                                        │               │
                                        ┌───────────────▼──┐   ┌────────▼─────────────┐
                                        │ src/llm/adapter  │   │ src/tools/proveedor  │
                                        │ openrouter.ts    │   │ 5 herramientas zod   │
                                        │ anthropic.ts     │   │ + src/tools/_lib     │
                                        │ mock.ts          │   └────────┬─────────────┘
                                        └───────────────┬──┘            │
                                                        │        fixtures/ (RO)
                                                OpenRouter / Anthropic   out/ (RW)
```

Separación que pide el PRD:

| Responsabilidad | Dónde vive |
|---|---|
| Comportamiento | `agent/prompt.md` (se lee al arrancar; no hay prompt en el código) |
| Conocimiento | `src/knowledge/registro-proveedor.md` (se concatena al system prompt) |
| Ejecución | `src/tools/proveedor.ts` + `src/tools/_lib/` |
| Transporte | `src/server.ts` (no contiene reglas de negocio) |

El front es HTML/CSS/JS plano servido por el backend: un solo proceso y un solo comando (`bun run dev`) o una sola imagen (`docker compose up`). Las sesiones se guardan en `out/sessions/<id>.json` y también en memoria; no hay base de datos.

**Dependencias y por qué**:

| Dependencia | Uso |
|---|---|
| `zod` | Validar los argumentos de las herramientas y los JSON de fixtures (obligatorio por el PRD). |
| `zod-to-json-schema` | Publicar esos esquemas al modelo como JSON Schema sin duplicar definiciones. |
| `exceljs` | Escribir etiquetas y valores en la hoja/celda exactas del caso Excel. |
| `pdfkit` | Generar el PDF en el orden de la plantilla. |
| `@anthropic-ai/sdk` | Adaptador alternativo de la API directa de Anthropic; OpenRouter usa `fetch` nativo. |

No se añaden frameworks HTTP ni de front: `Bun.serve` y HTML plano bastan para el alcance.

## 3. Ciclo del agente

`src/agent/loop.ts` recibe `(sessionId, mensaje)` y ejecuta:

1. Carga la sesión (memoria o archivo) y añade el mensaje del usuario.
2. Llama al adaptador con `system prompt + historial + herramientas`.
3. Si el modelo pide herramientas, valida los argumentos con zod, ejecuta, registra la llamada y devuelve el resultado como `tool_result`; repite.
4. Si el modelo responde texto, termina el turno.
5. Guarda la sesión y devuelve `{ reply, toolCalls, needsConfirmation }`.

**Tope de iteraciones (CA1)**: `AGENT_MAX_ITERATIONS` (25 por defecto). Al alcanzarlo, el agente responde con un resumen determinista de las herramientas ejecutadas y lo que quedó pendiente; no se queda colgado.

**Confirmación humana (CA3/RN4)**: no depende solo del prompt.

- Tras un `proveedor_armar_paquete` exitoso, el loop marca `pendingConfirmation = { caso, accion: "envio" }`.
- `proveedor_simular_envio` solo se ejecuta si el mensaje del turno actual es afirmativo (heurística conservadora: «sí», «confirmo», «envía», «adelante»…), existe una confirmación pendiente y el `caso` coincide.
- Si no se cumple, la herramienta devuelve `requiere confirmación explícita` al modelo sin ejecutarse.
- El front resalta ese estado con un recuadro y botones «Sí, preparar envío simulado» / «No, esperar».

**Errores (CA5)**: cada herramienta devuelve `{ ok, data }` o `{ ok: false, error }` y nunca lanza. El loop captura errores del proveedor y del timeout, escribe un mensaje claro en el chat y mantiene viva la sesión.

**Coste**: tope de iteraciones, tope de tokens por sesión (`SESSION_TOKEN_LIMIT`), timeout por llamada (`LLM_TIMEOUT_MS`), límite de largo de mensaje y rate limit por IP.

**Registro (CA4/RN5)**: cada herramienta escribe `out/<caso>/log.jsonl` y el loop escribe `out/log.jsonl` con `{ ts, sessionId, herramienta, args, ok, resumen }`. Los resúmenes no contienen valores sensibles ni claves.

## 4. Elección del modelo

- **Proveedor principal**: OpenRouter, con la interfaz propia `LlmAdapter` y `fetch` nativo (sin SDK adicional). OpenRouter expone una API compatible con OpenAI y permite cambiar de modelo con una sola variable, manteniendo una única clave. El adaptador directo de Anthropic (`@anthropic-ai/sdk`) queda como alternativa configurable.
- **Modelo**: `anthropic/claude-sonnet-5.5` por defecto, configurable con `OPENROUTER_MODEL`. No está hardcodeado en el ciclo ni en las herramientas. Se eligió Sonnet 5.5 por la fiabilidad del *tool use* y por el equilibrio costo/calidad.
- **Razonamiento**: Sonnet 5.5 tiene el *thinking* siempre activo. OpenRouter devuelve bloques `reasoning_details` que deben reenviarse sin modificar entre llamadas de herramientas; el adaptador los conserva como `providerData` en el historial de la sesión.
- **Modo sin clave**: `LLM_PROVIDER=mock` usa un agente guion determinista que ejercita el ciclo, el front y la confirmación sin red.

**Costo estimado por caso** (tarifa pública de Sonnet 5.5 en OpenRouter: US$2 por millón de tokens de entrada y US$10 por millón de salida; verificar tarifa vigente antes de presentar):

- 6–10 llamadas por caso.
- Entrada acumulada (historial que se reenvía en cada llamada): ~50k–120k tokens.
- Salida: ~2k–6k tokens.

```
costo = entrada/1e6 * 2 + salida/1e6 * 10
      ≈ (50k..120k)/1e6 * 2 + (2k..6k)/1e6 * 10
      ≈ US$0.12 .. US$0.30 por caso
```

Con 8–12 casos al mes, el orden de magnitud es **US$1–4 al mes** de modelo. El *prompt caching* (lectura a US$0.10 por millón) reduciría la entrada; no se activó para mantener el adaptador simple. OpenRouter puede cobrar una comisión al comprar crédito, no por token; verificar en su panel.

## 5. Diseño del portal web (sección 7.4 del PRD)

**Estrategia recomendada: navegador controlado con humano en el bucle** (Playwright o similar) antes que RPA de escritorio o una extensión.

- El agente abre el portal, localiza los campos con selectores declarativos y **propone** los valores de `valores-portal.md`.
- La persona ingresa usuario y contraseña en el navegador, resuelve CAPTCHA/MFA, revisa y hace clic en «Enviar».
- Alternativa descartada: RPA de escritorio (frágil ante cambios de layout, difícil de auditar). Una extensión de navegador es viable como fase 2, pero requiere distribución e instalación por usuario.

**Límites**: CAPTCHA, MFA, cambios de layout, sesiones que expiran y términos de servicio del cliente. Mitigación: detección de cambios con selectores versionados, *fallback* a `valores-portal.md`, alertas cuando un flujo falla y revisión humana obligatoria antes del envío.

**Credenciales**: nunca en el repositorio, el prompt ni los logs. Viven en un gestor de secretos o en el navegador de la persona; el agente no las recibe. En este reto el portal no se implementa: la salida es `valores-portal.md` y el mensaje «formato no soportado».

**Reparto agente/humano**: el agente prepara, ordena y valida los valores; el humano ingresa credenciales, resuelve MFA/CAPTCHA, revisa y envía. La firma también es humana.

## 6. Decisiones y trade-offs

1. **Confirmación forzada en el loop, no solo en el prompt.** Alternativa: confiar en que el modelo obedezca. Se descartó porque un prompt no es un control de seguridad; el loop bloquea la herramienta si no hay confirmación previa y caso coincidente.
2. **`generar_formulario` ignora los valores que envía el modelo.** Alternativa: aceptar el `mapeo` del argumento. Se descartó para que el modelo no pueda inyectar valores (CA2): la herramienta relee `out/<caso>/mapeo.json` o recalcula desde el maestro.
3. **PDF generado, no AcroForm.** Alternativa: rellenar el PDF original. Los fixtures solo traen la lista de campos, no un PDF con formulario; generar el documento en el orden de la plantilla cumple el criterio P1 y es más robusto.
4. **Front HTML/JS plano en vez de React/Next.** Alternativa: SPA con build. Se descartó por peso y tiempo de arranque: el PRD permite HTML plano y así un solo proceso sirve todo.
5. **Sesiones en memoria + JSON, sin base de datos.** Alternativa: Postgres/Redis. Se descartó porque el PRD no exige persistencia y el filesystem local basta; el costo es que no escala a varias instancias (se fija 1).
6. **Conocimiento concatenado al system prompt, no como herramienta.** Alternativa: una sexta herramienta de consulta. Se descartó para mantener el contrato de cinco herramientas y porque el conocimiento es estable y corto.
7. **Soporte vencido: no se copia al paquete.** Alternativa: copiarlo marcado. Se descartó para evitar que un documento vencido llegue a firma; se lista en `checklist.md` para que la analista lo actualice.
8. **Envío simulado permitido aunque el paquete no esté listo, con advertencia.** Alternativa: bloquearlo. El PRD no lo prohíbe y la persona ya confirmó; `ENVIO-SIMULADO.md` registra el estado y los motivos en mayúsculas. En producción se bloquearía.
9. **OpenRouter como proveedor principal frente a la API directa de Anthropic.** OpenRouter simplifica el cambio de modelo y el manejo de una sola clave, a costa de una capa adicional y de conservar los bloques `reasoning_details` entre llamadas de herramientas. La API directa queda como adaptador alternativo y se puede activar con `LLM_PROVIDER=anthropic`.

## 7. Supuestos

- `pa-logistica-istmo` no trae plantilla: se usan seis campos estándar de portal (razón social, identificación tributaria, dirección, teléfono, correo y representante legal). No se agregan bancarios porque nadie los pidió.
- El campo «País» se llena con `pais` del maestro (`CO`), que es el país del proveedor, no el del cliente.
- «Ingresos anuales» se escribe como número (98.000.000.000) sin sufijo de moneda; el maestro guarda COP en un campo hermano.
- Un soporte con `vigencia_hasta: null` se considera vigente (sin vencimiento).
- `certificado_cumplimiento_tributario` no existe en el repositorio: siempre se reporta ausente.
- La fecha de vigencias es `FECHA_REFERENCIA` o la fecha real. El PRD exige determinismo en la demo; por eso la fecha es configurable y se imprime en el encabezado.
- La confirmación se detecta con una heurística de texto afirmativo. Es deliberadamente conservadora: ante la duda, no envía.
- Las etiquetas sin coincidencia exacta en el glosario se buscan con Levenshtein: ≥ 0.9 se acepta con confianza registrada; 0.75–0.9 pasa a `requiere_confirmacion`; por debajo es `faltante`.
- El contenido de `solicitud.cuerpo` es dato no confiable; no se interpreta como instrucciones.
- Los fixtures representan la variabilidad real; en producción habrá plantillas peores (celdas combinadas, PDF escaneado, portales con MFA).

## 8. Cobertura

| Historia / criterio | Estado | Evidencia |
|---|---|---|
| HU-1 · Leer solicitud, país, formato, campos y soportes | Hecho | `proveedor_leer_solicitud`; pruebas de los cuatro casos. |
| HU-1 · Campos ambiguos como `requiere_confirmacion` | Hecho | «Identificación tributaria», RUC, RTN; nota con equivalente por país. |
| HU-2 · Tres estados con ruta del dato | Hecho | `proveedor_mapear_campos`; `llenos[].ruta` y `mapeo.json`. |
| HU-2 · Nunca inventar valores | Hecho | Sin coincidencia → `faltante`; el modelo no aporta valores. |
| HU-2 · Sinónimos del glosario | Hecho | Normalización de tildes/mayúsculas y coincidencia aproximada. |
| HU-3 · P0 Excel en hoja/celda exactas | Hecho | `formulario.xlsx` validado con ExcelJS en pruebas. |
| HU-3 · P1 PDF en orden de plantilla | Hecho | `formulario.pdf` generado con pdfkit. |
| HU-3 · P2 Portal | Parcial (por alcance) | «Formato no soportado» + `valores-portal.md`; el llenado real no se implementa, como pide el PRD. |
| HU-4 · Paquete con formulario, soportes, checklist y borrador | Hecho | `out/<caso>/paquete/`; pruebas de copia y checklist. |
| HU-4 · Vencido/ausente bloquea `listo_para_firma` | Hecho | Casos `hn` (parafiscales vencido) y `ec` (soporte ausente). |
| HU-4 · Confirmación explícita antes del envío | Hecho | Loop + front; prueba de bloqueo y de envío confirmado. |
| HU-5 · Errores claros, sin trazas, proceso continúa | Hecho | Caso inexistente, plantilla corrupta, formato portal; todas las herramientas devuelven `{ ok:false }`. |
| CA1 · Tope de iteraciones | Hecho | Prueba con tope 3. |
| CA2 · Solo valores de herramientas | Hecho | Mapeo persistido; `generar_formulario` ignora valores del argumento. |
| CA3 · Confirmación humana | Hecho | `pendingConfirmation` + heurística + resaltado en el front. |
| CA4 · Tool calls visibles y log | Hecho | Tarjetas en el chat + `out/log.jsonl` y `out/<caso>/log.jsonl`. |
| CA5 · Error de proveedor no mata la sesión | Hecho | Prueba de error y de timeout. |
| `demo.ts` sin clave, determinista | Hecho | 4 casos; `out/` se limpia al inicio. |
| Módulo reutilizable (bonus) | Hecho | `modulo/` generado y validado con `check:modulo`. |
| Link público desplegado | Pendiente del candidato | Ver README (Render). Sin link hay −10. |

**Qué falta para producción**: lectura de adjuntos reales (PDF escaneado/OCR, Excel con celdas combinadas), integración con correo/SharePoint, firma electrónica, autenticación y multiusuario, persistencia durable y auditoría centralizada, un dueño del dato del maestro, monitoreo y pruebas de carga.

## 9. Uso de IA

El repositorio se construyó con asistencia de IA: **OpenCode** como entorno de agente y **DeepSeek V4.1 Flash** como modelo, a partir del `PRD.md` y de un plan de ejecución. La IA se usó para proponer la arquitectura, escribir el código base, los tests y esta documentación. El candidato debe revisar y poder explicar cada línea.

Completar antes de entregar:

- **Asistentes usados**: `<<COMPLETAR>>`
- **Para qué tareas**: `<<COMPLETAR>>`
- **Qué descarté de lo que propusieron y por qué**: `<<COMPLETAR>>`

## 10. Riesgos de producción y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El modelo «completa» un valor plausible | Las herramientas son la única fuente; el mapeo se recalcula y los faltantes no se rellenan nunca. Pruebas que verifican valores exactos. |
| Maestro desactualizado | Dueño del dato, fecha de actualización visible y validación contra `checklist.md`. |
| Soporte vencido llega a firma | El estado `vencido` bloquea `listo_para_firma` y no se copia al paquete. |
| Datos bancarios en canales indebidos | Se excluyen del borrador de correo (prueba automatizada) y no se piden si la plantilla no los exige. |
| Prompt injection desde el correo del cliente | El cuerpo se trata como dato; el prompt prohíbe obedecer instrucciones embebidas; las herramientas solo aceptan `caso` y etiquetas. |
| Costo descontrolado del modelo | Topes de iteraciones/tokens, timeout, rate limit y `ACCESS_KEY` para links públicos. |
| Portales con CAPTCHA/MFA o cambios de layout | Humano en el bucle; `valores-portal.md` como respaldo; selectores versionados. |
| Pérdida de archivos en el hosting gratuito | Disco efímero documentado; en producción, volumen persistente u object storage. |
| Fuga de la clave del modelo | Solo en variables de entorno del backend; nunca en front, logs, `out/` ni respuestas; `/api/health` no la expone. |
| Protección de datos personales | Fixtures ficticios; en producción, minimización, control de acceso y retención definida. |
| Dependencia de una sola instancia | Sesiones en archivo local; para escalar haría falta un store compartido. |
