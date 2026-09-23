// =======================================================================
// TOOL ROUTING - BƯỚC 1: TOOL CƠ BẢN
//
// Tool = 1 hàm JS thường + name / description / schema.
// LLM không đọc code của hàm, chỉ đọc 3 thông tin này để biết:
// - Khi nào nên gọi Tool (name + description).
// - Gọi với tham số gì (schema).
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { toJsonSchema } = require("@langchain/core/utils/json_schema");

// Cách 1: không khai báo schema -> input luôn là 1 string.
const search = tool(
  async () => {
    // Giả lập kết quả tìm kiếm.
    return "42f";
  },
  {
    name: "search",
    description: "Search for weather online",
  },
);

console.log("=== Tool không có schema ===");
console.log("name:", search.name);
console.log("description:", search.description);

// Cách 2: khai báo schema bằng zod.
// .describe(): mô tả từng field, giúp LLM điền đúng tham số.
const SearchInput = z.object({
  query: z.string().describe("Thing to search for"),
});

const searchWithSchema = tool(
  async () => {
    return "42f";
  },
  {
    name: "search",
    description: "Search for the weather online.",
    schema: SearchInput,
  },
);

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  console.log("\n=== Tool có schema (zod) ===");
  // toJsonSchema: đổi schema zod sang JSON Schema, đúng format LLM nhận được.
  console.log("args:", JSON.stringify(toJsonSchema(searchWithSchema.schema), null, 2));

  // .invoke(): chạy Tool như hàm thường, không qua LLM.
  const result = await searchWithSchema.invoke({ query: "sf" });
  console.log("result:", result);
}

main();
