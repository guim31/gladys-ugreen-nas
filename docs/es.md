# UGREEN NAS

Siga desde Gladys un NAS UGREEN NASync con UGOS Pro: procesador, memoria,
temperaturas, red, volúmenes y discos, con escenas cuando un volumen o un
disco requiere atención, y un widget para el panel.

La integración solo **lee**: nunca modifica nada en el NAS (ni apagado, ni
reinicio, ni operaciones con archivos).

> **Desarrollada sin el hardware: se agradecen los comentarios.** La API de
> UGOS Pro no está documentada; esta integración sigue lo que otros proyectos
> libres leen en NAS reales. Si en el suyo falta algo o algo no es correcto,
> abra una incidencia: <https://github.com/guim31/gladys-ugreen-nas/issues>.

No afiliada a UGREEN, ni respaldada ni financiada por UGREEN. UGREEN, NASync y
UGOS son marcas de sus respectivos propietarios.

## Lo que obtiene

Una vez hecha la configuración, la pestaña **Descubrir** propone los
siguientes dispositivos. Añada los que quiera seguir: no se crea nada sin
usted.

### El NAS

- **En línea**: 1 mientras el NAS responde, 0 en cuanto deja de responder.
- **Procesador** y **Memoria**: uso, en %.
- **Temperatura del procesador**, en °C (si el firmware la proporciona).
- **Recepción** y **Envío**: tráfico de red del NAS, en Mbit/s.
- **Tiempo en marcha**, en días.
- **Versión de UGOS**.

### Volúmenes

Un dispositivo por volumen (`Volume 1`, `Volume 2`…):

- **Espacio usado**, en %;
- **Capacidad** y **Espacio libre**, en GB;
- **Estado**: Correcto, Advertencia, Reconstruyendo, Degradado, Averiado (el
  peor entre el volumen y su grupo de almacenamiento);
- **Alerta**: 1 cuando el estado requiere atención, 0 en caso contrario; útil
  en las escenas y en el historial.

### Discos

Un dispositivo por disco (discos duros y M.2):

- **Temperatura**, en °C;
- **Estado**, tal como UGOS evalúa el disco según sus comprobaciones de salud:
  Correcto, Advertencia, Crítico, En fallo (también No detectado, Bloqueado);
- **Alerta**: 1 para Advertencia, Crítico o En fallo.

La integración nunca lanza una prueba SMART ni lee el detalle SMART: esas
consultas despiertan los discos en reposo. El estado mostrado es el que UGOS
ya conoce.

## Antes de empezar

### Una cuenta dedicada

Cree en el NAS una cuenta para Gladys (UGOS Pro → Panel de control →
Usuarios). Que sepamos, UGOS no ofrece un rol de solo lectura: empiece con un
usuario estándar. Si los volúmenes y los discos no aparecen (la acción
**Probar la conexión** indica «almacenamiento no legible con esta cuenta»),
añada esa cuenta al grupo de administradores. Su contraseña da entonces acceso
al NAS: resérvela para Gladys.

### Verificación en dos pasos

La integración no puede introducir un código de un solo uso: use una cuenta
sin verificación en dos pasos.

## Configuración

1. Abra la pestaña **Configuración** de la integración.
2. **Dirección del NAS**: su dirección IP en su red, por ejemplo
   `192.168.1.50`. Se añade el puerto de la API, 9999. Una dirección completa
   también funciona: `http://192.168.1.50:9999`.
3. **Nombre de usuario** y **Contraseña** de la cuenta anterior. La contraseña
   se envía cifrada con la clave del NAS y nunca se escribe en los registros.
4. **Intervalo de actualización**: cada minuto (por defecto), cada 2 o cada
   5 minutos.
5. **Idioma de los nombres y estados**: Gladys no transmite su idioma a una
   integración. Los nombres de las funciones (fijados al añadir un
   dispositivo), los estados y las variables de escena usan este.
6. Guarde y luego añada los dispositivos desde la pestaña **Descubrir**.

Por qué HTTP simple en el puerto 9999: es donde UGOS Pro sirve su API, tal
como la usan la interfaz web y los demás proyectos. La contraseña nunca
circula en claro (cifrado RSA, como hace la interfaz web). En HTTPS, el NAS
presenta un certificado autofirmado: una dirección `https://` también
funciona, y el certificado se acepta entonces sin verificación.

## Escenas

La integración añade tres activadores al editor de escenas, en la categoría
**Integraciones**:

- **Volumen degradado**: un volumen o su grupo de almacenamiento requiere
  atención (Advertencia, Reconstruyendo, Degradado o Averiado). Solo se vuelve
  a activar si empeora, y de nuevo después de haber vuelto a Correcto. Elegir
  el volumen es opcional. Variables: NAS, Volumen, Estado.
- **Alerta de disco**: UGOS evalúa un disco como Advertencia, Crítico o En
  fallo. Mismas reglas. Elegir el disco es opcional. Variables: NAS, Disco,
  Modelo, Estado, Temperatura (°C).
- **NAS inaccesible**: el NAS no ha respondido a dos lecturas seguidas, con
  unos 15 segundos de intervalo. Una vez, hasta que vuelva a responder.
  Variables: NAS, Motivo.

Los estados observados se guardan en `/data`: un reinicio de Gladys o de la
integración no repite ni pierde ningún aviso. La primerísima lectura solo
registra los estados.

## Widget del panel

El widget **NAS UGREEN** muestra los indicadores del procesador y de la
memoria, la temperatura del procesador, luego los volúmenes y discos que
requieren atención, cada volumen con su porcentaje de uso y su espacio libre,
el tráfico de red y el tiempo en marcha. El botón **Actualizar** vuelve a leer
el NAS.

## Probar la conexión

La acción **Probar la conexión** de la pestaña Configuración lee el NAS al
momento e indica el modelo, la versión de UGOS y el número de volúmenes y
discos encontrados, o por qué ha fallado.

## Limitaciones

- Un solo NAS por instalación.
- Probada únicamente con respuestas reconstruidas, no con un NAS real (véase
  más arriba).
- Ninguna acción sobre el NAS. Se ha descartado a propósito un botón
  «Reiniciar el NAS»: exigiría una cuenta de administrador, y un error saldría
  demasiado caro.
- Tras una contraseña rechazada, la integración deja de intentarlo por sí
  misma (UGOS bloquea una dirección tras varios inicios de sesión fallidos).
  Corrija la contraseña y guarde, o use **Probar la conexión** para volver a
  intentarlo.

## Solución de problemas

- **«no responde»**: compruebe la dirección, que el NAS esté encendido y que
  Gladys llegue al puerto 9999 (cortafuegos, otra red).
- **«no hay API de UGOS Pro en esta dirección»**: la dirección responde, pero
  no como UGOS Pro. Compruebe el puerto (9999); el antiguo UGOS (no Pro) no es
  compatible.
- **«nombre de usuario o contraseña rechazados»**: compruébelos en UGOS y
  vuelva a guardar la configuración.
- **Ningún volumen, ningún disco**: véase «Una cuenta dedicada» más arriba.
- **Falta una temperatura**: algunos firmwares no la proporcionan, o no
  mientras un disco está en reposo.

## Comentarios

Modelos cubiertos: la gama UGREEN NASync con UGOS Pro (DXP2800, DXP4800,
DXP4800 Plus, DXP6800 Pro, DXP8800 Plus, DXP480T Plus…), en teoría: no se ha
podido probar ningún modelo. Un comentario desde su NAS (lo que funciona, lo
que falta) es la contribución más útil:
<https://github.com/guim31/gladys-ugreen-nas/issues>.
