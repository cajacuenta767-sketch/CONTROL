import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto por petición (IP, usuario) accesible desde los servicios sin pasarlo
 * a mano. Lo usa `auditar()` para registrar la IP de cada acción del panel.
 */
export const contexto = new AsyncLocalStorage();

export function middlewareContexto(req, res, next) {
  contexto.run({ ip: req.ip, usuarioId: null }, () => next());
}

export function ipActual() {
  return contexto.getStore()?.ip ?? null;
}
