import type { Db } from '../../db';

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { DatabaseRunner } from '@ez4/local-database/run';

import { StoreWhatsApp } from '../../panel/whatsapp';

const { STORE_ID } = process.env;

if (!STORE_ID) {
  throw new Error('Set STORE_ID (plus EVOLUTION_API_URL, EVOLUTION_API_KEY and WEBHOOK_BASE_URL)');
}

const db = DatabaseRunner.getClient<Db>('db');

// Same flow as the panel's "Conectar": creates the instance when Evolution does not have it, then asks for a QR.
const { qrBase64, pairingCode } = await StoreWhatsApp.connect(db, STORE_ID, process.env);

if (qrBase64) {
  const file = resolve(process.cwd(), '../../tmp', `qr-${STORE_ID}.png`);

  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, Buffer.from(qrBase64.replace(/^data:image\/png;base64,/, ''), 'base64'));

  process.stdout.write(`QR code saved to ${file}\n`);
}

if (pairingCode) {
  process.stdout.write(`Pairing code: ${pairingCode}\n`);
}
