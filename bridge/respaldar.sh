#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Respaldo del buzón de cartas — Jardín Matemático
#
#  Deja una copia COMPLETA fuera de Cloudflare: la base entera, las
#  cartas en .txt legibles y las fotos. Las cartas no se pueden
#  borrar ni editar, pero sí se puede perder la cuenta: esta es la
#  única capa que sobrevive a eso.
#
#  Uso:  ./respaldar.sh            → guarda en ../respaldos/AAAA-MM-DD
#        ./respaldar.sh /otra/ruta → guarda donde le digas
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.nvm/versions/node/v24.13.0/bin:$PATH"
HOY="$(date +%Y-%m-%d)"
DESTINO="${1:-$(dirname "$AQUI")/respaldos}/$HOY"
API="https://appstudiouniversal.com/YulizetRamirezLeal/api/v1"
CLAVE_FILE="$AQUI/.secretos/clave-respaldo"
LOG="${DESTINO%/*}/respaldar.log"

mkdir -p "$DESTINO/fotos" "${DESTINO%/*}"
decir(){ echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

decir "── respaldo en $DESTINO"

# 1. la base entera, tal cual, restaurable
rm -f "$DESTINO/base.sql"
npx --yes wrangler@latest d1 export jardin-cartas --remote \
    --output="$DESTINO/base.sql" >"$DESTINO/.export.log" 2>&1
if [ -s "$DESTINO/base.sql" ]; then
  decir "   base de datos: $(wc -c < "$DESTINO/base.sql" | tr -d ' ') bytes"
  rm -f "$DESTINO/.export.log"
else
  decir "   ¡FALLÓ el volcado de la base! (detalle en $DESTINO/.export.log)"
fi

# 2. las cartas en JSON y en .txt que se puedan leer sin herramientas
npx --yes wrangler@latest d1 execute jardin-cartas --remote --json \
  --command "SELECT * FROM cartas ORDER BY creada_en" 2>/dev/null \
  > "$DESTINO/cartas.raw.json"

python3 - "$DESTINO" <<'PY'
import json, sys, os, re, datetime
destino = sys.argv[1]
try:
    with open(os.path.join(destino, 'cartas.raw.json'), encoding='utf-8') as f:
        cartas = json.load(f)[0]['results']
except Exception as e:
    print('   no pude leer las cartas:', e); raise SystemExit(0)

json.dump(cartas, open(os.path.join(destino, 'cartas.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
os.remove(os.path.join(destino, 'cartas.raw.json'))

for c in cartas:
    fecha = datetime.datetime.fromtimestamp(c['creada_en']/1000).strftime('%Y-%m-%d %H%M')
    titulo = re.sub(r'[^\w\s-]', '', (c.get('titulo') or 'sin titulo')).strip()[:60] or 'sin titulo'
    nombre = f"{fecha} · de {c['de']} para {c['para']} · {titulo}.txt"
    with open(os.path.join(destino, nombre), 'w', encoding='utf-8') as f:
        f.write(f"De: {c['de']}\nPara: {c['para']}\n")
        f.write(f"Escrita: {datetime.datetime.fromtimestamp(c['creada_en']/1000)}\n")
        if c.get('abre_el'): f.write(f"Se abre: {c['abre_el']}\n")
        if c.get('abierta_en'):
            f.write(f"Abierta: {datetime.datetime.fromtimestamp(c['abierta_en']/1000)}\n")
        if c.get('titulo'): f.write(f"\n{c['titulo']}\n")
        f.write("\n" + (c.get('cuerpo') or '') + "\n")
print(f"   cartas: {len(cartas)}")
PY

# 3. las fotos, una a una, por el endpoint de dueño
if [ -f "$CLAVE_FILE" ]; then
  CLAVE="$(cat "$CLAVE_FILE")"
  # de paso, refrescar la copia que vive en R2
  R=$(curl -sfS -XPOST -H "X-Respaldo: $CLAVE" --max-time 60 "$API/admin/respaldar" || echo "fallo")
  decir "   copia en la nube: $R"
  CLAVES=$(npx --yes wrangler@latest d1 execute jardin-cartas --remote --json \
    --command "SELECT clave FROM fotos" 2>/dev/null \
    | python3 -c "import json,sys
try: print('\n'.join(f['clave'] for f in json.load(sys.stdin)[0]['results']))
except Exception: pass")
  N=0
  for K in $CLAVES; do
    [ -z "$K" ] && continue
    if curl -sfS -H "X-Respaldo: $CLAVE" --max-time 60 \
         "$API/admin/foto?clave=$K" -o "$DESTINO/fotos/$(basename "$K")"; then
      N=$((N+1))
    else
      decir "   no pude bajar la foto $K"
    fi
  done
  decir "   fotos: $N"
else
  decir "   sin clave de respaldo: me salto las fotos"
fi

# 4. dejar solo los 12 respaldos más recientes
PADRE="${DESTINO%/*}"
# (el head -n -N de GNU no existe en macOS: se invierte el orden y se salta)
ls -1d "$PADRE"/20*-*-* 2>/dev/null | sort -r | tail -n +13 | while read -r V; do
  decir "   borro respaldo viejo: $(basename "$V")"; rm -rf "$V"
done

decir "── listo: $(du -sh "$DESTINO" 2>/dev/null | cut -f1) en $DESTINO"
