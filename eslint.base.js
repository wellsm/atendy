import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import eslintPromise from 'eslint-plugin-promise';
import eslintImport from 'eslint-plugin-import';

export const eslintIgnore = {
  ignores: ['node_modules/**', 'dist/**', '.ez4/**']
};

export const eslintProject = {
  files: ['src/**/*.ts', 'test/**/*.ts'],
  languageOptions: {
    sourceType: 'module',
    parser: typescriptParser,
    parserOptions: {
      project: './tsconfig.test.json'
    }
  },
  plugins: {
    '@typescript-eslint': typescriptPlugin,
    promise: eslintPromise,
    import: eslintImport
  },
  settings: {
    'import/resolver': {
      typescript: {
        project: './tsconfig.test.json'
      }
    }
  },
  rules: {
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/require-await': 'error',
    '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    '@typescript-eslint/return-await': ['error', 'in-try-catch'],
    'promise/prefer-await-to-then': 'error',
    'import/no-extraneous-dependencies': 'error',
    'import/no-unresolved': 'error',
    'import/order': [
      'error',
      {
        'newlines-between': 'always',
        groups: ['type', 'builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
        pathGroups: [
          { pattern: '@*', group: 'type', position: 'before' },
          { pattern: '@*', group: 'builtin', position: 'before' },
          { pattern: '@*', group: 'external', position: 'before' },
          { pattern: '@*', group: 'internal', position: 'before' },
          { pattern: '@*', group: 'parent', position: 'before' },
          { pattern: '@*', group: 'sibling', position: 'before' },
          { pattern: '@*', group: 'index', position: 'before' }
        ],
        distinctGroup: false,
        sortTypesGroup: true,
        named: true,
        alphabetize: {
          caseInsensitive: true,
          order: 'asc'
        }
      }
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      {
        fixStyle: 'separate-type-imports',
        prefer: 'type-imports'
      }
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }
    ]
  }
};
