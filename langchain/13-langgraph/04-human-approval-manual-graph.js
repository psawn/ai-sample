// =======================================================================
// LANGGRAPH - BƯỚC 4: HUMAN IN THE LOOP (DUYỆT TAY) - BẢN DỰNG GRAPH BẰNG TAY
//
// Graph dừng lại chờ duyệt trước mỗi lần gọi tool.
// - interruptBefore: ["action"]: graph tự dừng ngay trước node "action" (node chạy tool).
// - graph.getState(thread).next: node sắp chạy tiếp. [] nghĩa là đã xong.
// - graph.stream(null, thread): input null -> chạy tiếp từ chỗ đang dừng.
//
// 2 kịch bản:
// 1. Code tự duyệt, không hỏi người dùng.
// 2. Hỏi người dùng (y/n) trước mỗi lần gọi tool.
//
// Dùng Agent ở agent-with-interrupt.js. Bản createAgent: 04-human-approval-create-agent.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const readline = require("node:readline/promises");

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
  // console.log("[event thô]", event);

  for (const [node, value] of Object.entries(event)) {
    // Lúc bị interruptBefore chặn, stream() trả thêm event phụ (vd: "__interrupt__").
    // Event này không có messages, không phải node thật -> bỏ qua.
    if (!value?.messages) continue;
    const lastMessage = value.messages.at(-1);
    console.log(`Node [${node}]`, lastMessage.content || lastMessage.tool_calls);
  }
}

// Kịch bản 1: code tự duyệt, không hỏi người dùng.
// Mục đích: minh họa getState() và stream(null).
async function runAutoApprove(abot) {
  console.log(
    '\n========== Thread 1: Chạy và tự dừng trước Node "action" ==========',
  );
  const thread = { configurable: { thread_id: "1" } };

  // Model muốn gọi tool -> graph dừng ngay trước node "action", tool chưa chạy.
  // Vòng for-await bên dưới kết thúc tại điểm dừng này.
  const firstEvents = await abot.graph.stream(
    { messages: [new HumanMessage("Whats the weather in SF?")] },
    thread,
  );
  for await (const event of firstEvents) {
    printStepEvent(event);
  }

  let state = await abot.graph.getState(thread);
  console.log("-> Node sắp chạy tiếp:", state.next);

  // Phải lặp: đọc kết quả tool xong, Model có thể gọi tool tiếp -> graph lại dừng.
  // Chỉ thoát khi state.next rỗng (graph đã chạy xong).
  while (state.next.length > 0) {
    console.log(
      "\n========== Tự động duyệt -> Tiếp tục chạy bằng stream(null) ==========",
    );
    const events = await abot.graph.stream(null, thread);
    for await (const event of events) {
      printStepEvent(event);
    }
    state = await abot.graph.getState(thread);
  }

  console.log("-> Node sắp chạy tiếp:", state.next, "(rỗng nghĩa là đã xong)");
}

// Kịch bản 2: hỏi người dùng (y/n) trước mỗi lần gọi tool.
async function runManualApprove(abot) {
  console.log(
    "\n========== Thread 2: Vòng lặp chờ người dùng xác nhận gọi Tool ==========",
  );
  const thread = { configurable: { thread_id: "2" } };

  // Chạy lượt đầu tới khi dừng trước node "action".
  const firstEvents = await abot.graph.stream(
    { messages: [new HumanMessage("Whats the weather in LA?")] },
    thread,
  );
  for await (const event of firstEvents) {
    printStepEvent(event);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let state = await abot.graph.getState(thread);

  // Hỏi duyệt chừng nào graph còn node chờ chạy.
  while (state.next.length > 0) {
    console.log("\n-> Model muốn gọi Tool, Node sắp chạy:", state.next);
    const answer = await rl.question("Đồng ý cho chạy Tool? (y/n) ");

    if (answer !== "y") {
      console.log("Đã hủy.");
      break;
    }

    // Đồng ý -> chạy tiếp tới điểm dừng kế tiếp, hoặc tới khi xong.
    const nextEvents = await abot.graph.stream(null, thread);
    for await (const event of nextEvents) {
      printStepEvent(event);
    }

    // Lấy state mới để kiểm tra điều kiện vòng lặp.
    state = await abot.graph.getState(thread);
  }

  rl.close();
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

  // Kịch bản 1: code tự duyệt.
  await runAutoApprove(abot);
  // Kịch bản 2: người dùng duyệt từng lần.
  await runManualApprove(abot);
}

main();
