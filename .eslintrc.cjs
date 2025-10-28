// eslint.config.cjs
try {
    const { FlatCompat } = require("@eslint/eslintrc");
    const compat = new FlatCompat({});

    module.exports = [
        // reuse your existing extends via compat
        ...compat.extends(
            "eslint:recommended",
            "plugin:@typescript-eslint/recommended"
            // add other extends you relied on, e.g. "plugin:react/recommended"
        ),

        // ignore patterns (equivalent to .eslintignore)
        { ignores: ["dist/", "node_modules/", "frontend/node_modules/", "build/"] },

        // file-specific config for TS / JS
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
    // Don't export a legacy config object from a flat config file — that causes the "root" error.
    // Fail loudly with an actionable message so contributors know how to fix it.
    throw new Error(
        "eslint.config.cjs failed to initialize. Install devDeps: " +
            "`npm i -D @eslint/eslintrc @typescript-eslint/parser @typescript-eslint/eslint-plugin` " +
            "or revert to legacy .eslintrc.* configs."
    );
}
