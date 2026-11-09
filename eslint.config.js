import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default defineConfig([
	{
		ignores: ["coverage/", "dist/"]
	},
	{
		files: ["**/*.{js,ts}"],
		extends: [eslint.configs.recommended],
		languageOptions: {
			globals: globals.node
		}
	},
	{
		files: ["**/*.ts"],
		extends: [tseslint.configs.recommended, tseslint.configs.stylistic]
	},
	// Must be last: turns off any rules that conflict with Prettier.
	prettierConfig,
	// After prettierConfig, which disables `curly`; "all" doesn't conflict with Prettier.
	{
		files: ["**/*.{js,ts}"],
		rules: {
			curly: ["error", "all"]
		}
	}
]);
