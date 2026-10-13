import type { Db } from '../../db';

import { DatabaseRunner } from '@ez4/local-database/run';

import { parsePolicyPatch } from '../../stores/policy';
import { StoreRepository } from '../../stores/repository';

const { STORE_ID, POLICY } = process.env;

if (!STORE_ID || !POLICY) {
  throw new Error(`Set STORE_ID and POLICY='{"max_item_qty":10}'`);
}

const patch = parsePolicyPatch(POLICY);

const db = DatabaseRunner.getClient<Db>('db');

if (!(await StoreRepository.getWebhookSecret(db, STORE_ID))) {
  throw new Error(`Store ${STORE_ID} not found`);
}

const policy = await StoreRepository.updatePolicy(db, STORE_ID, patch);

process.stdout.write(`${JSON.stringify(policy, null, 2)}\n`);
