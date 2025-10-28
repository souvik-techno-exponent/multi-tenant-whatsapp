// eslint.config.cjs
try {
    const { FlatCompat } = require("@eslint/eslintrc");
    const compat = new FlatCompat({});

    module.exports = [
        // reuse your existing extends via compat
        ...compat.extends(
            "eslint:recommended",
            "plugin:@typescript-eslint/recommended"
            // add e.g. "plugin:react/recommended" for frontend, but frontend has its own file
        ),

        // global ignores
        { ignores: ["dist/", "node_modules/", "frontend/node_modules/", "build/"] },

        // file-specific config for TS backend
        {
            files: ["**/*.ts", "**/*.js"],
            languageOptions: {
                parser: require.resolve("@typescript-eslint/parser"),
            },
            plugins: {
                "@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
            },
            rules: {
                "no-console": "off",
                "no-unused-vars": "off",
                "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
                "@typescript-eslint/no-explicit-any": "warn",
            },
        },
    ];
} catch (err) {
    // This should only run if @eslint/eslintrc isn't installed.
    // If you want a hard error instead, throw here. If you keep a fallback, ensure it doesn't throw.
    // module.exports = require("./.eslintrc.cjs");
}
