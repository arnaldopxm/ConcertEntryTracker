// Configuración de ESLint (formato plano).
//
// El objetivo no es imponer estilo, sino cazar lo que en una app sin build no
// avisa nadie: variables muertas, promesas sin await, comparaciones flojas y
// código inalcanzable.

import js from '@eslint/js';
import globals from 'globals';

const reglasComunes = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-undef': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': 'error',
  'no-implicit-coercion': ['error', { boolean: false }],
  'no-console': ['error', { allow: ['warn', 'error'] }],
  'no-throw-literal': 'error',
  'no-return-await': 'error',
  'require-atomic-updates': 'error',
  'no-constant-binary-expression': 'error',
  'no-promise-executor-return': 'error',
  'no-unmodified-loop-condition': 'error',
  'no-unreachable-loop': 'error',
  'no-template-curly-in-string': 'error',
  curly: ['error', 'multi-line']
};

export default [
  {
    ignores: ['node_modules/**', 'icons/**']
  },

  // La app: navegador, módulos ES, sin nada de Node.
  {
    files: ['app.js', 'store.js', 'calc.js', 'qr.js', 'firebase-config.js', 'views/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reglasComunes,
      // En el navegador no hay require ni process: que salte si se cuela.
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'La app corre en el navegador, no en Node.' },
        { name: 'require', message: 'La app usa módulos ES nativos.' }
      ]
    }
  },

  // Service worker: su propio scope.
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: globals.serviceworker
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reglasComunes
    }
  },

  // Tests: Node, salvo el doble de Firestore y lo que se evalúa en la página.
  {
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reglasComunes,
      'no-console': 'off'
    }
  }
];
