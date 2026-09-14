import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { ajuste, guardarAjuste } from './db.js';
import { config } from './config.js';

let par;

/**
 * Par de claves Ed25519 de la agencia. Se genera una vez y se guarda en la tabla
 * `ajustes` (respáldala junto con la base de datos). La clave pública se embebe
 * en cada producto para verificar tokens sin conexión.
 */
export function obtenerClaves() {
  if (par) return par;
  let privadaPem = ajuste('clave_privada_pem');
  let publicaPem = ajuste('clave_publica_pem');
  if (!privadaPem || !publicaPem) {
    const generado = generateKeyPairSync('ed25519');
    privadaPem = generado.privateKey.export({ type: 'pkcs8', format: 'pem' });
    publicaPem = generado.publicKey.export({ type: 'spki', format: 'pem' });
    guardarAjuste('clave_privada_pem', privadaPem);
    guardarAjuste('clave_publica_pem', publicaPem);
  }
  const privada = createPrivateKey(privadaPem);
  const publica = createPublicKey(publicaPem);
  // Los últimos 32 bytes del DER SPKI son la clave pública cruda (útil en PHP/Python).
  const cruda = publica.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  par = { privada, publica, publicaPem, publicaCruda: cruda };
  return par;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Firma un payload y devuelve `base64url(payload).base64url(firma)`. */
export function firmarToken(payload) {
  const { privada } = obtenerClaves();
  const cuerpo = b64url(JSON.stringify(payload));
  const firma = sign(null, Buffer.from(cuerpo), privada);
  return `${cuerpo}.${b64url(firma)}`;
}

/** Verifica un token con la clave pública. Devuelve el payload o null. */
export function verificarToken(token, publica = obtenerClaves().publica) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [cuerpo, firma] = token.split('.');
  const ok = verify(null, Buffer.from(cuerpo), publica, Buffer.from(firma, 'base64url'));
  if (!ok) return null;
  try {
    const payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    if (payload.expira_en && Date.parse(payload.expira_en) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Token que recibe un producto tras activar o enviar latido. */
export function tokenParaLicencia(licencia, activacion) {
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + config.tokenLicenciaDias * 86400000);
  return firmarToken({
    clave: licencia.clave,
    producto: licencia.producto_codigo,
    plan: licencia.plan_tipo,
    huella: activacion.huella,
    estado: licencia.estado,
    etiqueta: licencia.etiqueta,
    vence_en: licencia.vence_en,
    soporte_hasta: licencia.soporte_hasta,
    emitido_en: ahora.toISOString(),
    expira_en: expira.toISOString(),
  });
}
