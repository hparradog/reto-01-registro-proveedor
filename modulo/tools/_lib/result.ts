import { ZodError } from "zod";
import { ToolError } from "./errors";

export type ToolOk<T> = { ok: true; data: T };
export type ToolErr = { ok: false; error: string };
export type ToolResult<T> = ToolOk<T> | ToolErr;

export function ok<T>(data: T): ToolOk<T> {
  return { ok: true, data };
}

export function err(error: string): ToolErr {
  return { ok: false, error };
}

/** Convierte cualquier error en un mensaje claro, sin trazas ni detalles internos. */
export function mensajeClaro(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  if (error instanceof ZodError) {
    const detalles = error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
      .join("; ");
    return `Datos con formato inesperado: ${detalles}`;
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") return "La operación superó el tiempo máximo de espera.";
    return error.message || "Error inesperado durante la operación.";
  }
  return "Error inesperado durante la operación.";
}

/** Ejecuta una herramienta garantizando que nunca lanza: siempre devuelve JSON string. */
export async function ejecutarSeguro<T>(fn: () => Promise<T>): Promise<string> {
  try {
    return JSON.stringify(ok(await fn()));
  } catch (error) {
    return JSON.stringify(err(mensajeClaro(error)));
  }
}
