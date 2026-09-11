// Persistence and Streaming - Phần 1: Persistence (Bộ nhớ hội thoại)
// Bản dựng StateGraph thủ công (dùng agent-with-memory.js) - xem bản createAgent tương
// đương ở 02-persistence-create-agent.js.
// Mục tiêu:
//   - Checkpointer (MemorySaver) giúp Agent "nhớ" hội thoại giữa các lượt gọi.
//   - Cùng 1 thread_id: Agent thấy được toàn bộ lịch sử trước đó (hỏi "cái nào ấm hơn" mà
//     không cần nhắc lại "sf" hay "la").
//   - Khác thread_id: Agent coi như cuộc hội thoại hoàn toàn mới, không có ngữ cảnh cũ.
// Lưu ý:
//   MemorySaver ở đây chỉ lưu trong RAM (mất khi tắt chương trình). LangGraph JS còn hỗ trợ
//   các Checkpointer khác lưu bền vững hơn (SQLite, Postgres,...) nếu cần dùng thật (production).

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

// In gọn từng bước stream: tên Node vừa chạy xong + nội dung message mới nhất.
// stepCount dùng để đánh số + đánh dấu rõ ràng điểm BẮT ĐẦU của mỗi step khi stream chạy.
let stepCount = 0;
function printStepEvent(event) {
  stepCount += 1;
  console.log(`--- Step ${stepCount} ---`);
  for (const [node, value] of Object.entries(event)) {
    const lastMessage = value.messages.at(-1);
    console.log(`[${node}]`, lastMessage.content || lastMessage.tool_calls);
  }
}

async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });

  // 1 checkpointer dùng chung cho toàn bộ Agent -> mọi thread_id đều được lưu ở đây.
  const memory = new MemorySaver();
  const abot = new Agent(llm, [webSearch], memory, prompt);

  // 2 thread_id riêng biệt = 2 cuộc hội thoại độc lập trong cùng 1 checkpointer.
  const thread1 = { configurable: { thread_id: "1" } };
  const thread2 = { configurable: { thread_id: "2" } };

  console.log("\n========== Thread 1 - Lượt 1: Hỏi thời tiết SF ==========");
  const events1 = await abot.graph.stream(
    { messages: [new HumanMessage("What is the weather in sf?")] },
    thread1,
  );
  for await (const event of events1) {
    printStepEvent(event);
  }

  console.log("\n========== Thread 1 - Lượt 2: Hỏi tiếp về LA (vẫn thread 1) ==========");
  const events2 = await abot.graph.stream(
    { messages: [new HumanMessage("What about in la?")] },
    thread1,
  );
  for await (const event of events2) {
    printStepEvent(event);
  }

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
