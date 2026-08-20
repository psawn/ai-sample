// Bản viết lại của 06-agent-executor.js, dùng API MỚI (LangChain.js v1) - KHÔNG dùng
// RunnableWithMessageHistory (đã bị đánh dấu @deprecated trong @langchain/core@1.x, xem
// so sánh chi tiết ở dưới) và cũng không dùng createToolCallingAgent + AgentExecutor.
//
// Agent = LLM + Tools
//
// LLM:
//   - Đọc câu hỏi
//   - Quyết định cần làm gì
//   - Chọn Tool nếu cần
//
// Tool:
//   - Thực hiện công việc mà LLM yêu cầu
//
// Flow:
//   User → LLM → chọn Tool → Tool thực thi → kết quả → LLM → Final Answer
//
// createAgent (từ package "langchain") thay thế cả 2 việc mà bản cũ phải làm riêng:
//   1. createToolCallingAgent + AgentExecutor -> gộp thành 1 hàm createAgent duy nhất
//      (xây trên nền LangGraph, tự chạy Agent Loop bên trong, không cần bọc AgentExecutor).
//   2. RunnableWithMessageHistory -> thay bằng "checkpointer" (LangGraph tự lưu lịch sử
//      hội thoại theo "thread_id", không cần tự viết getMessageHistory() nữa).
//
// So sánh nhanh với bản cũ (06-agent-executor.js):
//   - prompt (tự viết ChatPromptTemplate) -> systemPrompt (chỉ cần 1 chuỗi text)
//   - sessionId -> thread_id
//   - input: { input: "..." } -> input: { messages: [{ role: "user", content: "..." }] }
//   - output: result.output (string) -> output: result.messages (mảng message, lấy phần tử cuối)
//   - getMessageHistory() + InMemoryChatMessageHistory -> checkpointer: new MemorySaver()
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

const tools = [getCurrentTemperature, searchWikipedia];

// checkpointer = nơi LangGraph tự lưu lịch sử hội thoại, thay cho
// getMessageHistory()/InMemoryChatMessageHistory ở bản cũ. MemorySaver lưu trong RAM
// (mất khi tắt chương trình) - tương đương InMemoryChatMessageHistory, chỉ khác là bạn
// không cần tự viết hàm tra cứu theo session nữa, LangGraph tự làm việc đó.
const checkpointer = new MemorySaver();

// agent: gộp luôn phần "quyết định action" (agent cũ) + "chạy Agent Loop" (agentExecutor
// cũ) vào 1 chỗ. Không còn "agent_scratchpad" phải tự khai báo trong prompt nữa -
// createAgent tự quản lý việc đó bên trong.
const agent = createAgent({
  model: llm,
  tools,
  systemPrompt: "You are helpful but sassy assistant",
  checkpointer,
});

async function main() {
  // "thread_id" = "sessionId" ở bản cũ: 1 thread_id = 1 cuộc hội thoại. Dùng lại đúng
  // thread_id này cho cả 3 lượt hỏi để agent nhớ được ngữ cảnh giữa các câu.
  const config = { configurable: { thread_id: "bob-session" } };

  try {
    const result1 = await agent.invoke(
      { messages: [{ role: "user", content: "my name is bob" }] },
      config,
    );
    console.log("\n========== Lượt 1 ==========");
    console.log(result1.messages.at(-1).content);

    const result2 = await agent.invoke(
      { messages: [{ role: "user", content: "whats my name" }] },
      config,
    );
    console.log("\n========== Lượt 2 (agent phải nhớ tên) ==========");
    console.log(result2.messages.at(-1).content);

    const result3 = await agent.invoke(
      { messages: [{ role: "user", content: "whats the weather in sf?" }] },
      config,
    );
    console.log(
      "\n========== Lượt 3 (agent vẫn nhớ, và biết gọi tool) ==========",
    );
    console.log(result3.messages.at(-1).content);

    // Log lại toàn bộ messages mà checkpointer đã lưu sau 3 lượt - bao gồm cả các bước
    // gọi tool (tool_calls) và kết quả tool (ToolMessage), không chỉ text như bản cũ.
    console.log("\n========== messages (nội bộ, do checkpointer lưu) ==========");
    console.log(result3.messages);
  } catch (error) {
    console.error(error);
  }
}

main();
