const assert = require('node:assert/strict')
const { chromium } = require('playwright')

async function verify() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.addInitScript(() => {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const log = { sent: [], opens: 0, closes: 0, probes: 0 }
      window.simulatedMega = log

      const port = new EventTarget()
      port.getInfo = () => ({ usbVendorId: 0x2341, usbProductId: 0x0042 })
      port.open = async ({ baudRate }) => {
        if (baudRate !== 115200) throw new Error('Baud rate inesperado')
        log.opens++
        let input
        port.readable = new ReadableStream({ start: (controller) => { input = controller } })
        port.writable = new WritableStream({
          write(chunk) {
            const command = decoder.decode(chunk).trim()
            log.sent.push(command)
            const responses = {
              M115: 'FIRMWARE_NAME:Marlin 2.1.2.5\n',
              M27: 'Not SD printing\n',
              M114: 'X:0.00 Y:0.00 Z:0.00 E:0.00\n',
            }
            input.enqueue(encoder.encode((responses[command] || '') + 'ok\n'))
          },
        })
      }
      port.close = async () => {
        if (port.readable.locked || port.writable.locked) throw new Error('Puerto todavía ocupado')
        log.closes++
      }

      const serial = Object.assign(new EventTarget(), {
        getPorts: async () => { log.probes++; return log.opens ? [port] : [] },
        requestPort: async () => port,
      })
      Object.defineProperty(navigator, 'serial', { value: serial })
    })

    await page.goto(process.env.CONTROLADOR_URL || 'http://127.0.0.1:8775/')
    await page.waitForFunction(() => window.simulatedMega.probes > 0)
    const connect = page.getByRole('button', { name: 'Conectar la Arduino Mega por USB', exact: true })
    const emergency = page.getByRole('button', { name: /^Parada de emergencia/ })
    const disconnect = page.getByRole('button', { name: 'Desconectar USB', exact: true })
    const steps = page.getByRole('radiogroup', { name: 'Paso de movimiento en milímetros' })
    assert.deepEqual(await steps.getByRole('radio').allTextContents(), ['1', '10', '100', '1000'])
    assert.equal(await steps.getByRole('radio', { name: '10', exact: true }).getAttribute('aria-checked'), 'true')

    await connect.click()
    await emergency.waitFor()
    assert.equal(await connect.isVisible(), false)
    await steps.getByRole('radio', { name: '1000', exact: true }).click()
    await page.getByRole('button', { name: 'Mover eje X en sentido positivo' }).click()
    await page.waitForFunction(() => window.simulatedMega.sent.includes('G90'))
    const motion = await page.evaluate(() => {
      const sent = window.simulatedMega.sent
      return sent.slice(sent.indexOf('G91'), sent.indexOf('G90') + 1)
    })
    assert.deepEqual(motion, ['G91', 'G0 X1000', 'G90'])

    await page.getByRole('navigation').getByRole('button', { name: 'Consola', exact: true }).click()
    await disconnect.click()
    await connect.waitFor()
    assert.equal(await emergency.isVisible(), false)
    assert.equal(await disconnect.isVisible(), false)
    assert.equal(await page.evaluate(() => window.simulatedMega.closes), 1)

    const probes = await page.evaluate(() => {
      const previous = window.simulatedMega.probes
      navigator.serial.dispatchEvent(new Event('connect'))
      return { previous, current: window.simulatedMega.probes }
    })
    assert.equal(probes.current, probes.previous)

    await connect.click()
    await emergency.waitFor()
    await disconnect.waitFor()
    assert.equal(await page.evaluate(() => window.simulatedMega.opens), 2)
    console.log('Chrome verificó conexión USB, desconexión, reconexión y el paso de 1000 mm con una Mega simulada.')
  } finally {
    await browser.close()
  }
}

verify().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
