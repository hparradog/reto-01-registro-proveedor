const CLAVE_SESION = "registro-proveedor-session";
const CLAVE_ACCESO = "registro-proveedor-access-key";

const estado = {
  sessionId: localStorage.getItem(CLAVE_SESION) || null,
  enviando: false,
};

const elementos = {
  chat: document.getElementById("chat"),
  messages: document.getElementById("messages"),
  welcome: document.getElementById("welcome"),
  thinking: document.getElementById("thinking"),
  form: document.getElementById("form"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  status: document.getElementById("status"),
  statusText: document.getElementById("statusText"),
  accessKey: document.getElementById("accessKey"),
  newSession: document.getElementById("newSession"),
  chips: document.getElementById("chips"),
};

elementos.accessKey.value = localStorage.getItem(CLAVE_ACCESO) || "";

function clave() {
  return elementos.accessKey.value.trim();
}

function cabeceras(extra = {}) {
  const resultado = { ...extra };
  if (clave()) resultado["x-access-key"] = clave();
  return resultado;
}

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(ruta, {
    ...opciones,
    headers: cabeceras(opciones.headers),
  });
  let cuerpo = null;
  try {
    cuerpo = await respuesta.json();
  } catch {
    cuerpo = null;
  }
  if (!respuesta.ok) {
    const mensaje =
      cuerpo && typeof cuerpo.error === "string"
        ? cuerpo.error
        : `El servidor respondió ${respuesta.status}.`;
    const error = new Error(mensaje);
    error.status = respuesta.status;
    throw error;
  }
  return cuerpo;
}

function alFinal() {
  elementos.chat.scrollTop = elementos.chat.scrollHeight;
}

function ocultarBienvenida() {
  elementos.welcome.hidden = true;
}

function burbuja(rol, texto, clase) {
  const contenedor = document.createElement("div");
  contenedor.className = `msg ${clase}`;

  const etiqueta = document.createElement("span");
  etiqueta.className = "rol";
  etiqueta.textContent = rol;

  const cuerpo = document.createElement("div");
  cuerpo.className = "burbuja";
  cuerpo.textContent = texto;

  contenedor.append(etiqueta, cuerpo);
  elementos.messages.append(contenedor);
  alFinal();
  return contenedor;
}

function agregarUsuario(texto) {
  burbuja("Tú", texto, "user");
}

function agregarAsistente(texto, toolCalls = [], necesitaConfirmacion = false) {
  const contenedor = document.createElement("div");
  contenedor.className = "msg assistant";

  const etiqueta = document.createElement("span");
  etiqueta.className = "rol";
  etiqueta.textContent = "Agente";

  if (texto || toolCalls.length === 0) {
    const cuerpo = document.createElement("div");
    cuerpo.className = "burbuja";
    cuerpo.textContent = texto || "(sin respuesta)";
    contenedor.append(etiqueta, cuerpo);
  }

  for (const llamada of toolCalls) {
    contenedor.append(tarjetaHerramienta(llamada));
  }

  if (necesitaConfirmacion) {
    contenedor.append(cajaConfirmacion());
  }

  elementos.messages.append(contenedor);
  alFinal();
}

function agregarError(texto) {
  burbuja("Aviso", texto, "error");
}

function agregarSistema(texto) {
  burbuja("Sistema", texto, "system");
}

function textoResultado(valor) {
  if (typeof valor === "string") {
    try {
      return JSON.stringify(JSON.parse(valor), null, 2);
    } catch {
      return valor;
    }
  }
  try {
    return JSON.stringify(valor, null, 2);
  } catch {
    return String(valor);
  }
}

function recolectarRutas(valor, acumuladas, profundidad = 0) {
  if (profundidad > 6 || acumuladas.size >= 12) return;
  if (typeof valor === "string") {
    if (/^out\/[^\s]+\.(xlsx|pdf|md|json|txt)$/.test(valor)) acumuladas.add(valor);
    return;
  }
  if (Array.isArray(valor)) {
    for (const item of valor) recolectarRutas(item, acumuladas, profundidad + 1);
    return;
  }
  if (valor && typeof valor === "object") {
    for (const item of Object.values(valor)) recolectarRutas(item, acumuladas, profundidad + 1);
  }
}

function nombreArchivo(ruta) {
  const partes = ruta.split("/");
  return partes[partes.length - 1] || ruta;
}

async function descargar(ruta) {
  try {
    const relativa = ruta.replace(/^out\//, "");
    const codificada = relativa.split("/").map(encodeURIComponent).join("/");
    const respuesta = await fetch(`/api/out/${codificada}`, { headers: cabeceras() });
    if (!respuesta.ok) {
      const cuerpo = await respuesta.json().catch(() => null);
      throw new Error(cuerpo?.error || "No se pudo descargar el archivo.");
    }
    const blob = await respuesta.blob();
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombreArchivo(ruta);
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    agregarError(`No se pudo descargar ${ruta}: ${error.message}`);
  }
}

function tarjetaHerramienta(llamada) {
  const detalles = document.createElement("details");
  detalles.className = `tool ${llamada.ok ? "ok" : "fallo"}`;

  const summary = document.createElement("summary");

  const marca = document.createElement("span");
  marca.className = "marca";
  marca.textContent = llamada.ok ? "✓" : "✕";

  const nombre = document.createElement("span");
  nombre.className = "nombre";
  nombre.textContent = llamada.name;

  const resumen = document.createElement("span");
  resumen.className = "resumen";
  resumen.textContent = llamada.resumen || "";

  summary.append(marca, nombre, resumen);

  const cuerpo = document.createElement("div");
  cuerpo.className = "cuerpo";

  const bloqueArgs = document.createElement("div");
  const tituloArgs = document.createElement("div");
  tituloArgs.className = "etiqueta";
  tituloArgs.textContent = "Argumentos";
  const preArgs = document.createElement("pre");
  preArgs.textContent = textoResultado(llamada.args);
  bloqueArgs.append(tituloArgs, preArgs);

  const bloqueResultado = document.createElement("div");
  const tituloResultado = document.createElement("div");
  tituloResultado.className = "etiqueta";
  tituloResultado.textContent = "Resultado";
  const preResultado = document.createElement("pre");
  preResultado.textContent = textoResultado(llamada.resultado);
  bloqueResultado.append(tituloResultado, preResultado);

  cuerpo.append(bloqueArgs, bloqueResultado);

  const rutas = new Set();
  try {
    recolectarRutas(JSON.parse(llamada.resultado), rutas);
  } catch {
    recolectarRutas(llamada.resultado, rutas);
  }
  if (rutas.size > 0) {
    const descargas = document.createElement("div");
    descargas.className = "descargas";
    for (const ruta of rutas) {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.textContent = `Descargar ${nombreArchivo(ruta)}`;
      boton.addEventListener("click", () => descargar(ruta));
      descargas.append(boton);
    }
    cuerpo.append(descargas);
  }

  detalles.append(summary, cuerpo);
  return detalles;
}

function cajaConfirmacion() {
  const caja = document.createElement("div");
  caja.className = "confirmacion";

  const titulo = document.createElement("strong");
  titulo.textContent = "Requiere tu confirmación";

  const texto = document.createElement("div");
  texto.textContent =
    "El paquete está armado. El agente no enviará ni firmará nada sin tu confirmación explícita.";

  const acciones = document.createElement("div");
  acciones.className = "acciones";

  const si = document.createElement("button");
  si.type = "button";
  si.className = "si";
  si.textContent = "Sí, preparar envío simulado";

  const no = document.createElement("button");
  no.type = "button";
  no.className = "no";
  no.textContent = "No, esperar";

  si.addEventListener("click", () => {
    si.disabled = true;
    no.disabled = true;
    enviar("Sí, confirma el envío del paquete.");
  });
  no.addEventListener("click", () => {
    si.disabled = true;
    no.disabled = true;
    enviar("No, espera. No envíes nada por ahora.");
  });

  acciones.append(si, no);
  caja.append(titulo, texto, acciones);
  return caja;
}

function mostrarPensando(visible) {
  elementos.thinking.hidden = !visible;
  elementos.send.disabled = visible;
  elementos.input.disabled = visible;
  if (visible) alFinal();
}

async function enviar(texto) {
  const mensaje = (texto ?? elementos.input.value).trim();
  if (!mensaje || estado.enviando) return;

  estado.enviando = true;
  ocultarBienvenida();
  agregarUsuario(mensaje);
  elementos.input.value = "";
  ajustarAltura();
  mostrarPensando(true);

  try {
    const respuesta = await api("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(estado.sessionId ? { sessionId: estado.sessionId } : {}),
        message: mensaje,
      }),
    });

    if (respuesta?.sessionId) {
      estado.sessionId = respuesta.sessionId;
      localStorage.setItem(CLAVE_SESION, respuesta.sessionId);
    }

    agregarAsistente(
      respuesta?.reply || "(sin respuesta)",
      Array.isArray(respuesta?.toolCalls) ? respuesta.toolCalls : [],
      respuesta?.needsConfirmation === true,
    );
  } catch (error) {
    if (error.status === 401) {
      agregarError("La clave de acceso es obligatoria o no es válida. Escríbela arriba y reintenta.");
      elementos.accessKey.focus();
    } else {
      agregarError(error.message || "No se pudo completar la solicitud.");
    }
  } finally {
    estado.enviando = false;
    mostrarPensando(false);
    elementos.input.focus();
  }
}

function ajustarAltura() {
  elementos.input.style.height = "auto";
  elementos.input.style.height = `${Math.min(elementos.input.scrollHeight, 160)}px`;
}

async function verificarSalud() {
  try {
    const salud = await api("/api/health");
    elementos.status.classList.remove("warn");
    elementos.status.classList.add(salud.llmConfigured ? "ok" : "warn");
    elementos.statusText.textContent = salud.llmConfigured
      ? `${salud.provider} · ${salud.model}`
      : `${salud.provider} · sin clave configurada`;
    if (!salud.llmConfigured) {
      agregarSistema(
        "El backend no tiene clave del modelo. Define ANTHROPIC_API_KEY o arranca con LLM_PROVIDER=mock para probar el flujo.",
      );
    }
  } catch (error) {
    elementos.status.classList.remove("ok");
    elementos.status.classList.add("warn");
    elementos.statusText.textContent =
      error.status === 401 ? "Clave de acceso requerida" : "Servidor no disponible";
  }
}

async function restaurarSesion() {
  if (!estado.sessionId) return;
  try {
    const sesion = await api(`/api/sessions/${encodeURIComponent(estado.sessionId)}`);
    if (!sesion || !Array.isArray(sesion.mensajes) || sesion.mensajes.length === 0) return;

    ocultarBienvenida();
    const resultados = new Map();
    for (const llamada of sesion.toolCalls || []) resultados.set(llamada.id, llamada);

    for (const mensaje of sesion.mensajes) {
      if (mensaje.role === "user") {
        agregarUsuario(mensaje.text);
      } else if (mensaje.role === "assistant") {
        const tarjetas = (mensaje.toolCalls || [])
          .map((llamada) => resultados.get(llamada.id))
          .filter(Boolean);
        agregarAsistente(mensaje.text || "", tarjetas, false);
      }
    }

    if (sesion.pendingConfirmation) {
      const contenedor = document.createElement("div");
      contenedor.className = "msg assistant";
      const caja = cajaConfirmacion();
      contenedor.append(caja);
      elementos.messages.append(contenedor);
      alFinal();
    }
  } catch {
    localStorage.removeItem(CLAVE_SESION);
    estado.sessionId = null;
  }
}

function nuevaSesion() {
  localStorage.removeItem(CLAVE_SESION);
  estado.sessionId = null;
  elementos.messages.replaceChildren();
  elementos.welcome.hidden = false;
  agregarSistema("Sesión nueva. Elige un caso para empezar.");
  elementos.input.focus();
}

elementos.form.addEventListener("submit", (evento) => {
  evento.preventDefault();
  enviar();
});

elementos.input.addEventListener("input", ajustarAltura);
elementos.input.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault();
    enviar();
  }
});

elementos.newSession.addEventListener("click", nuevaSesion);

elementos.accessKey.addEventListener("change", () => {
  const valor = clave();
  if (valor) localStorage.setItem(CLAVE_ACCESO, valor);
  else localStorage.removeItem(CLAVE_ACCESO);
  verificarSalud();
});

elementos.chips.addEventListener("click", (evento) => {
  const boton = evento.target.closest("button[data-prompt]");
  if (!boton) return;
  enviar(boton.dataset.prompt);
});

ajustarAltura();
verificarSalud();
restaurarSesion();
