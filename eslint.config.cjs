try {
    // Prefer using FlatCompat if available (clean migration path).
    const { FlatCompat } = require("@eslint/eslintrc");
    const compat = new FlatCompat({});

    module.exports = [
        // Use your existing shared/extendable configs via compat.extends()
        ...compat.extends(
            "eslint:recommended",
            "plugin:@typescript-eslint/recommended"
            // frontend-specific react rules are included in frontend/.eslintrc.cjs
        ),

        // global ignores (migrates .eslintignore -> 'ignores' in flat config)
        { ignores: ["dist/", "node_modules/", "frontend/node_modules/", "build/"] },

        // file-specific rules for TS backend (basic subset — ESLint will merge compat rules above)
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
} catch (e) {
    // Fallback: if @eslint/eslintrc isn't installed (FlatCompat not available),
    // just export the legacy .eslintrc.cjs so ESLint finds a config file and works.
    // This keeps behavior identical to your previous setup.
    // NOTE: with this fallback you may still see a warning about .eslintignore if ESLint
    // runs in flat-mode; in that case install @eslint/eslintrc or remove .eslintignore.
    module.exports = require("./.eslintrc.cjs");
}
