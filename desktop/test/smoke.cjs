const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { app, dialog } = require('electron')

const scratch = mkdtempSync(join(tmpdir(), 'controlador-pc-'))
app.setPath('userData', scratch)
app.disableHardwareAcceleration()

async function run() {
  const window = await require('../main.cjs')
  const { webContents } = window
  const session = webContents.session
  await session.setProxy({ mode: 'fixed_servers', proxyRules: '127.0.0.1:9' })
  const loaded = new Promise(resolve => webContents.once('did-finish-load', resolve))
  webContents.reloadIgnoringCache()
  await loaded

  const buttons = await webContents.executeJavaScript(`(async () => {
    const matches = () => [...document.querySelectorAll('nav button')]
    const deadline = performance.now() + 10000
    while (!matches().length && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return {
      labels: matches().map(button => button.textContent.trim()),
      serial: window.isSecureContext && typeof navigator.serial?.requestPort === 'function',
      ports: (await navigator.serial.getPorts()).length,
    }
  })()`)
  assert.deepEqual(buttons.labels, ['Movimiento', 'Control', 'Programa', 'Visualizador', 'Consola'])
  assert.equal(buttons.serial, true)
  assert.equal(buttons.ports, 0)

  // Exercise Chromium's serial permission and chooser without opening a port.
  const originalDialog = dialog.showMessageBox
  let selected = false
  dialog.showMessageBox = async () => {
    selected = true
    return { response: 0 }
  }
  try {
    const result = await webContents.executeJavaScript(`navigator.serial.requestPort()
      .then(() => 'unexpected port', error => error.name)`, true)
    assert.equal(result, 'NotFoundError')
    assert.equal(selected, true, 'The desktop chooser handled the request')
  } finally {
    dialog.showMessageBox = originalDialog
  }

  // Use the production file input and download, with a harmless local fixture.
  const sample = 'G90\nG1 X1 Y1\n'
  const samplePath = join(scratch, 'prueba.gcode')
  const savedPath = join(scratch, 'guardado.gcode')
  writeFileSync(samplePath, sample)
  const editorReady = await webContents.executeJavaScript(`(async () => {
    const deadline = performance.now() + 10000
    while (performance.now() < deadline) {
      if (document.querySelector('input[type=file]')) return true
      const button = [...document.querySelectorAll('nav button')]
        .find(item => item.textContent.trim() === 'Programa')
      button?.click()
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return false
  })()`)
  assert.equal(editorReady, true)

  const debuggerClient = webContents.debugger
  debuggerClient.attach('1.3')
  try {
    const { root } = await debuggerClient.sendCommand('DOM.getDocument')
    const { nodeId } = await debuggerClient.sendCommand('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'input[type=file]',
    })
    await debuggerClient.sendCommand('DOM.setFileInputFiles', { nodeId, files: [samplePath] })
  } finally {
    debuggerClient.detach()
  }

  const text = await webContents.executeJavaScript(`(async () => {
    const deadline = performance.now() + 10000
    while (performance.now() < deadline) {
      const editor = document.querySelector('textarea[aria-label="Editor del archivo G-code"]')
      if (editor?.value) return editor.value
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return ''
  })()`)
  assert.equal(text, sample)

  const saved = new Promise((resolve) => {
    session.once('will-download', (_event, item) => {
      item.setSavePath(savedPath)
      item.once('done', (_doneEvent, state) => resolve(state))
    })
  })
  await webContents.executeJavaScript(`[...document.querySelectorAll('button')]
    .find(button => button.textContent.trim() === 'Guardar en mi PC').click()`)
  assert.equal(await saved, 'completed')
  assert.equal(readFileSync(savedPath, 'utf8'), sample)
  console.log('Apertura offline, selector USB y lectura/guardado de G-code verificados.')
}

const timeout = setTimeout(() => {
  console.error('La prueba de escritorio excedió el tiempo previsto.')
  app.exit(1)
}, 45000)
run().then(() => {
  clearTimeout(timeout)
  app.exit(0)
}, (error) => {
  console.error(error)
  app.exit(1)
})
