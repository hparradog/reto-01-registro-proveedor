/** Error de negocio con mensaje apto para mostrarse al usuario y al modelo. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
