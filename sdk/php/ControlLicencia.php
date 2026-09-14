<?php
/**
 * SDK de licencias CONTROL para PHP / Laravel (DENTAL-PRO).
 * Requiere la extensión sodium (incluida en PHP ≥ 7.2) y cURL.
 *
 * Uso en Laravel (app/Http/Middleware/VerificarLicencia.php):
 *
 *   $licencia = new ControlLicencia(
 *       url: config('control.url'),
 *       clave: config('control.licencia'),
 *       producto: 'dental-pro',
 *       clavePublicaBase64: config('control.clave_publica'),
 *       archivo: storage_path('app/licencia.json'),
 *       huella: request()->getHost(),
 *       version: config('app.version'),
 *   );
 *   $estado = $licencia->iniciar();
 *   if (!$estado['valido']) abort(402, 'Licencia no válida: ' . $estado['motivo']);
 *
 * Programa `$licencia->latido()` en el scheduler cada 24 h.
 */
class ControlLicencia
{
    private array $estado = ['valido' => false, 'payload' => null, 'motivo' => 'sin iniciar'];

    public function __construct(
        private string $url,
        private string $clave,
        private string $producto,
        private string $clavePublicaBase64,
        private string $archivo,
        private ?string $huella = null,
        private ?string $version = null,
    ) {
        $this->url = rtrim($url, '/');
        $this->clave = strtoupper(trim($clave));
        $this->huella = $huella ?: substr(hash('sha256', gethostname() ?: 'php'), 0, 32);
    }

    /** Verifica firma Ed25519 y coherencia del payload. Devuelve el payload o null. */
    public function verificar(string $token): ?array
    {
        if (!str_contains($token, '.')) return null;
        [$cuerpo, $firma] = explode('.', $token, 2);
        $ok = sodium_crypto_sign_verify_detached(
            self::b64urlDecode($firma), $cuerpo, base64_decode($this->clavePublicaBase64)
        );
        if (!$ok) return null;
        $p = json_decode(self::b64urlDecode($cuerpo), true);
        if (!is_array($p)) return null;
        if (($p['clave'] ?? null) !== $this->clave || ($p['producto'] ?? null) !== $this->producto || ($p['huella'] ?? null) !== $this->huella) return null;
        if (strtotime($p['expira_en'] ?? '1970-01-01') < time()) return null;
        return $p;
    }

    public function activar(): array
    {
        return $this->procesar($this->llamar('activar', [
            'clave' => $this->clave, 'producto' => $this->producto, 'huella' => $this->huella,
            'dominio' => $this->huella, 'nombre_equipo' => gethostname(), 'version' => $this->version,
        ]));
    }

    public function latido(): array
    {
        return $this->procesar($this->llamar('latido', ['clave' => $this->clave, 'huella' => $this->huella, 'version' => $this->version]));
    }

    /** Token guardado si es válido; si no, activa. Sin red, vale hasta expira_en. */
    public function iniciar(): array
    {
        $guardado = @json_decode(@file_get_contents($this->archivo) ?: '', true)['token'] ?? null;
        $p = $guardado ? $this->verificar($guardado) : null;
        if ($p) $this->estado = ['valido' => true, 'payload' => $p, 'motivo' => null];
        try { $p ? $this->latido() : $this->activar(); }
        catch (\Throwable $e) { if (!$p) $this->estado = ['valido' => false, 'payload' => null, 'motivo' => 'Sin conexión con CONTROL: ' . $e->getMessage()]; }
        return $this->estado;
    }

    public function estado(): array { return $this->estado; }

    /** Código de 72 h emitido desde CONTROL para este equipo; se verifica sin red. */
    public function aplicarCodigoEmergencia(string $codigo): array
    {
        $codigo = trim($codigo);
        $p = $this->verificar($codigo);
        if (!$p || empty($p['emergencia'])) {
            return ['ok' => false, 'motivo' => $p ? 'Ese código no es de emergencia' : 'Código inválido, vencido o de otro equipo'];
        }
        @mkdir(dirname($this->archivo), 0775, true);
        @file_put_contents($this->archivo, json_encode(['token' => $codigo, 'guardado_en' => date('c')]));
        $this->estado = ['valido' => true, 'payload' => $p, 'motivo' => null];
        return ['ok' => true, 'expira_en' => $p['expira_en']];
    }

    /** Datos para la pantalla estándar "Licencia" (ver sdk/pantalla-licencia/). */
    public function resumen(): array
    {
        $p = $this->estado['payload'] ?? [];
        $vigente = ($this->estado['valido'] ?? false) || (!empty($p['expira_en']) && strtotime($p['expira_en']) > time());
        return [
            'valido' => $vigente, 'estado' => $p['estado'] ?? $this->estado['codigo'] ?? 'desconocido', 'motivo' => $this->estado['motivo'] ?? null,
            'clave' => $this->clave, 'producto' => $this->producto, 'plan' => $p['plan'] ?? null, 'etiqueta' => $p['etiqueta'] ?? null, 'huella' => $this->huella,
            'vence_en' => $p['vence_en'] ?? null, 'soporte_hasta' => $p['soporte_hasta'] ?? null, 'sin_conexion_hasta' => $p['expira_en'] ?? null,
            'emergencia' => !empty($p['emergencia']), 'version' => $this->version, 'version_actual' => $this->info['version_actual'] ?? null, 'desactualizada' => !empty($this->info['desactualizada']),
        ];
    }

    private array $info = [];

    private function procesar(array $r): array
    {
        if (!empty($r['licencia']) && is_array($r['licencia'])) $this->info = $r['licencia'];
        if (($r['ok'] ?? false) && !empty($r['token'])) {
            $p = $this->verificar($r['token']);
            if ($p) {
                @mkdir(dirname($this->archivo), 0775, true);
                @file_put_contents($this->archivo, json_encode(['token' => $r['token'], 'guardado_en' => date('c')]));
                return $this->estado = ['valido' => true, 'payload' => $p, 'motivo' => null];
            }
        }
        if (in_array($r['status'] ?? 0, [403, 404], true)) {
            $this->estado = ['valido' => false, 'payload' => $r['licencia'] ?? null, 'motivo' => $r['error'] ?? $r['codigo'] ?? 'licencia inválida', 'codigo' => $r['codigo'] ?? null];
        }
        return $this->estado;
    }

    private function llamar(string $ruta, array $cuerpo): array
    {
        $ch = curl_init("{$this->url}/api/v1/licencias/{$ruta}");
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode(array_filter($cuerpo, fn ($v) => $v !== null)),
        ]);
        $respuesta = curl_exec($ch);
        if ($respuesta === false) throw new \RuntimeException(curl_error($ch));
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $datos = json_decode($respuesta, true) ?: [];
        return ['ok' => $status >= 200 && $status < 300, 'status' => $status] + $datos;
    }

    private static function b64urlDecode(string $s): string
    {
        return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4));
    }
}
