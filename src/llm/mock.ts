import { esRegistro, type LlmAdapter, type LlmRequestOptions, type LlmMessage, type LlmResponse, type LlmToolCall, type LlmToolDef } from "./adapter";
import { esMensajeAfirmativo } from "../agent/confirmacion";

export type MockResponder = (
  mensajes: LlmMessage[],
  herramientas: LlmToolDef[],
  opciones: LlmRequestOptions,
) => LlmResponse | Promise<LlmResponse>;

export class MockAdapter implements LlmAdapter {
  readonly provider = "mock";
  readonly model = "mock-script";

  constructor(private readonly responder: MockResponder) {}

  async enviar(
    mensajes: LlmMessage[],
    herramientas: LlmToolDef[],
    opciones: LlmRequestOptions,
  ): Promise<LlmResponse> {
    return this.responder(mensajes, herramientas, opciones);
  }
}

function ultimoMensajeUsuario(mensajes: LlmMessage[]): string {
  for (let i = mensajes.length - 1; i >= 0; i -= 1) {
    const mensaje = mensajes[i];
    if (mensaje?.role === "user") return mensaje.text;
  }
  return "";
}

function rondasDeHerramientas(mensajes: LlmMessage[]): number {
  return mensajes.filter((mensaje) => mensaje.role === "assistant" && (mensaje.toolCalls?.length ?? 0) > 0)
    .length;
}

function resultadosDe(mensajes: LlmMessage[], herramienta: string): Record<string, unknown>[] {
  return mensajes
    .filter((mensaje): mensaje is Extract<LlmMessage, { role: "tool" }> => mensaje.role === "tool")
    .filter((mensaje) => mensaje.name === herramienta)
    .map((mensaje) => {
      try {
        const crudo: unknown = JSON.parse(mensaje.content);
        return esRegistro(crudo) ? crudo : {};
      } catch {
        return {};
      }
    });
}

function esAfirmativo(texto: string): boolean {
  return esMensajeAfirmativo(texto);
}

function extraerCaso(texto: string, mensajes: LlmMessage[]): string {
  const coincidencia = texto.match(/\b([a-z]{2}-[a-z0-9-]{3,})\b/i);
  if (coincidencia?.[1]) return coincidencia[1].toLowerCase();

  const previos = mensajes
    .filter((mensaje): mensaje is Extract<LlmMessage, { role: "assistant" }> => mensaje.role === "assistant")
    .flatMap((mensaje) => mensaje.toolCalls ?? [])
    .map((llamada) => (esRegistro(llamada.args) && typeof llamada.args.caso === "string" ? llamada.args.caso : null))
    .filter((caso): caso is string => caso !== null);

  return previos[previos.length - 1] ?? "ec-corp-andina";
}

function respuestaLlamada(nombre: string, args: Record<string, unknown>, indice: number): LlmResponse {
  const llamada: LlmToolCall = { id: `mock-tool-${indice}`, name: nombre, args };
  return {
    text: "",
    toolCalls: [llamada],
    usage: { inputTokens: 0, outputTokens: 0 },
    stopReason: "tool_use",
  };
}

function respuestaTexto(texto: string): LlmResponse {
  return {
    text: texto,
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    stopReason: "end_turn",
  };
}

/**
 * Agente guion para probar el ciclo y el front sin clave de proveedor
 * (LLM_PROVIDER=mock). No se usa cuando LLM_PROVIDER=anthropic.
 */
export function crearMockPorDefecto(): LlmAdapter {
  return new MockAdapter((mensajes) => {
    const texto = ultimoMensajeUsuario(mensajes);
    const caso = extraerCaso(texto, mensajes);
    const rondas = rondasDeHerramientas(mensajes);
    const indice = mensajes.filter((mensaje) => mensaje.role === "tool").length + 1;

    if (rondas === 0) return respuestaLlamada("proveedor_leer_solicitud", { caso }, indice);
    if (rondas === 1) return respuestaLlamada("proveedor_mapear_campos", { caso, campos: [] }, indice);
    if (rondas === 2) return respuestaLlamada("proveedor_generar_formulario", { caso, mapeo: {} }, indice);
    if (rondas === 3) return respuestaLlamada("proveedor_armar_paquete", { caso }, indice);

    if (rondas === 4) {
      if (esAfirmativo(texto)) {
        return respuestaLlamada("proveedor_simular_envio", { caso, confirmado: true }, indice);
      }
      const paquete = resultadosDe(mensajes, "proveedor_armar_paquete").at(-1);
      const data = esRegistro(paquete?.data) ? paquete.data : {};
      const listo = data.listo_para_firma === true;
      return respuestaTexto(
        [
          `Procesé el caso ${caso} y armé el paquete.`,
          listo
            ? "El paquete quedó listo para firma."
            : "El paquete NO está listo para firma: revisa los soportes y faltantes en checklist.md.",
          "Puedes revisar el resumen en out/" + caso + "/paquete/checklist.md.",
          "¿Confirmas que prepare el envío simulado? No enviaré nada sin tu confirmación.",
        ].join("\n"),
      );
    }

    return respuestaTexto(
      `Envío simulado preparado para ${caso}. El archivo está en out/${caso}/ENVIO-SIMULADO.md. No se envió ningún correo real.`,
    );
  });
}
