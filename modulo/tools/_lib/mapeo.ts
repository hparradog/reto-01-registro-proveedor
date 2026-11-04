import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { ToolError } from "./errors";
import { fechaReferencia } from "./fecha";
import { leerJson } from "./json";
import { asegurarDir, fixtureRoot, outCaso, repositorioRoot } from "./paths";
import { analizarEtiquetaTributaria, normalizar, similitud } from "./taxonomia";
import type { DatosCaso, EstadoCampo, Mapeo } from "./types";

const GlosarioSchema = z.record(z.string(), z.string());
const MaestroSchema = z.record(z.string(), z.unknown());

const EstadoCampoSchema = z.object({
  etiqueta: z.string(),
  clave: z.string().optional(),
  ruta: z.string().optional(),
  valor: z.union([z.string(), z.number()]).optional(),
  visual: z.string().optional(),
  confianza: z.number(),
  nota: z.string().optional(),
  obligatorio: z.boolean(),
  orden: z.number().optional(),
  hoja: z.string().optional(),
  celda_etiqueta: z.string().optional(),
  celda_valor: z.string().optional(),
});

export const MapeoSchema = z.object({
  caso: z.string(),
  pais: z.string(),
  cliente: z.string(),
  formato: z.enum(["xlsx", "pdf", "portal"]),
  fecha_referencia: z.string(),
  llenos: z.array(EstadoCampoSchema),
  faltantes: z.array(EstadoCampoSchema),
  requiere_confirmacion: z.array(EstadoCampoSchema),
});

export interface EntradaMapeo {
  etiqueta: string;
  obligatorio?: boolean;
  orden?: number;
  hoja?: string;
  celda_etiqueta?: string;
  celda_valor?: string;
}

export interface ResumenMapeo {
  llenos: number;
  faltantes: number;
  requiere_confirmacion: number;
}

export function resumenMapeo(mapeo: Mapeo): ResumenMapeo {
  return {
    llenos: mapeo.llenos.length,
    faltantes: mapeo.faltantes.length,
    requiere_confirmacion: mapeo.requiere_confirmacion.length,
  };
}

export function getPath(objeto: unknown, ruta: string): unknown {
  return ruta.split(".").reduce<unknown>((actual, clave) => {
    if (actual !== null && typeof actual === "object" && clave in actual) {
      return (actual as Record<string, unknown>)[clave];
    }
    return undefined;
  }, objeto);
}

function esValorVacio(valor: unknown): boolean {
  return valor === undefined || valor === null || (typeof valor === "string" && valor.trim() === "");
}

export function formatearVisual(valor: string | number | boolean): string {
  if (typeof valor === "number") {
    return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(valor);
  }
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  return valor;
}

async function cargarGlosario(directory: string): Promise<Map<string, string>> {
  const glosario = await leerJson(
    path.join(fixtureRoot(directory), "glosario-campos.json"),
    GlosarioSchema,
  );
  const mapa = new Map<string, string>();
  for (const [etiqueta, clave] of Object.entries(glosario)) {
    mapa.set(normalizar(etiqueta), clave);
  }
  return mapa;
}

async function cargarMaestro(directory: string): Promise<Record<string, unknown>> {
  try {
    return await leerJson(path.join(repositorioRoot(directory), "maestro.json"), MaestroSchema);
  } catch {
    throw new ToolError("No se pudo leer el repositorio maestro (repositorio/maestro.json).");
  }
}

function proponerClaveAproximada(
  etiquetaNormalizada: string,
  glosario: Map<string, string>,
): { clave: string; confianza: number } | null {
  let mejor: { clave: string; confianza: number } | null = null;
  for (const [texto, clave] of glosario) {
    const puntaje = similitud(etiquetaNormalizada, texto);
    if (puntaje >= 0.9 && (mejor === null || puntaje > mejor.confianza)) {
      mejor = { clave, confianza: Number(puntaje.toFixed(2)) };
    }
  }
  return mejor;
}

function proponerClaveConConfianzaMedia(
  etiquetaNormalizada: string,
  glosario: Map<string, string>,
): { clave: string; confianza: number } | null {
  let mejor: { clave: string; confianza: number } | null = null;
  for (const [texto, clave] of glosario) {
    const puntaje = similitud(etiquetaNormalizada, texto);
    if (puntaje >= 0.75 && puntaje < 0.9 && (mejor === null || puntaje > mejor.confianza)) {
      mejor = { clave, confianza: Number(puntaje.toFixed(2)) };
    }
  }
  return mejor;
}

function construir(
  entrada: EntradaMapeo,
  base: Pick<EstadoCampo, "clave" | "valor" | "visual" | "confianza" | "nota">,
): EstadoCampo {
  const campo: EstadoCampo = {
    etiqueta: entrada.etiqueta,
    confianza: base.confianza,
    obligatorio: entrada.obligatorio ?? false,
  };
  if (entrada.orden !== undefined) campo.orden = entrada.orden;
  if (base.clave !== undefined) {
    campo.clave = base.clave;
    campo.ruta = base.clave;
  }
  if (base.valor !== undefined) campo.valor = base.valor;
  if (base.visual !== undefined) campo.visual = base.visual;
  if (base.nota !== undefined && base.nota !== "") campo.nota = base.nota;
  if (entrada.hoja !== undefined) campo.hoja = entrada.hoja;
  if (entrada.celda_etiqueta !== undefined) campo.celda_etiqueta = entrada.celda_etiqueta;
  if (entrada.celda_valor !== undefined) campo.celda_valor = entrada.celda_valor;
  return campo;
}

function resolverValor(
  maestro: Record<string, unknown>,
  clave: string,
): { valor: string | number; visual: string } | null {
  const crudo = getPath(maestro, clave);
  if (esValorVacio(crudo)) return null;
  if (typeof crudo === "number") {
    return { valor: crudo, visual: formatearVisual(crudo) };
  }
  if (typeof crudo === "boolean") {
    return { valor: crudo ? "Sí" : "No", visual: formatearVisual(crudo) };
  }
  return { valor: String(crudo), visual: String(crudo) };
}

function entradaDesdePlantilla(datos: DatosCaso, indice: number): EntradaMapeo {
  const campo = datos.campos[indice];
  if (!campo) return { etiqueta: "" };
  const entrada: EntradaMapeo = {
    etiqueta: campo.etiqueta,
    obligatorio: campo.obligatorio,
    orden: indice,
  };
  if (campo.hoja !== undefined) entrada.hoja = campo.hoja;
  if (campo.celda_etiqueta !== undefined) entrada.celda_etiqueta = campo.celda_etiqueta;
  if (campo.celda_valor !== undefined) entrada.celda_valor = campo.celda_valor;
  return entrada;
}

/**
 * Completa la metadata de celdas desde la plantilla. Así, si el modelo reenvía
 * solo las etiquetas, el Excel sigue escribiéndose en la celda correcta.
 */
function enriquecerConPlantilla(entrada: EntradaMapeo, datos: DatosCaso): EntradaMapeo {
  const objetivo = normalizar(entrada.etiqueta);
  const campo = datos.campos.find((item) => normalizar(item.etiqueta) === objetivo);
  if (!campo) return entrada;
  return {
    etiqueta: entrada.etiqueta,
    obligatorio: entrada.obligatorio ?? campo.obligatorio,
    ...(entrada.hoja ?? campo.hoja) !== undefined ? { hoja: entrada.hoja ?? campo.hoja } : {},
    ...(entrada.celda_etiqueta ?? campo.celda_etiqueta) !== undefined
      ? { celda_etiqueta: entrada.celda_etiqueta ?? campo.celda_etiqueta }
      : {},
    ...(entrada.celda_valor ?? campo.celda_valor) !== undefined
      ? { celda_valor: entrada.celda_valor ?? campo.celda_valor }
      : {},
  };
}

/**
 * Cruza cada campo solicitado con el maestro. Nunca inventa valores: si no hay
 * fuente en el maestro, el campo es `faltante`.
 */
export async function mapearCaso(
  directory: string,
  datos: DatosCaso,
  entradas: EntradaMapeo[],
): Promise<Mapeo> {
  const glosario = await cargarGlosario(directory);
  const maestro = await cargarMaestro(directory);
  const referencia = fechaReferencia();

  const solicitadas: EntradaMapeo[] =
    entradas.length > 0
      ? entradas.map((entrada, indice) => ({ ...enriquecerConPlantilla(entrada, datos), orden: indice }))
      : datos.campos.map((_, indice) => entradaDesdePlantilla(datos, indice));

  const llenos: EstadoCampo[] = [];
  const faltantes: EstadoCampo[] = [];
  const requiereConfirmacion: EstadoCampo[] = [];

  for (const entrada of solicitadas) {
    const etiqueta = entrada.etiqueta.trim();
    if (!etiqueta) continue;
    const normalizada = normalizar(etiqueta);
    const analisis = analizarEtiquetaTributaria(etiqueta, datos.pais);

    let clave: string | undefined = glosario.get(normalizada);
    let confianza = clave ? 1 : 0;

    if (!clave) {
      const aproximada = proponerClaveAproximada(normalizada, glosario);
      if (aproximada) {
        clave = aproximada.clave;
        confianza = aproximada.confianza;
      }
    }

    if (clave) {
      const resuelto = resolverValor(maestro, clave);
      const requiere = analisis?.requiereConfirmacion === true;

      if (!resuelto) {
        faltantes.push(
          construir(entrada, {
            clave,
            confianza,
            nota: `La clave "${clave}" existe en el maestro pero no tiene valor.`,
          }),
        );
        continue;
      }

      const item = construir(entrada, {
        clave,
        valor: resuelto.valor,
        visual: resuelto.visual,
        confianza,
        nota: requiere ? analisis?.nota : undefined,
      });

      if (requiere) requiereConfirmacion.push(item);
      else llenos.push(item);
      continue;
    }

    const media = proponerClaveConConfianzaMedia(normalizada, glosario);
    if (media) {
      const resuelto = resolverValor(maestro, media.clave);
      const notaMedia = `Coincidencia aproximada con "${media.clave}" (confianza ${media.confianza}). Confirma si el mapeo es correcto.`;
      requiereConfirmacion.push(
        construir(entrada, {
          clave: media.clave,
          ...(resuelto ? { valor: resuelto.valor, visual: resuelto.visual } : {}),
          confianza: media.confianza,
          nota: notaMedia,
        }),
      );
      continue;
    }

    faltantes.push(
      construir(entrada, {
        confianza: 0,
        nota: "No existe un campo equivalente en el repositorio maestro. Se reporta como faltante; no se inventa un valor.",
      }),
    );
  }

  const mapeo: Mapeo = {
    caso: datos.caso,
    pais: datos.pais,
    cliente: datos.cliente,
    formato: datos.formato,
    fecha_referencia: referencia,
    llenos,
    faltantes,
    requiere_confirmacion: requiereConfirmacion,
  };

  await guardarMapeo(directory, mapeo);
  return mapeo;
}

export async function guardarMapeo(directory: string, mapeo: Mapeo): Promise<string> {
  const dir = outCaso(directory, mapeo.caso);
  await asegurarDir(dir);
  const ruta = path.join(dir, "mapeo.json");
  await writeFile(ruta, `${JSON.stringify(mapeo, null, 2)}\n`, "utf8");
  return ruta;
}

export async function cargarMapeo(directory: string, caso: string): Promise<Mapeo | null> {
  const ruta = path.join(outCaso(directory, caso), "mapeo.json");
  try {
    const texto = await readFile(ruta, "utf8");
    const resultado = MapeoSchema.safeParse(JSON.parse(texto));
    return resultado.success ? resultado.data : null;
  } catch {
    return null;
  }
}

/** Todos los campos del mapeo, en orden: llenos, confirmación y faltantes. */
export function todosLosCampos(mapeo: Mapeo): EstadoCampo[] {
  return [...mapeo.llenos, ...mapeo.requiere_confirmacion, ...mapeo.faltantes];
}

/** Busca un campo por etiqueta normalizada en cualquier estado. */
export function buscarCampo(mapeo: Mapeo, etiqueta: string): EstadoCampo | undefined {
  const objetivo = normalizar(etiqueta);
  return todosLosCampos(mapeo).find((campo) => normalizar(campo.etiqueta) === objetivo);
}
