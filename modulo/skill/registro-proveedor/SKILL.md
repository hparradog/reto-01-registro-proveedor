---
name: registro-proveedor
description: Conocimiento del proceso de registro como proveedor de Periferia
  IT Group: casos, repositorio maestro, identificadores por país, soportes,
  vigencias, formatos de salida y reparto de trabajo entre agente y humano.
---

# Proceso de registro como proveedor

## Qué hace este proceso

Un cliente pide que Periferia IT Group se registre como proveedor. Recepción recibe un correo y lo deja como caso en `fixtures/reto-01/casos/<caso>/`. La analista administrativa usa el agente para leer la solicitud, llenar el formulario con datos del repositorio maestro, reunir los soportes y preparar el paquete para firma del representante legal.

El agente no firma, no envía y no opera portales. Prepara; la persona decide.

## Archivos de un caso

| Archivo | Uso |
|---|---|
| `solicitud.json` | Correo normalizado: país, cliente, formato, cuerpo y adjuntos. |
| `plantilla-celdas.json` | Solo Excel: hoja, celda de etiqueta, etiqueta y celda de valor. |
| `plantilla-campos.json` | Solo PDF: lista ordenada de etiquetas y obligatoriedad. |
| `soportes-exigidos.json` | Tipos de soporte que exige el cliente. |

Un caso de portal web no trae plantilla. En ese caso se usan estos campos estándar: razón social, identificación tributaria, dirección, teléfono, correo electrónico y representante legal. No se agregan datos bancarios porque nadie los pidió.

## Repositorio maestro

- `fixtures/reto-01/repositorio/maestro.json`: datos de Periferia (ficticios). Claves en `snake_case`, algunas anidadas (`banco.numero_cuenta`, `representante_legal.nombre`).
- `fixtures/reto-01/repositorio/soportes/index.json`: soportes disponibles, con `vigencia_hasta` y `pais_emisor`.
- `fixtures/reto-01/glosario-campos.json`: sinónimos que usan los clientes y su clave en el maestro.

El maestro puede estar incompleto. Cuando falta un valor, el campo es `faltante`. Nunca se completa con un valor plausible.

## Estados de un campo

| Estado | Significado |
|---|---|
| `lleno` | Se encontró la clave en el maestro y tiene valor. Se informa la ruta del dato. |
| `faltante` | No hay clave equivalente o la clave existe sin valor. No se inventa nada. |
| `requiere_confirmacion` | Coincidencia con confianza menor a 0.8, etiqueta ambigua o regla de país. Se propone un valor y se pide revisión humana. |

## Identificador tributario por país (RN1)

| País | Nombre local |
|---|---|
| CO | NIT |
| EC | RUC |
| PE | RUC |
| PA | RUC |
| HN | RTN |

Periferia solo tiene NIT colombiano. Para clientes de otros países el formulario se llena con ese NIT y el campo queda en `requiere_confirmacion` con la nota «identificador extranjero». Etiquetas genéricas como «Identificación tributaria» o «Número de identificación fiscal» también requieren confirmación, porque el nombre local cambia según el país.

## Datos bancarios (RN2)

Se llenan solo si la plantilla los pide de forma explícita (por ejemplo, una hoja «Datos Bancarios» o los campos Banco, Número de cuenta, SWIFT). Nunca se incluyen en `borrador-correo.md` ni se repiten innecesariamente en el chat.

## Vigencias y bloqueos (RN3)

- Un soporte con `vigencia_hasta` anterior a la fecha de referencia está **vencido**.
- Una vigencia `null` significa que el soporte no vence.
- Un soporte exigido **ausente** o **vencido** bloquea `listo_para_firma`.
- Un campo `faltante` **no** bloquea la firma, pero aparece en el checklist y en el borrador de correo.

El agente no copia al paquete los soportes vencidos: los lista para que la analista los actualice.

## Alias de soportes

| El cliente pide | Se busca en el índice |
|---|---|
| `camara_comercio`, `certificado_existencia`, `certificado_existencia_legal` | `camara_comercio` |
| `rut`, `registro_tributario` | `rut` |
| `certificacion_bancaria`, `certificado_bancario` | `certificacion_bancaria` |
| `parafiscales`, `certificacion_parafiscales` | `parafiscales` |
| `estados_financieros` | `estados_financieros` |
| `certificado_cumplimiento_tributario` | No existe en el repositorio: se reporta ausente |

## Formatos de salida

| Formato | Salida | Regla |
|---|---|---|
| `xlsx` | `out/<caso>/formulario.xlsx` | Etiqueta y valor en la hoja y celda exactas de `plantilla-celdas.json`. Faltante: celda vacía con relleno amarillo. Confirmación: valor con relleno naranja. |
| `pdf` | `out/<caso>/formulario.pdf` | PDF generado (no AcroForm) con todos los campos en el orden de `plantilla-campos.json`. Faltante: «— FALTANTE —». |
| `portal` | `out/<caso>/valores-portal.md` | No se implementa el llenado. «Formato no soportado» y valores listos para copiar. |

Además se genera `out/<caso>/reporte-faltantes.md`.

## Paquete para firma

`out/<caso>/paquete/` contiene:

- el formulario generado;
- copias de los soportes exigidos presentes y vigentes, en `soportes/`;
- `checklist.md` con presentes, ausentes y vencidos;
- `borrador-correo.md` sin datos bancarios;
- `estado.json` con el resultado para el envío simulado.

El envío simulado escribe `out/<caso>/ENVIO-SIMULADO.md` y nada más. No hay correo real, ni firma, ni portal.

## Registro de actividad (RN5)

Cada herramienta escribe una línea en `out/<caso>/log.jsonl` con `{ ts, herramienta, ok, resumen }`. El ciclo del agente además escribe `out/log.jsonl`. Los resúmenes no incluyen valores sensibles.

## Portales web: qué haría el agente y qué hace el humano

El agente prepara `valores-portal.md`. Una persona ingresa las credenciales en el navegador, resuelve CAPTCHA o MFA, revisa los valores y hace clic en «Enviar». El agente nunca recibe contraseñas. En producción se podría añadir un navegador controlado (Playwright) con humano en el bucle, pero el ingreso de credenciales y el envío siguen siendo humanos.
