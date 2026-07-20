import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import configPrettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import { defineConfig, globalIgnores } from 'eslint/config'

const browserLanguageOptions = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  globals: {
    ...globals.browser,
    ...globals.es2026,
  },
}

export default defineConfig([
  globalIgnores(['dist/**', 'coverage/**', 'public/**', 'src/assets/**']),
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: browserLanguageOptions,
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
      'no-debugger': 'warn',
      'no-useless-assignment': 'off',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      ...browserLanguageOptions,
      parserOptions: {
        parser: tsParser,
      },
    },
    rules: {
      'no-console': 'off',
      'no-debugger': 'warn',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-mutating-props': 'off',
      'vue/no-v-html': 'off',
      'vue/require-default-prop': 'off',
      'vue/require-explicit-emits': 'off',
    },
  },
  configPrettier,
])
