// =======================================================================
// LANGGRAPH - BƯỚC 5: SỬA STATE TRƯỚC KHI CHẠY TIẾP - BẢN DỰNG GRAPH BẰNG TAY
//
// Graph dừng trước node "action". Ta sửa state đã lưu rồi mới cho chạy tiếp.
// Ví dụ: Model định tìm "weather in LA" (Los Angeles) -> đổi thành Louisiana.
//
// Luồng:
// 1. stream() tới khi dừng trước node "action".
// 2. getState() -> lấy message cuối, sửa tool_calls, giữ nguyên id.
// 3. updateState() -> message cùng id bị thay thế, không tạo message mới
//    (reducer của MessagesAnnotation).
// 4. stream(null) -> chạy tiếp với tool call đã sửa.
//
// Dùng Agent ở agent-with-interrupt.js. Bản createAgent: 05-modify-state-create-agent.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { MemorySaver } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const { Agent } = require("./agent-with-interrupt");
const { webSearch } = require("./tool");

// System prompt: trợ lý nghiên cứu, được gọi tool nhiều lần.
const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!`;

// In dữ liệu trả về sau mỗi node chạy xong.
function printStepEvent(event) {
  for (const [node, value] of Object.entries(event)) {
    // Lúc bị interruptBefore chặn, stream() trả thêm event phụ (vd: "__interrupt__").
    // Event này không có messages, không phải node thật -> bỏ qua.
    if (!value?.messages) continue;
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

  const memory = new MemorySaver();
  const abot = new Agent(llm, [webSearch], memory, prompt);
  const thread = { configurable: { thread_id: "3" } };

  // Bước 1: chạy tới khi dừng trước node "action".
  console.log("\n========== Chạy tới khi bị chặn trước Node \"action\" ==========");
  const firstEvents = await abot.graph.stream(
    { messages: [new HumanMessage("Whats the weather in LA?")] },
    thread,
  );
  for await (const event of firstEvents) {
    printStepEvent(event);
  }

  // Bước 2: đọc tool call Model muốn gọi, rồi sửa.
  let state = await abot.graph.getState(thread);
  const lastMessage = state.values.messages.at(-1);
  console.log("\nTool call ban đầu Model muốn gọi:", lastMessage.tool_calls);

  // Chỉ đổi args.query. Giữ nguyên id của tool call.
  const toolCallId = lastMessage.tool_calls[0].id;
  lastMessage.tool_calls = [
    { name: "web_search", args: { query: "current weather in Louisiana" }, id: toolCallId },
  ];

  // Bước 3: ghi message đã sửa vào state. Message cũ cùng id bị thay thế.
  await abot.graph.updateState(thread, { messages: [lastMessage] });
  state = await abot.graph.getState(thread);
  console.log("Tool call sau khi sửa:", state.values.messages.at(-1).tool_calls);

  // Bước 4: chạy tiếp bằng stream(null) với tool call đã sửa.
  console.log("\n========== Chạy tiếp với Tool call đã sửa ==========");
  const resumedEvents = await abot.graph.stream(null, thread);
  for await (const event of resumedEvents) {
    printStepEvent(event);
  }
}

main();
