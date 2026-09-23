// =======================================================================
// UDEMY COURSE - SEARCH AGENT: TÌM KIẾM WEB + STRUCTURED OUTPUT
//
// Agent = LLM + Tools:
// - LLM: đọc câu hỏi, quyết định gọi tool tìm kiếm hay trả lời luôn.
// - Tool: TavilySearch tìm kiếm web, trả nội dung + URL.
//
// Flow:
// 1. LLM đọc câu hỏi, gọi TavilySearch (có thể nhiều lần).
// 2. Đủ thông tin -> LLM viết câu trả lời.
// 3. Câu trả lời được ép theo schema AgentResponse: { answer, sources }.
//
// Cần OPENAI_API_KEY và TAVILY_API_KEY trong .env.
// =======================================================================

require("dotenv").config();

const { z } = require("zod");
const { createAgent } = require("langchain");
const { ChatOpenAI } = require("@langchain/openai");
const { TavilySearch } = require("@langchain/tavily");

// 1 nguồn tham khảo: chỉ cần URL.
const Source = z.object({
  url: z.string().describe("The URL of the source"),
});

// Schema kết quả cuối: câu trả lời + danh sách nguồn đã dùng.
// - .describe(): mô tả cho LLM biết cần điền gì vào từng field.
// - .default([]): LLM không trả sources -> dùng mảng rỗng.
const AgentResponse = z.object({
  answer: z.string().describe("The agent's answer to the query"),

  sources: z
    .array(Source)
    .default([])
    .describe("List of sources used to generate the answer"),
});

// LLM: "bộ não" của Agent, quyết định gọi tool nào.
const llm = new ChatOpenAI({
  model: "gpt-5",
});

// Tool Agent được dùng: tìm kiếm web.
const tools = [new TavilySearch()];

// agent: gộp "quyết định bước tiếp theo" + "chạy vòng lặp" vào 1 chỗ.
// Vòng lặp: gọi LLM -> gọi tool -> đưa kết quả về LLM, tới khi LLM trả lời xong.
// responseFormat: ép câu trả lời cuối theo schema AgentResponse.
const agent = createAgent({
  model: llm,
  tools,
  responseFormat: AgentResponse,
});

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  console.log("Hello from langchain-course!");

  // Câu hỏi cần thông tin mới trên web -> kỳ vọng agent gọi TavilySearch.
  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content:
          "search for 3 job postings for an ai engineer using langchain in the bay area on linkedin and list their details?",
      },
    ],
  });

  // result gồm:
  // - messages: các bước hỏi-đáp và gọi tool.
  // - structuredResponse: kết quả theo schema { answer, sources }.
  console.dir(result, { depth: null });
}

main();
