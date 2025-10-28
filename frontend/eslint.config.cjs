/* eslint-env node */
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */

// frontend/eslint.config.cjs  (flat-style config; NO "root" key")

const { FlatCompat } = require("@eslint/eslintrc");
// ensure we can translate "eslint:recommended" etc.
const js = require("@eslint/js");

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    // allConfig: js.configs.all, // optional — enable if you use "eslint:all"
});

module.exports = [
    // 1) Ignore build artifacts and the config file(s) themselves
    { ignores: ["**/eslint.config.*", "dist/**", "build/**", "node_modules/**"] },

    // 2) If ESLint ever touches a config file, treat it as Node+CJS and silence TS-specific complaints
    {
        files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            ecmaFeatures: { jsx: true }, // ⛔ ESLint 9 flat config does NOT allow this here
            parser: require("@typescript-eslint/parser"),

            parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module",
                project: undefined,
            },
        },
        rules: {
            "@typescript-eslint/no-require-imports": "off",
            "@typescript-eslint/no-unused-vars": "off",
            "no-undef": "off",
        },
    },

    // 3) Re-use common shareable configs/plugins (translates legacy "extends")
    ...compat.extends(
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:react/recommended",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended"
    ),

    // 4) Project-specific overrides (TS / TSX / JS / JSX)
    {
        files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            ecmaFeatures: { jsx: true },

            // parser is provided by @typescript-eslint/parser
            parser: require("@typescript-eslint/parser"),

            parserOptions: {
                // If you use project-based type-check linting (recommended for some rules),
                // add `project: "./tsconfig.json"` and enable typed linting separately.
                ecmaVersion: 2022,
                sourceType: "module",
                project: undefined, // set to "./tsconfig.json" only if you want typed rules
            },
        },
        plugins: {
            "@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
            react: require("eslint-plugin-react"),
            "react-hooks": require("eslint-plugin-react-hooks"),
            "jsx-a11y": require("eslint-plugin-jsx-a11y"),
        },
        rules: {
            // example rule overrides / preferences (customize to taste)
            "react/react-in-jsx-scope": "off",
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            // Allow explicit `any`
            "@typescript-eslint/no-explicit-any": "off",
            "react/prop-types": "off",
        },
        settings: {
            react: { version: "detect" },
        },
    },
];
