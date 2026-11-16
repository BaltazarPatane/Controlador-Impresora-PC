# Controlador Impresora PC para Windows

Abrí la compilación exitosa más reciente de `main` en [GitHub Actions](https://github.com/BaltazarPatane/Controlador-Impresora-PC/actions/workflows/desktop.yml?query=branch%3Amain) y descargá `Controlador-Impresora-PC-Windows-x64.exe` en **Artifacts**.

El instalador incluye el controlador y sus recursos. Podés copiar el
`Controlador-Impresora-PC-Windows-x64.exe` a la PC de la impresora con un pendrive,
instalarlo y abrir **Controlador Impresora PC** desde el menú Inicio con el Wi-Fi
apagado. Conectá la Mega, pulsá **Conectar USB** y seleccioná su puerto COM.
Si otro programa está usando el puerto, cerralo antes de conectar.

Al volver a abrir la aplicación, seleccioná nuevamente el puerto USB. Mientras
la aplicación sigue abierta se usa la lógica de reconexión del controlador.
El cierre de la ventana pide confirmación durante un trabajo enviado por USB.

## Compilar en Windows

Usá Node.js 24. Desde la raíz del repositorio, con internet durante la
compilación, ejecutá:

```powershell
npm ci
npm run build
npm --prefix desktop install
npm --prefix desktop test
npm --prefix desktop run dist:win
```

El instalador se genera en `dist-desktop/Controlador-Impresora-PC-Windows-x64.exe`.
Para ejecutar la app de desarrollo a partir del mismo `out/`, usá
`npm --prefix desktop start`.
