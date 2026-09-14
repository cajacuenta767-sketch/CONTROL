/** Error de negocio con código HTTP. */
export class ErrorHttp extends Error {
  constructor(status, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

export const noEncontrado = (m = 'No encontrado') => new ErrorHttp(404, m);
export const prohibido = (m = 'No tienes permiso para esta acción') => new ErrorHttp(403, m);
export const invalido = (m, extra) => new ErrorHttp(422, m, extra);

// eslint-disable-next-line no-unused-vars
export function manejarErrores(err, req, res, next) {
  if (err instanceof ErrorHttp) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
}

/** Envuelve un handler async para que sus errores lleguen al manejador. */
export const asincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
