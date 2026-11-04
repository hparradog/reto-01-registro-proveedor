import { normalizar } from "./taxonomia";
import type { Checklist, DatosCaso, EstadoCampo, Mapeo } from "./types";

function celda(texto: string): string {
  return texto.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function valorVisible(campo: EstadoCampo): string {
  return campo.visual ?? (campo.valor !== undefined ? String(campo.valor) : "— FALTANTE —");
}

const CLAVES_BANCARIAS = ["banco", "cuenta", "swift", "iban", "titular"];

/** RN2: ningún dato bancario puede viajar en el borrador de correo. */
export function esCampoBancario(etiqueta: string): boolean {
  const limpia = normalizar(etiqueta);
  return CLAVES_BANCARIAS.some((clave) => limpia.includes(clave));
}

export function renderReporteFaltantes(mapeo: Mapeo): string {
  const lineas: string[] = [
    `# Reporte de faltantes — ${mapeo.caso}`,
    "",
    `- Cliente: ${mapeo.cliente}`,
    `- País: ${mapeo.pais}`,
    `- Formato: ${mapeo.formato}`,
    `- Fecha de referencia: ${mapeo.fecha_referencia}`,
    "",
    `## Resumen`,
    "",
    `- Llenos: ${mapeo.llenos.length}`,
    `- Requieren confirmación: ${mapeo.requiere_confirmacion.length}`,
    `- Faltantes: ${mapeo.faltantes.length}`,
    "",
    "## Campos llenos",
    "",
    "| Campo | Valor | Ruta en el maestro |",
    "|---|---|---|",
    ...mapeo.llenos.map(
      (campo) => `| ${celda(campo.etiqueta)} | ${celda(valorVisible(campo))} | ${celda(campo.ruta ?? "")} |`,
    ),
    "",
    "## Campos que requieren confirmación",
    "",
  ];

  if (mapeo.requiere_confirmacion.length === 0) {
    lineas.push("Sin campos por confirmar.", "");
  } else {
    lineas.push("| Campo | Valor propuesto | Motivo |", "|---|---|---|");
    for (const campo of mapeo.requiere_confirmacion) {
      lineas.push(
        `| ${celda(campo.etiqueta)} | ${celda(valorVisible(campo))} | ${celda(campo.nota ?? "Confianza menor a 0.8")} |`,
      );
    }
    lineas.push("");
  }

  lineas.push("## Campos faltantes", "");
  if (mapeo.faltantes.length === 0) {
    lineas.push("Sin faltantes: todos los campos solicitados tienen fuente en el maestro.", "");
  } else {
    lineas.push("| Campo | Motivo |", "|---|---|");
    for (const campo of mapeo.faltantes) {
      lineas.push(`| ${celda(campo.etiqueta)} | ${celda(campo.nota ?? "Sin fuente en el maestro")} |`);
    }
    lineas.push("");
  }

  lineas.push("> Ningún valor de este reporte fue inventado: todos provienen del repositorio maestro.");
  return `${lineas.join("\n")}\n`;
}

export function renderValoresPortal(mapeo: Mapeo): string {
  const campos = [...mapeo.llenos, ...mapeo.requiere_confirmacion, ...mapeo.faltantes].sort(
    (a, b) => (a.orden ?? 0) - (b.orden ?? 0),
  );

  const lineas: string[] = [
    `# Valores para el portal — ${mapeo.caso}`,
    "",
    "**Formato no soportado: portal web.** El agente no ingresa credenciales ni envía formularios en portales.",
    "Copia estos valores manualmente. Los campos marcados como faltantes requieren que un humano los complete.",
    "",
    `- Cliente: ${mapeo.cliente}`,
    `- País: ${mapeo.pais}`,
    `- Fecha de referencia: ${mapeo.fecha_referencia}`,
    "",
    "| Campo | Valor | Estado |",
    "|---|---|---|",
  ];

  const confirmadas = new Set(mapeo.requiere_confirmacion.map((campo) => campo.etiqueta));
  const faltantes = new Set(mapeo.faltantes.map((campo) => campo.etiqueta));

  for (const campo of campos) {
    const estado = faltantes.has(campo.etiqueta)
      ? "FALTANTE"
      : confirmadas.has(campo.etiqueta)
        ? "REQUIERE CONFIRMACIÓN"
        : "OK";
    lineas.push(`| ${celda(campo.etiqueta)} | ${celda(valorVisible(campo))} | ${estado} |`);
  }

  lineas.push("", "> El ingreso de credenciales y el clic en «Enviar» son siempre humanos.");
  return `${lineas.join("\n")}\n`;
}

export function renderChecklist(
  datos: DatosCaso,
  checklist: Checklist,
  listoParaFirma: boolean,
  referencia: string,
): string {
  const lineas: string[] = [
    `# Checklist del paquete — ${datos.caso}`,
    "",
    `- Cliente: ${datos.cliente}`,
    `- País: ${datos.pais}`,
    `- Formato: ${datos.formato}`,
    `- Fecha de referencia: ${referencia}`,
    `- **Listo para firma: ${listoParaFirma ? "SÍ" : "NO"}**`,
    "",
    "## Soportes exigidos",
    "",
    "| Soporte | Estado | Vigencia hasta | Archivo |",
    "|---|---|---|---|",
  ];

  for (const soporte of checklist.soportes) {
    lineas.push(
      `| ${celda(soporte.tipo)} | ${soporte.estado.toUpperCase()} | ${celda(soporte.vigencia_hasta ?? "sin vencimiento")} | ${celda(soporte.archivo ?? "—")} |`,
    );
  }

  if (checklist.ausentes.length > 0) {
    lineas.push("", `**Soportes ausentes:** ${checklist.ausentes.join(", ")}`);
  }
  if (checklist.vencidos.length > 0) {
    lineas.push("", `**Soportes vencidos:** ${checklist.vencidos.join(", ")}`);
  }
  if (checklist.ausentes.length === 0 && checklist.vencidos.length === 0) {
    lineas.push("", "Todos los soportes exigidos están presentes y vigentes.");
  }

  lineas.push("", "## Campos faltantes (no bloquean la firma)", "");
  lineas.push(
    checklist.faltantes.length > 0 ? checklist.faltantes.map((item) => `- ${item}`).join("\n") : "Sin faltantes.",
  );

  lineas.push("", "## Campos que requieren confirmación", "");
  lineas.push(
    checklist.requieren_confirmacion.length > 0
      ? checklist.requieren_confirmacion.map((item) => `- ${item}`).join("\n")
      : "Sin campos por confirmar.",
  );

  lineas.push("", "> La firma y el envío son decisiones humanas. El agente solo prepara el paquete.");
  return `${lineas.join("\n")}\n`;
}

export function renderBorradorCorreo(
  datos: DatosCaso,
  checklist: Checklist,
  listoParaFirma: boolean,
  adjuntos: string[],
): string {
  const pendientesCampos = [...checklist.faltantes, ...checklist.requieren_confirmacion].filter(
    (etiqueta) => !esCampoBancario(etiqueta),
  );

  const lineas: string[] = [
    `Para: ${datos.solicitud.de}`,
    `Asunto: Re: ${datos.solicitud.asunto}`,
    "",
    "Estimados señores,",
    "",
    `Adjuntamos la documentación de Periferia IT Group S.A.S. para el registro como proveedor de ${datos.cliente}.`,
    "",
  ];

  if (adjuntos.length > 0) {
    lineas.push("Documentos adjuntos:");
    for (const archivo of adjuntos) lineas.push(`- ${archivo}`);
    lineas.push("");
  }

  if (checklist.ausentes.length > 0 || checklist.vencidos.length > 0) {
    lineas.push("Pendientes antes del envío:");
    for (const ausente of checklist.ausentes) lineas.push(`- Soporte ausente: ${ausente}`);
    for (const vencido of checklist.vencidos) lineas.push(`- Soporte vencido por actualizar: ${vencido}`);
    lineas.push("");
  }

  if (pendientesCampos.length > 0) {
    lineas.push("Campos por completar o confirmar:");
    for (const etiqueta of pendientesCampos) lineas.push(`- ${etiqueta}`);
    lineas.push("");
  }

  lineas.push(
    "Quedamos atentos a cualquier ajuste.",
    "",
    "Cordialmente,",
    "Periferia IT Group S.A.S.",
    "",
    "---",
    listoParaFirma
      ? "Borrador generado por el agente. Requiere revisión y envío por una persona."
      : "BORRADOR NO ENVIABLE: el paquete aún no está listo para firma. Ver checklist.md.",
  );
  lineas.push("Este borrador no incluye datos bancarios ni se envía automáticamente.");
  return `${lineas.join("\n")}\n`;
}

export function renderEnvioSimulado(
  datos: DatosCaso,
  listoParaFirma: boolean,
  motivos: string[],
  adjuntos: string[],
): string {
  const lineas: string[] = [
    `# ENVÍO SIMULADO — ${datos.caso}`,
    "",
    `- Fecha: ${new Date().toISOString()}`,
    `- Cliente: ${datos.cliente}`,
    `- Destinatario del borrador: ${datos.solicitud.de}`,
    `- Estado del paquete: ${listoParaFirma ? "LISTO PARA FIRMA" : "NO LISTO PARA FIRMA"}`,
    "",
  ];

  if (!listoParaFirma) {
    lineas.push(
      "## ADVERTENCIA",
      "",
      `El paquete no está listo para firma: ${motivos.join("; ")}.`,
      "El envío se simuló porque el usuario lo confirmó de forma explícita, pero no debe enviarse a producción en este estado.",
      "",
    );
  }

  lineas.push("## Adjuntos del paquete", "");
  if (adjuntos.length === 0) lineas.push("Sin adjuntos.");
  else for (const archivo of adjuntos) lineas.push(`- ${archivo}`);

  lineas.push(
    "",
    "> Este archivo reemplaza cualquier envío real en el alcance del reto. No se envió correo, no se cargó ningún portal y no se firmó nada.",
  );
  return `${lineas.join("\n")}\n`;
}
