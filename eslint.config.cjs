/* eslint-env node */
/* eslint-disable @typescript-eslint/no-require-imports, no-undef, @typescript-eslint/no-unused-vars */

try {
    const { FlatCompat } = require("@eslint/eslintrc");
    const js = require("@eslint/js");

    const compat = new FlatCompat({
        baseDirectory: __dirname,
        recommendedConfig: js.configs.recommended,
        // allConfig: js.configs.all,
    });

    module.exports = [
        // 1) Ignore build artifacts and the config file(s) themselves
        { ignores: ["**/eslint.config.*", "dist/**", "build/**", "node_modules/**", "frontend/node_modules/**"] },

        // 2) If ESLint ever touches a config file, treat it as Node+CJS and silence TS-specific complaints
        {
            files: ["**/eslint.config.*"],
            languageOptions: {
                ecmaVersion: 2022,
                sourceType: "commonjs",
                globals: {
                    require: "readonly",
                    module: "readonly",
                    __dirname: "readonly",
                },
            },
            rules: {
                "@typescript-eslint/no-require-imports": "off",
                "@typescript-eslint/no-unused-vars": "off",
                "no-undef": "off",
            },
        },

        // 3) Re-use shareable configs (translating legacy "extends")
        ...compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),

        // 4) Project rules for your backend/app code
        {
            files: ["**/*.ts", "**/*.tsx", "**/*.js"],
            languageOptions: {
                ecmaVersion: 2022,
                sourceType: "module",
                parser: require("@typescript-eslint/parser"),
            },
            plugins: {
                "@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
            },
            rules: {
                "no-console": "off",
                "no-unused-vars": "off",
                "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
                "@typescript-eslint/no-explicit-any": "off",
            },
        },

        // Example: scope relaxed rules to tests or legacy code if needed
        // {
        //   files: ["**/__tests__/**", "**/legacy/**"],
        //   rules: { "@typescript-eslint/no-explicit-any": "off" }
        // },
    ];
} catch (_err) {
    // If @eslint/eslintrc isn't installed and you want a hard failure, rethrow.
    // throw _err;
}
