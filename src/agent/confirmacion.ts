import { normalizar } from "../tools/_lib/taxonomia";

const AFIRMATIVO =
  /^(si|confirmo|confirmado|ok|dale|envia|envialo|adelante|procede|hazlo|de acuerdo)\b/;

/** Heurística conservadora: solo un "sí" explícito habilita una acción externa. */
export function esMensajeAfirmativo(texto: string): boolean {
  return AFIRMATIVO.test(normalizar(texto));
}
