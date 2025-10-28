module.exports = {
    root: true,
    env: {
        browser: true, // window, document, etc.
        es2021: true,
    },
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
        ecmaFeatures: {
            jsx: true,
        },
    },
    plugins: ["@typescript-eslint", "react", "react-hooks"],
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "plugin:react/recommended", "plugin:react-hooks/recommended"],
    rules: {
        // React 18 + Vite doesn't require `import React` in every file
        "react/react-in-jsx-scope": "off",

        // TS-friendly unused var rule
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

        "@typescript-eslint/no-explicit-any": "warn",
    },
    settings: {
        react: {
            version: "detect",
        },
    },
    ignorePatterns: ["dist/", "build/", "node_modules/"],
};
