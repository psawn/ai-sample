// =======================================================================
// LANGGRAPH - BƯỚC 6: TIME TRAVEL (QUAY LẠI CHECKPOINT CŨ, RẼ NHÁNH) - BẢN DỰNG GRAPH BẰNG TAY
//
// Checkpointer lưu state sau mỗi bước. Ta quay lại 1 checkpoint cũ và chạy tiếp
// theo nhiều cách khác nhau -> mỗi cách tạo 1 nhánh (branch) lịch sử riêng.
//
// Các branch (2, 3, 4 đều rẽ ra từ cùng 1 checkpoint dừng trước "action"):
// 1. Original: chạy lần đầu, bị chặn trước node "action".
// 2. Replay: chạy tiếp như cũ từ checkpoint đó.
// 3. Edit: sửa query của tool call rồi chạy.
// 4. Inject mock: chèn kết quả tool giả rồi chạy tiếp.
//
// Model có thể gọi tool nhiều lần, lần nào cũng bị interruptBefore chặn.
// -> Mỗi branch phải lặp resume tới khi state.next rỗng.
//
// Dùng Agent ở agent-with-interrupt.js. Bản createAgent: 06-time-travel-create-agent.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { MemorySaver } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage, ToolMessage } = require("@langchain/core/messages");

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
    // Lúc bị interruptBefore chặn, stream() trả thêm event phụ "__interrupt__".
    // Event này không có messages, không phải node thật -> bỏ qua.
    if (!value?.messages) continue;

    const lastMessage = value.messages.at(-1);
    console.log(`[${node}]`, lastMessage.content || lastMessage.tool_calls);
  }
}

// Chạy tiếp từ config (1 checkpoint cụ thể) tới khi xong (state.next rỗng).
// - Lần đầu: chạy từ đúng config truyền vào.
// - Lần sau: dùng thread (không kèm checkpoint) -> chạy tiếp đúng nhánh vừa tạo,
//   không rẽ nhánh lại từ config ban đầu.
async function resumeUntilDone(abot, config, thread) {
  let events = await abot.graph.stream(null, config);
  for await (const event of events) {
    printStepEvent(event);
  }

  let state = await abot.graph.getState(thread);
  while (state.next.length > 0) {
    events = await abot.graph.stream(null, thread);
    for await (const event of events) {
      printStepEvent(event);
    }
    state = await abot.graph.getState(thread);
  }

  return state;
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

  const thread = {
    configurable: {
      thread_id: "4",
    },
  };

  // Branch 1 (gốc): chạy lần đầu tới khi bị chặn.
  console.log(
    '\n========== [BRANCH 1] Chạy lần đầu (Bị chặn trước Node "action") ==========',
  );

  const firstEvents = await abot.graph.stream(
    { messages: [new HumanMessage("Whats the weather in LA?")] },
    thread,
  );

  for await (const event of firstEvents) {
    printStepEvent(event);
  }

  // Lấy toàn bộ checkpoint, từ mới nhất tới cũ nhất.
  const states = [];
  for await (const snapshot of abot.graph.getStateHistory(thread)) {
    states.push(snapshot);
  }

  console.log(`\n-> Tổng số checkpoint trong Memory: ${states.length}`);

  // Điểm rẽ nhánh: checkpoint dừng trước node "action" (next chứa "action").
  // Tìm theo next, không đoán theo vị trí, vì số checkpoint thực tế có thể thay đổi.
  const toReplay = states.find((snapshot) => snapshot.next.includes("action"));
  console.log("-> Checkpoint gốc được chọn để rẽ nhánh, Node sắp chạy:", toReplay.next);

  // Branch 2 (replay): chạy tiếp như cũ từ checkpoint đó.
  console.log(
    "\n========== [BRANCH 2] Replay: Chạy tiếp từ checkpoint cũ ==========",
  );

  const branch2State = await resumeUntilDone(abot, toReplay.config, thread);
  console.log(">>> [Branch 2] Kết quả:", branch2State.values.messages.at(-1).content);

  // Branch 3 (edit): sửa tool call tại checkpoint cũ rồi rẽ nhánh.
  console.log(
    "\n========== [BRANCH 3] Edit: Sửa Tool Call rồi tạo nhánh mới ==========",
  );

  const lastMessage = toReplay.values.messages.at(-1);
  const toolCallId = lastMessage.tool_calls[0].id;

  // Sửa trên object JS đang giữ, checkpoint đã lưu chưa bị đổi.
  // Giữ nguyên id -> updateState() bên dưới thay đúng message này, không tạo message mới.
  lastMessage.tool_calls = [
    {
      name: "web_search",
      args: { query: "current weather in LA, accuweather" },
      id: toolCallId,
    },
  ];

  // Ghi state đã sửa vào toReplay.config -> tạo checkpoint mới cho branch 3.
  const branch3Config = await abot.graph.updateState(
    toReplay.config,
    toReplay.values,
  );

  const branch3StateBefore = await abot.graph.getState(branch3Config);
  console.log(
    "-> Tool call đã sửa:",
    branch3StateBefore.values.messages.at(-1).tool_calls,
  );

  const branch3State = await resumeUntilDone(abot, branch3Config, thread);
  console.log(">>> [Branch 3] Kết quả:", branch3State.values.messages.at(-1).content);

  // Branch 4 (inject mock): chèn kết quả tool giả rồi rẽ nhánh.
  console.log(
    "\n========== [BRANCH 4] Inject: Chèn ToolMessage giả lập ==========",
  );

  const finalToolCallId = toReplay.values.messages.at(-1).tool_calls[0].id;

  // ToolMessage giả, đóng vai kết quả của web_search.
  const stateUpdate = {
    messages: [
      new ToolMessage({
        tool_call_id: finalToolCallId,
        name: "web_search",
        content: "54 degree celcius",
      }),
    ],
  };

  // asNode "action": coi như node "action" vừa chạy xong.
  // -> Tạo checkpoint mới cho branch 4, node kế tiếp là "llm".
  const branch4Config = await abot.graph.updateState(
    toReplay.config,
    stateUpdate,
    "action",
  );

  const branch4StateBefore = await abot.graph.getState(branch4Config);
  console.log(
    "-> Kết quả Tool giả lập đã chèn:",
    branch4StateBefore.values.messages.at(-1).content,
  );

  const branch4State = await resumeUntilDone(abot, branch4Config, thread);
  console.log(">>> [Branch 4] Kết quả:", branch4State.values.messages.at(-1).content);
}

main();
