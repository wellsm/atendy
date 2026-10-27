const { APP_STAGE = 'dev' } = process.env;

/**
 * @type {import('@ez4/project').ProjectOptions}
 */
export default {
  prefix: APP_STAGE,
  projectName: 'atendy-web',
  sourceFiles: ['./src/deploy/distribution.ts'],
  stateFile: {
    path: `${APP_STAGE}-deploy`,
    remote: true
  }
};
