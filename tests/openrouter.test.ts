import { describe, expect, test } from "bun:test";
import { LlmError, type LlmMessage, type LlmToolDef } from "../src/llm/adapter";
import { OpenRouterAdapter } from "../src/llm/openrouter";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function respuesta(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "content-type": "application/json" },
  });
}

function adaptador(fetchImpl: FetchLike, timeoutMs = 1_000): OpenRouterAdapter {
  return new OpenRouterAdapter({
    apiKey: "sk-or-prueba",
    model: "anthropic/claude-sonnet-5.5",
    timeoutMs,
    fetchImpl,
    retryDelayMs: 0,
  });
}

const herramientas: LlmToolDef[] = [
  {
    name: "proveedor_leer_solicitud",
    description: "Lee la solicitud.",
    inputSchema: {
      type: "object",
      properties: { caso: { type: "string" } },
      required: ["caso"],
    },
  },
];

function leerCuerpo(init: RequestInit | undefined): Record<string, unknown> {
  const texto = String(init?.body ?? "{}");
  return JSON.parse(texto) as Record<string, unknown>;
}

describe("OpenRouterAdapter", () => {
  test("traduce mensajes y herramientas y parsea la respuesta con tool calls", async () => {
    let cuerpo: Record<string, unknown> = {};
    let cabeceras: HeadersInit | undefined;
    const fetchFalso: FetchLike = async (_entrada, init) => {
      cuerpo = leerCuerpo(init);
      cabeceras = init?.headers;
      return respuesta({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Voy a leer la solicitud.",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "proveedor_leer_solicitud",
                    arguments: '{"caso":"ec-corp-andina"}',
                  },
                },
              ],
              reasoning_details: [{ type: "reasoning.text", text: "pienso" }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      });
    };

    const resultado = await adaptador(fetchFalso).enviar(
      [{ role: "user", text: "procesa ec-corp-andina" }],
      herramientas,
      { system: "eres un agente", maxOutputTokens: 512 },
    );

    expect(resultado.text).toBe("Voy a leer la solicitud.");
    expect(resultado.toolCalls).toHaveLength(1);
    expect(resultado.toolCalls[0]?.name).toBe("proveedor_leer_solicitud");
    expect(resultado.toolCalls[0]?.args).toEqual({ caso: "ec-corp-andina" });
    expect(resultado.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(resultado.providerData).toEqual([{ type: "reasoning.text", text: "pienso" }]);

    expect(cuerpo.model).toBe("anthropic/claude-sonnet-5.5");
    expect(cuerpo.max_tokens).toBe(512);

    const mensajes = cuerpo.messages as Array<Record<string, unknown>>;
    expect(mensajes[0]?.role).toBe("system");
    expect(mensajes[0]?.content).toBe("eres un agente");
    expect(mensajes[1]?.role).toBe("user");

    const herramienta = (cuerpo.tools as Array<Record<string, unknown>>)[0];
    expect(herramienta?.type).toBe("function");

    const cabecerasTexto = JSON.stringify(cabeceras);
    expect(cabecerasTexto).toContain("sk-or-prueba");
  });

  test("conserva reasoning_details al devolver el historial", async () => {
    let cuerpo: Record<string, unknown> = {};
    const fetchFalso: FetchLike = async (_entrada, init) => {
      cuerpo = leerCuerpo(init);
      return respuesta({
        choices: [{ message: { role: "assistant", content: "listo" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    };

    const mensajes: LlmMessage[] = [
      { role: "user", text: "procesa" },
      {
        role: "assistant",
        text: "",
        toolCalls: [{ id: "call-1", name: "proveedor_leer_solicitud", args: { caso: "x" } }],
        providerData: [{ type: "reasoning.text", text: "razonamiento" }],
      },
      { role: "tool", toolCallId: "call-1", name: "proveedor_leer_solicitud", content: '{"ok":true}' },
    ];

    await adaptador(fetchFalso).enviar(mensajes, herramientas, {
      system: "sistema",
      maxOutputTokens: 128,
    });

    const enviados = cuerpo.messages as Array<Record<string, unknown>>;
    const asistente = enviados[2];
    expect(asistente?.role).toBe("assistant");
    expect(asistente?.reasoning_details).toEqual([
      { type: "reasoning.text", text: "razonamiento" },
    ]);
    const llamadas = asistente?.tool_calls as Array<Record<string, unknown>>;
    const funcion = llamadas[0]?.function as Record<string, unknown>;
    expect(funcion.arguments).toBe('{"caso":"x"}');

    const herramienta = enviados[3];
    expect(herramienta?.role).toBe("tool");
    expect(herramienta?.tool_call_id).toBe("call-1");
  });

  test("un 402 se reporta como falta de saldo y no se reintenta", async () => {
    let llamadas = 0;
    const fetchFalso: FetchLike = async () => {
      llamadas += 1;
      return respuesta({ error: { message: "Insufficient credits" } }, 402);
    };

    await expect(
      adaptador(fetchFalso).enviar([{ role: "user", text: "hola" }], herramientas, {
        system: "s",
        maxOutputTokens: 10,
      }),
    ).rejects.toThrow("saldo");
    expect(llamadas).toBe(1);
  });

  test("reintenta una vez ante un 500 y luego responde", async () => {
    let llamadas = 0;
    const fetchFalso: FetchLike = async () => {
      llamadas += 1;
      if (llamadas === 1) return respuesta({ error: { message: "caída" } }, 500);
      return respuesta({
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 2, completion_tokens: 2 },
      });
    };

    const resultado = await adaptador(fetchFalso).enviar(
      [{ role: "user", text: "hola" }],
      herramientas,
      { system: "s", maxOutputTokens: 10 },
    );

    expect(resultado.text).toBe("ok");
    expect(llamadas).toBe(2);
  });

  test("corta por timeout con un mensaje claro", async () => {
    const fetchLento: FetchLike = (_entrada, init) =>
      new Promise<Response>((_resolver, rechazar) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("abortado");
          error.name = "AbortError";
          rechazar(error);
        });
      });

    const promesa = adaptador(fetchLento, 30).enviar(
      [{ role: "user", text: "hola" }],
      herramientas,
      { system: "s", maxOutputTokens: 10 },
    );

    await expect(promesa).rejects.toBeInstanceOf(LlmError);
    await expect(promesa).rejects.toThrow("tardó demasiado");
  });

  test("una respuesta sin choices no rompe la sesión", async () => {
    const fetchFalso: FetchLike = async () => respuesta({ choices: [] });

    await expect(
      adaptador(fetchFalso).enviar([{ role: "user", text: "hola" }], herramientas, {
        system: "s",
        maxOutputTokens: 10,
      }),
    ).rejects.toThrow("sin contenido");
  });

  test("argumentos de herramienta inválidos no lanzan", async () => {
    const fetchFalso: FetchLike = async () =>
      respuesta({
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "proveedor_leer_solicitud", arguments: "{no-json" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

    const resultado = await adaptador(fetchFalso).enviar(
      [{ role: "user", text: "hola" }],
      herramientas,
      { system: "s", maxOutputTokens: 10 },
    );

    expect(resultado.toolCalls[0]?.args).toEqual({});
  });
});
