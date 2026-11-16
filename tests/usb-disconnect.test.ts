import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STEPS, type PrinterConnectionState } from '../lib/printer-types'
import { WebSerialPrinterTransport } from '../lib/web-serial-printer-transport'

class SimulatedMega extends EventTarget {
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null
  readonly encoder = new TextEncoder()
  readonly decoder = new TextDecoder()
  input: ReadableStreamDefaultController<Uint8Array> | null = null
  opened = 0
  closed = 0

  async open() {
    this.opened += 1
    this.readable = new ReadableStream({
      start: (input) => { this.input = input },
    })
    this.writable = new WritableStream({
      write: (chunk) => {
        if (this.decoder.decode(chunk).trim() === 'M115') {
          this.input?.enqueue(this.encoder.encode('FIRMWARE_NAME:Marlin 2.1.2.5\nok\n'))
        }
      },
    })
  }

  async close() {
    assert.equal(this.readable?.locked, false)
    assert.equal(this.writable?.locked, false)
    this.closed += 1
    this.input = this.readable = this.writable = null
  }
}

function waitForState(transport: WebSerialPrinterTransport, state: PrinterConnectionState) {
  return new Promise<void>((resolve) => {
    const unsubscribe = transport.subscribe((message) => {
      if (message.kind === 'connection' && message.state === state) {
        unsubscribe()
        resolve()
      }
    })
  })
}

test('desconectar libera el USB y requiere que el operador vuelva a conectar', { timeout: 12000 }, async (t) => {
  const mega = new SimulatedMega()
  let probes = 0
  const serial = Object.assign(new EventTarget(), {
    async getPorts() { probes += 1; return [mega] },
    async requestPort() { return mega },
  })
  const original = Object.getOwnPropertyDescriptor(navigator, 'serial')
  Object.defineProperty(navigator, 'serial', { value: serial, configurable: true })
  const transport = new WebSerialPrinterTransport()
  t.after(async () => {
    await transport.disconnect()
    if (original) Object.defineProperty(navigator, 'serial', original)
    else Reflect.deleteProperty(navigator, 'serial')
  })

  let ready = waitForState(transport, 'connected')
  await transport.connect()
  await ready
  assert.equal(mega.opened, 1)

  const disconnected = waitForState(transport, 'disconnected')
  await transport.disconnect()
  await disconnected
  assert.equal(mega.closed, 1)
  const probesBefore = probes
  serial.dispatchEvent(new Event('connect'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(probes, probesBefore)
  assert.equal(mega.opened, 1)

  ready = waitForState(transport, 'connected')
  await transport.requestAndConnect()
  await ready
  assert.equal(mega.opened, 2)

  const linkLost = waitForState(transport, 'error')
  mega.input?.error(new Error('USB retirado'))
  await linkLost
  ready = waitForState(transport, 'connected')
  serial.dispatchEvent(new Event('connect'))
  await ready
  assert.equal(mega.opened, 3)
})

test('el selector ofrece 1, 10, 100 y 1000 mm', () => {
  assert.deepEqual(STEPS, [1, 10, 100, 1000])
})
