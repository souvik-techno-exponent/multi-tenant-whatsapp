module.exports = {
    root: true,
    env: {
        node: true, // Node.js globals (require, module, process, etc.)
        es2021: true,
    },
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
    },
    plugins: ["@typescript-eslint"],
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
    rules: {
        // backend logs are useful in PoC / worker
        "no-console": "off",

        // Prefer TS version of no-unused-vars
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

        // don't block you hard on any
        "@typescript-eslint/no-explicit-any": "warn",
    },
    ignorePatterns: ["dist/", "node_modules/", "frontend/node_modules/"],
};
