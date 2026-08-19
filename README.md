# Nexo — Desempeño & resultados

Aplicación web para que cada colaborador vea su propio desempeño de la quincena o del mes,
y para que la supervisión lo cargue subiendo directamente el Excel del CRM.

> El nombre, la bajada y la **paleta de colores** se cambian desde **Ajustes → Nombre de la
> plataforma**, sin tocar código. Vienen como *Nexo — Desempeño & resultados* en paleta índigo.

- **La supervisora** sube la planilla → la app la lee sola → revisa → publica.
- **Cada agente** entra con su usuario y ve **solo lo suyo**: si cumplió, qué le falta y qué hacer para mejorarlo.

---

## 1. Qué hace exactamente

### Del lado de la supervisión

| Pestaña | Para qué sirve |
|---|---|
| **Cargar planilla** | El flujo de cada quincena/mes: elegir el periodo, subir el Excel, revisar lo que leyó la app y publicar. |
| **Equipo** | Tabla completa con todos los agentes, cuántos indicadores cumplió cada uno y el resultado (Excelente / Bueno / Malo / Crítico). También se escriben los comentarios individuales. |
| **Destacados** | El podio del periodo y el registro histórico de cuántas veces salió destacada cada persona. |
| **Ver su panel** | En la tabla de *Equipo*, cada fila tiene un botón 👁 que abre el panel de esa persona tal como lo ve ella, en solo lectura. Sirve para saber exactamente qué está leyendo antes de hablarle. |
| **Notas al equipo** | Mensajes en el perfil de una persona, con aviso sonoro. |
| **Colaboradores** | Alta de personas, contraseñas provisorias y los nombres con que aparece cada una en el Excel. |
| **Indicadores** | Metas, si mayor o menor es mejor, cuáles cuentan para el plus, y el consejo que ve el agente cuando no llega. |
| **Periodos** | Publicar, archivar, **deshacer una carga** mal hecha, ver el historial de lo que se subió y descargar el Excel original. |

### Del lado del colaborador

Barra lateral con cinco secciones:

| Sección | Qué muestra |
|---|---|
| **Mis resultados** | Arranca con el **podio de destacados del periodo** — visible para todo el equipo. Después: su resultado y el plus que le corresponde, los indicadores principales con cuánto le falta, **qué tenés que mejorar** en orden de prioridad con una recomendación concreta, y lo que sí está cumpliendo. |
| **Detalle por criterio** | Aspecto por aspecto, con los más bajos primero. |
| **Mi evolución** | Gráfico de cómo viene, indicador por indicador. |
| **Notas del supervisor** | Los mensajes que la supervisión le dejó en el perfil. |
| **Ajustes** | Su perfil, la apariencia y las notificaciones. |

Los datos de sus compañeros **no** se muestran. Solo ve su posición ("5º de 7") y el promedio
del equipo como referencia.

### Ajustes personales (los tiene cada persona, agente o supervisora)

- **Foto de perfil** — se recorta y comprime en el navegador, así que no pesa.
- **Nombre, puesto, email y turno.**
- **Modo claro / oscuro / automático** — el automático sigue la configuración del dispositivo.
  Queda guardado en el usuario, así que lo acompaña en cualquier computadora.
- **Paleta de colores** — la de la plataforma, índigo o rosa, a gusto de cada quien.
- **Tamaño del texto** — de 85% a 140%, para quien necesite letra más grande.
- **Sonido de notificación** — una campanita cuando llega una nota nueva, con un botón para
  probar cómo suena. Se puede apagar.
- **Cambio de contraseña.**

La supervisora tiene además un botón de sol/luna en el encabezado para alternar el modo de
un toque.

### Destacados del periodo

Es lo primero que ve cualquiera al entrar, y lo ve **todo el equipo**:

- **🏆 Mejor asesor del periodo** — quien cumplió todos los indicadores principales con el
  mayor avance promedio.
- **📊 MVP Volumen · ⭐ MVP Calidad · ⚡ MVP Velocidad** — el mejor de cada indicador principal,
  con su número y el promedio del equipo al lado para dar contexto.

Solo se premia a quien además **cumple la meta**: no hay "mejor" de un indicador que nadie alcanzó.
A quien sale destacado le aparece arriba de todo una franja de felicitación en verde lima, y en su
panel un resumen de su palmarés.

El **registro histórico** vive en la pestaña *Destacados* de la supervisión: una tabla con cuántas
veces salió cada persona mejor asesor y MVP de cada indicador, filtrable por fechas y exportable a
CSV, más el detalle periodo por periodo.

> El registro se **recalcula** sobre los periodos publicados en vez de guardarse aparte. Así nunca
> queda desincronizado: si corregís un dato y volvés a cargar el mes, el palmarés se ajusta solo.

### Roles y permisos

| Rol | Qué puede hacer |
|---|---|
| **Gerencia** | Control total, siempre. Es el único perfil que reparte permisos, y hay uno solo. |
| **Supervisor** | Exactamente los permisos que la gerencia le haya dado, ni uno más. |
| **Invitado** | Normalmente solo *Ver los resultados de todo el equipo*. Para dirección o auditoría. |
| **Agente** | Ve solo su propio panel. |

**Los siete permisos** que la gerencia otorga uno por uno, desde *Colaboradores → Editar*:

| Permiso | Habilita |
|---|---|
| `ver_equipo` | Ver los resultados de todo el equipo |
| `cargar` | Subir planillas y cargar datos |
| `periodos` | Publicar, archivar y deshacer cargas |
| `personas` | Dar de alta, editar y dar de baja colaboradores |
| `indicadores` | Cambiar metas, indicadores y consejos |
| `notas` | Enviar notas a los colaboradores |
| `marca` | Cambiar el nombre y el aspecto de la plataforma |

Lo que no está marcado **no aparece en el menú de esa persona** y además queda bloqueado en el
servidor: no alcanza con adivinar una dirección. Los permisos se leen en cada pedido, así que
quitarle uno a alguien tiene efecto inmediato, aunque tenga la sesión abierta.

La gerencia se define al instalar el sistema y no se puede asignar desde la pantalla de perfiles.
Existe **Traspasar la gerencia**, con doble confirmación: quien la cede queda como supervisora con
todos los permisos, para que nadie se quede afuera por error.

Desde **Colaboradores → Editar** también se cambia el nombre, el usuario, el puesto, el email, el
turno y la contraseña, y se agregan nombres alternativos de la planilla.

**Dos formas de sacar a alguien del equipo:**

- **Eliminar** (lo normal) — pierde el acceso, pero **sus resultados quedan**. Aparece como
  *"Alma Escobar (eliminada)"* en los informes y sigue contando en los promedios de los periodos
  donde trabajó, así ningún resultado ya publicado cambia. Se la puede reincorporar cuando se quiera.
- **Borrar definitivamente** (dentro del editor, con doble confirmación) — se van también sus datos
  históricos. Esto **sí** cambia los promedios de periodos anteriores; el propio botón lo advierte.

### Deshacer y archivar cargas

En **Periodos → Gestionar**:

- **Deshacer la carga** — borra los valores cargados en ese periodo y lo despublica, para volver a
  subir la planilla corregida. No toca personas ni indicadores.
- **Archivar** — el periodo sale de las estadísticas, del ranking y del palmarés sin borrarse. Al
  desarchivarlo vuelve como *sin publicar*. Sirve para un mes con datos dudosos que no querés que
  ensucie los promedios.
- **Despublicar** — más suave: los agentes dejan de verlo, pero sigue contando para la supervisión.
- **Historial de cargas** — qué archivo se subió, de qué hoja, cuántas personas y valores, cuándo y
  quién. Las cargas deshechas también quedan registradas.

### Paletas de color

Hay dos, y cada una trae su modo claro y su modo oscuro (cuatro combinaciones en total):

| Paleta | Cómo se ve |
|---|---|
| **Índigo** | Lavanda e índigo con acento verde lima. |
| **Rosa** | Fondo rosa claro o casi negro, con magenta neón de acento. |

Se elige en dos niveles:

- **La plataforma** tiene una paleta por defecto, que fija quien tenga el permiso `marca`. Es la que
  ve quien no eligió nada y la de la pantalla de ingreso.
- **Cada persona** puede quedarse con esa o elegir la suya, desde *Ajustes → Apariencia*. Su
  elección manda sobre la de la plataforma, y con *"La de la plataforma"* vuelve a seguirla.

El modo claro/oscuro y el tamaño del texto también son personales. Paleta y modo son ejes
independientes: cualquier combinación de las dos paletas con los dos modos funciona.

**El verde de celebración no cambia con la paleta.** La franja de felicitación, el chip
*DESTACADOS*, el rótulo *Mejor asesor del periodo* y el borde que marca "sos vos" usan siempre el
mismo verde lima (`--celebra`), en las dos paletas y en los dos modos. Ese es justamente el punto:
si el reconocimiento se tiñe del color de todo lo demás, deja de destacarse.

Los dos esquemas están verificados contra el estándar de contraste WCAG AA: texto principal por
encima de 15:1, colores de estado por encima de 3:1 sobre su fondo, y el texto dentro de cada chip
por encima de 4,5:1. Los estados nunca dependen solo del color: siempre van con su ✓/✕ y su palabra
("Cumple", "Bajo meta"), que es lo que sostiene la lectura para quien no distingue bien los tonos.

### Semáforo de conexión

Cada persona tiene un puntito de estado sobre su foto: 🟢 conectada, 🟡 ausente, 🔴 desconectada,
gris si fue dada de baja. Se ve en Colaboradores y en la tabla de Equipo.

El estado se actualiza solo con un latido al servidor cada minuto; a los 3 minutos sin señal la
persona pasa a desconectada. Cada quien puede además elegirlo a mano desde el menú de su nombre,
abajo a la izquierda: **Conectada · Ausente · Aparecer desconectada**, más accesos a *Mis ajustes*
y *Cerrar sesión*.

### Notas en el perfil

Desde **Notas al equipo**, la supervisión le deja un mensaje a una persona y elige el tono:
📝 nota, 🎉 felicitación o ⚠️ llamado de atención. Al colaborador le aparece un contador rojo
en la barra lateral y en la campanita, y le suena el aviso. Es distinto del *comentario del
periodo*: la nota es un mensaje suelto, el comentario queda pegado a los resultados de ese mes.

---

## 2. Cómo lee el Excel

No hay un formato obligatorio. Al subir el archivo la app:

1. Recorre **todas las hojas** y busca las que tengan una fila por persona y columnas con números.
2. Elige la más completa y muestra qué encontró (en el dashboard de ATC elige sola la hoja **Gráficos**).
3. Empareja los nombres de la planilla con los colaboradores cargados, salvando acentos y mayúsculas.
4. Reconoce indicadores conocidos y les propone meta y dirección:
   - *Chats atendidos* → meta ≥ 800
   - *Calidad* → meta ≥ 7,0
   - *Tiempo de respuesta* → meta ≤ 35 min (menor es mejor)
   - Los 7 criterios de calidad → meta ≥ 7,0 cada uno
5. Muestra todo en pantalla **antes** de guardar nada, para que se corrija lo que haga falta.

Lo que se corrige queda guardado: la próxima quincena la app ya sabe que "Beatriz A." es
Beatriz Alcaraz y que "T. Resp." se mide al revés.

También lee números escritos a la paraguaya: `1.745`, `7,39`, `29.6 min`, `99.7% resolución`.

---

## 3. Publicarla en internet (gratis, ~20 minutos)

Hacen falta dos servicios gratuitos: **Neon** guarda los datos y **Render** corre la aplicación.
Se usan los dos porque el disco de Render se borra en cada reinicio, así que la base tiene que
estar afuera.

### Paso 1 — La base de datos (Neon)

1. Entrar a **neon.com** y crear una cuenta.
2. Crear un proyecto (cualquier nombre, por ejemplo `desempeno`).
3. Copiar la **connection string**. Se ve así:
   ```
   postgresql://usuario:clave@ep-algo-123.neon.tech/neondb?sslmode=require
   ```
   Guardala, se usa en el paso 3.

### Paso 2 — Subir el código

1. Crear una cuenta en **github.com**.
2. Crear un repositorio nuevo, **privado**.
3. Subir esta carpeta completa (se puede arrastrar los archivos en "uploading an existing file").
   No subas la carpeta `node_modules` ni el archivo `.env`.

### Paso 3 — La aplicación (Render)

1. Entrar a **render.com**, crear cuenta y conectar GitHub.
2. **New → Web Service** y elegir el repositorio.
3. Configurar:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. En **Environment → Add Environment Variable**, cargar:

   | Clave | Valor |
   |---|---|
   | `DATABASE_URL` | la connection string de Neon |
   | `SESSION_SECRET` | cualquier texto largo e inventado |
   | `ADMIN_NOMBRE` | tu nombre |
   | `ADMIN_PASSWORD` | una contraseña provisoria para el primer ingreso |
   | `NODE_ENV` | `production` |

5. **Create Web Service**. En unos minutos queda una dirección tipo
   `https://panel-desempeno.onrender.com`.

### Paso 4 — Primer ingreso

1. Abrir la dirección, entrar con usuario **`admin`** y la contraseña que pusiste en `ADMIN_PASSWORD`.
2. Cambiarla enseguida.
3. Ir a **Colaboradores** y dar de alta al equipo con una contraseña provisoria para cada uno
   (el sistema les pide cambiarla al entrar por primera vez).
4. Ir a **Cargar planilla** y hacer la primera carga.

> **Nota sobre el plan gratuito de Render:** si nadie entra por 15 minutos, el servicio se
> "duerme". El primer ingreso después de eso tarda unos 30 segundos en abrir; los siguientes
> son instantáneos. Los datos no se pierden nunca porque están en Neon. Si molesta la espera,
> el plan pago de Render (unos 7 USD al mes) lo mantiene siempre despierto.

---

## 4. La rutina de cada quincena o mes

1. **Cargar planilla → 1.** Crear el periodo (por ejemplo, *1ª quincena de agosto 2026*).
2. **2.** Arrastrar el Excel.
3. **3.** Revisar lo que leyó — normalmente no hay nada que tocar — y **Cargar datos al periodo**.
4. **Publicar ahora**.
5. Opcional: en **Equipo**, escribirle un comentario a quien lo necesite.

Listo. Los agentes ya lo ven al entrar.

---

## 5. Correrla en una computadora (opcional)

```bash
npm install
cp .env.example .env      # completar DATABASE_URL
npm start                 # queda en http://localhost:3000
```

Requiere Node 20 o superior y un Postgres accesible (sirve el mismo de Neon).

---

## 6. Seguridad

- Las contraseñas se guardan cifradas con bcrypt, nunca en texto plano.
- Las sesiones se guardan en la base y expiran a las 12 horas.
- Un agente no puede ver, ni por dirección directa, los datos de otro: el servidor responde
  siempre con los datos de quien está logueado.
- Un periodo sin publicar es invisible para los agentes.
- El Excel original queda guardado en la base y solo lo puede descargar la supervisión.

---

## 7. Estructura del código

```
server.js              API y rutas
src/db.js              conexión a Postgres y migración
src/schema.sql         tablas
src/parse.js           lectura e interpretación del Excel
src/score.js           cálculo de cumplimiento, escala de plus y "qué mejorar"
public/login.html      ingreso
public/admin.html      panel de supervisión
public/agente.html     panel del colaborador
public/js/             lógica de cada pantalla
public/css/app.css     estilos
```

Las tablas se crean solas la primera vez que arranca. No hay que ejecutar nada a mano.
