import path from "node:path";
import os from "node:os";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import type { ToolContext } from "../src/tools/proveedor";

export const RAIZ = path.resolve(import.meta.dir, "..");

async function copiarDirectorio(origen: string, destino: string): Promise<void> {
  await mkdir(destino, { recursive: true });
  for (const entrada of await readdir(origen, { withFileTypes: true })) {
    const desde = path.join(origen, entrada.name);
    const hacia = path.join(destino, entrada.name);
    if (entrada.isDirectory()) await copiarDirectorio(desde, hacia);
    else await copyFile(desde, hacia);
  }
}

export async function crearEntorno(): Promise<string> {
  const directorio = await mkdtemp(path.join(os.tmpdir(), "reto01-"));
  await copiarDirectorio(
    path.join(RAIZ, "fixtures", "reto-01"),
    path.join(directorio, "fixtures", "reto-01"),
  );
  return directorio;
}

export async function limpiarEntorno(directorio: string): Promise<void> {
  await rm(directorio, { recursive: true, force: true });
}

export function contexto(directorio: string): ToolContext {
  return { directory: directorio, sessionId: "prueba" };
}

export type RespuestaHerramienta<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function parsear<T>(texto: string): RespuestaHerramienta<T> {
  return JSON.parse(texto) as RespuestaHerramienta<T>;
}

export function conFecha<T>(fn: () => Promise<T>): Promise<T> {
  const anterior = process.env.FECHA_REFERENCIA;
  process.env.FECHA_REFERENCIA = "2026-09-03";
  return fn().finally(() => {
    if (anterior === undefined) delete process.env.FECHA_REFERENCIA;
    else process.env.FECHA_REFERENCIA = anterior;
  });
}
