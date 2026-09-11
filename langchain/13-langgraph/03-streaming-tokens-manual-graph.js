// Persistence and Streaming - Phần 2: Streaming từng token của Model
// Mục tiêu:
//   - .stream(): trả kết quả sau MỖI Node chạy xong.
//   - .streamEvents(): trả event chi tiết hơn, kể cả lúc Model đang sinh từng chữ.
//   - "on_chat_model_stream": bắt được từng chunk (mẩu chữ nhỏ) ngay khi Model sinh ra nó.
// Lưu ý:
//   Khi Agent đang gọi Tool thì chưa có chữ nào để stream. Chunk chỉ xuất hiện khi Model
//   bắt đầu sinh câu trả lời dạng chữ.

require("../_polyfill");
require("dotenv").config();

const { MemorySaver } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const { Agent } = require("./agent-with-memory");
const { webSearch } = require("./tool");

const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!`;

async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });

  const memory = new MemorySaver();
  const abot = new Agent(llm, [webSearch], memory, prompt);

  // Mỗi thread_id đại diện cho 1 cuộc hội thoại riêng (xem thêm ở 02-persistence-manual-graph.js).
  const thread = {
    configurable: {
      thread_id: "4",
    },
  };

  const events = abot.graph.streamEvents(
    {
      messages: [new HumanMessage("What is the weather in SF?")],
    },
    {
      ...thread,
      version: "v2",
    },
  );

  // Nhận từng sự kiện ngay khi nó xảy ra (thời gian thực).
  for await (const event of events) {
    // "on_chat_model_stream": 1 mẩu (chunk) nhỏ của câu trả lời Model vừa sinh ra.
    if (event.event === "on_chat_model_stream") {
      const content = event.data.chunk.content;

      // content rỗng nghĩa là Model đang yêu cầu gọi Tool (chưa có chữ để in) -> bỏ qua,
      // chỉ in khi thực sự có chữ.
      if (content) {
        // Dấu "|" chỉ để nhìn rõ ranh giới giữa các chunk khi test, không phải do Model sinh ra.
        process.stdout.write(`${content}|`);
      }
    }
  }

  console.log();
}

main();
