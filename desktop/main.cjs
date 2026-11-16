const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { app, BrowserWindow, dialog, Menu, protocol } = require('electron')

const appUrl = 'impresora://control/'
const uiRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'ui')
  : path.join(__dirname, '..', 'out')
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'impresora',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

function isAppUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'impresora:' && url.host === 'control' &&
      !url.username && !url.password
  } catch {
    return false
  }
}

async function serveInterface(request) {
  if (!isAppUrl(request.url)) return new Response(null, { status: 404 })
  try {
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    const requestedFile = path.resolve(uiRoot, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`)
    const relative = path.relative(uiRoot, requestedFile)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return new Response(null, { status: 404 })
    }
    const type = contentTypes[path.extname(requestedFile)] || 'application/octet-stream'
    return new Response(await readFile(requestedFile), {
      headers: {
        'Content-Type': type,
        'Content-Security-Policy': "default-src 'self' blob: data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'",
      },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function configureUsb(window) {
  const { webContents } = window
  const session = webContents.session
  session.setPermissionCheckHandler((source, permission, origin, details) => (
    permission === 'serial' && source === webContents && isAppUrl(origin) &&
    isAppUrl(details.securityOrigin ?? origin) && details.isMainFrame !== false
  ))

  let choosing = false
  session.on('select-serial-port', async (event, ports, source, complete) => {
    event.preventDefault()
    if (source !== webContents || !isAppUrl(source.getURL()) || choosing) {
      complete('')
      return
    }

    choosing = true
    const removedPorts = new Set()
    const rememberRemoval = (_event, port, requester) => {
      if (requester === source) removedPorts.add(port.portId)
    }
    session.on('serial-port-removed', rememberRemoval)
    let chosen = ''
    try {
      if (ports.length === 0) {
        await dialog.showMessageBox(window, {
          type: 'info',
          title: 'Conectar USB',
          message: 'No hay puertos serie disponibles.',
          detail: 'Conectá la Arduino Mega por USB y volvé a intentar.',
          buttons: ['Aceptar'],
        })
      } else {
        const result = await dialog.showMessageBox(window, {
          type: 'question',
          title: 'Conectar USB',
          message: 'Elegí el puerto de la Arduino Mega.',
          buttons: ['Cancelar', ...ports.map(port => {
            const description = port.displayName
            return description && !description.includes(port.portName)
              ? `${port.portName} · ${description}`
              : description || port.portName
          })],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        const port = ports[result.response - 1]
        if (port && !removedPorts.has(port.portId)) chosen = port.portId
      }
    } catch (error) {
      console.error('Error al seleccionar el puerto serie.', error)
    } finally {
      session.off('serial-port-removed', rememberRemoval)
      choosing = false
      if (!source.isDestroyed()) complete(chosen)
    }
  })
}

async function openWindow() {
  Menu.setApplicationMenu(null)
  const window = new BrowserWindow({
    title: 'Controlador Impresora PC',
    icon: path.join(uiRoot, 'logo-ars3d-192.png'),
    width: 1200,
    height: 850,
    backgroundColor: '#111318',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })

  const { webContents } = window
  webContents.session.protocol.handle('impresora', serveInterface)
  webContents.session.webRequest.onBeforeRequest({
    urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'],
  }, (_details, complete) => complete({ cancel: true }))
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  webContents.on('will-navigate', (event) => {
    if (!isAppUrl(event.url)) event.preventDefault()
  })
  webContents.on('will-prevent-unload', (event) => {
    const answer = dialog.showMessageBoxSync(window, {
      type: 'warning',
      title: 'Trabajo por USB en curso',
      message: 'Si cerrás la aplicación, se interrumpirá el envío de G-code por USB.',
      buttons: ['Mantener abierta', 'Cerrar aplicación'],
      defaultId: 0,
      cancelId: 0,
    })
    if (answer === 1) event.preventDefault()
  })
  configureUsb(window)
  await window.loadURL(appUrl)
  return window
}

app.setName('Controlador Impresora PC')
app.commandLine.appendSwitch('disable-background-networking')
if (process.platform === 'win32') app.setAppUserModelId('org.ars.controlador.impresora.pc')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const ready = app.whenReady().then(openWindow)
  ready.catch((error) => {
    console.error(error)
    dialog.showErrorBox('Controlador Impresora PC', 'No se pudo abrir la aplicación. Revisá la instalación.')
    app.exit(1)
  })
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.on('window-all-closed', () => app.quit())
  module.exports = ready
}
