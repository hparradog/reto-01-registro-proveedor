export type Formato = "xlsx" | "pdf" | "portal";

export interface Solicitud {
  id: string;
  de: string;
  para?: string;
  asunto: string;
  fecha: string;
  pais: string;
  cliente: string;
  formato: Formato;
  cuerpo: string;
  adjuntos: string[];
}

export interface CampoPlantilla {
  etiqueta: string;
  obligatorio: boolean;
  origen: "plantilla" | "estandar_portal";
  hoja?: string;
  celda_etiqueta?: string;
  celda_valor?: string;
}

export interface DatosCaso {
  caso: string;
  solicitud: Solicitud;
  formato: Formato;
  pais: string;
  cliente: string;
  campos: CampoPlantilla[];
  soportes: string[];
  advertencias: string[];
}

export interface EstadoCampo {
  etiqueta: string;
  clave?: string;
  ruta?: string;
  valor?: string | number;
  visual?: string;
  confianza: number;
  nota?: string;
  obligatorio: boolean;
  orden?: number;
  hoja?: string;
  celda_etiqueta?: string;
  celda_valor?: string;
}

export interface Mapeo {
  caso: string;
  pais: string;
  cliente: string;
  formato: Formato;
  fecha_referencia: string;
  llenos: EstadoCampo[];
  faltantes: EstadoCampo[];
  requiere_confirmacion: EstadoCampo[];
}

export type EstadoSoporte = "presente" | "ausente" | "vencido";

export interface SoporteChecklist {
  tipo: string;
  estado: EstadoSoporte;
  archivo?: string;
  vigencia_hasta?: string | null;
  descripcion?: string;
}

export interface Checklist {
  soportes: SoporteChecklist[];
  faltantes: string[];
  requieren_confirmacion: string[];
  vencidos: string[];
  ausentes: string[];
}

export interface PaqueteResultado {
  ruta: string;
  listo_para_firma: boolean;
  checklist: Checklist;
  advertencias: string[];
}
