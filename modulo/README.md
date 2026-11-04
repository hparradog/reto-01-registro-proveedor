# Módulo reutilizable — Registro como proveedor

Estas piezas son las mismas que usa la aplicación web. Se generan con
`bun run build:modulo` y se validan con `bun run check:modulo`.

## Contenido

- `agent.md`: frontmatter con `mode: primary` y permisos de edición/bash denegados;
  el cuerpo es `agent/prompt.md`.
- `tools/proveedor.ts`: las herramientas tipadas con zod, sin servidor HTTP.
- `tools/_lib/`: soporte interno de las herramientas (validación, mapeo, render).
- `skill/registro-proveedor/SKILL.md`: el conocimiento de `src/knowledge/`.

## Uso en otra plataforma de agentes

1. Copia `modulo/` al proyecto destino.
2. Instala las dependencias de `package.json` (zod, exceljs, pdfkit).
3. Publica las herramientas como `<archivo>_<export>`; el resultado es
   `proveedor_leer_solicitud`, `proveedor_mapear_campos`,
   `proveedor_generar_formulario`, `proveedor_armar_paquete` y
   `proveedor_simular_envio`.
4. Entrega a cada herramienta un `ctx` con `{ directory, sessionId }`, donde
   `directory` apunta a la raíz que contiene `fixtures/reto-01/`. Las
   herramientas solo escriben dentro de `out/`.

Las herramientas no ejecutan shell, no acceden a red y nunca lanzan:
devuelven `{ ok: true, data }` o `{ ok: false, error }`.
