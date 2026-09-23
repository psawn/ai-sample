// =======================================================================
// TOOL ROUTING - BƯỚC 4: BIẾN REST API (OPENAPI) THÀNH TOOL
//
// REST API (ở đây là Swagger Petstore) cũng biến được thành Tool cho LLM gọi.
// Cách làm: mỗi endpoint = 1 Tool, trỏ vào đúng URL của endpoint đó.
//
// File này chỉ xem LLM chọn Tool nào, tham số gì. Không chạy Tool.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

const PETSTORE_BASE_URL = "http://petstore.swagger.io/v1";

// Tool cho endpoint GET /pets: trả danh sách pet.
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

// Tool cho endpoint GET /pets/{petId}: trả thông tin 1 pet.
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

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // bindTools: gửi danh sách Tool cho model. Model tự chọn gọi Tool nào.
  const modelWithTools = llm.bindTools([listPets, showPetById]);

  // petstore.swagger.io/v1 là mock server, không có dữ liệu thật.
  // Nên chỉ in tool_calls (Tool + tham số model chọn), không gọi API.
  try {
    // Câu 1: hỏi danh sách pet -> kỳ vọng listPets, limit = 3.
    const result1 = await modelWithTools.invoke("what are three pets names");
    console.log("=== what are three pets names ===");
    console.log("tool_calls:", result1.tool_calls);

    // Câu 2: hỏi 1 pet cụ thể -> kỳ vọng showPetById, petId = "42".
    const result2 = await modelWithTools.invoke("tell me about pet with id 42");
    console.log("\n=== tell me about pet with id 42 ===");
    console.log("tool_calls:", result2.tool_calls);
  } catch (error) {
    console.error(error);
  }
}

main();
