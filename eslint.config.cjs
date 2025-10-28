try {
    const path = require("path");
    const { FlatCompat } = require("@eslint/eslintrc");
    const js = require("@eslint/js");

    const compat = new FlatCompat({
        baseDirectory: __dirname,
        recommendedConfig: js.configs.recommended,
        // allConfig: js.configs.all,
    });

    module.exports = [
        ...compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),

        { ignores: ["dist/", "node_modules/", "frontend/node_modules/", "build/"] },

        {
            files: ["**/*.ts", "**/*.tsx", "**/*.js"],
            languageOptions: {
                parser: require("@typescript-eslint/parser"),
            },
            plugins: {
                "@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
            },
            rules: {
                "no-console": "off",
                "no-unused-vars": "off",
                "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
                // Allow explicit any everywhere
                "@typescript-eslint/no-explicit-any": "off",
            },
        },

        // Optional: if you only want unrestricted any in specific places, use a scoped override:
        // {
        //   files: ["**/__tests__/**", "**/legacy/**"],
        //   rules: { "@typescript-eslint/no-explicit-any": "off" }
        // },
    ];
} catch (err) {
    // If @eslint/eslintrc isn't installed and you want a hard failure, rethrow.
    // throw err;
}
