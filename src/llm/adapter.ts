export interface LlmToolCall {
  id: string;
  name: string;
  args: unknown;
}

export type LlmMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls?: LlmToolCall[]; providerData?: unknown }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface LlmToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
  stopReason: string;
  /** Datos opacos del proveedor (p. ej. reasoning_details) que deben devolverse en el siguiente turno. */
  providerData?: unknown;
}

export interface LlmRequestOptions {
  system: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

/**
 * Interfaz propia del proveedor. Cambiar de proveedor no debe tocar el ciclo
 * del agente: solo se añade otra implementación de este contrato.
 */
export interface LlmAdapter {
  readonly provider: string;
  readonly model: string;
  enviar(
    mensajes: LlmMessage[],
    herramientas: LlmToolDef[],
    opciones: LlmRequestOptions,
  ): Promise<LlmResponse>;
}

export class LlmError extends Error {
  readonly reintentable: boolean;

  constructor(message: string, reintentable = false) {
    super(message);
    this.name = "LlmError";
    this.reintentable = reintentable;
  }
}

export function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}
