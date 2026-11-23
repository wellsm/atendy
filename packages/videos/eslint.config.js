import { eslintIgnore, eslintProject } from '../../eslint.base.js';

export default [
  { ignores: [...eslintIgnore.ignores, 'out/**'] },
  {
    ...eslintProject,
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ...eslintProject.languageOptions,
      parserOptions: { project: './tsconfig.json' }
    },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } }
    }
  }
];
