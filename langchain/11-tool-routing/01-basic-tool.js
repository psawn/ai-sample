// Tool = 1 hàm JS bình thường, gắn thêm name/description/schema để LLM biết khi nào nên
// gọi và gọi với tham số gì.
require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { toJsonSchema } = require("@langchain/core/utils/json_schema");

// Cách 1: Tool không khai báo schema tham số -> input luôn là 1 string.
// description là thứ LLM đọc để quyết định có nên gọi Tool này không.
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

// Cách 2: Khai báo schema tham số bằng zod. .describe() gắn mô tả cho từng field, giúp
// LLM điền đúng tham số khi gọi Tool.
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

async function main() {
  console.log("\n=== Tool có schema (zod) ===");
  // toJsonSchema: chuyển schema zod sang JSON Schema - format thật mà LLM nhận được.
  console.log("args:", JSON.stringify(toJsonSchema(searchWithSchema.schema), null, 2));

  // .invoke() chạy trực tiếp Tool như 1 hàm bình thường, không cần qua LLM.
  const result = await searchWithSchema.invoke({ query: "sf" });
  console.log("result:", result);
}

main();
