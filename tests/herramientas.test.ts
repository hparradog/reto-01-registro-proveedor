import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  armar_paquete,
  generar_formulario,
  leer_solicitud,
  mapear_campos,
} from "../src/tools/proveedor";
import type { Mapeo, PaqueteResultado } from "../src/tools/_lib/types";
import {
  crearEntorno,
  limpiarEntorno,
  conFecha,
  contexto,
  parsear,
} from "./helpers";

interface Leida {
  campos: { etiqueta: string; requiere_confirmacion: boolean }[];
  advertencias: string[];
  formato: string;
  pais: string;
  soportes: string[];
}

let directorio = "";

beforeEach(async () => {
  directorio = await crearEntorno();
});

afterEach(async () => {
  await limpiarEntorno(directorio);
});

describe("proveedor_leer_solicitud", () => {
  test("lee formato, campos y soportes de un caso Excel", async () => {
    await conFecha(async () => {
      const respuesta = parsear<Leida>(
        await leer_solicitud.execute({ caso: "co-industrias-delta" }, contexto(directorio)),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      expect(respuesta.data.formato).toBe("xlsx");
      expect(respuesta.data.pais).toBe("CO");
      expect(respuesta.data.campos).toHaveLength(17);
      expect(respuesta.data.soportes).toContain("camara_comercio");
      expect(respuesta.data.advertencias).toHaveLength(0);
    });
  });

  test("marca el identificador tributario extranjero como ambiguo", async () => {
    await conFecha(async () => {
      const respuesta = parsear<Leida>(
        await leer_solicitud.execute({ caso: "ec-corp-andina" }, contexto(directorio)),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      const ruc = respuesta.data.campos.find((campo) => campo.etiqueta === "RUC");
      expect(ruc?.requiere_confirmacion).toBe(true);
    });
  });

  test("un caso inexistente devuelve ok:false sin lanzar", async () => {
    const respuesta = parsear<Leida>(
      await leer_solicitud.execute({ caso: "no-existe" }, contexto(directorio)),
    );
    expect(respuesta.ok).toBe(false);
    if (respuesta.ok) return;
    expect(respuesta.error).toContain("no existe");
  });

  test("rechaza path traversal en el nombre del caso", async () => {
    const respuesta = parsear<Leida>(
      await leer_solicitud.execute({ caso: "../../etc" }, contexto(directorio)),
    );
    expect(respuesta.ok).toBe(false);
  });

  test("una plantilla corrupta no lanza y permite continuar", async () => {
    const dirCaso = path.join(directorio, "fixtures", "reto-01", "casos", "caso-corrupto");
    await mkdir(dirCaso, { recursive: true });
    await writeFile(
      path.join(dirCaso, "solicitud.json"),
      JSON.stringify({
        id: "caso-corrupto",
        de: "cliente@ejemplo.com",
        asunto: "Prueba",
        fecha: "2026-09-01",
        pais: "CO",
        cliente: "Cliente Prueba S.A.S.",
        formato: "xlsx",
        cuerpo: "Adjunto formato.",
        adjuntos: ["formato.xlsx"],
      }),
      "utf8",
    );
    await writeFile(path.join(dirCaso, "plantilla-celdas.json"), "{ esto no es json", "utf8");
    await writeFile(path.join(dirCaso, "soportes-exigidos.json"), "[]", "utf8");

    const leida = parsear<Leida>(
      await leer_solicitud.execute({ caso: "caso-corrupto" }, contexto(directorio)),
    );
    expect(leida.ok).toBe(true);
    if (!leida.ok) return;
    expect(leida.data.campos).toHaveLength(0);
    expect(leida.data.advertencias.length).toBeGreaterThan(0);

    const mapeo = parsear<Mapeo>(
      await mapear_campos.execute(
        { caso: "caso-corrupto", campos: [] },
        contexto(directorio),
      ),
    );
    expect(mapeo.ok).toBe(true);
    if (!mapeo.ok) return;

    const generado = parsear<{ ruta: string | null; mensaje?: string }>(
      await generar_formulario.execute(
        { caso: "caso-corrupto", mapeo: {} },
        contexto(directorio),
      ),
    );
    expect(generado.ok).toBe(true);
    if (!generado.ok) return;
    expect(generado.data.ruta).toBeNull();
    expect(generado.data.mensaje).toContain("plantilla");
  });
});

describe("proveedor_mapear_campos", () => {
  test("mapea todos los campos de co-industrias-delta sin inventar", async () => {
    await conFecha(async () => {
      const respuesta = parsear<Mapeo>(
        await mapear_campos.execute(
          { caso: "co-industrias-delta", campos: [] },
          contexto(directorio),
        ),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      expect(respuesta.data.llenos).toHaveLength(17);
      expect(respuesta.data.faltantes).toHaveLength(0);
      const razon = respuesta.data.llenos.find((campo) => campo.etiqueta === "Razón social");
      expect(razon?.ruta).toBe("razon_social");
      expect(razon?.valor).toBe("Periferia IT Group S.A.S.");
    });
  });

  test("hn: RTN requiere confirmación y Referencias comerciales es faltante", async () => {
    await conFecha(async () => {
      const respuesta = parsear<Mapeo>(
        await mapear_campos.execute(
          { caso: "hn-agroexport-sula", campos: [] },
          contexto(directorio),
        ),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;

      const rtn = respuesta.data.requiere_confirmacion.find((campo) => campo.etiqueta === "RTN");
      expect(rtn?.valor).toBe("900123456");
      expect(rtn?.nota).toContain("identificador extranjero");

      const referencias = respuesta.data.faltantes.find(
        (campo) => campo.etiqueta === "Referencias comerciales",
      );
      expect(referencias).toBeDefined();
      expect(referencias?.valor).toBeUndefined();

      const pais = respuesta.data.llenos.find((campo) => campo.etiqueta === "País");
      expect(pais?.valor).toBe("CO");
    });
  });

  test("ec: RUC requiere confirmación y el contribuyente especial falta", async () => {
    await conFecha(async () => {
      const respuesta = parsear<Mapeo>(
        await mapear_campos.execute(
          { caso: "ec-corp-andina", campos: [] },
          contexto(directorio),
        ),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      expect(
        respuesta.data.requiere_confirmacion.some((campo) => campo.etiqueta === "RUC"),
      ).toBe(true);
      expect(
        respuesta.data.faltantes.some(
          (campo) => campo.etiqueta === "Número de contribuyente especial",
        ),
      ).toBe(true);
      const cuenta = respuesta.data.llenos.find((campo) => campo.etiqueta === "Número de cuenta");
      expect(cuenta?.valor).toBe("03100012345");
    });
  });

  test("pa: el portal usa campos estándar y no agrega bancarios", async () => {
    await conFecha(async () => {
      const respuesta = parsear<Mapeo>(
        await mapear_campos.execute(
          { caso: "pa-logistica-istmo", campos: [] },
          contexto(directorio),
        ),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      const etiquetas = [
        ...respuesta.data.llenos,
        ...respuesta.data.requiere_confirmacion,
        ...respuesta.data.faltantes,
      ].map((campo) => campo.etiqueta);
      expect(etiquetas).toContain("Identificación tributaria");
      expect(etiquetas.some((etiqueta) => /cuenta|swift|banco/i.test(etiqueta))).toBe(false);
      expect(
        respuesta.data.requiere_confirmacion.some(
          (campo) => campo.etiqueta === "Identificación tributaria",
        ),
      ).toBe(true);
    });
  });

  test("normaliza tildes y mayúsculas del glosario", async () => {
    await conFecha(async () => {
      const respuesta = parsear<Mapeo>(
        await mapear_campos.execute(
          {
            caso: "co-industrias-delta",
            campos: [{ etiqueta: "razon social" }],
          },
          contexto(directorio),
        ),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      expect(respuesta.data.llenos).toHaveLength(1);
      expect(respuesta.data.llenos[0]?.clave).toBe("razon_social");
      expect(respuesta.data.llenos[0]?.celda_valor).toBe("C3");
    });
  });

  test("no acepta valores del modelo: el mapeo se recalcula desde el maestro", async () => {
    await conFecha(async () => {
      const respuesta = parsear<Mapeo>(
        await mapear_campos.execute(
          {
            caso: "co-industrias-delta",
            campos: [{ etiqueta: "Razón social", obligatorio: true }],
          },
          contexto(directorio),
        ),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      expect(respuesta.data.llenos[0]?.valor).toBe("Periferia IT Group S.A.S.");
    });
  });
});

describe("proveedor_armar_paquete", () => {
  test("co queda listo para firma con la fecha del PRD", async () => {
    await conFecha(async () => {
      const respuesta = parsear<PaqueteResultado>(
        await armar_paquete.execute({ caso: "co-industrias-delta" }, contexto(directorio)),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      expect(respuesta.data.listo_para_firma).toBe(true);
      expect(respuesta.data.checklist.ausentes).toHaveLength(0);
      expect(respuesta.data.checklist.vencidos).toHaveLength(0);
    });
  });

  test("hn no queda listo porque parafiscales está vencido", async () => {
    await conFecha(async () => {
      const respuesta = parsear<PaqueteResultado>(
        await armar_paquete.execute({ caso: "hn-agroexport-sula" }, contexto(directorio)),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      expect(respuesta.data.listo_para_firma).toBe(false);
      expect(respuesta.data.checklist.vencidos).toContain("parafiscales");
    });
  });

  test("ec no queda listo porque falta el certificado de cumplimiento tributario", async () => {
    await conFecha(async () => {
      const respuesta = parsear<PaqueteResultado>(
        await armar_paquete.execute({ caso: "ec-corp-andina" }, contexto(directorio)),
      );
      expect(respuesta.ok).toBe(true);
      if (!respuesta.ok) return;
      expect(respuesta.data.listo_para_firma).toBe(false);
      expect(respuesta.data.checklist.ausentes).toContain("certificado_cumplimiento_tributario");
    });
  });
});
