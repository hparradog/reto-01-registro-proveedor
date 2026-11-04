/**
 * demo.ts — ejecuta todas las herramientas sobre todos los casos, sin modelo ni red.
 *
 *   bun run demo.ts
 *
 * Limpia out/ al inicio y termina con código 1 si alguna verificación falla.
 */
import path from "node:path";
import { mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  armar_paquete,
  generar_formulario,
  leer_solicitud,
  mapear_campos,
  simular_envio,
  type ToolContext,
} from "./src/tools/proveedor";
import { mensajeClaro } from "./src/tools/_lib/result";
import type { Checklist, Mapeo, PaqueteResultado } from "./src/tools/_lib/types";

interface Ok<T> {
  ok: true;
  data: T;
}
interface Fallo {
  ok: false;
  error: string;
}
type Resultado<T> = Ok<T> | Fallo;

interface CampoLeido {
  etiqueta: string;
  requiere_confirmacion: boolean;
}

interface SolicitudLeida {
  caso: string;
  pais: string;
  cliente: string;
  formato: string;
  campos: CampoLeido[];
  soportes: string[];
  advertencias: string[];
}

const directory = path.resolve(import.meta.dir);
const ctx: ToolContext = { directory, sessionId: "demo" };

const fallos: string[] = [];

function verificar(condicion: boolean, mensaje: string): void {
  if (!condicion) fallos.push(mensaje);
}

function parsear<T>(texto: string): Resultado<T> {
  const crudo: unknown = JSON.parse(texto);
  if (typeof crudo === "object" && crudo !== null && "ok" in crudo) {
    return crudo as Resultado<T>;
  }
  return { ok: false, error: "Respuesta de herramienta con forma inesperada." };
}

function linea(etiqueta: string, valor: string | number | boolean): void {
  console.log(`  ${etiqueta.padEnd(22)} ${String(valor)}`);
}

async function limpiarOut(): Promise<void> {
  const objetivo = path.join(directory, "out");
  const raiz = path.resolve(directory);
  if (!objetivo.startsWith(raiz + path.sep)) {
    throw new Error("Ruta de limpieza fuera del proyecto; se aborta por seguridad.");
  }
  await rm(objetivo, { recursive: true, force: true });
  await mkdir(objetivo, { recursive: true });
}

async function descubrirCasos(): Promise<string[]> {
  const raiz = path.join(directory, "fixtures", "reto-01", "casos");
  const entradas = await readdir(raiz, { withFileTypes: true });
  return entradas
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .filter((nombre) => existsSync(path.join(raiz, nombre, "solicitud.json")))
    .sort();
}

interface ResumenCaso {
  caso: string;
  formato: string;
  llenos: number;
  faltantes: number;
  confirmaciones: number;
  listoParaFirma: boolean;
  ausentes: string[];
  vencidos: string[];
  rutas: { formulario: string | null; paquete: string; reporte: string };
}

async function procesarCaso(caso: string): Promise<ResumenCaso | null> {
  console.log(`\n[${caso}]`);

  const leida = parsear<SolicitudLeida>(await leer_solicitud.execute({ caso }, ctx));
  if (!leida.ok) {
    console.log(`  ERROR: ${leida.error}`);
    fallos.push(`${caso}: leer_solicitud falló: ${leida.error}`);
    return null;
  }
  linea("formato", leida.data.formato);
  linea("país / cliente", `${leida.data.pais} / ${leida.data.cliente}`);
  linea("campos solicitados", leida.data.campos.length);
  linea("soportes exigidos", leida.data.soportes.join(", ") || "ninguno");
  for (const advertencia of leida.data.advertencias) linea("advertencia", advertencia);

  const mapeada = parsear<Mapeo>(
    await mapear_campos.execute({ caso, campos: leida.data.campos }, ctx),
  );
  if (!mapeada.ok) {
    console.log(`  ERROR: ${mapeada.error}`);
    fallos.push(`${caso}: mapear_campos falló: ${mapeada.error}`);
    return null;
  }
  const mapeo = mapeada.data;
  linea("llenos", mapeo.llenos.length);
  linea("faltantes", mapeo.faltantes.map((campo) => campo.etiqueta).join(", ") || "ninguno");
  linea(
    "requiere confirmación",
    mapeo.requiere_confirmacion.map((campo) => campo.etiqueta).join(", ") || "ninguno",
  );

  const generada = parsear<{ ruta: string | null; formato: string; mensaje?: string; reporte: string }>(
    await generar_formulario.execute({ caso, mapeo: mapeo as unknown as Record<string, unknown> }, ctx),
  );
  if (!generada.ok) {
    console.log(`  ERROR: ${generada.error}`);
    fallos.push(`${caso}: generar_formulario falló: ${generada.error}`);
    return null;
  }
  linea("formulario", generada.data.ruta ?? "(no generado)");
  if (generada.data.mensaje) linea("mensaje", generada.data.mensaje);

  const paquete = parsear<PaqueteResultado>(await armar_paquete.execute({ caso }, ctx));
  if (!paquete.ok) {
    console.log(`  ERROR: ${paquete.error}`);
    fallos.push(`${caso}: armar_paquete falló: ${paquete.error}`);
    return null;
  }
  const checklist: Checklist = paquete.data.checklist;
  linea("paquete", paquete.data.ruta);
  linea("listo_para_firma", paquete.data.listo_para_firma);
  linea("soportes ausentes", checklist.ausentes.join(", ") || "ninguno");
  linea("soportes vencidos", checklist.vencidos.join(", ") || "ninguno");
  for (const advertencia of paquete.data.advertencias) linea("advertencia", advertencia);

  return {
    caso,
    formato: leida.data.formato,
    llenos: mapeo.llenos.length,
    faltantes: mapeo.faltantes.length,
    confirmaciones: mapeo.requiere_confirmacion.length,
    listoParaFirma: paquete.data.listo_para_firma,
    ausentes: checklist.ausentes,
    vencidos: checklist.vencidos,
    rutas: {
      formulario: generada.data.ruta,
      paquete: paquete.data.ruta,
      reporte: generada.data.reporte,
    },
  };
}

async function verificarCasosEsperados(resumenes: ResumenCaso[]): Promise<void> {
  const porCaso = new Map(resumenes.map((resumen) => [resumen.caso, resumen]));

  const co = porCaso.get("co-industrias-delta");
  verificar(co !== undefined, "Falta el resumen de co-industrias-delta.");
  verificar(co?.formato === "xlsx", "co-industrias-delta debe ser xlsx.");
  verificar(
    co?.rutas.formulario !== null && existsSync(path.join(directory, co?.rutas.formulario ?? "")),
    "co-industrias-delta no generó formulario.xlsx.",
  );
  verificar(co?.faltantes === 0, "co-industrias-delta no debería tener faltantes.");

  const hn = porCaso.get("hn-agroexport-sula");
  verificar(hn !== undefined, "Falta el resumen de hn-agroexport-sula.");
  verificar(
    (hn?.confirmaciones ?? 0) >= 1,
    "hn-agroexport-sula debe marcar el RTN como requiere_confirmacion.",
  );
  verificar((hn?.faltantes ?? 0) >= 1, "hn-agroexport-sula debe reportar Referencias comerciales.");

  const ec = porCaso.get("ec-corp-andina");
  verificar(ec !== undefined, "Falta el resumen de ec-corp-andina.");
  verificar(
    ec?.rutas.formulario?.endsWith(".pdf") === true,
    "ec-corp-andina no generó formulario.pdf.",
  );
  verificar(
    (ec?.ausentes ?? []).includes("certificado_cumplimiento_tributario"),
    "ec-corp-andina debe reportar ausente el certificado de cumplimiento tributario.",
  );

  const pa = porCaso.get("pa-logistica-istmo");
  verificar(pa !== undefined, "Falta el resumen de pa-logistica-istmo.");
  verificar(
    pa?.rutas.formulario === "out/pa-logistica-istmo/valores-portal.md",
    "pa-logistica-istmo debe generar valores-portal.md.",
  );
}

async function verificarErroresYConfirmacion(): Promise<void> {
  console.log("\n[caso inexistente]");
  const inexistente = parsear<unknown>(await leer_solicitud.execute({ caso: "no-existe" }, ctx));
  verificar(!inexistente.ok, "Un caso inexistente debe devolver ok:false.");
  console.log(`  ${inexistente.ok ? "ERROR: devolvió ok:true" : `ok:false — ${inexistente.error}`}`);

  console.log("\n[envío sin confirmación]");
  const sinConfirmar = parsear<{ ruta: string }>(
    await simular_envio.execute({ caso: "co-industrias-delta", confirmado: false }, ctx),
  );
  verificar(!sinConfirmar.ok, "simular_envio sin confirmación debe devolver ok:false.");
  verificar(
    !sinConfirmar.ok && sinConfirmar.error.includes("requiere confirmación explícita"),
    "simular_envio debe responder 'requiere confirmación explícita'.",
  );
  console.log(`  ${sinConfirmar.ok ? "ERROR: devolvió ok:true" : `ok:false — ${sinConfirmar.error}`}`);

  console.log("\n[envío confirmado]");
  const confirmado = parsear<{ ruta: string }>(
    await simular_envio.execute({ caso: "co-industrias-delta", confirmado: true }, ctx),
  );
  verificar(confirmado.ok, "simular_envio con confirmación debe devolver ok:true.");
  if (confirmado.ok) {
    const ruta = path.join(directory, confirmado.data.ruta);
    verificar(existsSync(ruta), "No se creó ENVIO-SIMULADO.md.");
    console.log(`  ${confirmado.data.ruta}`);
  } else {
    console.log(`  ERROR: ${confirmado.error}`);
  }
}

async function principal(): Promise<void> {
  const referencia = process.env.FECHA_REFERENCIA?.trim() || new Date().toISOString().slice(0, 10);
  console.log("Reto 01 — demo de herramientas (sin modelo)");
  console.log(`Fecha de referencia: ${referencia}`);
  if (!process.env.FECHA_REFERENCIA) {
    console.log("(define FECHA_REFERENCIA=2026-09-03 para reproducir los resultados del PRD)");
  }
  console.log(`Directorio: ${directory}`);

  await limpiarOut();
  const casos = await descubrirCasos();
  console.log(`Casos encontrados: ${casos.length} (${casos.join(", ")})`);

  const resumenes: ResumenCaso[] = [];
  for (const caso of casos) {
    try {
      const resumen = await procesarCaso(caso);
      if (resumen) resumenes.push(resumen);
    } catch (error) {
      console.log(`  ERROR inesperado: ${mensajeClaro(error)}`);
      fallos.push(`${caso}: error inesperado: ${mensajeClaro(error)}`);
    }
  }

  await verificarCasosEsperados(resumenes);
  await verificarErroresYConfirmacion();

  console.log("\nResumen");
  console.log("| Caso | Formato | Llenos | Faltantes | Confirmar | Listo |");
  console.log("|---|---|---|---|---|---|");
  for (const resumen of resumenes) {
    console.log(
      `| ${resumen.caso} | ${resumen.formato} | ${resumen.llenos} | ${resumen.faltantes} | ${resumen.confirmaciones} | ${resumen.listoParaFirma ? "sí" : "no"} |`,
    );
  }

  if (fallos.length > 0) {
    console.error(`\nFALLARON ${fallos.length} verificación(es):`);
    for (const fallo of fallos) console.error(`- ${fallo}`);
    process.exit(1);
  }
  console.log("\nOK: todas las verificaciones pasaron.");
}

await principal();
