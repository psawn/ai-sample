// =======================================================================
// LANGGRAPH - BƯỚC 3: STREAMING TỪNG TOKEN - BẢN createAgent
//
// In câu trả lời dần từng mẩu chữ (chunk) ngay khi Model sinh ra.
// Agent tạo bằng createAgent, không tự dựng graph.
//
// Cùng bài toán với 03-streaming-tokens-manual-graph.js.
// Giải thích .stream() và .streamEvents() xem ở bản đó.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { createAgent } = require("langchain");
const { MemorySaver } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { webSearch } = require("./tool");

// System prompt: trợ lý nghiên cứu, được gọi tool nhiều lần.
const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!`;

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });

  const memory = new MemorySaver();
  const agent = createAgent({
    model: llm,
    tools: [webSearch],
    systemPrompt: prompt,
    checkpointer: memory,
  });

  // Mỗi thread_id = 1 cuộc hội thoại riêng.
  const thread = { configurable: { thread_id: "4" } };
  const events = agent.streamEvents(
    { messages: [{ role: "user", content: "What is the weather in SF?" }] },
    { ...thread, version: "v2" },
  );

  // Nhận từng event ngay khi nó xảy ra.
  for await (const event of events) {
    // "on_chat_model_stream": 1 chunk chữ Model vừa sinh ra.
    if (event.event === "on_chat_model_stream") {
      const content = event.data.chunk.content;
      // content rỗng: Model đang gọi tool, chưa có chữ -> bỏ qua.
      if (content) {
        process.stdout.write(`${content}|`);
      }
    }
  }
  console.log();
}

main();
