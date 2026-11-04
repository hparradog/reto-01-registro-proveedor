import path from "node:path";
import { appendFile } from "node:fs/promises";
import { asegurarDir, outCaso, outRoot, validarNombreCaso } from "./paths";

export interface EntradaLog {
  herramienta: string;
  ok: boolean;
  resumen: string;
}

export interface EntradaLogGlobal extends EntradaLog {
  sessionId: string;
  args?: unknown;
}

async function anexar(ruta: string, linea: Record<string, unknown>): Promise<void> {
  await asegurarDir(path.dirname(ruta));
  await appendFile(ruta, `${JSON.stringify(linea)}\n`, "utf8");
}

/** RN5: toda ejecución deja registro en out/<caso>/log.jsonl. */
export async function registrarLogCaso(
  directory: string,
  caso: string,
  entrada: EntradaLog,
): Promise<void> {
  const nombre = validarNombreCaso(caso);
  const ruta = path.join(outCaso(directory, nombre), "log.jsonl");
  await anexar(ruta, { ts: new Date().toISOString(), ...entrada });
}

/** CA4: historial global de llamadas del agente en out/log.jsonl. */
export async function registrarLogGlobal(
  directory: string,
  entrada: EntradaLogGlobal,
): Promise<void> {
  await anexar(path.join(outRoot(directory), "log.jsonl"), {
    ts: new Date().toISOString(),
    ...entrada,
  });
}
