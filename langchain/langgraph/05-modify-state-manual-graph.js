// Human in the Loop - Phần 2: Sửa State trước khi cho Agent chạy tiếp
// Bản dựng StateGraph thủ công (dùng agent-with-interrupt.js) - xem bản createAgent tương
// đương ở 05-modify-state-create-agent.js.
// Mục tiêu:
//   - Khi Graph đang dừng trước Node "action" (nhờ interruptBefore), ta có thể đọc và SỬA
//     state đã lưu trước khi cho chạy tiếp - ví dụ đổi lại query của Tool sắp gọi.
//   - `graph.updateState(thread, values)` ghi đè state hiện tại. Vì message được sửa vẫn
//     giữ nguyên `id` cũ nên bị THAY THẾ, không tạo thêm message mới (nhờ reducer có sẵn
//     trong MessagesAnnotation).

require("../_polyfill");
require("dotenv").config();

const { MemorySaver } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const { Agent } = require("./agent-with-interrupt");
const { webSearch } = require("./tool");

const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!`;

function printStepEvent(event) {
  for (const [node, value] of Object.entries(event)) {
    // Khi Graph bị interruptBefore chặn lại, stream() bắn thêm 1 event phụ (vd:
    // "__interrupt__") không có field `messages` - bỏ qua, không phải Node thật.
    if (!value?.messages) continue;
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

  const memory = new MemorySaver();
  const abot = new Agent(llm, [webSearch], memory, prompt);
  const thread = { configurable: { thread_id: "3" } };

  console.log("\n========== Chạy tới khi bị chặn trước Node \"action\" ==========");
  const firstEvents = await abot.graph.stream(
    { messages: [new HumanMessage("Whats the weather in LA?")] },
    thread,
  );
  for await (const event of firstEvents) {
    printStepEvent(event);
  }

  let state = await abot.graph.getState(thread);
  const lastMessage = state.values.messages.at(-1);
  console.log("\nTool call ban đầu Model muốn gọi:", lastMessage.tool_calls);

  // Giữ nguyên `id` (để reducer thay thế đúng message này) - chỉ đổi `args.query`.
  const toolCallId = lastMessage.tool_calls[0].id;
  lastMessage.tool_calls = [
    { name: "web_search", args: { query: "current weather in Louisiana" }, id: toolCallId },
  ];

  await abot.graph.updateState(thread, { messages: [lastMessage] });
  state = await abot.graph.getState(thread);
  console.log("Tool call sau khi sửa:", state.values.messages.at(-1).tool_calls);

  console.log("\n========== Chạy tiếp với Tool call đã sửa ==========");
  const resumedEvents = await abot.graph.stream(null, thread);
  for await (const event of resumedEvents) {
    printStepEvent(event);
  }
}

main();
