import path from "node:path";
import { z } from "zod";
import { estaVencido } from "./fecha";
import { leerJson } from "./json";
import { repositorioRoot } from "./paths";
import { mensajeClaro } from "./result";
import type { Checklist, Mapeo, SoporteChecklist } from "./types";

const EntradaIndiceSchema = z.object({
  tipo: z.string().min(1),
  archivo: z.string().min(1),
  vigencia_hasta: z.string().nullable().default(null),
  pais_emisor: z.string().optional(),
  descripcion: z.string().optional(),
});

const IndiceSchema = z.array(EntradaIndiceSchema);

export interface EntradaIndice {
  tipo: string;
  archivo: string;
  vigencia_hasta: string | null;
  pais_emisor?: string;
  descripcion?: string;
}

/**
 * Alias entre el tipo que exige el cliente y el tipo del repositorio.
 * Los tipos no listados se buscan con su nombre normalizado.
 */
export const ALIAS_SOPORTES: Readonly<Record<string, string>> = {
  camara_comercio: "camara_comercio",
  certificado_existencia: "camara_comercio",
  certificado_existencia_legal: "camara_comercio",
  rut: "rut",
  registro_tributario: "rut",
  certificacion_bancaria: "certificacion_bancaria",
  certificado_bancario: "certificacion_bancaria",
  parafiscales: "parafiscales",
  certificacion_parafiscales: "parafiscales",
  estados_financieros: "estados_financieros",
  certificado_cumplimiento_tributario: "certificado_cumplimiento_tributario",
};

export interface IndiceSoportes {
  entradas: EntradaIndice[];
  advertencia?: string;
}

export async function leerIndiceSoportes(directory: string): Promise<IndiceSoportes> {
  const ruta = path.join(repositorioRoot(directory), "soportes", "index.json");
  try {
    return { entradas: await leerJson(ruta, IndiceSchema) };
  } catch (error) {
    return {
      entradas: [],
      advertencia: `No se pudo leer el índice de soportes: ${mensajeClaro(error)}. Todos los soportes se reportan como ausentes.`,
    };
  }
}

export function normalizarTipoSoporte(tipo: string): string {
  const limpio = tipo.trim().toLowerCase();
  return ALIAS_SOPORTES[limpio] ?? limpio;
}

export interface ResultadoChecklist {
  checklist: Checklist;
  presentes: SoporteChecklist[];
  advertencias: string[];
}

export async function construirChecklist(
  directory: string,
  soportesExigidos: string[],
  mapeo: Mapeo,
): Promise<ResultadoChecklist> {
  const indice = await leerIndiceSoportes(directory);
  const advertencias = indice.advertencia ? [indice.advertencia] : [];
  const referencia = mapeo.fecha_referencia;

  const soportes: SoporteChecklist[] = soportesExigidos.map((tipoExigido) => {
    const buscado = normalizarTipoSoporte(tipoExigido);
    const entrada = indice.entradas.find((item) => normalizarTipoSoporte(item.tipo) === buscado);

    if (!entrada) {
      return {
        tipo: tipoExigido,
        estado: "ausente",
        vigencia_hasta: null,
      };
    }

    const vencido = estaVencido(entrada.vigencia_hasta, referencia);
    const item: SoporteChecklist = {
      tipo: tipoExigido,
      estado: vencido ? "vencido" : "presente",
      archivo: entrada.archivo,
      vigencia_hasta: entrada.vigencia_hasta,
    };
    if (entrada.descripcion !== undefined) item.descripcion = entrada.descripcion;
    return item;
  });

  const presentes = soportes.filter((soporte) => soporte.estado === "presente");
  const vencidos = soportes.filter((soporte) => soporte.estado === "vencido").map((s) => s.tipo);
  const ausentes = soportes.filter((soporte) => soporte.estado === "ausente").map((s) => s.tipo);

  const checklist: Checklist = {
    soportes,
    faltantes: mapeo.faltantes.map((campo) => campo.etiqueta),
    requieren_confirmacion: mapeo.requiere_confirmacion.map((campo) => campo.etiqueta),
    vencidos,
    ausentes,
  };

  return { checklist, presentes, advertencias };
}

export function paqueteListoParaFirma(checklist: Checklist): boolean {
  return checklist.vencidos.length === 0 && checklist.ausentes.length === 0;
}

export function motivosNoListo(checklist: Checklist): string[] {
  const motivos: string[] = [];
  if (checklist.ausentes.length > 0) {
    motivos.push(`soportes ausentes: ${checklist.ausentes.join(", ")}`);
  }
  if (checklist.vencidos.length > 0) {
    motivos.push(`soportes vencidos: ${checklist.vencidos.join(", ")}`);
  }
  return motivos;
}
