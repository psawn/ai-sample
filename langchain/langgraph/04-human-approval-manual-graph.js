// Human in the Loop - Phần 1: Duyệt tay trước khi Agent gọi Tool
// Bản dựng StateGraph thủ công (dùng agent-with-interrupt.js) - xem bản createAgent tương
// đương ở 04-human-approval-create-agent.js.
//
// Mục tiêu:
// - Cơ chế `interruptBefore: ["action"]` khiến Graph tự động DỪNG lại ngay
//   trước Node "action" khi Model yêu cầu gọi Tool.
// - Dùng `graph.getState(thread).next` để xem Node nào sắp chạy tiếp ([] là đã xong).
// - Dùng `graph.stream(null, thread)` (truyền `null`) để tiếp tục chạy từ vị trí đang dừng.

require("../_polyfill");
require("dotenv").config();
const readline = require("node:readline/promises");

const { MemorySaver } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const { Agent } = require("./agent-with-interrupt");
const { webSearch } = require("./tool");

const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!`;

// Hàm in ra dữ liệu trả về sau mỗi Node chạy xong
function printStepEvent(event) {
  // console.log("[event thô]", event);

  for (const [node, value] of Object.entries(event)) {
    // Khi Graph bị interruptBefore chặn lại, stream() bắn thêm 1 event phụ (vd:
    // "__interrupt__") không có field `messages` - bỏ qua, không phải Node thật.
    if (!value?.messages) continue;
    const lastMessage = value.messages.at(-1);
    console.log(`Node [${node}]`, lastMessage.content || lastMessage.tool_calls);
  }
}

// Kịch bản 1: Tự động cho chạy tiếp bằng code, không cần hỏi người dùng (minh họa API
// getState và stream(null)) - vẫn phải LẶP vì Model có thể cần gọi Tool nhiều lần liên tiếp.
async function runAutoApprove(abot) {
  console.log(
    '\n========== Thread 1: Chạy và tự dừng trước Node "action" ==========',
  );
  const thread = { configurable: { thread_id: "1" } };

  // Model muốn gọi Tool -> Agent có interruptBefore: ["action"] nên Graph bị chặn NGAY
  // TRƯỚC Node "action", chưa chạy Tool -> vòng lặp for-await bên dưới tự dừng ở đây.
  const firstEvents = await abot.graph.stream(
    { messages: [new HumanMessage("Whats the weather in SF?")] },
    thread,
  );
  for await (const event of firstEvents) {
    printStepEvent(event);
  }

  let state = await abot.graph.getState(thread);
  console.log("-> Node sắp chạy tiếp:", state.next);

  // Tự động duyệt (không hỏi ai) nhưng vẫn phải LẶP: sau khi đọc xong kết quả Tool, Model
  // có thể quyết định gọi Tool thêm lần nữa -> Graph lại bị chặn tiếp. Chỉ dừng vòng lặp
  // khi state.next thực sự rỗng (Graph chạy xong hoàn toàn).
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

// Kịch bản 2: Hỏi ý kiến người dùng (y/n) trước MỖI lần gọi Tool
async function runManualApprove(abot) {
  console.log(
    "\n========== Thread 2: Vòng lặp chờ người dùng xác nhận gọi Tool ==========",
  );
  const thread = { configurable: { thread_id: "2" } };

  // Chạy lượt đầu tiên tới khi bị dừng trước Node "action"
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

  // Tiếp tục hỏi duyệt chừng nào Graph vẫn còn Node chờ chạy (state.next không rỗng)
  while (state.next.length > 0) {
    console.log("\n-> Model muốn gọi Tool, Node sắp chạy:", state.next);
    const answer = await rl.question("Đồng ý cho chạy Tool? (y/n) ");

    if (answer !== "y") {
      console.log("Đã hủy.");
      break;
    }

    // Người dùng đồng ý -> Cho Graph chạy tiếp tới điểm dừng tiếp theo (hoặc tới khi xong)
    const nextEvents = await abot.graph.stream(null, thread);
    for await (const event of nextEvents) {
      printStepEvent(event);
    }

    // Cập nhật lại state mới nhất để kiểm tra vòng lặp kế tiếp
    state = await abot.graph.getState(thread);
  }

  rl.close();
}

async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });

  const memory = new MemorySaver();
  const abot = new Agent(llm, [webSearch], memory, prompt);

  await runAutoApprove(abot);
  await runManualApprove(abot);
}

main();
