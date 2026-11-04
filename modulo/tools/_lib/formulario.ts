import path from "node:path";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { asegurarDir, outCaso } from "./paths";
import { renderReporteFaltantes, renderValoresPortal } from "./render-markdown";
import { resumenMapeo, todosLosCampos, type ResumenMapeo } from "./mapeo";
import type { DatosCaso, EstadoCampo, Formato, Mapeo } from "./types";

export interface ResultadoFormulario {
  ruta: string | null;
  formato: Formato;
  mensaje?: string;
  reporte: string;
  resumen: ResumenMapeo;
}

type Estado = "lleno" | "confirmacion" | "faltante";

function mapaEstados(mapeo: Mapeo): Map<string, Estado> {
  const mapa = new Map<string, Estado>();
  for (const campo of mapeo.llenos) mapa.set(campo.etiqueta, "lleno");
  for (const campo of mapeo.requiere_confirmacion) mapa.set(campo.etiqueta, "confirmacion");
  for (const campo of mapeo.faltantes) mapa.set(campo.etiqueta, "faltante");
  return mapa;
}

function camposOrdenados(mapeo: Mapeo): EstadoCampo[] {
  return todosLosCampos(mapeo).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

function rutaRelativa(directory: string, absoluta: string): string {
  return path.relative(directory, absoluta).split(path.sep).join("/");
}

function nombreArchivo(formato: Formato): string {
  if (formato === "xlsx") return "formulario.xlsx";
  if (formato === "pdf") return "formulario.pdf";
  return "valores-portal.md";
}

export async function generarFormulario(
  directory: string,
  datos: DatosCaso,
  mapeo: Mapeo,
): Promise<ResultadoFormulario> {
  const dirSalida = outCaso(directory, datos.caso);
  await asegurarDir(dirSalida);

  const reporteAbs = path.join(dirSalida, "reporte-faltantes.md");
  await writeFile(reporteAbs, renderReporteFaltantes(mapeo), "utf8");
  const reporte = rutaRelativa(directory, reporteAbs);
  const resumen = resumenMapeo(mapeo);

  if (datos.formato === "portal") {
    const portalAbs = path.join(dirSalida, nombreArchivo("portal"));
    await writeFile(portalAbs, renderValoresPortal(mapeo), "utf8");
    return {
      ruta: rutaRelativa(directory, portalAbs),
      formato: "portal",
      mensaje:
        "formato no soportado: portal web. Se generó valores-portal.md para copiar manualmente; el agente no ingresa credenciales.",
      reporte,
      resumen,
    };
  }

  if (camposOrdenados(mapeo).length === 0) {
    return {
      ruta: null,
      formato: datos.formato,
      mensaje:
        "No se pudo generar el formulario porque la plantilla está ausente o corrupta. Se generó el reporte de faltantes.",
      reporte,
      resumen,
    };
  }

  const rutaAbs = path.join(dirSalida, nombreArchivo(datos.formato));

  if (datos.formato === "xlsx") {
    await generarXlsx(rutaAbs, mapeo);
  } else {
    await generarPdf(rutaAbs, datos, mapeo);
  }

  return {
    ruta: rutaRelativa(directory, rutaAbs),
    formato: datos.formato,
    reporte,
    resumen,
  };
}

async function generarXlsx(ruta: string, mapeo: Mapeo): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Agente de registro de proveedores";
  workbook.created = new Date();

  const estados = mapaEstados(mapeo);
  for (const campo of camposOrdenados(mapeo)) {
    if (!campo.hoja || !campo.celda_etiqueta || !campo.celda_valor) continue;
    const hoja = workbook.getWorksheet(campo.hoja) ?? workbook.addWorksheet(campo.hoja);
    const etiqueta = hoja.getCell(campo.celda_etiqueta);
    etiqueta.value = campo.etiqueta;
    etiqueta.font = { bold: true };

    const valor = hoja.getCell(campo.celda_valor);
    const estado = estados.get(campo.etiqueta) ?? "faltante";
    valor.value = estado === "faltante" ? null : (campo.valor ?? campo.visual ?? null);
    valor.alignment = { wrapText: true, vertical: "top" };

    if (estado === "faltante") {
      valor.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
      valor.note = "FALTANTE: el repositorio maestro no tiene este dato. No se inventó un valor.";
    } else if (estado === "confirmacion") {
      valor.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
      valor.note = campo.nota ?? "Requiere confirmación humana antes de firmar.";
    }

    const letraEtiqueta = campo.celda_etiqueta.match(/^[A-Z]+/)?.[0];
    const letraValor = campo.celda_valor.match(/^[A-Z]+/)?.[0];
    if (letraEtiqueta) hoja.getColumn(letraEtiqueta).width = Math.max(28, hoja.getColumn(letraEtiqueta).width ?? 0);
    if (letraValor) hoja.getColumn(letraValor).width = Math.max(45, hoja.getColumn(letraValor).width ?? 0);
  }

  await workbook.xlsx.writeFile(ruta);
}

async function generarPdf(ruta: string, datos: DatosCaso, mapeo: Mapeo): Promise<void> {
  const campos = camposOrdenados(mapeo);
  const estados = mapaEstados(mapeo);

  await new Promise<void>((resolve, reject) => {
    const documento = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: `Formulario de proveedor — ${datos.cliente}`,
        Author: "Periferia IT Group S.A.S.",
      },
    });
    const salida = createWriteStream(ruta);
    salida.on("finish", () => resolve());
    salida.on("error", reject);
    documento.on("error", reject);
    documento.pipe(salida);

    documento.font("Helvetica-Bold").fontSize(16).text("Formulario de registro como proveedor");
    documento.moveDown(0.4);
    documento.font("Helvetica").fontSize(10);
    documento.text(`Cliente: ${datos.cliente}`);
    documento.text(`Caso: ${datos.caso}`);
    documento.text(`País del cliente: ${datos.pais}`);
    documento.text(`Fecha de referencia: ${mapeo.fecha_referencia}`);
    documento.moveDown(0.8);
    documento
      .strokeColor("#cccccc")
      .moveTo(50, documento.y)
      .lineTo(545, documento.y)
      .stroke();
    documento.moveDown(0.8);

    for (const campo of campos) {
      const estado = estados.get(campo.etiqueta) ?? "faltante";
      const obligatorio = campo.obligatorio ? " *" : "";
      documento.font("Helvetica-Bold").fontSize(10).fillColor("black");
      documento.text(`${campo.etiqueta}${obligatorio}: `, { continued: true });
      documento.font("Helvetica").fontSize(10);

      if (estado === "faltante") {
        documento.fillColor("#B00020").text("— FALTANTE —");
      } else if (estado === "confirmacion") {
        documento
          .fillColor("#9C5700")
          .text(`${campo.visual ?? String(campo.valor ?? "")}  (requiere confirmación)`);
      } else {
        documento.fillColor("black").text(campo.visual ?? String(campo.valor ?? ""));
      }

      if (campo.nota && estado !== "lleno") {
        documento.font("Helvetica-Oblique").fontSize(8).fillColor("#555555").text(campo.nota);
      }
      documento.moveDown(0.35);
    }

    documento.moveDown(1);
    documento
      .font("Helvetica-Oblique")
      .fontSize(8)
      .fillColor("#555555")
      .text(
        "Documento generado automáticamente por el agente. Los campos marcados con * son obligatorios. No está firmado ni fue enviado.",
        { align: "left" },
      );

    documento.end();
  });
}
