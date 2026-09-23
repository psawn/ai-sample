// =======================================================================
// LANGGRAPH - BƯỚC 2: PERSISTENCE (NHỚ HỘI THOẠI) - BẢN DỰNG GRAPH BẰNG TAY
//
// Agent nhớ hội thoại qua nhiều lượt nhờ checkpointer (MemorySaver).
// - Cùng thread_id: agent thấy toàn bộ lịch sử. Hỏi "cái nào ấm hơn" không cần nhắc lại SF, LA.
// - Khác thread_id: hội thoại mới, không có ngữ cảnh cũ.
//
// Dùng Agent ở agent-with-memory.js. Bản createAgent: 02-persistence-create-agent.js.
//
// MemorySaver chỉ lưu trong RAM, tắt chương trình là mất.
// Dự án thật dùng checkpointer lưu bền (SQLite, Postgres...).
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

// In mỗi bước stream: tên node vừa chạy + message mới nhất.
// stepCount đánh số bước -> dễ thấy mỗi step bắt đầu ở đâu.
let stepCount = 0;
function printStepEvent(event) {
  stepCount += 1;
  console.log(`--- Step ${stepCount} ---`);
  for (const [node, value] of Object.entries(event)) {
    const lastMessage = value.messages.at(-1);
    console.log(`[${node}]`, lastMessage.content || lastMessage.tool_calls);
  }
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });

  // 1 checkpointer cho cả agent, lưu hội thoại của mọi thread_id.
  const memory = new MemorySaver();
  const abot = new Agent(llm, [webSearch], memory, prompt);

  // 2 thread_id = 2 cuộc hội thoại độc lập, dùng chung 1 checkpointer.
  const thread1 = { configurable: { thread_id: "1" } };
  const thread2 = { configurable: { thread_id: "2" } };

  // Thread 1 - lượt 1: hỏi thời tiết SF.
  console.log("\n========== Thread 1 - Lượt 1: Hỏi thời tiết SF ==========");
  const events1 = await abot.graph.stream(
    { messages: [new HumanMessage("What is the weather in sf?")] },
    thread1,
  );
  for await (const event of events1) {
    printStepEvent(event);
  }

  // Thread 1 - lượt 2: chỉ hỏi "LA thì sao?" -> agent hiểu là hỏi thời tiết LA.
  console.log("\n========== Thread 1 - Lượt 2: Hỏi tiếp về LA (vẫn thread 1) ==========");
  const events2 = await abot.graph.stream(
    { messages: [new HumanMessage("What about in la?")] },
    thread1,
  );
  for await (const event of events2) {
    printStepEvent(event);
  }

  // Thread 1 - lượt 3: "Cái nào ấm hơn?" -> agent nhớ SF và LA nhờ checkpointer.
  console.log(
    "\n========== Thread 1 - Lượt 3: 'Cái nào ấm hơn?' -> Agent tự nhớ SF & LA nhờ checkpointer ==========",
  );
  const events3 = await abot.graph.stream(
    { messages: [new HumanMessage("Which one is warmer?")] },
    thread1,
  );
  for await (const event of events3) {
    printStepEvent(event);
  }

  // Thread 2: hỏi y hệt nhưng khác thread_id -> không có ngữ cảnh cũ.
  console.log(
    "\n========== Thread 2 - Hỏi lại y hệt câu trên nhưng khác thread_id -> KHÔNG có ngữ cảnh cũ ==========",
  );
  const events4 = await abot.graph.stream(
    { messages: [new HumanMessage("Which one is warmer?")] },
    thread2,
  );
  for await (const event of events4) {
    printStepEvent(event);
  }
}

main();
