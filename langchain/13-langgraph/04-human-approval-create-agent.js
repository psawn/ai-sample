// =======================================================================
// LANGGRAPH - BƯỚC 4: HUMAN IN THE LOOP (DUYỆT TAY) - BẢN createAgent
//
// Agent dừng lại chờ người dùng duyệt (y/n) trước mỗi lần gọi tool.
// Dùng createAgent + humanInTheLoopMiddleware.
//
// Luồng:
// 1. agent.invoke() -> Model muốn gọi tool -> bị chặn, trả về result.__interrupt__.
// 2. Người dùng chọn approve / reject cho từng tool call đang chờ.
// 3. agent.invoke(new Command({ resume: { decisions } }), thread) -> chạy tiếp.
// 4. Còn __interrupt__ thì quay lại bước 2.
//
// Cùng bài toán với 04-human-approval-manual-graph.js. Khác biệt:
// - Chặn theo tên tool (interruptOn: { web_search: true }), không theo tên node.
// - Không dùng getState() / stream(null, thread). Đọc result.__interrupt__, chạy tiếp bằng Command.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const readline = require("node:readline/promises");

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
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Lượt đầu: Model muốn gọi web_search -> bị chặn, trả về result.__interrupt__.
  let result = await agent.invoke(
    { messages: [{ role: "user", content: "Whats the weather in SF?" }] },
    thread,
  );

  // Vòng duyệt: còn __interrupt__ nghĩa là còn tool call chờ duyệt.
  // Phải lặp vì Model có thể gọi tool nhiều lần liên tiếp.
  while (result.__interrupt__) {
    const interruptRequest = result.__interrupt__[0];
    console.log(
      "\n-> Tool đang chờ duyệt:",
      interruptRequest.value.actionRequests,
    );

    const answer = await rl.question("Đồng ý cho chạy Tool? (y/n) ");
    // Mỗi tool call đang chờ cần 1 quyết định.
    const decisions = interruptRequest.value.actionRequests.map(() =>
      answer === "y"
        ? { type: "approve" }
        : { type: "reject", message: "Người dùng từ chối" },
    );

    // Command: vừa cập nhật state, vừa điều khiển hướng đi của graph.
    // - goto: chọn node tiếp theo hoặc END.
    // - update: cập nhật state.
    // - resume: giá trị gửi vào chỗ interrupt() đang dừng, để chạy tiếp.
    //
    // Ở đây resume mang decisions cho middleware xử lý từng tool call:
    // approve (cho chạy) / reject (không chạy) / edit (sửa rồi chạy).
    result = await agent.invoke(new Command({ resume: { decisions } }), thread);

    // Debug: in kết quả thật của tool (chỉ ToolMessage có tool_call_id).
    // Tool lỗi (vd: lỗi mạng) thì nội dung là thông báo lỗi từ catch() trong tool.js.
    const toolMessage = result.messages.findLast((m) => m.tool_call_id);
    if (toolMessage) console.log("\n[Tool trả về]:", toolMessage.content);
  }

  rl.close();
  console.log("\n>>> KẾT QUẢ CUỐI:", result.messages.at(-1).content);
}

main();
