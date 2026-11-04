import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { LlmMessage } from "../llm/adapter";
import { asegurarDir, outRoot } from "../tools/_lib/paths";

export interface ConfirmacionPendiente {
  caso: string;
  accion: "envio";
}

export interface ToolCallRegistrado {
  id: string;
  name: string;
  args: unknown;
  ok: boolean;
  resumen: string;
  resultado: string;
}

export interface Sesion {
  id: string;
  mensajes: LlmMessage[];
  toolCalls: ToolCallRegistrado[];
  tokensUsados: number;
  pendingConfirmation: ConfirmacionPendiente | null;
  creada: string;
  actualizada: string;
}

const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

const ConfirmacionSchema = z.object({
  caso: z.string(),
  accion: z.literal("envio"),
});

const SesionSchema = z.object({
  id: z.string(),
  mensajes: z.array(z.unknown()),
  toolCalls: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      args: z.unknown(),
      ok: z.boolean(),
      resumen: z.string(),
      resultado: z.string(),
    }),
  ),
  tokensUsados: z.number(),
  pendingConfirmation: ConfirmacionSchema.nullable(),
  creada: z.string(),
  actualizada: z.string(),
});

export function validarSessionId(valor: string): string {
  if (!ID_VALIDO.test(valor)) {
    throw new Error(
      "sessionId inválido: usa entre 1 y 64 caracteres alfanuméricos, guion o guion bajo.",
    );
  }
  return valor;
}

function sesionVacia(id: string): Sesion {
  const ahora = new Date().toISOString();
  return {
    id,
    mensajes: [],
    toolCalls: [],
    tokensUsados: 0,
    pendingConfirmation: null,
    creada: ahora,
    actualizada: ahora,
  };
}

export class SessionStore {
  private readonly cache = new Map<string, Sesion>();

  constructor(private readonly directory: string) {}

  private ruta(id: string): string {
    return path.join(outRoot(this.directory), "sessions", `${id}.json`);
  }

  async obtener(id: string): Promise<Sesion> {
    validarSessionId(id);
    const enMemoria = this.cache.get(id);
    if (enMemoria) return enMemoria;

    try {
      const texto = await readFile(this.ruta(id), "utf8");
      const resultado = SesionSchema.safeParse(JSON.parse(texto));
      if (resultado.success) {
        const sesion = resultado.data as unknown as Sesion;
        this.cache.set(id, sesion);
        return sesion;
      }
    } catch {
      // Sesión nueva o archivo ilegible: se empieza de cero.
    }

    const nueva = sesionVacia(id);
    this.cache.set(id, nueva);
    return nueva;
  }

  async guardar(sesion: Sesion): Promise<void> {
    sesion.actualizada = new Date().toISOString();
    this.cache.set(sesion.id, sesion);
    await asegurarDir(path.dirname(this.ruta(sesion.id)));
    await writeFile(this.ruta(sesion.id), `${JSON.stringify(sesion, null, 2)}\n`, "utf8");
  }

  async existe(id: string): Promise<boolean> {
    validarSessionId(id);
    if (this.cache.has(id)) return true;
    try {
      await readFile(this.ruta(id), "utf8");
      return true;
    } catch {
      return false;
    }
  }
}
