// Persistence and Streaming - Bản dùng createAgent (API cấp cao)
// Mục tiêu:
//   - Cùng bài toán "Agent nhớ hội thoại" như 02-persistence-manual-graph.js, nhưng dùng
//     `createAgent` (giống 01-components-create-agent.js) thay vì tự dựng StateGraph.
//   - `createAgent` nhận `checkpointer` thẳng qua option -> không cần viết class Agent
//     riêng như agent-with-memory.js.

require("../_polyfill");
require("dotenv").config();

const { createAgent } = require("langchain");
const { MemorySaver } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { webSearch } = require("./tool");

const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!`;

// In gọn từng bước stream: tên Node vừa chạy xong + nội dung message mới nhất.
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

  // createAgent nhận checkpointer trực tiếp qua option, tự lo phần compile() bên trong.
  const agent = createAgent({
    model: llm,
    tools: [webSearch],
    systemPrompt: prompt,
    checkpointer: memory,
  });

  // 2 thread_id riêng biệt = 2 cuộc hội thoại độc lập trong cùng 1 checkpointer.
  const thread1 = { configurable: { thread_id: "1" } };
  const thread2 = { configurable: { thread_id: "2" } };

  console.log("\n========== Thread 1 - Lượt 1: Hỏi thời tiết SF ==========");
  for await (const event of await agent.stream(
    { messages: [{ role: "user", content: "What is the weather in sf?" }] },
    thread1,
  )) {
    printStepEvent(event);
  }

  console.log("\n========== Thread 1 - Lượt 2: Hỏi tiếp về LA (vẫn thread 1) ==========");
  for await (const event of await agent.stream(
    { messages: [{ role: "user", content: "What about in la?" }] },
    thread1,
  )) {
    printStepEvent(event);
  }

  console.log(
    "\n========== Thread 1 - Lượt 3: 'Cái nào ấm hơn?' -> Agent tự nhớ SF & LA nhờ checkpointer ==========",
  );
  for await (const event of await agent.stream(
    { messages: [{ role: "user", content: "Which one is warmer?" }] },
    thread1,
  )) {
    printStepEvent(event);
  }

  console.log(
    "\n========== Thread 2 - Hỏi lại y hệt câu trên nhưng khác thread_id -> KHÔNG có ngữ cảnh cũ ==========",
  );
  for await (const event of await agent.stream(
    { messages: [{ role: "user", content: "Which one is warmer?" }] },
    thread2,
  )) {
    printStepEvent(event);
  }
}

main();
