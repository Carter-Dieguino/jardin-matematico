# ∮ Jardín Matemático

Un jardín hecho enteramente de ecuaciones, y un buzón donde dos personas se
escriben cartas.

Las flores que ves no son dibujos ni imágenes: son curvas polares que se
calculan y se dibujan en tiempo real. Rodóneas, lemniscatas, hipotrocoides,
la mariposa de Fay, la superfórmula de Gielis, y diez flores tomadas del
libro *Flores 3D* de Débora Pereiro Carbajo. Puedes editar la ecuación en
vivo y ver cómo cambia el ramo.

**→ [appstudiouniversal.com/YulizetRamirezLeal](https://appstudiouniversal.com/YulizetRamirezLeal/)**

Escrito por **Diego Ramos** — [@Carter-Dieguino](https://github.com/Carter-Dieguino)

---

## Cómo está hecho

Sin framework, sin compilación, sin dependencias que instalar. La página
entera —HTML, CSS y JavaScript— vive en **un solo archivo** de unas 5 000
líneas. Se abre con doble clic y funciona.

```
public/YulizetRamirezLeal/index.html   el sitio completo
public/_headers  public/_redirects     configuración de Cloudflare Pages
bridge/worker.js                       el Worker: hace de puente y sirve la API del buzón
bridge/migrations/                     el esquema de la base de datos (D1)
bridge/respaldar.sh                    respaldo completo con un comando
```

Lo único que viene de fuera son CodeMirror (para el editor de ecuaciones) y
tres tipografías de Google Fonts.

## El buzón de cartas

Dos personas, cada una con su propia entrada, se escriben cartas que quedan
guardadas. Una carta tiene lo que tiene una carta: lugar y fecha, saludo,
cuerpo, despedida y firma. Puede llevar fotos y puede fecharse para que no se
abra hasta un día concreto.

Algunas decisiones que quizá te interesen si vienes a leer el código:

- **El sello no es una promesa del código, son triggers de SQLite.** Una carta
  leída no se puede editar ni borrar, ni desde la API ni desde la consola de
  administración. Se puede *retirar* mientras la otra persona no la haya
  abierto; después, jamás. Mientras siga sin abrir también se puede
  *devolver a borrador*, que es retirarla sin perderla: vuelve al borrador
  con su título, su fecha y sus fotos.
- **Archivar no toca la carta.** Es una marca en una tabla aparte, con el
  nombre de quien archiva: cada persona aparta su propia vista, la otra
  sigue viendo la suya, y se deshace siempre —también con las ya leídas.
- **El candado de fecha vive en el `WHERE` del SQL**, no en el navegador. El
  cuerpo y las fotos de una carta con fecha futura no salen de la base de
  datos. Esconderlo solo en el cliente sería teatro: se rompería la sorpresa
  con la pestaña de red abierta.
- **El enlace de una carta no es una puerta trasera.** Compartir una carta da
  una dirección con el id en el fragmento (`#carta=…`), que no llega al
  servidor ni acaba en el Referer de nadie. Quien la abra tiene que escribir
  su fecha de nacimiento igual que siempre, y una vez dentro entra al buzón
  entero: la carta del enlace se abre sola y detrás están todas las demás.
- **La bandeja de salida es durable.** La carta se guarda en el teléfono
  *antes* de tocar la red y no se borra hasta que el servidor la acusa. Sin
  cobertura no se pierde ninguna.
- **Los PDF se dibujan en un `<canvas>`** y cada página se incrusta como
  imagen. Un PDF con texto de verdad obligaría a incrustar y subdividir las
  tipografías, y aun así se comería los emoji.
- **Las fotos se recomprimen a WebP en el teléfono** antes de subirse. De
  paso eso borra los metadatos EXIF, que llevan las coordenadas GPS de dónde
  se tomó la foto.

## Si quieres montar tu propia copia

Hace falta una cuenta de Cloudflare (el plan gratuito basta) y Node.

```bash
npm install -g wrangler
wrangler login

cd bridge
wrangler d1 create mis-cartas            # copia el database_id a wrangler.toml
wrangler d1 migrations apply mis-cartas --remote

wrangler secret put JARDIN_SECRETO       # una cadena larga y aleatoria
wrangler secret put CLAVE_DIEGO          # la llave de una persona
wrangler secret put CLAVE_YULIZET        # la de la otra
wrangler secret put CLAVE_RESPALDO       # otra cadena larga, para los respaldos

wrangler deploy
```

Los nombres, las rutas y los textos están en el HTML y en `worker.js`; se
cambian buscando y reemplazando.

## Créditos

Todo el código —el motor de curvas, el editor de ecuaciones en vivo, los
epiciclos de Fourier, el modo 3D, el herbario, las mascotas del lienzo y el
buzón de cartas— está escrito por **Diego Ramos**
([@Carter-Dieguino](https://github.com/Carter-Dieguino)).

Las matemáticas, en cambio, son de mucha gente:

- Las diez flores del herbario vienen del libro
  [*Flores 3D*](https://www.geogebra.org/m/ct3jebjc) de **Débora Pereiro
  Carbajo**, en GeoGebra. Aquí se rehicieron como curvas paramétricas propias:
  en el applet original cada flor es una superficie reglada, y lo que este
  motor rellena es su curva de borde.
- La concoide de rosetón y varias curvas más siguen a
  [**MathFlowers**](https://community.appinventor.mit.edu/t/free-mathflowers-lets-create-beautiful-mathematical-flower-patterns-on-a-canvas/142630).
- La curva mariposa es de Temple H. Fay (1989); la superfórmula, de Johan
  Gielis (2003); la lemniscata, de Jacob Bernoulli (1694).

## Licencia

MIT. Haz lo que quieras con el código.

Los textos de las cartas y la dedicatoria no: esos son de quien los escribió.

---

*Es imposible ser matemático sin tener alma de poeta.*
— Diego Ramos
