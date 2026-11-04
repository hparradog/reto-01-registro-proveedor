import path from "node:path";
import { z } from "zod";
import { ToolError } from "./errors";
import { leerJson } from "./json";
import { resolverCaso } from "./paths";
import { mensajeClaro } from "./result";
import type { CampoPlantilla, DatosCaso, Formato, Solicitud } from "./types";

const CELDA = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/;

export const SolicitudSchema = z.object({
  id: z.string().min(1),
  de: z.string().min(1),
  para: z.string().optional(),
  asunto: z.string().min(1),
  fecha: z.string().min(1),
  pais: z.string().length(2),
  cliente: z.string().min(1),
  formato: z.enum(["xlsx", "pdf", "portal"]),
  cuerpo: z.string(),
  adjuntos: z.array(z.string()).default([]),
});

const PlantillaCeldasSchema = z.array(
  z.object({
    hoja: z.string().min(1),
    celda_etiqueta: z.string().regex(CELDA, "celda_etiqueta inválida"),
    etiqueta: z.string().min(1),
    celda_valor: z.string().regex(CELDA, "celda_valor inválida"),
  }),
);

const PlantillaCamposSchema = z.array(
  z.object({
    etiqueta: z.string().min(1),
    obligatorio: z.boolean().default(false),
  }),
);

const SoportesSchema = z.array(z.string().min(1));

/** Campos estándar cuando el cliente pide un portal web y no adjunta plantilla. */
export const CAMPOS_PORTAL: readonly string[] = [
  "Razón social",
  "Identificación tributaria",
  "Dirección",
  "Teléfono",
  "Correo electrónico",
  "Representante legal",
];

export async function leerDatosCaso(directory: string, caso: string): Promise<DatosCaso> {
  const dirCaso = await resolverCaso(directory, caso);

  let solicitud: Solicitud;
  try {
    solicitud = await leerJson(path.join(dirCaso, "solicitud.json"), SolicitudSchema);
  } catch (error) {
    throw new ToolError(`La solicitud del caso "${caso}" no es válida: ${mensajeClaro(error)}`);
  }

  const advertencias: string[] = [];
  let soportes: string[] = [];
  try {
    soportes = await leerJson(path.join(dirCaso, "soportes-exigidos.json"), SoportesSchema);
  } catch (error) {
    advertencias.push(`No se pudieron leer los soportes exigidos: ${mensajeClaro(error)}`);
  }

  const formato = solicitud.formato as Formato;
  const campos = await leerCampos(dirCaso, formato, advertencias);

  return {
    caso,
    solicitud,
    formato,
    pais: solicitud.pais,
    cliente: solicitud.cliente,
    campos,
    soportes,
    advertencias,
  };
}

async function leerCampos(
  dirCaso: string,
  formato: Formato,
  advertencias: string[],
): Promise<CampoPlantilla[]> {
  if (formato === "portal") {
    return CAMPOS_PORTAL.map((etiqueta) => ({
      etiqueta,
      obligatorio: true,
      origen: "estandar_portal" as const,
    }));
  }

  if (formato === "xlsx") {
    try {
      const celdas = await leerJson(path.join(dirCaso, "plantilla-celdas.json"), PlantillaCeldasSchema);
      return celdas.map((celda) => ({
        etiqueta: celda.etiqueta,
        obligatorio: false,
        origen: "plantilla" as const,
        hoja: celda.hoja,
        celda_etiqueta: celda.celda_etiqueta,
        celda_valor: celda.celda_valor,
      }));
    } catch (error) {
      advertencias.push(
        `La plantilla Excel está ausente o corrupta (${mensajeClaro(error)}). Se puede continuar con el reporte de faltantes y los soportes.`,
      );
      return [];
    }
  }

  try {
    const lista = await leerJson(path.join(dirCaso, "plantilla-campos.json"), PlantillaCamposSchema);
    return lista.map((campo) => ({
      etiqueta: campo.etiqueta,
      obligatorio: campo.obligatorio,
      origen: "plantilla" as const,
    }));
  } catch (error) {
    advertencias.push(
      `La plantilla PDF está ausente o corrupta (${mensajeClaro(error)}). Se puede continuar con el reporte de faltantes y los soportes.`,
    );
    return [];
  }
}
