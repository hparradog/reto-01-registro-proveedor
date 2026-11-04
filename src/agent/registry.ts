import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { herramientas, type ToolContext } from "../tools/proveedor";
import type { LlmToolDef } from "../llm/adapter";
import { err, mensajeClaro } from "../tools/_lib/result";

interface HerramientaCruda {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute: (args: never, ctx: ToolContext) => Promise<string>;
}

export interface HerramientaRegistrada {
  name: string;
  description: string;
  schema: z.AnyZodObject;
  execute: (args: unknown, ctx: ToolContext) => Promise<string>;
}

const PREFIJO = "proveedor";

function adaptar(nombre: string, herramienta: HerramientaCruda): HerramientaRegistrada {
  const schema = z.object(herramienta.args);
  return {
    name: nombre,
    description: herramienta.description,
    schema,
    async execute(args: unknown, ctx: ToolContext): Promise<string> {
      const validados = schema.safeParse(args);
      if (!validados.success) {
        return JSON.stringify(
          err(`Argumentos inválidos para ${nombre}: ${mensajeClaro(validados.error)}`),
        );
      }
      return herramienta.execute(validados.data as never, ctx);
    },
  };
}

const registro = new Map<string, HerramientaRegistrada>();
for (const [clave, herramienta] of Object.entries(herramientas)) {
  const cruda = herramienta as unknown as HerramientaCruda;
  const nombre = `${PREFIJO}_${clave}`;
  registro.set(nombre, adaptar(nombre, cruda));
}

export function listarHerramientas(): HerramientaRegistrada[] {
  return [...registro.values()];
}

export function buscarHerramienta(nombre: string): HerramientaRegistrada | undefined {
  return registro.get(nombre);
}

export function definicionesParaModelo(): LlmToolDef[] {
  return listarHerramientas().map((herramienta) => ({
    name: herramienta.name,
    description: herramienta.description,
    inputSchema: zodToJsonSchema(herramienta.schema, {
      target: "jsonSchema7",
      $refStrategy: "none",
    }) as Record<string, unknown>,
  }));
}

/** Verifica que los nombres expuestos coincidan con el contrato del PRD. */
export const NOMBRES_REQUERIDOS = [
  "proveedor_leer_solicitud",
  "proveedor_mapear_campos",
  "proveedor_generar_formulario",
  "proveedor_armar_paquete",
  "proveedor_simular_envio",
] as const;
