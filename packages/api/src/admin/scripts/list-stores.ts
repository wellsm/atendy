import type { Db } from '../../db';

import { DatabaseRunner } from '@ez4/local-database/run';

import { StoreRepository } from '../../stores/repository';

const db = DatabaseRunner.getClient<Db>('db');

process.stdout.write(`${JSON.stringify(await StoreRepository.list(db), null, 2)}\n`);
