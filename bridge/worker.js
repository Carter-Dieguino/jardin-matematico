// ═══════════════════════════════════════════════════════════════
//  Puente: appstudiouniversal.com/YulizetRamirezLeal/*  ->  Pages
//  + Buzón de cartas (D1 + R2) bajo /YulizetRamirezLeal/api/v1/
//
//  Worker independiente con una ruta MAS ESPECIFICA que la de
//  appuniversal-api, que por precedencia de rutas gana solo en
//  esta carpeta. La API no se toca.
//
//  REGLA DURA DE ESTE ARCHIVO: el cuerpo y las fotos de una carta
//  sellada NO salen de la base de datos antes de su fecha. El
//  candado es el WHERE del SQL, no un if del serializador ni un
//  hidden del navegador. Si se filtrara al cliente, la sorpresa se
//  rompe con la pestaña de red abierta.
// ═══════════════════════════════════════════════════════════════
const JARDIN = 'https://jardin-yulizet.pages.dev';
const API    = '/YulizetRamirezLeal/api/v1';

const PERSONAS = {
  diego:   { nombre: 'Diego',   otro: 'yulizet' },
  yulizet: { nombre: 'Yulizet', otro: 'diego'   },
};

const MAX_CUERPO = 20000;
const MAX_TITULO = 120;
const MAX_SOBRE  = 140;
const MAX_PARTE  = 90;   // lugar, saludo, despedida y firma
const MAX_FOTOS  = 4;
const MAX_BYTES  = 3 * 1024 * 1024;          // por foto, ya recomprimida en el móvil
const TIPOS_OK   = ['image/webp', 'image/jpeg', 'image/png'];
const TOKEN_DIAS = 365;
const CLAVE_VER  = 1;                        // súbelo para invalidar TODAS las sesiones

// ── utilidades ────────────────────────────────────────────────
const ahora = () => Date.now();
const enc   = new TextEncoder();

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      ...extra,
    },
  });
}
const err = (codigo, mensaje, status, extra) => json({ error: codigo, mensaje }, status, extra);

function b64urlEnc(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDec(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
async function sha256hex(txt) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(txt));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const dormir = ms => new Promise(r => setTimeout(r, ms));

// ── fechas ────────────────────────────────────────────────────
const MESES = {
  ene:1, enero:1, jan:1, january:1, feb:2, febrero:2, february:2,
  mar:3, marzo:3, march:3, abr:4, abril:4, apr:4, april:4,
  may:5, mayo:5, jun:6, junio:6, june:6, jul:7, julio:7, july:7,
  ago:8, agosto:8, aug:8, august:8, sep:9, sept:9, septiembre:9, september:9,
  oct:10, octubre:10, october:10, nov:11, noviembre:11, november:11,
  dic:12, diciembre:12, dec:12, december:12,
};

function fechaValida(y, m, d) {
  if (!(y >= 1900 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Devuelve TODAS las lecturas plausibles de lo que escribió la persona.
// Aceptar una fecha ambigua (04/05/1990) como «4 de mayo» y como «5 de
// abril» dobla la
// probabilidad de un acierto ciego, pero con el portero de abajo eso son
// siglos de intentos; a cambio, nadie se queda fuera por el orden de los
// números en su propia fecha de nacimiento.
function candidatos(raw) {
  const out = new Set();
  let s = String(raw || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().slice(0, 40);
  if (!s) return [];
  s = s.replace(/[a-z]+/g, w => (MESES[w] != null ? ' ' + MESES[w] + ' ' : ' '));
  const nums = s.match(/\d+/g) || [];
  const push = (y, m, d) => { const f = fechaValida(y, m, d); if (f) out.add(f); };

  if (nums.length >= 3) {
    const [a, b, c] = nums.slice(0, 3).map(Number);
    push(c, b, a);            // D M Y  ← lo normal en México
    push(c, a, b);            // M D Y
    push(a, b, c);            // Y M D  (ISO)
  } else if (nums.length === 1) {
    const n = nums[0];
    if (n.length === 8) {
      push(+n.slice(4),   +n.slice(2, 4), +n.slice(0, 2));   // DDMMYYYY
      push(+n.slice(0, 4), +n.slice(4, 6), +n.slice(6));      // YYYYMMDD
      push(+n.slice(4),   +n.slice(0, 2), +n.slice(2, 4));   // MMDDYYYY
    } else if (n.length === 6) {
      const yy = +n.slice(4);
      const corte = (new Date().getUTCFullYear() % 100) - 10;
      push(yy <= corte ? 2000 + yy : 1900 + yy, +n.slice(2, 4), +n.slice(0, 2));
    }
  }
  return [...out];
}

// Offset real de la zona en un instante dado. Si el runtime no trae
// datos de zonas horarias (no está garantizado en Workers), cae a
// -360, que es CDMX todo el año desde que México dejó el horario de
// verano en octubre de 2022. Verificable en vivo con /api/v1/salud.
function offsetMin(tz, ms) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    for (const { type, value } of dtf.formatToParts(new Date(ms))) p[type] = value;
    let h = +p.hour; if (h === 24) h = 0;
    const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second);
    return Math.round((comoUTC - Math.floor(ms / 1000) * 1000) / 60000);
  } catch { return -360; }
}

// «Que se abra el 14 de febrero» = 00:00 de ESE día en México,
// no a medianoche UTC (que allá serían las 6 de la tarde del 13).
function medianoche(fechaISO, tz) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d, 0, 0, 0);
  let ms = base;
  for (let i = 0; i < 2; i++) {
    const off = offsetMin(tz, ms);
    const nuevo = base - off * 60000;
    if (nuevo === ms) break;
    ms = nuevo;
  }
  return { ms, off: offsetMin(tz, ms) };
}

// ── token ─────────────────────────────────────────────────────
async function claveHMAC(env) {
  return crypto.subtle.importKey(
    'raw', enc.encode(env.JARDIN_SECRETO || ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}
async function emitir(quien, env) {
  const t = ahora();
  const payload = b64urlEnc(enc.encode(JSON.stringify({
    q: quien, i: t, e: t + TOKEN_DIAS * 86400000, k: CLAVE_VER,
  })));
  const cuerpo = 'j1.' + payload;
  const firma = await crypto.subtle.sign('HMAC', await claveHMAC(env), enc.encode(cuerpo));
  return cuerpo + '.' + b64urlEnc(new Uint8Array(firma));
}
async function leerToken(request, env) {
  const cab = request.headers.get('Authorization') || '';
  const tok = cab.startsWith('Bearer ') ? cab.slice(7).trim() : '';
  if (!tok) return null;
  const partes = tok.split('.');
  if (partes.length !== 3 || partes[0] !== 'j1') return null;
  let ok = false;
  try {
    // subtle.verify compara en tiempo constante. Nunca con ===.
    ok = await crypto.subtle.verify(
      'HMAC', await claveHMAC(env), b64urlDec(partes[2]),
      enc.encode('j1.' + partes[1]),
    );
  } catch { return null; }
  if (!ok) return null;
  let p;
  try { p = JSON.parse(new TextDecoder().decode(b64urlDec(partes[1]))); } catch { return null; }
  if (p.k !== CLAVE_VER) return null;
  if (!PERSONAS[p.q]) return null;
  if (!(p.e > ahora())) return null;
  return { quien: p.q, expira: p.e };
}

// ── portero ───────────────────────────────────────────────────
// Una fecha de nacimiento son ~36 500 combinaciones: es un PIN, no
// una contraseña. Toda la seguridad real está aquí.
async function revisarPortero(env, ipHash) {
  const min = Math.floor(ahora() / 60000);
  const r = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN ambito = ?1       AND minuto >= ?2 THEN fallos END), 0) AS ip_min,
      COALESCE(SUM(CASE WHEN ambito = ?1       AND minuto >= ?3 THEN fallos END), 0) AS ip_hora,
      COALESCE(SUM(CASE WHEN ambito = 'global' AND minuto >= ?4 THEN fallos END), 0) AS glob_dia
    FROM intentos WHERE minuto >= ?4
  `).bind('ip:' + ipHash, min, min - 59, min - 1439).first();

  if (!r) return null;
  if (r.ip_min  >= 5)  return { espera: 60 };
  if (r.ip_hora >= 10) return { espera: 3600 };
  if (r.glob_dia >= 30) return { espera: 3600 };
  return null;
}
async function anotarFallo(env, ipHash) {
  const min = Math.floor(ahora() / 60000);
  const sql = `INSERT INTO intentos (ambito, minuto, fallos) VALUES (?1, ?2, 1)
               ON CONFLICT(ambito, minuto) DO UPDATE SET fallos = fallos + 1`;
  await env.DB.batch([
    env.DB.prepare(sql).bind('ip:' + ipHash, min),
    env.DB.prepare(sql).bind('global', min),
  ]);
}

// Cloudflare sabe desde qué ciudad entra la petición. Se usa SOLO
// como valor inicial editable del campo «lugar»: con una VPN o según
// el operador puede salir mal, y una carta no puede mentir sobre
// dónde se escribió.
// Cloudflare devuelve los nombres en inglés y sin acentos: «Mexico
// City», «Merida». En una carta en español eso canta.
const CIUDADES = {
  'Mexico City': 'Ciudad de México', 'Merida': 'Mérida', 'Cancun': 'Cancún',
  'Queretaro': 'Querétaro', 'San Luis Potosi': 'San Luis Potosí',
  'Culiacan': 'Culiacán', 'Torreon': 'Torreón', 'Leon': 'León',
  'Mazatlan': 'Mazatlán', 'Tuxtla Gutierrez': 'Tuxtla Gutiérrez',
  'Cordoba': 'Córdoba', 'Ciudad Obregon': 'Ciudad Obregón',
  'Los Mochis': 'Los Mochis', 'Hermosillo': 'Hermosillo',
  'State of Mexico': 'Estado de México', 'Yucatan': 'Yucatán',
  'Nuevo Leon': 'Nuevo León', 'Michoacan': 'Michoacán',
  'San Luis Potosi ': 'San Luis Potosí',
};
const enEspanol = v => (v && CIUDADES[v]) || v;

function ciudadDe(request) {
  const cf = request.cf || {};
  const ciudad = enEspanol(cf.city || null);
  const region = enEspanol(cf.region || null);
  if (!ciudad) return null;
  return region && region !== ciudad ? ciudad + ', ' + region : ciudad;
}

// ── serialización de una carta ────────────────────────────────
// `vis` lo decide el SQL. Aquí solo se da forma a lo que ya llegó.
function comoCarta(f) {
  const sellada = !f.visible;
  const base = {
    id: f.id, de: f.de, para: f.para, sellada,
    creada: f.creada_en, abre: f.abre_en, abre_el: f.abre_el,
    abierta_en: f.abierta_en ?? null,
    sobre: f.sobre ?? null,
    archivada: !!f.archivada,
  };
  if (sellada) return base;
  return {
    ...base,
    lugar: f.lugar ?? null,
    saludo: f.saludo ?? null,
    despedida: f.despedida ?? null,
    firma: f.firma ?? null,
    titulo: f.titulo ?? null,
    extracto: f.extracto ?? null,
    longitud: f.longitud ?? 0,
    fotos: f.n_fotos ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════
//  API
// ═══════════════════════════════════════════════════════════════
async function api(request, env, url, ctx) {
  const ruta = url.pathname.slice(API.length) || '/';
  const metodo = request.method;

  // Sin cookies y sin CORS: el token va en Authorization, que no se
  // envía solo. Un tercero no puede ni adjuntarlo ni leer la respuesta.
  const origen = request.headers.get('Origin');
  if (origen && origen !== (env.ORIGEN_CANONICO || '') && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origen)) {
    return err('origen_no_permitido', 'Esta petición no viene del jardín.', 403);
  }
  if (metodo === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

  const tz = env.TZ_CASA || 'America/Mexico_City';
  const t0 = ahora();

  if (ruta === '/salud') {
    let db = 'ok';
    try { await env.DB.prepare('SELECT 1').first(); } catch { db = 'caida'; }
    const off = offsetMin(tz, t0);
    return json({
      ok: true, server_now: t0, db, tz, offset_min: off,
      medianoche_utc: String(((-off / 60) + 24) % 24).padStart(2, '0') + ':00',
    });
  }

  // ── aviso público: ¿hay carta esperando, y para quién? ──────
  // Sin sesión a propósito: si hace falta identificarse para saber que
  // te esperan, el aviso llega tarde. Devuelve SOLO cuántas y para
  // quién — ni una palabra del contenido, ni títulos, ni fechas. Las
  // cartas con fecha futura no se cuentan: seguirían siendo secretas.
  if (ruta === '/aviso' && metodo === 'GET') {
    const t = ahora();
    const { results } = await env.DB.prepare(`
      SELECT para, COUNT(*) AS n
      FROM cartas
      WHERE abierta_en IS NULL AND abre_en <= ?1
      GROUP BY para
    `).bind(t).all();
    return json({ esperando: results || [], server_now: t });
  }

  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const ipHash = (await sha256hex(ip + '|' + (env.JARDIN_SECRETO || ''))).slice(0, 16);

  // ── entrar ──────────────────────────────────────────────────
  if (ruta === '/sesion' && metodo === 'POST') {
    const bloqueo = await revisarPortero(env, ipHash);
    if (bloqueo) {
      return err('demasiados_intentos', 'Demasiados intentos. Prueba más tarde.', 429,
        { 'Retry-After': String(bloqueo.espera) });
    }
    let body = {};
    try { body = await request.json(); } catch { /* cae en clave vacía */ }
    const lecturas = candidatos(body && body.clave);

    // Se comparan SIEMPRE las dos claves y sin salir antes de tiempo:
    // ni el flujo ni el reloj deben decir cuál de las dos falló.
    let quien = null;
    for (const c of lecturas) {
      if (c === env.CLAVE_DIEGO)   quien = quien || 'diego';
      if (c === env.CLAVE_YULIZET) quien = quien || 'yulizet';
    }
    await dormir(Math.max(0, 220 - (ahora() - t0)));   // latencia fija: éxito y fallo miden igual

    if (!quien) {
      await anotarFallo(env, ipHash);
      if (!lecturas.length) return err('formato_invalido', 'No reconocí eso como una fecha.', 400);
      return err('clave_invalida', 'Esa no es.', 401);
    }
    const agente = (request.headers.get('User-Agent') || '').slice(0, 180);
    const pais = request.headers.get('CF-IPCountry') || null;
    ctx.waitUntil(env.DB.prepare(
      'INSERT INTO accesos (ts, quien, ip_hash, agente, pais) VALUES (?1,?2,?3,?4,?5)',
    ).bind(ahora(), quien, ipHash, agente, pais).run());

    const p = PERSONAS[quien];
    return json({
      token: await emitir(quien, env), quien, nombre: p.nombre, otro: p.otro,
      // Sugerencia para el campo «lugar», nada más: se rellena solo pero
      // se puede corregir, y lo que quede escrito es lo que se guarda.
      ciudad: ciudadDe(request),
      expira: ahora() + TOKEN_DIAS * 86400000, server_now: ahora(),
    });
  }

  // ── respaldo de dueño (lo usa bridge/respaldar.sh) ─────────
  // Forzar el respaldo a R2 sin esperar a la noche. Lo usa
  // respaldar.sh para que la copia en la nube y la local coincidan.
  if (ruta === '/admin/respaldar' && metodo === 'POST') {
    const dado = request.headers.get('X-Respaldo') || '';
    const bueno = env.CLAVE_RESPALDO || '';
    if (!bueno || dado.length !== bueno.length || dado !== bueno) {
      return err('no_autorizado', 'No.', 403);
    }
    await respaldar(env);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM cartas').first();
    return json({ ok: true, cartas: (n && n.n) || 0, server_now: ahora() });
  }

  // Ver qué respaldos hay de verdad en R2. Un respaldo que nadie ha
  // mirado nunca no es un respaldo.
  if (ruta === '/admin/respaldos' && metodo === 'GET') {
    const dado = request.headers.get('X-Respaldo') || '';
    const bueno = env.CLAVE_RESPALDO || '';
    if (!bueno || dado.length !== bueno.length || dado !== bueno) {
      return err('no_autorizado', 'No.', 403);
    }
    const lista = await env.FOTOS.list({ prefix: 'respaldos/', limit: 200 });
    return json({
      copias: lista.objects
        .map(o => ({ clave: o.key, bytes: o.size, subido: o.uploaded }))
        .sort((a, b) => a.clave < b.clave ? 1 : -1),
      server_now: ahora(),
    });
  }

  if (ruta === '/admin/foto' && metodo === 'GET') {
    const dado = request.headers.get('X-Respaldo') || '';
    const bueno = env.CLAVE_RESPALDO || '';
    if (!bueno || dado.length !== bueno.length || dado !== bueno) {
      return err('no_autorizado', 'No.', 403);
    }
    const clave = url.searchParams.get('clave') || '';
    if (!/^fotos\/(diego|yulizet)\/[\w-]{8,64}$/.test(clave)) {
      return err('clave_invalida', 'Esa llave no vale.', 400);
    }
    const obj = await env.FOTOS.get(clave);
    if (!obj) return err('no_existe', 'No está.', 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    });
  }

  // ── de aquí en adelante hace falta sesión ───────────────────
  // (excepto /admin/*, que ya se resolvió arriba con su propio secreto)
  const sesion = await leerToken(request, env);
  if (!sesion) return err('sin_sesion', 'Escribe tu fecha para entrar.', 401);
  const yo = sesion.quien;
  const otro = PERSONAS[yo].otro;
  const vis = '(c.de = ?1 OR c.abre_en <= ?2)';   // ← el candado, en SQL

  // ── quién soy + resumen para el aviso ───────────────────────
  if (ruta === '/yo' && metodo === 'GET') {
    const r = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM cartas WHERE para = ?1 AND abierta_en IS NULL AND abre_en <= ?2) AS no_leidas,
        (SELECT COUNT(*) FROM cartas WHERE para = ?1) AS recibidas,
        (SELECT COUNT(*) FROM cartas WHERE de   = ?1) AS enviadas,
        (SELECT MIN(abre_en) FROM cartas WHERE para = ?1 AND abre_en > ?2) AS proxima,
        (SELECT ts FROM accesos WHERE quien = ?1 ORDER BY ts DESC LIMIT 1 OFFSET 1) AS ultimo_acceso
    `).bind(yo, ahora()).first();
    return json({
      quien: yo, nombre: PERSONAS[yo].nombre, otro, expira: sesion.expira,
      ciudad: ciudadDe(request),
      server_now: ahora(), resumen: r || {},
    });
  }

  // ── lista ───────────────────────────────────────────────────
  if (ruta === '/cartas' && metodo === 'GET') {
    const buzon = url.searchParams.get('buzon') || 'todas';
    const limite = Math.min(200, Math.max(1, +(url.searchParams.get('limite') || 100)));
    const filtro = buzon === 'recibidas' ? 'c.para = ?1'
                 : buzon === 'enviadas'  ? 'c.de = ?1'
                 : '(c.de = ?1 OR c.para = ?1)';
    const { results } = await env.DB.prepare(`
      SELECT c.id, c.de, c.para, c.sobre, c.creada_en, c.abre_en, c.abre_el, c.abierta_en,
             ${vis} AS visible,
             EXISTS(SELECT 1 FROM archivadas a
                     WHERE a.carta_id = c.id AND a.quien = ?1) AS archivada,
             CASE WHEN ${vis} THEN c.titulo END                    AS titulo,
             CASE WHEN ${vis} THEN substr(c.cuerpo, 1, 150) END    AS extracto,
             CASE WHEN ${vis} THEN length(c.cuerpo) END            AS longitud,
             CASE WHEN ${vis} THEN
               (SELECT COUNT(*) FROM fotos f WHERE f.carta_id = c.id) END AS n_fotos
      FROM cartas c
      WHERE ${filtro}
      ORDER BY c.creada_en DESC
      LIMIT ?3
    `).bind(yo, ahora(), limite).all();
    return json({ cartas: (results || []).map(comoCarta), server_now: ahora() });
  }

  // ── abrir una carta ─────────────────────────────────────────
  const mLeer = ruta.match(/^\/cartas\/([\w-]{1,64})$/);
  if (mLeer && metodo === 'GET') {
    const id = mLeer[1];
    const t = ahora();
    const fila = await env.DB.prepare(`
      SELECT c.id, c.de, c.para, c.titulo, c.sobre, c.cuerpo, c.creada_en,
             c.abre_en, c.abre_el, c.abierta_en, 1 AS visible,
             c.lugar, c.saludo, c.despedida, c.firma,
             EXISTS(SELECT 1 FROM archivadas a
                     WHERE a.carta_id = c.id AND a.quien = ?1) AS archivada,
             length(c.cuerpo) AS longitud
      FROM cartas c
      WHERE c.id = ?3 AND ${vis}
    `).bind(yo, t, id).first();

    if (!fila) {
      // Segunda consulta que NO nombra `cuerpo`: distingue «no existe»
      // de «todavía no toca» sin que el texto salga de la base.
      const meta = await env.DB.prepare(
        'SELECT para, abre_en, abre_el, sobre FROM cartas WHERE id = ?1',
      ).bind(id).first();
      if (!meta || meta.para !== yo) return err('no_existe', 'Esa carta no está aquí.', 404);
      // Lo único que se puede leer antes de tiempo es la frase del
      // sobre, que el remitente escribió justo para esto.
      return json({
        error: 'sellada_hasta', mensaje: 'Todavía no es su día.',
        abre: meta.abre_en, abre_el: meta.abre_el, sobre: meta.sobre,
        faltan_ms: meta.abre_en - t, server_now: t,
      }, 423);
    }

    const { results: fs } = await env.DB.prepare(
      'SELECT orden, tipo, ancho, alto FROM fotos WHERE carta_id = ?1 ORDER BY orden',
    ).bind(id).all();

    // marcar abierta: solo el destinatario, solo la primera vez
    let abierta = fila.abierta_en;
    if (fila.para === yo && !abierta) {
      abierta = t;
      ctx.waitUntil(env.DB.prepare(
        `UPDATE cartas SET abierta_en = ?1
         WHERE id = ?2 AND para = ?3 AND abierta_en IS NULL AND abre_en <= ?1`,
      ).bind(t, id, yo).run());
    }
    return json({
      ...comoCarta({ ...fila, n_fotos: (fs || []).length }),
      abierta_en: abierta,
      cuerpo: fila.cuerpo,
      fotos: (fs || []).map(f => ({ n: f.orden, tipo: f.tipo, ancho: f.ancho, alto: f.alto })),
      server_now: t,
    });
  }

  // ── retirar una carta que aún no ha leído ──────────────────
  if (mLeer && metodo === 'DELETE') {
    const id = mLeer[1];
    const c = await env.DB.prepare(
      'SELECT de, abierta_en FROM cartas WHERE id = ?1',
    ).bind(id).first();
    if (!c || c.de !== yo) return err('no_existe', 'Esa carta no está aquí.', 404);
    if (c.abierta_en) {
      return err('ya_leida', 'Ya la leyó. Esta carta ya no se puede retirar.', 409);
    }
    const { results: fs } = await env.DB.prepare(
      'SELECT clave FROM fotos WHERE carta_id = ?1',
    ).bind(id).all();
    // fotos primero: su trigger mira la carta, que todavía existe
    await env.DB.batch([
      env.DB.prepare('DELETE FROM archivadas WHERE carta_id = ?1').bind(id),
      env.DB.prepare('DELETE FROM fotos WHERE carta_id = ?1').bind(id),
      env.DB.prepare(
        'DELETE FROM cartas WHERE id = ?1 AND de = ?2 AND abierta_en IS NULL',
      ).bind(id, yo),
    ]);
    for (const f of (fs || [])) { try { await env.FOTOS.delete(f.clave); } catch (e) {} }
    return json({ ok: true, id, server_now: ahora() });
  }

  // ── archivar / sacar del archivo ────────────────────────────
  // Ni borra ni edita: solo aparta la carta de la vista de quien lo
  // pide. Es lo unico de una carta enviada que se puede deshacer
  // siempre, la haya leido ya o no.
  const mArch = ruta.match(/^\/cartas\/([\w-]{1,64})\/archivo$/);
  if (mArch && (metodo === 'POST' || metodo === 'DELETE')) {
    const id = mArch[1];
    // Solo el cuerpo esta bajo llave: quien la escribio o quien la
    // recibe puede archivarla aunque todavia no sea su dia.
    const c = await env.DB.prepare('SELECT de, para FROM cartas WHERE id = ?1').bind(id).first();
    if (!c || (c.de !== yo && c.para !== yo)) return err('no_existe', 'Esa carta no está aquí.', 404);
    const archivar = metodo === 'POST';
    if (archivar) {
      await env.DB.prepare(
        `INSERT INTO archivadas (carta_id, quien, ts) VALUES (?1, ?2, ?3)
         ON CONFLICT(carta_id, quien) DO NOTHING`,
      ).bind(id, yo, ahora()).run();
    } else {
      await env.DB.prepare(
        'DELETE FROM archivadas WHERE carta_id = ?1 AND quien = ?2',
      ).bind(id, yo).run();
    }
    return json({ ok: true, id, archivada: archivar, server_now: ahora() });
  }

  // ── foto de una carta ───────────────────────────────────────
  const mFoto = ruta.match(/^\/cartas\/([\w-]{1,64})\/fotos\/(\d{1,2})$/);
  if (mFoto && metodo === 'GET') {
    const [, id, n] = mFoto;
    // Mismo candado que el cuerpo: una foto no se adelanta a su fecha.
    const f = await env.DB.prepare(`
      SELECT f.clave, f.tipo FROM fotos f
      JOIN cartas c ON c.id = f.carta_id
      WHERE f.carta_id = ?3 AND f.orden = ?4 AND ${vis}
    `).bind(yo, ahora(), id, +n).first();
    if (!f) return err('no_existe', 'Esa foto no está aquí.', 404);
    const obj = await env.FOTOS.get(f.clave);
    if (!obj) return err('no_existe', 'Esa foto no está aquí.', 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': f.tipo || 'image/webp',
        'Cache-Control': 'private, max-age=86400',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  }

  // ── subir una foto (antes de sellar la carta) ───────────────
  if (ruta === '/fotos' && metodo === 'POST') {
    const tipo = (request.headers.get('Content-Type') || '').split(';')[0].trim();
    if (!TIPOS_OK.includes(tipo)) return err('tipo_no_permitido', 'Solo imágenes.', 415);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return err('foto_vacia', 'La foto llegó vacía.', 400);
    if (buf.byteLength > MAX_BYTES) return err('foto_pesada', 'Esa foto pesa demasiado.', 413);
    const id = crypto.randomUUID();
    const clave = `fotos/${yo}/${id}`;
    await env.FOTOS.put(clave, buf, { httpMetadata: { contentType: tipo } });
    return json({ id, clave, tipo, bytes: buf.byteLength, server_now: ahora() }, 201);
  }

  // ── sellar y enviar ─────────────────────────────────────────
  if (ruta === '/cartas' && metodo === 'POST') {
    const idem = (request.headers.get('Idempotency-Key') || '').slice(0, 64) || null;
    if (idem) {
      const ya = await env.DB.prepare(
        'SELECT id, creada_en, abre_en, abre_el FROM cartas WHERE de = ?1 AND clave_cliente = ?2',
      ).bind(yo, idem).first();
      // La red se cae justo después de un INSERT correcto más veces de
      // lo que parece. Sin esto, el reintento crearía una carta gemela
      // que además sería imborrable.
      if (ya) {
        return json({ ...ya, id: ya.id, sellada: true, server_now: ahora() }, 200,
          { 'Idempotency-Replayed': 'true' });
      }
    }
    let body = {};
    try { body = await request.json(); } catch { return err('json_invalido', 'No entendí la carta.', 400); }

    const cuerpo = typeof body.cuerpo === 'string' ? body.cuerpo.trim() : '';
    if (!cuerpo) return err('cuerpo_vacio', 'La carta está en blanco.', 400);
    if (cuerpo.length > MAX_CUERPO) return err('demasiado_larga', 'La carta es larguísima.', 413);
    const titulo = body.titulo ? String(body.titulo).trim().slice(0, MAX_TITULO) : null;
    const sobre  = body.sobre  ? String(body.sobre).trim().slice(0, MAX_SOBRE)  : null;
    const parte = v => (v ? String(v).trim().slice(0, MAX_PARTE) : null) || null;
    const lugar = parte(body.lugar), saludo = parte(body.saludo);
    const despedida = parte(body.despedida), firma = parte(body.firma);

    const t = ahora();
    let abre = t, abreEl = null, off = offsetMin(tz, t);
    if (body.abre_el) {
      const f = String(body.abre_el).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !fechaValida(+f.slice(0, 4), +f.slice(5, 7), +f.slice(8, 10))) {
        return err('fecha_invalida', 'Esa fecha no existe.', 400);
      }
      const m = medianoche(f, tz);
      if (m.ms > t + 100 * 365 * 86400000) return err('fecha_lejana', 'Eso es demasiado lejos.', 400);
      if (m.ms > t) { abre = m.ms; abreEl = f; off = m.off; }
    }

    // fotos: solo las que este remitente subió de verdad
    const fotos = Array.isArray(body.fotos) ? body.fotos.slice(0, MAX_FOTOS) : [];
    const buenas = [];
    for (const f of fotos) {
      const fid = String((f && f.id) || '').slice(0, 64);
      if (!/^[\w-]{8,64}$/.test(fid)) continue;
      const clave = `fotos/${yo}/${fid}`;
      const head = await env.FOTOS.head(clave);
      if (!head) continue;
      buenas.push({
        id: fid, clave, bytes: head.size,
        tipo: (head.httpMetadata && head.httpMetadata.contentType) || 'image/webp',
        ancho: +(f.ancho || 0) || null, alto: +(f.alto || 0) || null,
      });
    }

    const id = crypto.randomUUID();
    const agente = (request.headers.get('User-Agent') || '').slice(0, 180);
    const sentencias = [
      env.DB.prepare(`
        INSERT INTO cartas (id, de, para, titulo, sobre, cuerpo, creada_en, abre_en, abre_el,
                            tz, tz_offset_min, clave_cliente, ip_hash, agente,
                            lugar, saludo, despedida, firma)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
      `).bind(id, yo, otro, titulo, sobre, cuerpo, t, abre, abreEl, tz, off, idem, ipHash, agente,
              lugar, saludo, despedida, firma),
    ];
    buenas.forEach((f, i) => sentencias.push(env.DB.prepare(`
      INSERT INTO fotos (id, carta_id, orden, clave, tipo, bytes, ancho, alto, creada_en)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
    `).bind(f.id, id, i + 1, f.clave, f.tipo, f.bytes, f.ancho, f.alto, t)));

    try {
      await env.DB.batch(sentencias);   // batch = transacción: o entra todo, o nada
    } catch (e) {
      const msg = String(e && e.message || '');
      if (/UNIQUE/i.test(msg) && idem) {
        const ya = await env.DB.prepare(
          'SELECT id, creada_en, abre_en, abre_el FROM cartas WHERE de = ?1 AND clave_cliente = ?2',
        ).bind(yo, idem).first();
        if (ya) return json({ ...ya, sellada: true, server_now: ahora() }, 200, { 'Idempotency-Replayed': 'true' });
      }
      throw e;
    }
    return json({
      id, creada: t, abre, abre_el: abreEl, sellada: abre > t,
      fotos: buenas.length, server_now: ahora(),
    }, 201);
  }

  // ── exportar (respaldo desde el propio móvil) ───────────────
  if (ruta === '/exportar' && metodo === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT c.id, c.de, c.para, c.creada_en, c.abre_en, c.abre_el, c.abierta_en, c.sobre,
             ${vis} AS visible,
             CASE WHEN ${vis} THEN c.titulo END AS titulo,
             CASE WHEN ${vis} THEN c.cuerpo END AS cuerpo
      FROM cartas c
      WHERE c.de = ?1 OR c.para = ?1
      ORDER BY c.creada_en
    `).bind(yo, ahora()).all();
    const hoy = new Date().toISOString().slice(0, 10);
    return json({
      exportado_en: ahora(), quien: yo,
      nota: 'Las cartas selladas salen sin cuerpo: un respaldo no puede ser la puerta trasera del candado.',
      cartas: results || [],
    }, 200, { 'Content-Disposition': `attachment; filename="cartas-${hoy}.json"` });
  }

  return err('ruta_desconocida', 'Por aquí no hay nada.', 404);
}

// ── respaldo diario ───────────────────────────────────────────
// Time Travel de D1 en plan gratuito son 7 días, y esto son cartas:
// una instantánea diaria en R2 cuesta céntimos y aguanta 90 días.
async function respaldar(env) {
  const cartas = (await env.DB.prepare('SELECT * FROM cartas ORDER BY creada_en').all()).results || [];
  const fotos  = (await env.DB.prepare('SELECT * FROM fotos ORDER BY carta_id, orden').all()).results || [];
  const hoy = new Date(ahora()).toISOString().slice(0, 10);
  const bulto = JSON.stringify({
    hecho_en: ahora(), fecha: hoy, total: cartas.length,
    nota: 'Respaldo completo del buzón. Los bytes de las fotos siguen en el mismo bucket, bajo fotos/.',
    cartas, fotos,
  }, null, 1);
  const opciones = { httpMetadata: { contentType: 'application/json; charset=utf-8' } };
  await env.FOTOS.put('respaldos/cartas-' + hoy + '.json', bulto, opciones);
  await env.FOTOS.put('respaldos/ultimo.json', bulto, opciones);

  const lista = await env.FOTOS.list({ prefix: 'respaldos/cartas-', limit: 400 });
  const claves = lista.objects.map(o => o.key).sort();
  for (const k of claves.slice(0, Math.max(0, claves.length - 90))) await env.FOTOS.delete(k);
}

// ═══════════════════════════════════════════════════════════════
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/YulizetRamirezLeal') {
      return Response.redirect(url.origin + '/YulizetRamirezLeal/', 301);
    }

    // La API va antes del proxy, y encerrada: un fallo aquí no puede
    // tumbar el jardín, que es lo único que ella ve.
    if (url.pathname.startsWith(API + '/') || url.pathname === API) {
      try {
        return await api(request, env, url, ctx);
      } catch (e) {
        console.error('api', e && e.stack || e);
        return err('fallo_interno', 'El buzón está descansando. Tu carta sigue guardada.', 503);
      }
    }

    // OJO: hay que reconstruir la Request entera. El `fetch(url, {method,
    // headers})` de antes NO reenviaba el body: cualquier POST llegaba
    // vacío y sin error visible.
    const upstream = await fetch(new Request(JARDIN + url.pathname + url.search, request));
    const res = new Response(upstream.body, upstream);
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return res;
  },

  // Cada noche: respaldo de las cartas, contadores viejos del portero
  // y fotos que se subieron pero nunca llegaron a viajar en una carta.
  async scheduled(event, env, ctx) {
    // El respaldo va PRIMERO: si algo de la limpieza falla, la copia
    // del día ya está hecha.
    try { await respaldar(env); } catch (e) { console.error('respaldo', e && e.stack || e); }

    const min = Math.floor(ahora() / 60000);
    await env.DB.prepare('DELETE FROM intentos WHERE minuto < ?1').bind(min - 2880).run();

    const corte = ahora() - 86400000;
    for (const quien of Object.keys(PERSONAS)) {
      const lista = await env.FOTOS.list({ prefix: `fotos/${quien}/`, limit: 500 });
      const viejas = lista.objects.filter(o => new Date(o.uploaded).getTime() < corte);
      if (!viejas.length) continue;
      const marcas = viejas.map((_, i) => '?' + (i + 1)).join(',');
      const { results } = await env.DB.prepare(
        `SELECT clave FROM fotos WHERE clave IN (${marcas})`,
      ).bind(...viejas.map(o => o.key)).all();
      const usadas = new Set((results || []).map(r => r.clave));
      for (const o of viejas) if (!usadas.has(o.key)) await env.FOTOS.delete(o.key);
    }
  },
};
