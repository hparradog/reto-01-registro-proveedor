/** Normaliza etiquetas: sin tildes, minúsculas, sin puntuación y con espacios simples. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Equivalente del identificador tributario según el país del cliente (RN1). */
export const IDENTIFICADOR_POR_PAIS: Readonly<Record<string, string>> = {
  CO: "NIT",
  EC: "RUC",
  PE: "RUC",
  PA: "RUC",
  HN: "RTN",
};

export function identificadorDePais(pais: string): string {
  return IDENTIFICADOR_POR_PAIS[pais.toUpperCase()] ?? "identificador tributario local";
}

export interface AnalisisTributario {
  requiereConfirmacion: boolean;
  nota: string;
}

/**
 * Detecta etiquetas tributarias y si requieren confirmación.
 * - "Identificación tributaria" / "Número de identificación fiscal" son genéricas (HU-1).
 * - Un identificador cuyo nombre no corresponde al país también requiere confirmación (RN1).
 */
export function analizarEtiquetaTributaria(
  etiqueta: string,
  pais: string,
): AnalisisTributario | null {
  const limpia = normalizar(etiqueta);
  const equivalente = identificadorDePais(pais);
  const generica =
    limpia.includes("identificacion tributaria") || limpia.includes("identificacion fiscal");
  const especifica = limpia === "nit" || limpia === "ruc" || limpia === "rtn";

  if (!generica && !especifica) return null;

  const notaBase = `La plantilla pide "${etiqueta}". Para ${pais} el equivalente es ${equivalente}; se propone el NIT colombiano del maestro y el campo requiere confirmación.`;

  if (generica) {
    return { requiereConfirmacion: true, nota: notaBase };
  }

  if (pais.toUpperCase() !== "CO") {
    return {
      requiereConfirmacion: true,
      nota: `identificador extranjero: Periferia solo tiene NIT colombiano; ${pais} usa ${equivalente}. Valor propuesto: NIT.`,
    };
  }

  if (limpia !== "nit") {
    return {
      requiereConfirmacion: true,
      nota: `El cliente está en CO y su identificador es NIT, pero la plantilla pide ${etiqueta.toUpperCase()}. Valor propuesto: NIT colombiano.`,
    };
  }

  return { requiereConfirmacion: false, nota: "" };
}

/** Distancia de Levenshtein para coincidencias aproximadas del glosario. */
export function distanciaLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const actual = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      const arriba = actual[j - 1] ?? 0;
      const izquierda = previa[j] ?? 0;
      const diagonal = previa[j - 1] ?? 0;
      actual.push(Math.min(arriba + 1, izquierda + 1, diagonal + costo));
    }
    previa = actual;
  }
  return previa[b.length] ?? Math.max(a.length, b.length);
}

export function similitud(a: string, b: string): number {
  const maximo = Math.max(a.length, b.length);
  if (maximo === 0) return 1;
  return 1 - distanciaLevenshtein(a, b) / maximo;
}
