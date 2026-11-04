import { esRegistro, type LlmAdapter, type LlmResponse, type LlmToolDef } from "../llm/adapter";
import { mensajeClaro } from "../tools/_lib/result";
import { registrarLogGlobal } from "../tools/_lib/log";
import type { HerramientaRegistrada } from "./registry";
import type { SessionStore, ToolCallRegistrado } from "./session";
import { esMensajeAfirmativo } from "./confirmacion";

export interface LimitesAgente {
  maxIteraciones: number;
  tokenLimit: number;
  maxMessageChars: number;
}

export interface LoopDeps {
  adapter: LlmAdapter;
  herramientas: HerramientaRegistrada[];
  definiciones: LlmToolDef[];
  systemPrompt: string;
  sesiones: SessionStore;
  directory: string;
  limites: LimitesAgente;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface ToolCallVista {
  id: string;
  name: string;
  args: unknown;
  ok: boolean;
  resumen: string;
  resultado: string;
}

export interface TurnResult {
  sessionId: string;
  reply: string;
  toolCalls: ToolCallVista[];
  needsConfirmation: boolean;
  error?: string;
}

const HERRAMIENTA_ENVIO = "proveedor_simular_envio";
const HERRAMIENTA_PAQUETE = "proveedor_armar_paquete";
const RECORTE_RESUMEN = 400;
const RECORTE_RESULTADO = 4_000;

function casoDeArgs(args: unknown): string | null {
  if (esRegistro(args) && typeof args.caso === "string") return args.caso;
  return null;
}

function recortar(texto: string, maximo: number): string {
  return texto.length <= maximo ? texto : `${texto.slice(0, maximo)}…`;
}

/**
 * El log global no necesita los argumentos completos. Se guarda solo lo
 * imprescindible para auditar (caso, confirmación y tamaños), de modo que
 * valores del maestro —incluidos los bancarios— no lleguen al archivo.
 */
function resumenArgs(args: unknown): unknown {
  if (!esRegistro(args)) return undefined;
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(args)) {
    if (/^caso$/i.test(clave) || /^confirmado$/i.test(clave)) {
      salida[clave] = valor;
    } else if (Array.isArray(valor)) {
      salida[clave] = `[${valor.length} elementos]`;
    } else if (esRegistro(valor)) {
      salida[clave] = "[objeto]";
    } else if (typeof valor === "string") {
      salida[clave] = recortar(valor, 80);
    } else {
      salida[clave] = valor;
    }
  }
  return salida;
}

function analizarResultado(contenido: string): { ok: boolean; resumen: string } {
  try {
    const crudo: unknown = JSON.parse(contenido);
    if (esRegistro(crudo)) {
      if (crudo.ok === true) {
        return { ok: true, resumen: resumirData(crudo.data) };
      }
      return { ok: false, resumen: typeof crudo.error === "string" ? crudo.error : "Error." };
    }
  } catch {
    // respuesta no JSON
  }
  return { ok: false, resumen: "La herramienta devolvió una respuesta ilegible." };
}

function resumirData(data: unknown): string {
  if (!esRegistro(data)) return recortar(JSON.stringify(data), RECORTE_RESUMEN);

  if ("llenos" in data && "faltantes" in data && "requiere_confirmacion" in data) {
    const llenos = Array.isArray(data.llenos) ? data.llenos.length : 0;
    const faltantes = Array.isArray(data.faltantes) ? data.faltantes.length : 0;
    const confirmar = Array.isArray(data.requiere_confirmacion)
      ? data.requiere_confirmacion.length
      : 0;
    return `llenos=${llenos}, faltantes=${faltantes}, requiere_confirmacion=${confirmar}`;
  }

  if ("listo_para_firma" in data) {
    const checklist = esRegistro(data.checklist) ? data.checklist : {};
    const ausentes = Array.isArray(checklist.ausentes) ? checklist.ausentes.length : 0;
    const vencidos = Array.isArray(checklist.vencidos) ? checklist.vencidos.length : 0;
    return `listo_para_firma=${String(data.listo_para_firma)}, ausentes=${ausentes}, vencidos=${vencidos}`;
  }

  if (typeof data.ruta === "string") {
    const detalles: string[] = [`ruta=${data.ruta}`];
    if (typeof data.formato === "string") detalles.push(`formato=${data.formato}`);
    if (typeof data.mensaje === "string") detalles.push(data.mensaje);
    return recortar(detalles.join(", "), RECORTE_RESUMEN);
  }

  if (Array.isArray(data.campos) && Array.isArray(data.soportes)) {
    return `${data.campos.length} campos, ${data.soportes.length} soportes, formato ${String(data.formato)}`;
  }

  return recortar(JSON.stringify(data), RECORTE_RESUMEN);
}

async function conTiempo<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controlador = new AbortController();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const vencimiento = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      controlador.abort();
      rechazar(new Error("El proveedor del modelo tardó demasiado en responder."));
    }, ms);
  });
  try {
    return await Promise.race([fn(controlador.signal), vencimiento]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

function resumenPorLimite(vistas: ToolCallVista[], maxIteraciones: number): string {
  const lineas = [
    `Alcancé el límite de ${maxIteraciones} iteraciones de herramientas en este turno.`,
    "Esto es lo que tengo hasta ahora:",
  ];
  for (const vista of vistas) {
    lineas.push(`- ${vista.name}: ${vista.ok ? "ok" : "error"} — ${vista.resumen}`);
  }
  lineas.push("Puedes pedirme que continúe o revisar los archivos en out/.");
  return lineas.join("\n");
}

export async function ejecutarTurno(
  deps: LoopDeps,
  sessionId: string,
  mensaje: string,
): Promise<TurnResult> {
  const sesion = await deps.sesiones.obtener(sessionId);
  const afirmativo = esMensajeAfirmativo(mensaje);

  if (mensaje.length > deps.limites.maxMessageChars) {
    return {
      sessionId,
      reply: `El mensaje supera el máximo de ${deps.limites.maxMessageChars} caracteres. Acórtalo un poco.`,
      toolCalls: [],
      needsConfirmation: sesion.pendingConfirmation !== null,
    };
  }

  if (!afirmativo) {
    sesion.pendingConfirmation = null;
  }

  // Solo vale la confirmación que existía al empezar el turno: una acción no
  // puede autorizarse a sí misma dentro del mismo turno en que se propone.
  const confirmacionAlInicio = afirmativo ? sesion.pendingConfirmation : null;

  sesion.mensajes.push({ role: "user", text: mensaje });

  if (sesion.tokensUsados >= deps.limites.tokenLimit) {
    const reply =
      "Esta sesión alcanzó el límite de tokens configurado. Abre una sesión nueva para continuar.";
    sesion.mensajes.push({ role: "assistant", text: reply });
    await deps.sesiones.guardar(sesion);
    return { sessionId, reply, toolCalls: [], needsConfirmation: false };
  }

  const vistas: ToolCallVista[] = [];
  let final: string | null = null;
  let error: string | undefined;
  let envioBloqueado = false;

  for (let iteracion = 0; iteracion < deps.limites.maxIteraciones && final === null; iteracion += 1) {
    let respuesta: LlmResponse;
    try {
      respuesta = await conTiempo(
        (signal) =>
          deps.adapter.enviar(sesion.mensajes, deps.definiciones, {
            system: deps.systemPrompt,
            maxOutputTokens: deps.maxOutputTokens,
            signal,
          }),
        deps.timeoutMs,
      );
    } catch (fallo) {
      error = mensajeClaro(fallo);
      const detalle = error.endsWith(".") ? error.slice(0, -1) : error;
      final = `No pude consultar el modelo: ${detalle}. La sesión sigue activa; puedes reintentar.`;
      sesion.mensajes.push({ role: "assistant", text: final });
      break;
    }

    sesion.tokensUsados += respuesta.usage.inputTokens + respuesta.usage.outputTokens;

    if (respuesta.toolCalls.length === 0) {
      final = respuesta.text || "(El modelo no devolvió texto en este turno.)";
      sesion.mensajes.push({ role: "assistant", text: respuesta.text });
      break;
    }

    sesion.mensajes.push({
      role: "assistant",
      text: respuesta.text,
      toolCalls: respuesta.toolCalls,
      ...(respuesta.providerData !== undefined ? { providerData: respuesta.providerData } : {}),
    });

    for (const llamada of respuesta.toolCalls) {
      const herramienta = deps.herramientas.find((item) => item.name === llamada.name);
      let contenido: string;
      const caso = casoDeArgs(llamada.args);

      const confirmacionValida =
        confirmacionAlInicio !== null &&
        caso !== null &&
        confirmacionAlInicio.caso === caso;

      if (!herramienta) {
        contenido = JSON.stringify({ ok: false, error: `Herramienta desconocida: ${llamada.name}` });
      } else if (llamada.name === HERRAMIENTA_ENVIO && !confirmacionValida) {
        envioBloqueado = true;
        contenido = JSON.stringify({
          ok: false,
          error:
            "requiere confirmación explícita: pide al usuario que confirme el envío en el turno inmediatamente anterior.",
        });
      } else {
        contenido = await herramienta.execute(llamada.args, {
          directory: deps.directory,
          sessionId,
        });
      }

      const { ok, resumen } = analizarResultado(contenido);

      if (ok && llamada.name === HERRAMIENTA_PAQUETE && caso !== null) {
        sesion.pendingConfirmation = { caso, accion: "envio" };
      }
      if (ok && llamada.name === HERRAMIENTA_ENVIO) {
        sesion.pendingConfirmation = null;
      }

      const registro: ToolCallRegistrado = {
        id: llamada.id,
        name: llamada.name,
        args: llamada.args,
        ok,
        resumen,
        resultado: recortar(contenido, RECORTE_RESULTADO),
      };
      sesion.toolCalls.push(registro);
      vistas.push({
        id: registro.id,
        name: registro.name,
        args: registro.args,
        ok: registro.ok,
        resumen: registro.resumen,
        resultado: registro.resultado,
      });

      await registrarLogGlobal(deps.directory, {
        sessionId,
        herramienta: llamada.name,
        args: resumenArgs(llamada.args),
        ok,
        resumen,
      }).catch(() => undefined);

      sesion.mensajes.push({
        role: "tool",
        toolCallId: llamada.id,
        name: llamada.name,
        content: contenido,
      });
    }

    if (sesion.tokensUsados >= deps.limites.tokenLimit) {
      final = `Se alcanzó el límite de tokens de la sesión (${deps.limites.tokenLimit}). Responde con lo que tengas o abre una sesión nueva.`;
      sesion.mensajes.push({ role: "assistant", text: final });
    }
  }

  if (final === null) {
    final = resumenPorLimite(vistas, deps.limites.maxIteraciones);
    sesion.mensajes.push({ role: "assistant", text: final });
  }

  const resultado: TurnResult = {
    sessionId,
    reply: final,
    toolCalls: vistas,
    needsConfirmation: sesion.pendingConfirmation !== null || envioBloqueado,
  };
  if (error) resultado.error = error;

  await deps.sesiones.guardar(sesion);
  return resultado;
}
