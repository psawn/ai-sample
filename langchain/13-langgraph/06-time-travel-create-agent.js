// =======================================================================
// LANGGRAPH - BƯỚC 6: TIME TRAVEL (QUAY LẠI CHECKPOINT CŨ, RẼ NHÁNH) - BẢN createAgent
//
// Checkpointer lưu state sau mỗi bước. Ta quay lại 1 checkpoint cũ và chạy tiếp
// theo nhiều cách khác nhau -> mỗi cách tạo 1 nhánh (branch) lịch sử riêng.
//
// Các branch (2, 3, 4 đều rẽ ra từ cùng 1 checkpoint đang chờ duyệt):
// 1. Original: chạy lần đầu, bị chặn trước khi gọi tool.
// 2. Replay: duyệt (approve), chạy tiếp như cũ.
// 3. Edit: duyệt kèm sửa query (decision "edit").
// 4. Inject mock: tự chèn kết quả tool giả, bỏ qua middleware.
//
// Model có thể gọi tool nhiều lần, lần nào cũng bị chặn.
// -> Mỗi branch phải lặp resume tới khi state.next rỗng.
//
// Cùng bài toán với 06-time-travel-manual-graph.js. Khác biệt:
// - Chặn bằng humanInTheLoopMiddleware, không bằng interruptBefore.
// - Chạy tiếp bằng Command({ resume: { decisions } }), không bằng stream(null, config).
// - Node chạy tool tên "tools" (createAgent tự đặt), không phải "action".
// - Lúc bị chặn, next là ["HumanInTheLoopMiddleware.after_model"], không phải ["tools"].
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { createAgent, humanInTheLoopMiddleware } = require("langchain");
const { MemorySaver, Command } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ToolMessage } = require("@langchain/core/messages");
const { webSearch } = require("./tool");

// System prompt: trợ lý nghiên cứu, được gọi tool nhiều lần.
const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!`;

// In dữ liệu trả về sau mỗi node chạy xong.
function printStepEvent(event) {
  for (const [node, value] of Object.entries(event)) {
    // Lúc bị middleware chặn, stream() trả thêm event phụ "__interrupt__".
    // Event này không có messages, không phải node thật -> bỏ qua.
    if (!value?.messages) continue;

    const lastMessage = value.messages.at(-1);
    console.log(`[${node}]`, lastMessage.content || lastMessage.tool_calls);
  }
}

// Chạy tiếp từ config tới khi xong (state.next rỗng).
// - Lần đầu: dùng firstInput + config -> chạy từ đúng checkpoint rẽ nhánh.
// - Lần sau: dùng thread (không kèm checkpoint) -> chạy từ checkpoint mới nhất.
// Nếu dùng lại config cũ, graph cứ chạy lại từ cùng 1 điểm -> lặp vô hạn.
async function resumeUntilDone(agent, config, firstInput, thread) {
  let events = await agent.stream(firstInput, config);
  for await (const event of events) {
    printStepEvent(event);
  }

  let state = await agent.graph.getState(thread);
  while (state.next.length > 0) {
    events = await agent.stream(
      new Command({ resume: { decisions: [{ type: "approve" }] } }),
      thread,
    );
    for await (const event of events) {
      printStepEvent(event);
    }
    state = await agent.graph.getState(thread);
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

  // Branch 1 (gốc): chạy lần đầu, dừng chờ duyệt tool.
  console.log(
    "\n========== [BRANCH 1] Chạy lần đầu (Bị chặn trước khi gọi Tool) ==========",
  );
  const firstEvents = await agent.stream(
    { messages: [{ role: "user", content: "Whats the weather in LA?" }] },
    thread,
  );
  for await (const event of firstEvents) {
    printStepEvent(event);
  }

  // stream() không trả interrupt request như invoke() -> đọc qua getState().
  const firstState = await agent.graph.getState(thread);
  console.log(
    "-> Đang chờ duyệt:",
    firstState.tasks[0].interrupts[0].value.actionRequests,
  );

  // Lấy toàn bộ checkpoint, từ mới nhất tới cũ nhất.
  const states = [];
  for await (const snapshot of agent.graph.getStateHistory(thread)) {
    states.push(snapshot);
  }
  console.log(`\n-> Có ${states.length} checkpoint trong lịch sử.`);

  // Điểm rẽ nhánh: checkpoint đang chờ duyệt (message cuối có tool_calls).
  // Không tìm theo next.includes("tools") như bản manual-graph,
  // vì middleware dừng tại "HumanInTheLoopMiddleware.after_model", không phải trước "tools".
  const toReplay = states.find((snapshot) => snapshot.values.messages?.at(-1)?.tool_calls?.length);
  console.log("-> Checkpoint được chọn để làm điểm rẽ nhánh. Node sắp chạy:", toReplay.next);

  // Branch 2 (replay): duyệt rồi chạy tiếp như cũ.
  console.log("\n========== [BRANCH 2] Replay: Duyệt rồi chạy tiếp nguyên bản ==========");

  // resume mang decisions cho middleware biết xử lý tool call đang chờ thế nào.
  // Thay cho stream(null, config) ở bản manual-graph.
  // Giải thích Command xem 04-human-approval-create-agent.js.
  const branch2State = await resumeUntilDone(
    agent,
    toReplay.config,
    new Command({ resume: { decisions: [{ type: "approve" }] } }),
    thread,
  );
  console.log(">>> [Branch 2] Kết quả:", branch2State.values.messages.at(-1).content);

  // Branch 3 (edit): duyệt kèm sửa tool call.
  console.log("\n========== [BRANCH 3] Edit: Duyệt kèm sửa Tool Call ==========");

  const originalAction = toReplay.values.messages.at(-1).tool_calls[0];

  // decision "edit": middleware tự thay tool call.
  // Không cần tự sửa message hay gọi updateState() như bản manual-graph.
  const branch3State = await resumeUntilDone(
    agent,
    toReplay.config,
    new Command({
      resume: {
        decisions: [
          {
            type: "edit",
            editedAction: {
              name: originalAction.name,
              args: { query: "current weather in LA, accuweather" },
            },
          },
        ],
      },
    }),
    thread,
  );
  console.log(">>> [Branch 3] Kết quả:", branch3State.values.messages.at(-1).content);

  // Branch 4 (inject mock): tự chèn kết quả tool giả, bỏ qua middleware.
  console.log("\n========== [BRANCH 4] Inject: Tự chèn ToolMessage giả lập ==========");

  const finalToolCallId = toReplay.values.messages.at(-1).tool_calls[0].id;
  const stateUpdate = {
    messages: [
      new ToolMessage({
        tool_call_id: finalToolCallId,
        name: "web_search",
        content: "54 degree celcius",
      }),
    ],
  };

  // updateState với asNode "tools": ghi thẳng vào checkpoint, không qua middleware.
  // Graph coi như node "tools" đã chạy xong -> node kế tiếp là "model_request".
  const branch4Config = await agent.graph.updateState(toReplay.config, stateUpdate, "tools");
  console.log(
    "-> Kết quả Tool giả lập đã chèn:",
    (await agent.graph.getState(branch4Config)).values.messages.at(-1).content,
  );

  const branch4State = await resumeUntilDone(agent, branch4Config, null, thread);
  console.log(">>> [Branch 4] Kết quả:", branch4State.values.messages.at(-1).content);
}

main();
