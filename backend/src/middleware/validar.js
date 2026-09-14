import { ErrorHttp } from './errores.js';

/** Valida req.body (o query/params) con un esquema zod y deja el resultado en req.datos. */
export const validar = (esquema, origen = 'body') => (req, res, next) => {
  const r = esquema.safeParse(req[origen]);
  if (!r.success) {
    const detalles = r.error.issues.map((i) => `${i.path.join('.') || 'campo'}: ${i.message}`);
    return next(new ErrorHttp(422, 'Datos inválidos', { detalles }));
  }
  req.datos = r.data;
  next();
};
