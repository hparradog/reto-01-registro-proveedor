import {
  LlmError,
  esRegistro,
  type LlmAdapter,
  type LlmMessage,
  type LlmRequestOptions,
  type LlmResponse,
  type LlmToolCall,
  type LlmToolDef,
  type LlmUsage,
} from "./adapter";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  baseUrl?: string;
  appName?: string;
  appUrl?: string;
  fetchImpl?: FetchLike;
  retryDelayMs?: number;
}

interface LlamadaOpenRouter {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface MensajeOpenRouter {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: LlamadaOpenRouter[];
  tool_call_id?: string;
  reasoning_details?: unknown;
}

interface HerramientaOpenRouter {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface CuerpoOpenRouter {
  model: string;
  messages: MensajeOpenRouter[];
  tools: HerramientaOpenRouter[];
  max_tokens: number;
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textoDeContenido(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) {
    return valor
      .map((parte) => (esRegistro(parte) && typeof parte.text === "string" ? parte.text : ""))
      .join("");
  }
  return "";
}

function parsearLlamadas(valor: unknown): LlmToolCall[] {
  if (!Array.isArray(valor)) return [];
  const llamadas: LlmToolCall[] = [];
  for (const [indice, crudo] of valor.entries()) {
    if (!esRegistro(crudo)) continue;
    const funcion = esRegistro(crudo.function) ? crudo.function : null;
    if (!funcion || typeof funcion.name !== "string") continue;

    let args: unknown = {};
    if (esRegistro(funcion.arguments)) {
      args = funcion.arguments;
    } else if (typeof funcion.arguments === "string" && funcion.arguments.trim() !== "") {
      try {
        args = JSON.parse(funcion.arguments);
      } catch {
        args = {};
      }
    }

    llamadas.push({
      id: typeof crudo.id === "string" ? crudo.id : `openrouter-${indice + 1}`,
      name: funcion.name,
      args,
    });
  }
  return llamadas;
}

function parsearUso(valor: unknown): LlmUsage {
  if (!esRegistro(valor)) return { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: typeof valor.prompt_tokens === "number" ? valor.prompt_tokens : 0,
    outputTokens: typeof valor.completion_tokens === "number" ? valor.completion_tokens : 0,
  };
}

function convertirMensajes(mensajes: LlmMessage[], system: string): MensajeOpenRouter[] {
  const salida: MensajeOpenRouter[] = [{ role: "system", content: system }];

  for (const mensaje of mensajes) {
    if (mensaje.role === "user") {
      salida.push({ role: "user", content: mensaje.text });
      continue;
    }

    if (mensaje.role === "tool") {
      salida.push({
        role: "tool",
        tool_call_id: mensaje.toolCallId,
        content: mensaje.content,
      });
      continue;
    }

    const item: MensajeOpenRouter = {
      role: "assistant",
      content: mensaje.text === "" ? null : mensaje.text,
    };
    if (mensaje.toolCalls && mensaje.toolCalls.length > 0) {
      item.tool_calls = mensaje.toolCalls.map((llamada) => ({
        id: llamada.id,
        type: "function" as const,
        function: {
          name: llamada.name,
          arguments: JSON.stringify(esRegistro(llamada.args) ? llamada.args : {}),
        },
      }));
    }
    // Los proveedores de razonamiento (Claude) exigen devolver sus bloques
    // internos sin modificar para continuar el tool calling.
    if (mensaje.providerData !== undefined) {
      item.reasoning_details = mensaje.providerData;
    }
    salida.push(item);
  }

  return salida;
}

function convertirHerramientas(herramientas: LlmToolDef[]): HerramientaOpenRouter[] {
  return herramientas.map((herramienta) => ({
    type: "function" as const,
    function: {
      name: herramienta.name,
      description: herramienta.description,
      parameters: herramienta.inputSchema,
    },
  }));
}

function mensajeDelProveedor(cuerpo: unknown): string {
  if (esRegistro(cuerpo) && esRegistro(cuerpo.error) && typeof cuerpo.error.message === "string") {
    return cuerpo.error.message.slice(0, 300);
  }
  return "";
}

function clasificarError(estado: number, detalle: string): { mensaje: string; reintentable: boolean } {
  if (estado === 401 || estado === 403) {
    return {
      mensaje: "La clave de OpenRouter no es válida o no tiene permisos para este modelo.",
      reintentable: false,
    };
  }
  if (estado === 402) {
    return {
      mensaje: "OpenRouter no tiene saldo suficiente para este modelo. Carga crédito o cambia de modelo.",
      reintentable: false,
    };
  }
  if (estado === 404) {
    return {
      mensaje: "OpenRouter no encontró el modelo configurado. Revisa OPENROUTER_MODEL.",
      reintentable: false,
    };
  }
  if (estado === 429) {
    return {
      mensaje: "OpenRouter limitó las solicitudes. Intenta de nuevo en unos segundos.",
      reintentable: true,
    };
  }
  if (estado >= 500) {
    return {
      mensaje: "OpenRouter tuvo un error temporal. Intenta de nuevo.",
      reintentable: true,
    };
  }
  return {
    mensaje: detalle
      ? `OpenRouter rechazó la solicitud: ${detalle}`
      : "OpenRouter rechazó la solicitud. Revisa la configuración del modelo.",
    reintentable: false,
  };
}

export class OpenRouterAdapter implements LlmAdapter {
  readonly provider = "openrouter";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly appName: string;
  private readonly appUrl: string | null;
  private readonly fetchImpl: FetchLike;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;

  constructor(opciones: OpenRouterOptions) {
    this.model = opciones.model;
    this.apiKey = opciones.apiKey;
    this.baseUrl = (opciones.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
    this.appName = opciones.appName ?? "Registro de proveedores - Periferia IT Group";
    this.appUrl = opciones.appUrl ?? null;
    this.timeoutMs = opciones.timeoutMs;
    this.retryDelayMs = opciones.retryDelayMs ?? 700;
    this.fetchImpl = opciones.fetchImpl ?? fetch;
  }

  private cabeceras(): Record<string, string> {
    const cabeceras: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "X-Title": this.appName,
    };
    if (this.appUrl) cabeceras["HTTP-Referer"] = this.appUrl;
    return cabeceras;
  }

  private async solicitar(cuerpo: CuerpoOpenRouter, signalExterno?: AbortSignal): Promise<Response> {
    const controlador = new AbortController();
    const alAbortar = () => controlador.abort();
    if (signalExterno) {
      if (signalExterno.aborted) controlador.abort();
      else signalExterno.addEventListener("abort", alAbortar, { once: true });
    }
    const temporizador = setTimeout(() => controlador.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.cabeceras(),
        body: JSON.stringify(cuerpo),
        signal: controlador.signal,
      });
    } finally {
      clearTimeout(temporizador);
      signalExterno?.removeEventListener("abort", alAbortar);
    }
  }

  async enviar(
    mensajes: LlmMessage[],
    herramientas: LlmToolDef[],
    opciones: LlmRequestOptions,
  ): Promise<LlmResponse> {
    const cuerpo: CuerpoOpenRouter = {
      model: this.model,
      messages: convertirMensajes(mensajes, opciones.system),
      tools: convertirHerramientas(herramientas),
      max_tokens: opciones.maxOutputTokens,
    };

    for (let intento = 0; intento < 2; intento += 1) {
      let respuesta: Response;
      try {
        respuesta = await this.solicitar(cuerpo, opciones.signal);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          if (opciones.signal?.aborted) {
            throw new LlmError("La llamada al proveedor fue cancelada.", false);
          }
          throw new LlmError("OpenRouter tardó demasiado en responder.", true);
        }
        if (intento === 0) {
          await dormir(this.retryDelayMs);
          continue;
        }
        throw new LlmError("No se pudo conectar con OpenRouter.", true);
      }

      let crudo: unknown = null;
      try {
        crudo = await respuesta.json();
      } catch {
        crudo = null;
      }

      if (!respuesta.ok) {
        const { mensaje, reintentable } = clasificarError(
          respuesta.status,
          mensajeDelProveedor(crudo),
        );
        if (intento === 0 && reintentable) {
          await dormir(this.retryDelayMs);
          continue;
        }
        throw new LlmError(mensaje, reintentable);
      }

      if (!esRegistro(crudo) || !Array.isArray(crudo.choices) || crudo.choices.length === 0) {
        throw new LlmError("OpenRouter devolvió una respuesta sin contenido.", false);
      }

      const eleccion = crudo.choices[0];
      if (!esRegistro(eleccion) || !esRegistro(eleccion.message)) {
        throw new LlmError("OpenRouter devolvió una respuesta con formato inesperado.", false);
      }

      const mensaje = eleccion.message;
      const resultado: LlmResponse = {
        text: textoDeContenido(mensaje.content).trim(),
        toolCalls: parsearLlamadas(mensaje.tool_calls),
        usage: parsearUso(crudo.usage),
        stopReason: typeof eleccion.finish_reason === "string" ? eleccion.finish_reason : "unknown",
      };

      if (mensaje.reasoning_details !== undefined && mensaje.reasoning_details !== null) {
        resultado.providerData = mensaje.reasoning_details;
      }

      return resultado;
    }

    throw new LlmError("No se pudo completar la llamada a OpenRouter.", false);
  }
}
