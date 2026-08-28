// ESC/POS Bluetooth print via Web Bluetooth — best-effort, works on Chrome Android
export async function printViaBluetooth(text: string): Promise<boolean> {
  if (!('bluetooth' in navigator)) throw new Error('Bluetooth not supported');
  const device = await (navigator as unknown as { bluetooth: { requestDevice: (opts: unknown) => Promise<BluetoothDevice> } }).bluetooth.requestDevice({
    filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
    optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'battery_service'],
  }).catch(() => null);
  if (!device) return false;
  const server = await (device as unknown as { gatt: { connect: () => Promise<BluetoothRemoteGATTServer> } }).gatt.connect().catch(()=>null);
  if (!server) throw new Error('Could not connect');
  // Generic write — many printers use 0x2ae1 or custom; try first writable characteristic
  const services = await server.getPrimaryServices().catch(()=>[]);
  for (const s of services) {
    const chars = await s.getCharacteristics().catch(()=>[]);
    for (const c of chars) {
      if (c.properties.write || c.properties.writeWithoutResponse) {
        const enc = new TextEncoder();
        // ESC/POS init + text + cut
        const init = new Uint8Array([0x1B,0x40]);
        const body = enc.encode(text + '\n\n\n');
        const cut = new Uint8Array([0x1D,0x56,0x00]);
        const payload = new Uint8Array(init.length + body.length + cut.length);
        payload.set(init,0); payload.set(body,init.length); payload.set(cut,init.length+body.length);
        await c.writeValue(payload).catch(()=> c.writeValueWithoutResponse?.(payload));
        return true;
      }
    }
  }
  throw new Error('No writable printer characteristic');
}
type BluetoothDevice = { gatt: { connect: () => Promise<BluetoothRemoteGATTServer> } };
type BluetoothRemoteGATTServer = { getPrimaryServices: () => Promise<BluetoothService[]> };
type BluetoothService = { getCharacteristics: () => Promise<BluetoothCharacteristic[]> };
type BluetoothCharacteristic = { properties: { write: boolean; writeWithoutResponse: boolean }; writeValue: (v: BufferSource) => Promise<void>; writeValueWithoutResponse?: (v: BufferSource) => Promise<void> };
