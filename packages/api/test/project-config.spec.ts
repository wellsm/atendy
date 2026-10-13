import { equal } from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const projectFile = resolve(import.meta.dirname, '../ez4.project.js');

describe('ez4.project.js', () => {
  // `ez4 serve/run/test --local` create tables on whatever localOptions points to.
  // A Neon URL in the environment must never turn local commands into production DDL.
  it('keeps local and test options on the Docker Postgres even when EZ4_RAW_PG_DB_URL is set', async () => {
    process.env.EZ4_RAW_PG_DB_URL = 'postgres://user:pass@ep-prod-pooler.neon.tech/neondb';

    const { default: project } = (await import(`${projectFile}?neon=${Date.now()}`)) as {
      default: {
        localOptions: { db: { connectionString?: string; host?: string } };
        testOptions: { db: { database?: string } };
      };
    };

    equal(project.localOptions.db.connectionString, undefined);
    equal(project.localOptions.db.host, 'localhost');
    equal(project.testOptions.db.database, 'atendy_tests');

    delete process.env.EZ4_RAW_PG_DB_URL;
  });
});
