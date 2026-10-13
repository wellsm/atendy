import { eslintIgnore, eslintProject } from '../../eslint.base.js';

export default [
  { ignores: [...eslintIgnore.ignores, '.output/**', '.tanstack/**', 'src/routeTree.gen.ts'] },
  {
    ...eslintProject,
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    languageOptions: {
      ...eslintProject.languageOptions,
      parserOptions: { project: './tsconfig.json' }
    },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } }
    }
  }
];
