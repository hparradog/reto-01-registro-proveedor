import { ToolError } from "./errors";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha de ejecución usada para evaluar vigencias. Configurable para reproducibilidad. */
export function fechaReferencia(): string {
  const configurada = process.env.FECHA_REFERENCIA?.trim();
  if (configurada) {
    if (!ISO_DATE.test(configurada) || Number.isNaN(Date.parse(configurada))) {
      throw new ToolError(
        `FECHA_REFERENCIA inválida: "${configurada}". Usa el formato YYYY-MM-DD.`,
      );
    }
    return configurada;
  }
  return new Date().toISOString().slice(0, 10);
}

/** Una vigencia nula significa "sin vencimiento". Las fechas ISO se comparan como texto. */
export function estaVencido(vigenciaHasta: string | null | undefined, referencia: string): boolean {
  if (!vigenciaHasta) return false;
  return vigenciaHasta < referencia;
}
