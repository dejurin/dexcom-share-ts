// eslint.config.mjs
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import { fileURLToPath } from "node:url";
import prettier from "eslint-config-prettier";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default [
  {
    ignores: ["dist/**", "**/*.d.ts", "coverage/**"],
  },
  {
    files: ["**/*.ts", "**/*.mts", "**/*.cts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest",
      },
      globals: {
        ...js.configs.recommended.languageOptions?.globals,
        fetch: "readonly",
        Response: "readonly",
        setTimeout: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-implicit-coercion": "error",
      eqeqeq: ["error", "smart"],
    },
  },

  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: __dirname,
      },
      globals: {
        fetch: "readonly",
        Response: "readonly",
        setTimeout: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...tseslint.configs["recommended-type-checked"].rules,
      "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  prettier,
];
