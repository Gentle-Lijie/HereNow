import js from '@eslint/js';
import ts from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
export default ts.config(
  { ignores: ['node_modules/**', '**/dist/**', 'output/**', '.local/**', '.playwright-cli/**'] },
  js.configs.recommended,
  {
    files: ['**/*.cjs'],
    languageOptions: { globals: { module: 'readonly', __dirname: 'readonly' } },
  },
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: ts.parser } },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/multiline-html-element-content-newline': 'off',
    },
  },
  { files: ['**/*.ts', '**/*.vue'], rules: { 'no-undef': 'off' } },
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        crypto: 'readonly',
        location: 'readonly',
        history: 'readonly',
        sessionStorage: 'readonly',
        File: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        HTMLInputElement: 'readonly',
        Blob: 'readonly',
        Event: 'readonly',
      },
    },
  },
);
