import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { cargarConfig } from "./agent/config";
import { ejecutarTurno, type LoopDeps } from "./agent/loop";
import { definicionesParaModelo, listarHerramientas } from "./agent/registry";
import { validarSessionId, SessionStore } from "./agent/session";
import { AnthropicAdapter } from "./llm/anthropic";
import { OpenRouterAdapter } from "./llm/openrouter";
import { crearMockPorDefecto } from "./llm/mock";
import type { LlmAdapter } from "./llm/adapter";
import { estaContenida, outRoot } from "./tools/_lib/paths";
import { mensajeClaro } from "./tools/_lib/result";

const directory = path.resolve(import.meta.dir, "..");
const config = cargarConfig();

function crearAdapter(): LlmAdapter | null {
  if (config.proveedor === "mock") return crearMockPorDefecto();

  if (config.proveedor === "openrouter") {
    if (!config.openrouterApiKey) return null;
    return new OpenRouterAdapter({
      apiKey: config.openrouterApiKey,
      model: config.openrouterModel,
      timeoutMs: config.timeoutMs,
      baseUrl: config.openrouterBaseUrl,
      ...(config.openrouterAppUrl ? { appUrl: config.openrouterAppUrl } : {}),
    });
  }

  if (!config.anthropicApiKey) return null;
  return new AnthropicAdapter({
    apiKey: config.anthropicApiKey,
    model: config.anthropicModel,
    timeoutMs: config.timeoutMs,
  });
}

const adapter: LlmAdapter | null = crearAdapter();

const sesiones = new SessionStore(directory);
const herramientas = listarHerramientas();

async function cargarSystemPrompt(): Promise<string> {
  const prompt = await readFile(path.join(directory, "agent", "prompt.md"), "utf8");
  const conocimiento = await readFile(
    path.join(directory, "src", "knowledge", "registro-proveedor.md"),
    "utf8",
  );
  return [
    prompt.trim(),
    "",
    "---",
    "",
    "# Conocimiento del proceso de registro de proveedores",
    "",
    conocimiento.trim(),
  ].join("\n");
}

const systemPrompt = await cargarSystemPrompt();

const deps: LoopDeps = {
  adapter: adapter ?? crearMockPorDefecto(),
  herramientas,
  definiciones: definicionesParaModelo(),
  systemPrompt,
  sesiones,
  directory,
  limites: {
    maxIteraciones: config.maxIteraciones,
    tokenLimit: config.tokenLimit,
    maxMessageChars: config.maxMessageChars,
  },
  timeoutMs: config.timeoutMs,
  maxOutputTokens: config.maxOutputTokens,
};

const ChatSchema = z.object({
  sessionId: z.string().min(1).max(64).optional(),
  message: z.string().min(1).max(20_000),
});

const intentosPorIp = new Map<string, number[]>();

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function claveValida(req: Request): boolean {
  if (!config.accessKey) return true;
  const cabecera = req.headers.get("x-access-key");
  if (cabecera === config.accessKey) return true;
  const autorizacion = req.headers.get("authorization");
  return autorizacion === `Bearer ${config.accessKey}`;
}

function ipDe(req: Request): string {
  const reenviada = req.headers.get("x-forwarded-for");
  if (reenviada) return reenviada.split(",")[0]?.trim() || "desconocida";
  return "local";
}

function limitado(req: Request): boolean {
  const ip = ipDe(req);
  const ahora = Date.now();
  const previos = (intentosPorIp.get(ip) ?? []).filter((marca) => ahora - marca < 60_000);
  if (previos.length >= config.rateLimitPorMinuto) {
    intentosPorIp.set(ip, previos);
    return true;
  }
  previos.push(ahora);
  intentosPorIp.set(ip, previos);
  if (intentosPorIp.size > 5_000) intentosPorIp.clear();
  return false;
}

const TIPOS: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain; charset=utf-8",
};

async function servirArchivo(rutaAbsoluta: string, descargar: boolean): Promise<Response> {
  const archivo = Bun.file(rutaAbsoluta);
  if (!(await archivo.exists())) return json({ error: "Archivo no encontrado." }, 404);
  const extension = path.extname(rutaAbsoluta).toLowerCase();
  const cabeceras: Record<string, string> = {
    "content-type": TIPOS[extension] ?? "application/octet-stream",
    "cache-control": descargar ? "no-store" : "no-cache",
  };
  if (descargar) {
    cabeceras["content-disposition"] = `attachment; filename="${path.basename(rutaAbsoluta)}"`;
  }
  return new Response(archivo, { headers: cabeceras });
}

async function manejarApi(req: Request, url: URL): Promise<Response> {
  // El healthcheck de la plataforma no envía la clave: solo expone proveedor y modelo.
  if (url.pathname === "/api/health" && req.method === "GET") {
    return json({
      ok: true,
      provider: adapter?.provider ?? config.proveedor,
      model: adapter?.model ?? config.modelo,
      llmConfigured: adapter !== null,
    });
  }

  if (!claveValida(req)) {
    return json({ error: "Clave de acceso inválida o ausente." }, 401);
  }

  if (url.pathname === "/api/chat" && req.method === "POST") {
    if (limitado(req)) {
      return json({ error: "Demasiadas solicitudes. Espera un minuto antes de reintentar." }, 429);
    }
    if (!adapter) {
      const variable =
        config.proveedor === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY";
      return json(
        {
          error: `El modelo no está configurado. Define ${variable} en el backend o usa LLM_PROVIDER=mock.`,
        },
        503,
      );
    }

    let cuerpo: unknown;
    try {
      const texto = await req.text();
      if (texto.length > 64_000) return json({ error: "Solicitud demasiado grande." }, 413);
      cuerpo = JSON.parse(texto);
    } catch {
      return json({ error: "El cuerpo debe ser JSON válido." }, 400);
    }

    const validado = ChatSchema.safeParse(cuerpo);
    if (!validado.success) {
      return json({ error: "Se esperaba { sessionId?: string, message: string }." }, 400);
    }

    const sessionId = validado.data.sessionId ?? crypto.randomUUID();
    try {
      validarSessionId(sessionId);
    } catch (error) {
      return json({ error: mensajeClaro(error) }, 400);
    }

    try {
      const resultado = await ejecutarTurno(deps, sessionId, validado.data.message);
      return json(resultado);
    } catch (error) {
      return json({ error: mensajeClaro(error) }, 500);
    }
  }

  if (url.pathname.startsWith("/api/sessions/") && req.method === "GET") {
    const crudo = url.pathname.slice("/api/sessions/".length);
    let id: string;
    try {
      id = decodeURIComponent(crudo);
    } catch {
      return json({ error: "Identificador de sesión con codificación inválida." }, 400);
    }
    try {
      validarSessionId(id);
    } catch (error) {
      return json({ error: mensajeClaro(error) }, 400);
    }
    if (!(await sesiones.existe(id))) {
      return json({ error: `No existe la sesión "${id}".` }, 404);
    }
    return json(await sesiones.obtener(id));
  }

  if (url.pathname.startsWith("/api/out/") && req.method === "GET") {
    let relativa: string;
    try {
      relativa = decodeURIComponent(url.pathname.slice("/api/out/".length));
    } catch {
      return json({ error: "Ruta con codificación inválida." }, 400);
    }
    const base = outRoot(directory);
    const destino = path.resolve(base, relativa);
    if (!estaContenida(base, destino)) {
      return json({ error: "Ruta fuera de out/." }, 400);
    }
    return servirArchivo(destino, true);
  }

  return json({ error: "Ruta de API no encontrada." }, 404);
}

async function manejar(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname.startsWith("/api/")) {
    return manejarApi(req, url);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return json({ error: "Método no permitido." }, 405);
  }

  let relativa = "index.html";
  if (url.pathname !== "/") {
    try {
      relativa = decodeURIComponent(url.pathname.slice(1));
    } catch {
      return json({ error: "Ruta inválida." }, 400);
    }
  }
  const base = path.join(directory, "web");
  const destino = path.resolve(base, relativa);
  if (!estaContenida(base, destino)) {
    return json({ error: "Ruta inválida." }, 400);
  }
  return servirArchivo(destino, false);
}

const servidor = Bun.serve({
  port: config.port,
  hostname: config.hostname,
  maxRequestBodySize: 128 * 1024,
  fetch: manejar,
  error(error) {
    console.error("Error no controlado en el servidor:", mensajeClaro(error));
    return json({ error: "Error interno del servidor." }, 500);
  },
});

console.log(`Servidor escuchando en http://localhost:${servidor.port}`);
console.log(
  `Proveedor: ${adapter?.provider ?? config.proveedor} · modelo: ${adapter?.model ?? config.modelo} · configurado: ${adapter !== null}`,
);
if (config.accessKey) console.log("Protección con ACCESS_KEY activa.");
