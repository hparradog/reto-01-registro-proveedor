export type ProveedorLlm = "anthropic" | "openrouter" | "mock";

export interface Config {
  port: number;
  hostname: string;
  proveedor: ProveedorLlm;
  /** Modelo del proveedor seleccionado, para /api/health y los mensajes. */
  modelo: string;
  openrouterApiKey: string | null;
  openrouterModel: string;
  openrouterBaseUrl: string;
  openrouterAppUrl: string | null;
  anthropicApiKey: string | null;
  anthropicModel: string;
  maxIteraciones: number;
  maxOutputTokens: number;
  tokenLimit: number;
  timeoutMs: number;
  maxMessageChars: number;
  rateLimitPorMinuto: number;
  accessKey: string | null;
}

function entero(valor: string | undefined, defecto: number, minimo: number, maximo: number): number {
  if (!valor) return defecto;
  const numero = Number.parseInt(valor, 10);
  if (!Number.isFinite(numero)) return defecto;
  return Math.min(Math.max(numero, minimo), maximo);
}

function texto(valor: string | undefined): string | null {
  const limpio = valor?.trim();
  return limpio ? limpio : null;
}

function proveedorDe(valor: string | undefined): ProveedorLlm {
  const limpio = (valor ?? "openrouter").trim().toLowerCase();
  if (limpio === "mock") return "mock";
  if (limpio === "anthropic") return "anthropic";
  return "openrouter";
}

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const proveedor = proveedorDe(env.LLM_PROVIDER);

  const openrouterModel = texto(env.OPENROUTER_MODEL) ?? "anthropic/claude-sonnet-5.5";
  const anthropicModel = texto(env.ANTHROPIC_MODEL) ?? "claude-sonnet-4-6";
  const modelo =
    proveedor === "openrouter"
      ? openrouterModel
      : proveedor === "anthropic"
        ? anthropicModel
        : "mock-script";

  return {
    port: entero(env.PORT, 3000, 1, 65535),
    hostname: env.HOST ?? "0.0.0.0",
    proveedor,
    modelo,
    openrouterApiKey: texto(env.OPENROUTER_API_KEY),
    openrouterModel,
    openrouterBaseUrl: texto(env.OPENROUTER_BASE_URL) ?? "https://openrouter.ai/api/v1",
    openrouterAppUrl: texto(env.OPENROUTER_APP_URL),
    anthropicApiKey: texto(env.ANTHROPIC_API_KEY),
    anthropicModel,
    maxIteraciones: entero(env.AGENT_MAX_ITERATIONS, 25, 1, 60),
    maxOutputTokens: entero(env.AGENT_MAX_OUTPUT_TOKENS, 4096, 256, 8192),
    tokenLimit: entero(env.SESSION_TOKEN_LIMIT, 200_000, 10_000, 2_000_000),
    timeoutMs: entero(env.LLM_TIMEOUT_MS, 60_000, 5_000, 300_000),
    maxMessageChars: entero(env.MAX_MESSAGE_CHARS, 4_000, 100, 20_000),
    rateLimitPorMinuto: entero(env.RATE_LIMIT_PER_MINUTE, 20, 1, 1_000),
    accessKey: texto(env.ACCESS_KEY),
  };
}
