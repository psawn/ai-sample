// =======================================================================
// DEMO: SEARCH AGENT (TÌM KIẾM WEB + TRẢ VỀ DỮ LIỆU CÓ CẤU TRÚC)
//
// Cơ chế hoạt động (Agent Loop):
// 1. LLM nhận câu hỏi -> Quyết định tìm kiếm web hay trả lời trực tiếp.
// 2. Nếu thiếu thông tin -> Gọi TavilySearch -> Nhận kết quả -> Lặp lại bước 1.
// 3. Khi đủ thông tin   -> Ép kết quả ra theo đúng schema AgentResponse và dừng.
//
// Yêu cầu: Cần cấu hình GEMINI_API_KEY và TAVILY_API_KEY trong file .env
// =======================================================================

require("../langchain/_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { createAgent, toolStrategy } = require("langchain");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { TavilySearch } = require("@langchain/tavily");

// ===== 1. CẤU HÌNH SCHEMA ĐẦU RỦA (STRUCTURED OUTPUT) =====

// Schema cho 1 nguồn trích dẫn
const Source = z.object({
  url: z.string().describe("The URL of the source"),
});

// Schema kết quả cuối cùng Agent phải trả về: Câu trả lời + Danh sách URL tham khảo
const AgentResponse = z.object({
  answer: z.string().describe("The agent's answer to the query"),
  sources: z
    .array(Source)
    .default([])
    .describe("List of sources used to generate the answer"),
});

// ===== 2. KHỞI TẠO LLM VÀ TOOLS =====

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Tool tìm kiếm dữ liệu thời gian thực trên Internet
const tools = [new TavilySearch()];

// Khoản đóng gói Agent: Tự động chạy vòng lặp ReAct (Gọi tool -> Lấy dữ liệu -> Xử lý)
// responseFormat: Ép kết quả cuối cùng phải khớp với AgentResponse thông qua toolStrategy
const agent = createAgent({
  model: llm,
  tools,
  responseFormat: toolStrategy(AgentResponse),
});

// ===== 3. THỰC THI =====

async function main() {
  console.log("===== Hello from langchain-course =====");

  // Gửi câu hỏi yêu cầu dữ liệu mới -> Agent sẽ tự động kích hoạt TavilySearch
  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content:
          "search for 3 job postings for an ai engineer using langchain in the bay area on linkedin and list their details?",
      },
    ],
  });

  // Kết quả trả về gồm:
  // - result.messages: Lịch sử các bước suy luận và các tool_calls đã thực hiện.
  // - result.structuredResponse: Kết quả đã ép chuẩn theo schema { answer, sources }.
  console.log("\n----- Full Result -----");
  console.dir(result, { depth: null });

  const { answer, sources } = result.structuredResponse;
  console.log("\n===== FINAL ANSWER =====");
  console.log(answer);
  console.log("\nSources:");
  sources.forEach((s) => console.log(`  - ${s.url}`));
}

main();
