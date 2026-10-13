/**
 * @type {import('@ez4/project').ProjectOptions}
 */
export default {
  prefix: 'atendy',
  projectName: 'api',
  sourceFiles: ['./src/*.ts', './src/**/queues/*.ts'],
  serveOptions: {
    localPort: 3746
  },
  stateFile: {
    path: 'atendy-deploy'
  },
  localOptions: {
    // Service `Db` → key `db`. Local commands (serve/run/test) always use Docker Postgres and create
    // tables there. `ez4 deploy` reads EZ4_RAW_PG_DB_URL (Neon) by itself; never wire it in here.
    db: { user: 'postgres', password: 'postgres', host: 'localhost', port: 54322, database: 'atendy' }
  },
  testOptions: {
    db: {
      database: 'atendy_tests'
    }
  }
};
