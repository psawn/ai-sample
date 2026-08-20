// 1 REST API (Swagger Petstore) cũng có thể trở thành Tool cho LLM gọi - chỉ cần khai báo
// 1 Tool cho mỗi endpoint, trỏ vào đúng URL của nó.
require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

const PETSTORE_BASE_URL = "http://petstore.swagger.io/v1";

// Tương ứng endpoint GET /pets của Petstore API - trả về danh sách pet.
const listPets = tool(
  async ({ limit }) => {
    const params = limit ? `?limit=${limit}` : "";
    const response = await fetch(`${PETSTORE_BASE_URL}/pets${params}`);
    return response.status === 200 ? await response.text() : `Lỗi HTTP ${response.status}`;
  },
  {
    name: "listPets",
    description: "List all pets",
    schema: z.object({
      limit: z
        .number()
        .optional()
        .describe("How many items to return at one time (max 100)"),
    }),
  },
);

// Tương ứng endpoint GET /pets/{petId} của Petstore API - trả về thông tin 1 pet.
const showPetById = tool(
  async ({ petId }) => {
    const response = await fetch(`${PETSTORE_BASE_URL}/pets/${petId}`);
    return response.status === 200 ? await response.text() : `Lỗi HTTP ${response.status}`;
  },
  {
    name: "showPetById",
    description: "Info for a specific pet",
    schema: z.object({
      petId: z.string().describe("The id of the pet to retrieve"),
    }),
  },
);

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

async function main() {
  // bindTools: báo cho model biết danh sách Tool khả dụng, model tự quyết định gọi cái nào.
  const modelWithTools = llm.bindTools([listPets, showPetById]);

  // petstore.swagger.io/v1 là mock server, không có dữ liệu thật - mục đích ở đây là xem
  // model chọn đúng Tool + tham số, không phải xem kết quả gọi API.
  try {
    const result1 = await modelWithTools.invoke("what are three pets names");
    console.log("=== what are three pets names ===");
    console.log("tool_calls:", result1.tool_calls);

    const result2 = await modelWithTools.invoke("tell me about pet with id 42");
    console.log("\n=== tell me about pet with id 42 ===");
    console.log("tool_calls:", result2.tool_calls);
  } catch (error) {
    console.error(error);
  }
}

main();
