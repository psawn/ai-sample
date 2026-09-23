// =======================================================================
// TOOL ROUTING - BƯỚC 6B: AGENT CÓ TRÍ NHỚ - BẢN createAgent (API MỚI)
//
// Viết lại 06-agent-executor.js bằng API mới.
// createAgent (package "langchain") thay 2 phần của bản cũ:
// 1. createToolCallingAgent + AgentExecutor -> createAgent.
//    Xây trên LangGraph, tự chạy vòng lặp agent bên trong.
// 2. RunnableWithMessageHistory (deprecated) -> checkpointer.
//    LangGraph tự lưu lịch sử theo thread_id, không cần viết getMessageHistory().
//
// So sánh với bản cũ:
// - prompt (ChatPromptTemplate) -> systemPrompt (1 chuỗi text).
// - sessionId -> thread_id.
// - input: { input: "..." } -> { messages: [{ role: "user", content: "..." }] }.
// - output: result.output -> result.messages.at(-1).
// - InMemoryChatMessageHistory -> checkpointer: new MemorySaver().
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { createAgent } = require("langchain");
const { MemorySaver } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { getCurrentTemperature } = require("./02-weather-tool");
const { searchWikipedia } = require("./03-wikipedia-tool");

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// 2 Tool Agent được dùng: xem nhiệt độ + tra Wikipedia.
const tools = [getCurrentTemperature, searchWikipedia];

// checkpointer: nơi LangGraph tự lưu lịch sử hội thoại.
// MemorySaver lưu trong RAM, giống InMemoryChatMessageHistory,
// nhưng không cần tự viết hàm tra history theo session.
const checkpointer = new MemorySaver();

// agent: gộp "quyết định bước tiếp theo" + "chạy vòng lặp" vào 1 chỗ.
// Không cần agent_scratchpad trong prompt, createAgent tự quản lý.
const agent = createAgent({
  model: llm,
  tools,
  systemPrompt: "You are helpful but sassy assistant",
  checkpointer,
});

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // 1 thread_id = 1 cuộc hội thoại (= sessionId ở bản cũ).
  // Dùng chung cho cả 3 lượt để agent nhớ ngữ cảnh.
  const config = { configurable: { thread_id: "bob-session" } };

  try {
    // Lượt 1: giới thiệu tên.
    const result1 = await agent.invoke(
      { messages: [{ role: "user", content: "my name is bob" }] },
      config,
    );
    console.log("\n========== Lượt 1 ==========");
    console.log(result1.messages.at(-1).content);

    // Lượt 2: hỏi lại tên -> agent phải nhớ "bob" từ lượt 1.
    const result2 = await agent.invoke(
      { messages: [{ role: "user", content: "whats my name" }] },
      config,
    );
    console.log("\n========== Lượt 2 (agent phải nhớ tên) ==========");
    console.log(result2.messages.at(-1).content);

    // Lượt 3: hỏi thời tiết -> agent vẫn nhớ ngữ cảnh, và gọi Tool.
    const result3 = await agent.invoke(
      { messages: [{ role: "user", content: "whats the weather in sf?" }] },
      config,
    );
    console.log(
      "\n========== Lượt 3 (agent vẫn nhớ, và biết gọi tool) ==========",
    );
    console.log(result3.messages.at(-1).content);

    // Messages checkpointer đã lưu: có cả tool_calls và ToolMessage,
    // không chỉ text hỏi-đáp như bản cũ.
    console.log("\n========== messages (nội bộ, do checkpointer lưu) ==========");
    console.log(result3.messages);
  } catch (error) {
    console.error(error);
  }
}

main();
