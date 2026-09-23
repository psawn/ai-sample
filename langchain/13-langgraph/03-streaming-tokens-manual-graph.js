// =======================================================================
// LANGGRAPH - BƯỚC 3: STREAMING TỪNG TOKEN - BẢN DỰNG GRAPH BẰNG TAY
//
// In câu trả lời dần từng mẩu chữ (chunk) ngay khi Model sinh ra, giống ChatGPT.
// - .stream(): trả kết quả sau mỗi node chạy xong.
// - .streamEvents(): trả event chi tiết hơn, kể cả từng chunk chữ Model đang sinh.
// - Event "on_chat_model_stream": chứa 1 chunk chữ.
//
// Lúc agent gọi tool thì chưa có chữ để stream.
// Chunk chỉ xuất hiện khi Model bắt đầu viết câu trả lời.
//
// Bản createAgent: 03-streaming-tokens-create-agent.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { MemorySaver } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const { Agent } = require("./agent-with-memory");
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
  const abot = new Agent(llm, [webSearch], memory, prompt);

  // Mỗi thread_id = 1 cuộc hội thoại riêng (xem 02-persistence-manual-graph.js).
  const thread = {
    configurable: {
      thread_id: "4",
    },
  };

  // version "v2": định dạng event mới nhất của streamEvents.
  const events = abot.graph.streamEvents(
    {
      messages: [new HumanMessage("What is the weather in SF?")],
    },
    {
      ...thread,
      version: "v2",
    },
  );

  // Nhận từng event ngay khi nó xảy ra.
  for await (const event of events) {
    // "on_chat_model_stream": 1 chunk chữ Model vừa sinh ra.
    if (event.event === "on_chat_model_stream") {
      const content = event.data.chunk.content;

      // content rỗng: Model đang gọi tool, chưa có chữ -> bỏ qua.
      if (content) {
        // "|" chỉ để thấy ranh giới giữa các chunk, không phải do Model sinh ra.
        process.stdout.write(`${content}|`);
      }
    }
  }

  console.log();
}

main();
