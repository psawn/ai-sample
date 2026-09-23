// =======================================================================
// LANGGRAPH - BƯỚC 5: SỬA TOOL CALL TRƯỚC KHI CHẠY TIẾP - BẢN createAgent
//
// Agent bị chặn trước khi gọi tool. Ta sửa tham số tool call rồi mới cho chạy.
// Ví dụ: Model định tìm "weather in LA" (Los Angeles) -> đổi thành Louisiana.
//
// Luồng:
// 1. agent.invoke() -> bị chặn, đọc tool call trong result.__interrupt__.
// 2. Tạo decision { type: "edit", editedAction: { name, args } }.
// 3. agent.invoke(new Command({ resume: { decisions } })) -> middleware thay tool call rồi chạy.
//
// Cùng bài toán với 05-modify-state-manual-graph.js. Khác biệt:
// - Bản đó tự sửa tool_calls trong message, rồi gọi updateState() (dựa vào message id).
// - Bản này không đụng tới message hay id. Middleware tự thay tool call.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { createAgent, humanInTheLoopMiddleware } = require("langchain");
const { MemorySaver, Command } = require("@langchain/langgraph");
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

  // Mỗi lần Model gọi tool "web_search" đều bị chặn chờ duyệt.
  // Tương đương interruptBefore: ["action"] ở bản manual-graph.
  const hitlMiddleware = humanInTheLoopMiddleware({
    interruptOn: { web_search: true },
  });

  const agent = createAgent({
    model: llm,
    tools: [webSearch],
    systemPrompt: prompt,
    checkpointer: memory,
    middleware: [hitlMiddleware],
  });

  const thread = { configurable: { thread_id: "1" } };

  // Bước 1: hỏi thời tiết LA -> Model muốn gọi web_search -> bị chặn.
  let result = await agent.invoke(
    { messages: [{ role: "user", content: "Whats the weather in LA?" }] },
    thread,
  );

  const originalAction = result.__interrupt__[0].value.actionRequests[0];
  console.log("\nTool call ban đầu Model muốn gọi:", originalAction);

  // Bước 2: sửa tool call bằng decision "edit".
  // Chỉ cần tên tool + args mới, không cần message id.
  const decisions = [
    {
      type: "edit",
      editedAction: {
        name: originalAction.name,
        args: { query: "current weather in Louisiana" },
      },
    },
  ];

  // Bước 3: chạy tiếp với tool call đã sửa.
  console.log("\n========== Chạy tiếp với Tool call đã sửa ==========");
  // resume gửi decisions vào chỗ graph đang dừng, middleware đọc để xử lý tool call.
  // Giải thích Command xem 04-human-approval-create-agent.js.
  result = await agent.invoke(new Command({ resume: { decisions } }), thread);
  console.log("\n>>> KẾT QUẢ CUỐI:", result.messages.at(-1).content);
}

main();
