import path from "node:path";
import { copyFile, access, readFile, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { ToolError } from "./errors";
import { generarFormulario } from "./formulario";
import { asegurarDir, outCaso, repositorioRoot } from "./paths";
import {
  renderBorradorCorreo,
  renderChecklist,
  renderEnvioSimulado,
} from "./render-markdown";
import {
  construirChecklist,
  motivosNoListo,
  paqueteListoParaFirma,
} from "./soportes";
import type { DatosCaso, Mapeo, PaqueteResultado } from "./types";

export const EstadoPaqueteSchema = z.object({
  caso: z.string(),
  fecha_referencia: z.string(),
  listo_para_firma: z.boolean(),
  checklist: z.object({
    soportes: z.array(
      z.object({
        tipo: z.string(),
        estado: z.enum(["presente", "ausente", "vencido"]),
        archivo: z.string().optional(),
        vigencia_hasta: z.string().nullable().optional(),
        descripcion: z.string().optional(),
      }),
    ),
    faltantes: z.array(z.string()),
    requieren_confirmacion: z.array(z.string()),
    vencidos: z.array(z.string()),
    ausentes: z.array(z.string()),
  }),
  adjuntos: z.array(z.string()),
  motivos: z.array(z.string()),
});

export type EstadoPaquete = z.infer<typeof EstadoPaqueteSchema>;

export async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

function rutaRelativa(directory: string, absoluta: string): string {
  return path.relative(directory, absoluta).split(path.sep).join("/");
}

function archivoFormulario(formato: DatosCaso["formato"]): string {
  if (formato === "xlsx") return "formulario.xlsx";
  if (formato === "pdf") return "formulario.pdf";
  return "valores-portal.md";
}

export async function armarPaquete(
  directory: string,
  datos: DatosCaso,
  mapeo: Mapeo,
): Promise<PaqueteResultado> {
  const dirCaso = outCaso(directory, datos.caso);
  const dirPaquete = path.join(dirCaso, "paquete");
  await asegurarDir(dirCaso);

  await rm(dirPaquete, { recursive: true, force: true });
  await asegurarDir(path.join(dirPaquete, "soportes"));

  const nombreFormulario = archivoFormulario(datos.formato);
  const rutaFormulario = path.join(dirCaso, nombreFormulario);
  if (!(await existe(rutaFormulario))) {
    await generarFormulario(directory, datos, mapeo);
  }

  const adjuntos: string[] = [];
  if (await existe(rutaFormulario)) {
    await copyFile(rutaFormulario, path.join(dirPaquete, nombreFormulario));
    adjuntos.push(nombreFormulario);
  }

  const { checklist, presentes, advertencias } = await construirChecklist(
    directory,
    datos.soportes,
    mapeo,
  );

  for (const soporte of presentes) {
    if (!soporte.archivo) continue;
    const origen = path.join(repositorioRoot(directory), "soportes", soporte.archivo);
    const destino = path.join(dirPaquete, "soportes", soporte.archivo);
    try {
      await copyFile(origen, destino);
      adjuntos.push(soporte.archivo);
    } catch {
      soporte.estado = "ausente";
      checklist.ausentes.push(soporte.tipo);
      advertencias.push(`El soporte "${soporte.tipo}" está en el índice pero su archivo no existe.`);
    }
  }

  const listo = paqueteListoParaFirma(checklist);
  const motivos = motivosNoListo(checklist);

  await writeFile(
    path.join(dirPaquete, "checklist.md"),
    renderChecklist(datos, checklist, listo, mapeo.fecha_referencia),
    "utf8",
  );
  await writeFile(
    path.join(dirPaquete, "borrador-correo.md"),
    renderBorradorCorreo(datos, checklist, listo, adjuntos),
    "utf8",
  );

  const estado: EstadoPaquete = {
    caso: datos.caso,
    fecha_referencia: mapeo.fecha_referencia,
    listo_para_firma: listo,
    checklist,
    adjuntos,
    motivos,
  };
  await writeFile(
    path.join(dirPaquete, "estado.json"),
    `${JSON.stringify(estado, null, 2)}\n`,
    "utf8",
  );

  return {
    ruta: rutaRelativa(directory, dirPaquete),
    listo_para_firma: listo,
    checklist,
    advertencias,
  };
}

export async function leerEstadoPaquete(
  directory: string,
  caso: string,
): Promise<EstadoPaquete> {
  const ruta = path.join(outCaso(directory, caso), "paquete", "estado.json");
  let texto: string;
  try {
    texto = await readFile(ruta, "utf8");
  } catch {
    throw new ToolError(
      `El paquete del caso "${caso}" no existe. Ejecuta primero proveedor_armar_paquete.`,
    );
  }
  const resultado = EstadoPaqueteSchema.safeParse(JSON.parse(texto));
  if (!resultado.success) {
    throw new ToolError(`El estado del paquete del caso "${caso}" está corrupto. Vuelve a armarlo.`);
  }
  return resultado.data;
}

export async function escribirEnvioSimulado(
  directory: string,
  datos: DatosCaso,
  estado: EstadoPaquete,
): Promise<string> {
  const dirCaso = outCaso(directory, datos.caso);
  await asegurarDir(dirCaso);
  const ruta = path.join(dirCaso, "ENVIO-SIMULADO.md");
  await writeFile(
    ruta,
    renderEnvioSimulado(datos, estado.listo_para_firma, estado.motivos, estado.adjuntos),
    "utf8",
  );
  return rutaRelativa(directory, ruta);
}
