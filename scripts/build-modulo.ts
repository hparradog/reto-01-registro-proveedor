/**
 * Genera y valida el módulo reutilizable `modulo/` a partir de las piezas
 * que usa la aplicación. No se escribe a mano: así no hay copias divergentes.
 *
 *   bun run scripts/build-modulo.ts build
 *   bun run scripts/build-modulo.ts check
 */
import path from "node:path";
import { mkdir, readdir, readFile, writeFile, access } from "node:fs/promises";

const RAIZ = path.resolve(import.meta.dir, "..");
const MODULO = path.join(RAIZ, "modulo");

interface Archivo {
  ruta: string;
  contenido: string;
}

async function leer(ruta: string): Promise<string> {
  return readFile(ruta, "utf8");
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

function frontmatter(campos: string[], cuerpo: string): string {
  return ["---", ...campos, "---", "", cuerpo.trim(), ""].join("\n");
}

async function construirArchivos(): Promise<Archivo[]> {
  const prompt = await leer(path.join(RAIZ, "agent", "prompt.md"));
  const conocimiento = await leer(path.join(RAIZ, "src", "knowledge", "registro-proveedor.md"));
  const herramientas = await leer(path.join(RAIZ, "src", "tools", "proveedor.ts"));

  const archivos: Archivo[] = [
    {
      ruta: "agent.md",
      contenido: frontmatter(
        [
          "description: Prepara registros de Periferia como proveedor: lee solicitudes,",
          "  llena formularios y arma el paquete para firma sin enviar ni firmar nada.",
          "mode: primary",
          "permission:",
          "  edit: deny",
          "  bash: deny",
        ],
        prompt,
      ),
    },
    {
      ruta: "skill/registro-proveedor/SKILL.md",
      contenido: frontmatter(
        [
          "name: registro-proveedor",
          "description: Conocimiento del proceso de registro como proveedor de Periferia",
          "  IT Group: casos, repositorio maestro, identificadores por país, soportes,",
          "  vigencias, formatos de salida y reparto de trabajo entre agente y humano.",
        ],
        conocimiento,
      ),
    },
    { ruta: "tools/proveedor.ts", contenido: herramientas },
    {
      ruta: "package.json",
      contenido: `${JSON.stringify(
        {
          name: "periferia-registro-proveedor-modulo",
          version: "1.0.0",
          private: true,
          type: "module",
          description:
            "Módulo reutilizable del agente de registro como proveedor (sin servidor HTTP).",
          dependencies: {
            exceljs: "^4.4.0",
            pdfkit: "^0.17.2",
            zod: "^3.25.76",
          },
        },
        null,
        2,
      )}\n`,
    },
    {
      ruta: "README.md",
      contenido: [
        "# Módulo reutilizable — Registro como proveedor",
        "",
        "Estas piezas son las mismas que usa la aplicación web. Se generan con",
        "`bun run build:modulo` y se validan con `bun run check:modulo`.",
        "",
        "## Contenido",
        "",
        "- `agent.md`: frontmatter con `mode: primary` y permisos de edición/bash denegados;",
        "  el cuerpo es `agent/prompt.md`.",
        "- `tools/proveedor.ts`: las herramientas tipadas con zod, sin servidor HTTP.",
        "- `tools/_lib/`: soporte interno de las herramientas (validación, mapeo, render).",
        "- `skill/registro-proveedor/SKILL.md`: el conocimiento de `src/knowledge/`.",
        "",
        "## Uso en otra plataforma de agentes",
        "",
        "1. Copia `modulo/` al proyecto destino.",
        "2. Instala las dependencias de `package.json` (zod, exceljs, pdfkit).",
        "3. Publica las herramientas como `<archivo>_<export>`; el resultado es",
        "   `proveedor_leer_solicitud`, `proveedor_mapear_campos`,",
        "   `proveedor_generar_formulario`, `proveedor_armar_paquete` y",
        "   `proveedor_simular_envio`.",
        "4. Entrega a cada herramienta un `ctx` con `{ directory, sessionId }`, donde",
        "   `directory` apunta a la raíz que contiene `fixtures/reto-01/`. Las",
        "   herramientas solo escriben dentro de `out/`.",
        "",
        "Las herramientas no ejecutan shell, no acceden a red y nunca lanzan:",
        "devuelven `{ ok: true, data }` o `{ ok: false, error }`.",
        "",
      ].join("\n"),
    },
  ];

  const dirLib = path.join(RAIZ, "src", "tools", "_lib");
  const archivosLib = (await readdir(dirLib))
    .filter((archivo) => archivo.endsWith(".ts"))
    .sort();
  for (const archivo of archivosLib) {
    archivos.push({
      ruta: `tools/_lib/${archivo}`,
      contenido: await leer(path.join(dirLib, archivo)),
    });
  }

  return archivos;
}

async function construir(): Promise<void> {
  const archivos = await construirArchivos();
  for (const archivo of archivos) {
    const destino = path.join(MODULO, archivo.ruta);
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, archivo.contenido, "utf8");
  }
  console.log(`Módulo generado: ${archivos.length} archivos en modulo/`);
}

async function verificar(): Promise<void> {
  const archivos = await construirArchivos();
  const divergentes: string[] = [];

  for (const archivo of archivos) {
    const destino = path.join(MODULO, archivo.ruta);
    if (!(await existe(destino))) {
      divergentes.push(`${archivo.ruta}: falta`);
      continue;
    }
    const actual = await readFile(destino, "utf8");
    if (actual !== archivo.contenido) divergentes.push(`${archivo.ruta}: distinto`);
  }

  if (divergentes.length > 0) {
    console.error("El módulo no está sincronizado con la aplicación:");
    for (const item of divergentes) console.error(`- ${item}`);
    console.error("Ejecuta: bun run build:modulo");
    process.exit(1);
  }

  console.log(`Módulo sincronizado: ${archivos.length} archivos verificados.`);
}

const accion = process.argv[2] ?? "check";
if (accion === "build") await construir();
else if (accion === "check") await verificar();
else {
  console.error("Uso: bun run scripts/build-modulo.ts [build|check]");
  process.exit(1);
}
