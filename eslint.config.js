// ESLint chỉ dùng để sắp xếp require/import (giống isort bên Python)
// Chạy: npm run sort-imports

const importPlugin = require("eslint-plugin-import");

module.exports = [
  {
    ignores: ["node_modules/**", "chroma-data/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
    },
    plugins: { import: importPlugin },
    rules: {
      "import/order": [
        "warn",
        {
          // Thứ tự nhóm: Node có sẵn -> thư viện npm -> file nội bộ
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          // Mỗi nhóm cách nhau 1 dòng trống
          "newlines-between": "always",
          // Trong mỗi nhóm: xếp theo bảng chữ cái
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
    },
  },
];
