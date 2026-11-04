import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import {
  LlmError,
  esRegistro,
  type LlmAdapter,
  type LlmMessage,
  type LlmRequestOptions,
  type LlmResponse,
  type LlmToolCall,
  type LlmToolDef,
} from "./adapter";

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function convertirHerramientas(herramientas: LlmToolDef[]): Anthropic.Tool[] {
  return herramientas.map((herramienta) => {
    const propiedades = esRegistro(herramienta.inputSchema.properties)
      ? herramienta.inputSchema.properties
      : {};
    const requeridos = Array.isArray(herramienta.inputSchema.required)
      ? herramienta.inputSchema.required.filter(
          (valor): valor is string => typeof valor === "string",
        )
      : [];
    return {
      name: herramienta.name,
      description: herramienta.description,
      input_schema: {
        type: "object" as const,
        properties: propiedades,
        required: requeridos,
      },
    };
  });
}

function esResultadoError(contenido: string): boolean {
  try {
    const crudo: unknown = JSON.parse(contenido);
    return esRegistro(crudo) && crudo.ok === false;
  } catch {
    return false;
  }
}

/** Traduce nuestro historial al formato de la Messages API, agrupando tool_result. */
function convertirMensajes(mensajes: LlmMessage[]): Anthropic.MessageParam[] {
  const resultado: Anthropic.MessageParam[] = [];
  let indice = 0;

  while (indice < mensajes.length) {
    const mensaje = mensajes[indice];
    if (!mensaje) break;

    if (mensaje.role === "tool") {
      const bloques: Anthropic.ToolResultBlockParam[] = [];
      while (indice < mensajes.length && mensajes[indice]?.role === "tool") {
        const herramienta = mensajes[indice];
        if (herramienta && herramienta.role === "tool") {
          bloques.push({
            type: "tool_result",
            tool_use_id: herramienta.toolCallId,
            content: herramienta.content,
            is_error: esResultadoError(herramienta.content),
          });
        }
        indice += 1;
      }
      resultado.push({ role: "user", content: bloques });
      continue;
    }

    if (mensaje.role === "user") {
      resultado.push({ role: "user", content: mensaje.text });
      indice += 1;
      continue;
    }

    const bloques: Anthropic.ContentBlockParam[] = [];
    if (mensaje.text) bloques.push({ type: "text", text: mensaje.text });
    for (const llamada of mensaje.toolCalls ?? []) {
      bloques.push({
        type: "tool_use",
        id: llamada.id,
        name: llamada.name,
        input: esRegistro(llamada.args) ? llamada.args : {},
      });
    }
    if (bloques.length > 0) resultado.push({ role: "assistant", content: bloques });
    indice += 1;
  }

  return resultado;
}

function convertirRespuesta(respuesta: Anthropic.Message): LlmResponse {
  let texto = "";
  const toolCalls: LlmToolCall[] = [];

  for (const bloque of respuesta.content) {
    if (bloque.type === "text") {
      texto += bloque.text;
    } else if (bloque.type === "tool_use") {
      toolCalls.push({ id: bloque.id, name: bloque.name, args: bloque.input });
    }
  }

  return {
    text: texto.trim(),
    toolCalls,
    usage: {
      inputTokens: respuesta.usage.input_tokens,
      outputTokens: respuesta.usage.output_tokens,
    },
    stopReason: respuesta.stop_reason ?? "unknown",
  };
}

function mensajeDeError(error: unknown): { mensaje: string; reintentable: boolean } {
  if (error instanceof APIUserAbortError) {
    return { mensaje: "La llamada al proveedor fue cancelada por tiempo de espera.", reintentable: false };
  }
  if (error instanceof APIConnectionTimeoutError) {
    return { mensaje: "El proveedor del modelo tardó demasiado en responder.", reintentable: true };
  }
  if (error instanceof APIConnectionError) {
    return { mensaje: "No se pudo conectar con el proveedor del modelo.", reintentable: true };
  }
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403) {
      return {
        mensaje: "La clave del proveedor del modelo no es válida o no tiene permisos.",
        reintentable: false,
      };
    }
    if (error.status === 429) {
      return {
        mensaje: "El proveedor del modelo limitó las solicitudes. Intenta de nuevo en unos segundos.",
        reintentable: true,
      };
    }
    if (typeof error.status === "number" && error.status >= 500) {
      return {
        mensaje: "El proveedor del modelo tuvo un error temporal. Intenta de nuevo.",
        reintentable: true,
      };
    }
    return {
      mensaje: "El proveedor del modelo rechazó la solicitud. Revisa la configuración del modelo.",
      reintentable: false,
    };
  }
  return { mensaje: "No se pudo completar la llamada al proveedor del modelo.", reintentable: false };
}

export class AnthropicAdapter implements LlmAdapter {
  readonly provider = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(opciones: { apiKey: string; model: string; timeoutMs: number }) {
    this.model = opciones.model;
    this.client = new Anthropic({
      apiKey: opciones.apiKey,
      timeout: opciones.timeoutMs,
      maxRetries: 0,
    });
  }

  async enviar(
    mensajes: LlmMessage[],
    herramientas: LlmToolDef[],
    opciones: LlmRequestOptions,
  ): Promise<LlmResponse> {
    const solicitud: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: opciones.maxOutputTokens,
      system: opciones.system,
      messages: convertirMensajes(mensajes),
      tools: convertirHerramientas(herramientas),
    };

    let ultimoError: unknown = null;
    for (let intento = 0; intento < 2; intento += 1) {
      try {
        const respuesta = await this.client.messages.create(solicitud, {
          signal: opciones.signal,
        });
        return convertirRespuesta(respuesta);
      } catch (error) {
        ultimoError = error;
        const { mensaje, reintentable } = mensajeDeError(error);
        if (intento === 0 && reintentable) {
          await dormir(700);
          continue;
        }
        throw new LlmError(mensaje, reintentable);
      }
    }

    throw new LlmError(mensajeDeError(ultimoError).mensaje, false);
  }
}
