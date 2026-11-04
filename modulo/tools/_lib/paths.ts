import path from "node:path";
import { access, mkdir } from "node:fs/promises";
import { ToolError } from "./errors";

const CASO_VALIDO = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export function fixtureRoot(directory: string): string {
  return path.join(directory, "fixtures", "reto-01");
}

export function casosRoot(directory: string): string {
  return path.join(fixtureRoot(directory), "casos");
}

export function repositorioRoot(directory: string): string {
  return path.join(fixtureRoot(directory), "repositorio");
}

export function outRoot(directory: string): string {
  return path.join(directory, "out");
}

export function outCaso(directory: string, caso: string): string {
  return path.join(outRoot(directory), caso);
}

export function validarNombreCaso(caso: string): string {
  const limpio = caso.trim();
  if (!CASO_VALIDO.test(limpio)) {
    throw new ToolError(
      `Nombre de caso inválido: "${caso}". Usa el nombre de la carpeta en fixtures/reto-01/casos/.`,
    );
  }
  return limpio;
}

/** Resuelve la carpeta del caso y verifica que exista dentro de fixtures (anti path traversal). */
export async function resolverCaso(directory: string, caso: string): Promise<string> {
  const nombre = validarNombreCaso(caso);
  const raiz = path.resolve(casosRoot(directory));
  const destino = path.resolve(raiz, nombre);
  if (destino !== path.join(raiz, nombre) || !destino.startsWith(raiz + path.sep)) {
    throw new ToolError(`Ruta de caso fuera del directorio permitido: "${caso}".`);
  }
  try {
    await access(path.join(destino, "solicitud.json"));
  } catch {
    throw new ToolError(
      `El caso "${nombre}" no existe o no tiene solicitud.json en fixtures/reto-01/casos/.`,
    );
  }
  return destino;
}

export async function asegurarDir(ruta: string): Promise<void> {
  await mkdir(ruta, { recursive: true });
}

/** Verifica que una ruta absoluta esté contenida en otra (para servir archivos). */
export function estaContenida(base: string, destino: string): boolean {
  const baseAbs = path.resolve(base);
  const destinoAbs = path.resolve(destino);
  return destinoAbs === baseAbs || destinoAbs.startsWith(baseAbs + path.sep);
}
