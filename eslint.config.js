const eslint = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const globals = require("globals");
const prettierConfig = require("eslint-config-prettier");

module.exports = defineConfig([
	{
		ignores: ["coverage/"]
	},
	{
		files: ["**/*.js"],
		extends: [eslint.configs.recommended],
		languageOptions: {
			sourceType: "commonjs",
			globals: globals.node
		}
	},
	{
		files: ["**/*.mjs"],
		extends: [eslint.configs.recommended],
		languageOptions: {
			sourceType: "module",
			globals: globals.node
		}
	},
	// Must be last: turns off any rules that conflict with Prettier.
	prettierConfig
]);
