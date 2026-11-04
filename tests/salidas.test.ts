import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, readdir, stat } from "node:fs/promises";
import ExcelJS from "exceljs";
import {
  armar_paquete,
  generar_formulario,
  simular_envio,
} from "../src/tools/proveedor";
import type { PaqueteResultado } from "../src/tools/_lib/types";
import { crearEntorno, limpiarEntorno, conFecha, contexto, parsear } from "./helpers";

interface Generado {
  ruta: string | null;
  formato: string;
  reporte: string;
  mensaje?: string;
}

let directorio = "";

beforeEach(async () => {
  directorio = await crearEntorno();
});

afterEach(async () => {
  await limpiarEntorno(directorio);
});

async function generar(caso: string): Promise<Generado> {
  const respuesta = parsear<Generado>(
    await generar_formulario.execute({ caso, mapeo: {} }, contexto(directorio)),
  );
  expect(respuesta.ok).toBe(true);
  if (!respuesta.ok) throw new Error(respuesta.error);
  return respuesta.data;
}

describe("generar_formulario", () => {
  test("escribe etiqueta y valor en la hoja y celda exactas (xlsx)", async () => {
    await conFecha(async () => {
      const generado = await generar("co-industrias-delta");
      expect(generado.ruta).toBe("out/co-industrias-delta/formulario.xlsx");

      const ruta = path.join(directorio, generado.ruta ?? "");
      const libro = new ExcelJS.Workbook();
      await libro.xlsx.readFile(ruta);

      const datos = libro.getWorksheet("Datos Proveedor");
      expect(datos?.getCell("B3").value).toBe("Razón social");
      expect(datos?.getCell("C3").value).toBe("Periferia IT Group S.A.S.");
      expect(datos?.getCell("B4").value).toBe("NIT");
      expect(String(datos?.getCell("C4").value)).toBe("900123456");

      const banco = libro.getWorksheet("Datos Bancarios");
      expect(banco?.getCell("C5").value).toBe("03100012345");
    });
  });

  test("deja vacía la celda de un campo faltante (xlsx)", async () => {
    await conFecha(async () => {
      await generar("hn-agroexport-sula");
      const ruta = path.join(directorio, "out", "hn-agroexport-sula", "formulario.xlsx");
      const libro = new ExcelJS.Workbook();
      await libro.xlsx.readFile(ruta);

      const hoja = libro.getWorksheet("Registro");
      expect(hoja?.getCell("A12").value).toBe("Referencias comerciales");
      expect(hoja?.getCell("B12").value).toBeNull();
      expect(String(hoja?.getCell("B3").value)).toBe("900123456");
    });
  });

  test("genera un PDF con todos los campos en orden", async () => {
    await conFecha(async () => {
      const generado = await generar("ec-corp-andina");
      expect(generado.ruta).toBe("out/ec-corp-andina/formulario.pdf");
      const info = await stat(path.join(directorio, generado.ruta ?? ""));
      expect(info.size).toBeGreaterThan(1000);
    });
  });

  test("portal: genera valores-portal.md con formato no soportado", async () => {
    await conFecha(async () => {
      const generado = await generar("pa-logistica-istmo");
      expect(generado.ruta).toBe("out/pa-logistica-istmo/valores-portal.md");
      expect(generado.mensaje).toContain("formato no soportado");

      const contenido = await readFile(
        path.join(directorio, "out", "pa-logistica-istmo", "valores-portal.md"),
        "utf8",
      );
      expect(contenido).toContain("Formato no soportado");
      expect(contenido).toContain("Identificación tributaria");
      expect(contenido).toContain("REQUIERE CONFIRMACIÓN");
    });
  });

  test("genera el reporte de faltantes", async () => {
    await conFecha(async () => {
      await generar("hn-agroexport-sula");
      const reporte = await readFile(
        path.join(directorio, "out", "hn-agroexport-sula", "reporte-faltantes.md"),
        "utf8",
      );
      expect(reporte).toContain("Referencias comerciales");
      expect(reporte).toContain("RTN");
    });
  });
});

describe("armar_paquete", () => {
  test("crea checklist, borrador sin datos bancarios y copia soportes vigentes", async () => {
    await conFecha(async () => {
      const respuesta = parsear<PaqueteResultado>(
        await armar_paquete.execute({ caso: "co-industrias-delta" }, contexto(directorio)),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;

      const paquete = path.join(directorio, "out", "co-industrias-delta", "paquete");
      const archivos = await readdir(paquete);
      expect(archivos).toContain("formulario.xlsx");
      expect(archivos).toContain("checklist.md");
      expect(archivos).toContain("borrador-correo.md");
      expect(archivos).toContain("estado.json");

      const borrador = await readFile(path.join(paquete, "borrador-correo.md"), "utf8");
      expect(borrador).not.toContain("Bancolombia");
      expect(borrador).not.toContain("03100012345");
      expect(borrador).not.toContain("COLOCOBM");

      const soportes = await readdir(path.join(paquete, "soportes"));
      expect(soportes).toContain("camara-comercio-2026-08.txt");
      expect(soportes).toContain("rut-2026.txt");
    });
  });

  test("no copia un soporte vencido", async () => {
    await conFecha(async () => {
      const respuesta = parsear<PaqueteResultado>(
        await armar_paquete.execute({ caso: "hn-agroexport-sula" }, contexto(directorio)),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      const soportes = await readdir(
        path.join(directorio, "out", "hn-agroexport-sula", "paquete", "soportes"),
      );
      expect(soportes).not.toContain("parafiscales-2026-07.txt");
    });
  });

  test("no copia un soporte ausente del repositorio", async () => {
    await conFecha(async () => {
      const respuesta = parsear<PaqueteResultado>(
        await armar_paquete.execute({ caso: "ec-corp-andina" }, contexto(directorio)),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      expect(respuesta.data.checklist.ausentes).toContain("certificado_cumplimiento_tributario");
    });
  });
});

describe("simular_envio", () => {
  test("exige el paquete armado y la confirmación explícita", async () => {
    await conFecha(async () => {
      const sinPaquete = parsear<{ ruta: string }>(
        await simular_envio.execute(
          { caso: "co-industrias-delta", confirmado: true },
          contexto(directorio),
        ),
      );
      expect(sinPaquete.ok).toBe(false);

      await armar_paquete.execute({ caso: "co-industrias-delta" }, contexto(directorio));

      const sinConfirmar = parsear<{ ruta: string }>(
        await simular_envio.execute(
          { caso: "co-industrias-delta", confirmado: false },
          contexto(directorio),
        ),
      );
      expect(sinConfirmar.ok).toBe(false);
      if (!sinConfirmar.ok) {
        expect(sinConfirmar.error).toBe("requiere confirmación explícita");
      }

      const confirmado = parsear<{ ruta: string }>(
        await simular_envio.execute(
          { caso: "co-industrias-delta", confirmado: true },
          contexto(directorio),
        ),
      );
      expect(confirmado.ok).toBe(true);
      if (!confirmado.ok) return;
      const contenido = await readFile(
        path.join(directorio, "out", "co-industrias-delta", "ENVIO-SIMULADO.md"),
        "utf8",
      );
      expect(contenido).toContain("ENVÍO SIMULADO");
    });
  });
});
