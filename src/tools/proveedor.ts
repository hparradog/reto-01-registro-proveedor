import { z } from "zod";
import { fechaReferencia } from "./_lib/fecha";
import { registrarLogCaso } from "./_lib/log";
import { cargarMapeo, mapearCaso, resumenMapeo } from "./_lib/mapeo";
import { armarPaquete, escribirEnvioSimulado, leerEstadoPaquete } from "./_lib/paquete";
import { generarFormulario } from "./_lib/formulario";
import { err, mensajeClaro, ok } from "./_lib/result";
import { leerDatosCaso } from "./_lib/solicitud";
import { analizarEtiquetaTributaria } from "./_lib/taxonomia";
import type { Mapeo } from "./_lib/types";

export interface ToolContext {
  directory: string;
  sessionId: string;
}

const CasoArg = z
  .string()
  .describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/ (por ejemplo ec-corp-andina).");

async function ejecutarConLog(
  ctx: ToolContext,
  caso: string,
  herramienta: string,
  fn: () => Promise<{ data: unknown; resumen: string }>,
): Promise<string> {
  try {
    const { data, resumen } = await fn();
    await registrarLogSeguro(ctx.directory, caso, herramienta, true, resumen);
    return JSON.stringify(ok(data));
  } catch (error) {
    const mensaje = mensajeClaro(error);
    await registrarLogSeguro(ctx.directory, caso, herramienta, false, mensaje);
    return JSON.stringify(err(mensaje));
  }
}

async function registrarLogSeguro(
  directory: string,
  caso: string,
  herramienta: string,
  exito: boolean,
  resumen: string,
): Promise<void> {
  try {
    await registrarLogCaso(directory, caso, { herramienta, ok: exito, resumen });
  } catch {
    // El log nunca debe tumbar una herramienta.
  }
}

interface CampoConAmbiguedad {
  etiqueta: string;
  obligatorio: boolean;
  origen: string;
  requiere_confirmacion: boolean;
  nota?: string;
  hoja?: string;
  celda_etiqueta?: string;
  celda_valor?: string;
}

export const leer_solicitud = {
  description:
    "Lee la solicitud, la plantilla y los soportes exigidos de un caso para saber qué pide el cliente.",
  args: {
    caso: CasoArg,
  },
  async execute(args: { caso: string }, ctx: ToolContext): Promise<string> {
    return ejecutarConLog(ctx, args.caso, "proveedor_leer_solicitud", async () => {
      const datos = await leerDatosCaso(ctx.directory, args.caso);

      const campos: CampoConAmbiguedad[] = datos.campos.map((campo) => {
        const analisis = analizarEtiquetaTributaria(campo.etiqueta, datos.pais);
        const item: CampoConAmbiguedad = {
          etiqueta: campo.etiqueta,
          obligatorio: campo.obligatorio,
          origen: campo.origen,
          requiere_confirmacion: analisis?.requiereConfirmacion ?? false,
        };
        if (analisis?.nota) item.nota = analisis.nota;
        if (campo.hoja !== undefined) item.hoja = campo.hoja;
        if (campo.celda_etiqueta !== undefined) item.celda_etiqueta = campo.celda_etiqueta;
        if (campo.celda_valor !== undefined) item.celda_valor = campo.celda_valor;
        return item;
      });

      return {
        data: {
          caso: datos.caso,
          pais: datos.pais,
          cliente: datos.cliente,
          asunto: datos.solicitud.asunto,
          fecha_solicitud: datos.solicitud.fecha,
          formato: datos.formato,
          campos,
          soportes: datos.soportes,
          advertencias: datos.advertencias,
          fecha_referencia: fechaReferencia(),
        },
        resumen: `${campos.length} campos, ${datos.soportes.length} soportes, formato ${datos.formato}`,
      };
    });
  },
};

const CampoMapeoArg = z
  .object({
    etiqueta: z.string().describe("Etiqueta exacta del campo solicitado por el cliente."),
    obligatorio: z.boolean().optional().describe("Si la plantilla marca el campo como obligatorio."),
    hoja: z.string().optional().describe("Hoja de Excel donde va el campo, si aplica."),
    celda_etiqueta: z.string().optional().describe("Celda de la etiqueta, si aplica."),
    celda_valor: z.string().optional().describe("Celda del valor, si aplica."),
  })
  .describe("Campo solicitado por el cliente.");

export const mapear_campos = {
  description:
    "Cruza los campos solicitados con el repositorio maestro y clasifica cada uno en lleno, faltante o requiere_confirmacion.",
  args: {
    caso: CasoArg,
    campos: z
      .array(CampoMapeoArg)
      .describe(
        "Campos solicitados. Si se envía vacío, la herramienta recalcula la lista desde el caso.",
      ),
  },
  async execute(
    args: { caso: string; campos: z.infer<typeof CampoMapeoArg>[] },
    ctx: ToolContext,
  ): Promise<string> {
    return ejecutarConLog(ctx, args.caso, "proveedor_mapear_campos", async () => {
      const datos = await leerDatosCaso(ctx.directory, args.caso);
      const mapeo = await mapearCaso(ctx.directory, datos, args.campos);
      const resumen = resumenMapeo(mapeo);
      return {
        data: { ...mapeo, resumen },
        resumen: `llenos=${resumen.llenos}, faltantes=${resumen.faltantes}, requiere_confirmacion=${resumen.requiere_confirmacion}`,
      };
    });
  },
};

async function obtenerMapeo(directory: string, caso: string): Promise<Mapeo> {
  const guardado = await cargarMapeo(directory, caso);
  if (guardado) return guardado;
  const datos = await leerDatosCaso(directory, caso);
  return mapearCaso(directory, datos, []);
}

const MapeoArg = z
  .record(z.string(), z.unknown())
  .describe(
    "Mapeo devuelto por proveedor_mapear_campos. Solo se usa como referencia: los valores se recalculan desde el maestro.",
  );

export const generar_formulario = {
  description:
    "Genera el formulario en el formato del cliente (xlsx, pdf o valores para portal) usando el mapeo guardado.",
  args: {
    caso: CasoArg,
    mapeo: MapeoArg,
  },
  async execute(args: { caso: string; mapeo: Record<string, unknown> }, ctx: ToolContext): Promise<string> {
    return ejecutarConLog(ctx, args.caso, "proveedor_generar_formulario", async () => {
      const datos = await leerDatosCaso(ctx.directory, args.caso);
      const mapeo = await obtenerMapeo(ctx.directory, datos.caso);
      const resultado = await generarFormulario(ctx.directory, datos, mapeo);
      return {
        data: resultado,
        resumen: resultado.ruta
          ? `generado ${resultado.ruta} (${resultado.formato})`
          : `sin formulario: ${resultado.mensaje ?? "plantilla inválida"}`,
      };
    });
  },
};

export const armar_paquete = {
  description:
    "Arma out/<caso>/paquete con formulario, soportes vigentes, checklist y borrador de correo, e indica si está listo para firma.",
  args: {
    caso: CasoArg,
  },
  async execute(args: { caso: string }, ctx: ToolContext): Promise<string> {
    return ejecutarConLog(ctx, args.caso, "proveedor_armar_paquete", async () => {
      const datos = await leerDatosCaso(ctx.directory, args.caso);
      const mapeo = await obtenerMapeo(ctx.directory, datos.caso);
      const paquete = await armarPaquete(ctx.directory, datos, mapeo);
      return {
        data: paquete,
        resumen: `listo_para_firma=${paquete.listo_para_firma}, ausentes=${paquete.checklist.ausentes.length}, vencidos=${paquete.checklist.vencidos.length}`,
      };
    });
  },
};

export const simular_envio = {
  description:
    "Escribe el envío simulado del paquete; solo procede si confirmado es true tras una confirmación explícita del usuario.",
  args: {
    caso: CasoArg,
    confirmado: z
      .boolean()
      .describe("true solo si el último mensaje del usuario confirmó explícitamente el envío."),
  },
  async execute(args: { caso: string; confirmado: boolean }, ctx: ToolContext): Promise<string> {
    return ejecutarConLog(ctx, args.caso, "proveedor_simular_envio", async () => {
      if (args.confirmado !== true) {
        throw new Error("requiere confirmación explícita");
      }
      const datos = await leerDatosCaso(ctx.directory, args.caso);
      const estado = await leerEstadoPaquete(ctx.directory, datos.caso);
      const ruta = await escribirEnvioSimulado(ctx.directory, datos, estado);
      return {
        data: {
          ruta,
          listo_para_firma: estado.listo_para_firma,
          advertencia: estado.listo_para_firma
            ? undefined
            : `El paquete no estaba listo para firma: ${estado.motivos.join("; ")}`,
        },
        resumen: `envío simulado en ${ruta}`,
      };
    });
  },
};

export const herramientas = {
  leer_solicitud,
  mapear_campos,
  generar_formulario,
  armar_paquete,
  simular_envio,
} as const;
