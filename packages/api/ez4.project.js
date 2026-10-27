const { APP_STAGE = 'dev' } = process.env;

/**
 * @type {import('@ez4/project').ProjectOptions}
 */
export default {
  prefix: APP_STAGE,
  projectName: 'atendy',
  sourceFiles: ['./src/*.ts', './src/**/queues/*.ts', './src/**/crons/*.ts'],
  serveOptions: {
    localPort: 3746
  },
  stateFile: {
    path: `${APP_STAGE}-deploy`,
    remote: true
  },
  localOptions: {
    // Service `Db` → key `db`. Local commands (serve/run/test) always use Docker Postgres and create
    // tables there. `ez4 deploy` reads EZ4_RAW_PG_DB_URL (Neon) by itself; never wire it in here.
    db: { user: 'postgres', password: 'postgres', host: 'localhost', port: 54322, database: 'atendy' },
    // Service `RealtimeDb` → key `realtime_db`: DynamoDB Local (docker compose service `dynamodb`).
    realtime_db: { port: 8012 }
  },
  testOptions: {
    db: {
      database: 'atendy_tests'
    }
  }
};
