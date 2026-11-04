import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { ejecutarTurno, type LoopDeps } from "../src/agent/loop";
import { definicionesParaModelo, listarHerramientas, NOMBRES_REQUERIDOS } from "../src/agent/registry";
import { SessionStore } from "../src/agent/session";
import { LlmError, type LlmAdapter, type LlmResponse, type LlmToolCall } from "../src/llm/adapter";
import { crearMockPorDefecto, MockAdapter } from "../src/llm/mock";
import { crearEntorno, limpiarEntorno, conFecha } from "./helpers";

let directorio = "";

beforeEach(async () => {
  directorio = await crearEntorno();
});

afterEach(async () => {
  await limpiarEntorno(directorio);
});

function construirDeps(
  adapter: LlmAdapter,
  opciones: { maxIteraciones?: number; tokenLimit?: number; maxMessageChars?: number; timeoutMs?: number } = {},
): LoopDeps {
  return {
    adapter,
    herramientas: listarHerramientas(),
    definiciones: definicionesParaModelo(),
    systemPrompt: "Prompt de prueba",
    sesiones: new SessionStore(directorio),
    directory: directorio,
    limites: {
      maxIteraciones: opciones.maxIteraciones ?? 25,
      tokenLimit: opciones.tokenLimit ?? 200_000,
      maxMessageChars: opciones.maxMessageChars ?? 4_000,
    },
    timeoutMs: opciones.timeoutMs ?? 5_000,
    maxOutputTokens: 1_024,
  };
}

function respuestaHerramienta(nombre: string, args: Record<string, unknown>, indice = 1): LlmResponse {
  const llamada: LlmToolCall = { id: `test-${indice}`, name: nombre, args };
  return {
    text: "",
    toolCalls: [llamada],
    usage: { inputTokens: 1, outputTokens: 1 },
    stopReason: "tool_use",
  };
}

function respuestaTexto(texto: string, tokens = 1): LlmResponse {
  return {
    text: texto,
    toolCalls: [],
    usage: { inputTokens: tokens, outputTokens: tokens },
    stopReason: "end_turn",
  };
}

describe("registro de herramientas", () => {
  test("expone exactamente los nombres del contrato", () => {
    const nombres = listarHerramientas()
      .map((herramienta) => herramienta.name)
      .sort();
    expect(nombres).toEqual([...NOMBRES_REQUERIDOS].sort());
  });

  test("las definiciones tienen JSON schema de tipo object", () => {
    const definiciones = definicionesParaModelo();
    for (const definicion of definiciones) {
      expect(definicion.inputSchema.type).toBe("object");
      expect(typeof definicion.description).toBe("string");
    }
  });
});

describe("ciclo del agente", () => {
  test("flujo completo: arma el paquete y solo envía tras confirmación", async () => {
    await conFecha(async () => {
      const adapter = crearMockPorDefecto();
      const deps = construirDeps(adapter);
      const id = "sesion-flujo";

      const turno1 = await ejecutarTurno(
        deps,
        id,
        "Procesa el caso ec-corp-andina. No envíes nada todavía.",
      );
      expect(turno1.needsConfirmation).toBe(true);
      expect(turno1.toolCalls.map((llamada) => llamada.name)).toContain(
        "proveedor_armar_paquete",
      );
      expect(turno1.reply).toContain("?");
      expect(existsSync(path.join(directorio, "out", "ec-corp-andina", "ENVIO-SIMULADO.md"))).toBe(
        false,
      );

      const turno2 = await ejecutarTurno(deps, id, "Sí, confirma el envío.");
      const envio = turno2.toolCalls.find(
        (llamada) => llamada.name === "proveedor_simular_envio",
      );
      expect(envio?.ok).toBe(true);
      expect(turno2.needsConfirmation).toBe(false);
      expect(existsSync(path.join(directorio, "out", "ec-corp-andina", "ENVIO-SIMULADO.md"))).toBe(
        true,
      );
    });
  });

  test("bloquea simular_envio sin una confirmación previa", async () => {
    const adapter = new MockAdapter((_mensajes, _herramientas, _opciones) =>
      respuestaHerramienta("proveedor_simular_envio", {
        caso: "co-industrias-delta",
        confirmado: true,
      }),
    );
    const deps = construirDeps(adapter, { maxIteraciones: 2 });

    const turno = await ejecutarTurno(deps, "sesion-bloqueo", "envía ya");

    expect(turno.toolCalls.length).toBeGreaterThan(0);
    for (const llamada of turno.toolCalls) {
      expect(llamada.ok).toBe(false);
      expect(llamada.resumen).toContain("requiere confirmación explícita");
    }
    expect(turno.needsConfirmation).toBe(true);
    expect(
      existsSync(path.join(directorio, "out", "co-industrias-delta", "ENVIO-SIMULADO.md")),
    ).toBe(false);
  });

  test("al alcanzar el tope de iteraciones responde con lo que tiene", async () => {
    const adapter = new MockAdapter(() =>
      respuestaHerramienta("proveedor_leer_solicitud", { caso: "co-industrias-delta" }),
    );
    const deps = construirDeps(adapter, { maxIteraciones: 3 });

    const turno = await ejecutarTurno(deps, "sesion-tope", "procesa co-industrias-delta");

    expect(turno.reply).toContain("límite de 3 iteraciones");
    expect(turno.toolCalls).toHaveLength(3);
  });

  test("un error del proveedor no mata la sesión", async () => {
    const adapter = new MockAdapter(() => {
      throw new LlmError("fallo simulado del proveedor", false);
    });
    const deps = construirDeps(adapter);

    const turno = await ejecutarTurno(deps, "sesion-error", "hola");
    expect(turno.reply).toContain("No pude consultar el modelo");
    expect(turno.error).toContain("fallo simulado");

    const sesion = await deps.sesiones.obtener("sesion-error");
    expect(sesion.mensajes.length).toBeGreaterThanOrEqual(2);

    const segunda = await ejecutarTurno(deps, "sesion-error", "otra vez");
    expect(segunda.reply).toContain("No pude consultar el modelo");
  });

  test("un proveedor que no responde se corta por timeout", async () => {
    const adapter = new MockAdapter(
      () => new Promise<LlmResponse>(() => undefined),
    );
    const deps = construirDeps(adapter, { timeoutMs: 60 });

    const turno = await ejecutarTurno(deps, "sesion-timeout", "hola");
    expect(turno.reply).toContain("tardó demasiado");
    expect(turno.reply).toContain("sesión sigue activa");
  });

  test("corta el turno al superar el límite de tokens", async () => {
    const adapter = new MockAdapter(() => ({
      ...respuestaHerramienta("proveedor_leer_solicitud", { caso: "co-industrias-delta" }),
      usage: { inputTokens: 100, outputTokens: 100 },
    }));
    const deps = construirDeps(adapter, { tokenLimit: 10 });

    const turno = await ejecutarTurno(deps, "sesion-tokens", "procesa co-industrias-delta");
    expect(turno.reply).toContain("límite de tokens");
    expect(turno.toolCalls).toHaveLength(1);
  });

  test("rechaza mensajes demasiado largos sin llamar al modelo", async () => {
    let llamado = false;
    const adapter = new MockAdapter(() => {
      llamado = true;
      return respuestaTexto("no debería llegar aquí");
    });
    const deps = construirDeps(adapter, { maxMessageChars: 20 });

    const turno = await ejecutarTurno(deps, "sesion-larga", "x".repeat(100));
    expect(turno.reply).toContain("supera el máximo");
    expect(llamado).toBe(false);
  });

  test("persiste el historial y las llamadas a herramientas", async () => {
    await conFecha(async () => {
      const deps = construirDeps(crearMockPorDefecto());
      await ejecutarTurno(deps, "sesion-persistida", "procesa co-industrias-delta");

      const nuevoStore = new SessionStore(directorio);
      const sesion = await nuevoStore.obtener("sesion-persistida");
      expect(sesion.mensajes.length).toBeGreaterThan(0);
      expect(sesion.toolCalls.length).toBeGreaterThan(0);
      expect(sesion.pendingConfirmation?.caso).toBe("co-industrias-delta");
    });
  });

  test("rechaza un sessionId inválido", async () => {
    const deps = construirDeps(crearMockPorDefecto());
    await expect(ejecutarTurno(deps, "../invalido", "hola")).rejects.toThrow("sessionId inválido");
  });
});
