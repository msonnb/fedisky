import { defineConfig, globalIgnores } from "eslint/config";
import { fixupConfigRules } from "@eslint/compat";
import n from "eslint-plugin-n";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([
    globalIgnores(["**/dist", "**/node_modules"]),
    {
        extends: fixupConfigRules(compat.extends(
            "eslint:recommended",
            "plugin:@typescript-eslint/recommended",
            "plugin:import/recommended",
            "plugin:import/typescript",
            "plugin:prettier/recommended",
        )),

        plugins: {
            n,
        },

        settings: {
            "import/parsers": {
                "@typescript-eslint/parser": [".ts"],
            },

            "import/resolver": {
                typescript: {
                    project: "tsconfig.json",
                },
            },
        },

        rules: {
            eqeqeq: ["error", "always", {
                null: "ignore",
            }],

            "n/no-extraneous-import": "error",
            "n/prefer-node-protocol": "error",
            "import/no-absolute-path": "error",
            "import/no-self-import": "error",

            "import/order": ["error", {
                alphabetize: {
                    order: "asc",
                },

                "newlines-between": "never",
                groups: ["builtin", "external", "internal", "parent", ["index", "sibling"]],
            }],

            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                ignoreRestSiblings: true,
            }],

            "@typescript-eslint/no-explicit-any": "off",
        },
    },
]);