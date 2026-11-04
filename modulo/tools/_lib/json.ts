import { readFile } from "node:fs/promises";
import type { z } from "zod";
import { ToolError } from "./errors";
import { mensajeClaro } from "./result";

export async function leerTexto(ruta: string): Promise<string> {
  try {
    return await readFile(ruta, "utf8");
  } catch {
    throw new ToolError(`No se pudo leer el archivo ${ruta}.`);
  }
}

/** Lee un JSON y lo valida con zod. Cualquier fallo se convierte en ToolError claro. */
export async function leerJson<S extends z.ZodTypeAny>(ruta: string, esquema: S): Promise<z.infer<S>> {
  const texto = await leerTexto(ruta);
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    throw new ToolError(`El archivo ${ruta} no contiene JSON válido.`);
  }
  const resultado = esquema.safeParse(crudo);
  if (!resultado.success) {
    throw new ToolError(
      `El archivo ${ruta} no tiene la estructura esperada: ${mensajeClaro(resultado.error)}`,
    );
  }
  return resultado.data;
}

export async function leerJsonSiExiste<S extends z.ZodTypeAny>(
  ruta: string,
  esquema: S,
): Promise<z.infer<S> | null> {
  try {
    return await leerJson(ruta, esquema);
  } catch {
    return null;
  }
}
