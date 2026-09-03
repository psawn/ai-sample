// Human in the Loop - Bản dùng createAgent (Time Travel qua Checkpoint & Branching)
//
// File này dùng `humanInTheLoopMiddleware` để BỊ CHẶN trước khi gọi Tool - giống hệt hành
// vi `interruptBefore` ở bản manual-graph, chỉ khác cơ chế resume:
//   - Bản manual-graph: chạy tiếp bằng `stream(null, config)`.
//   - Bản createAgent:  phải chạy tiếp bằng `Command({ resume: { decisions } })` với quyết
//     định approve/edit/reject (xem thêm ở 04-human-approval-create-agent.js).
//
// Điểm khác biệt khác so với bản manual-graph:
//   - Bản manual-graph: Node gọi Tool có tên là "action".
//   - Bản createAgent:  Node gọi Tool có tên là "tools" (do createAgent tự đặt). Lúc bị
//     chặn, `next` là ["HumanInTheLoopMiddleware.after_model"] chứ không phải ["tools"].
//
// Sơ đồ các Branch được tạo ra (đều rẽ từ cùng 1 checkpoint đang chờ duyệt):
// Branch 1 (Original) : Chạy ban đầu -> Bị chặn trước khi gọi Tool (Interrupt).
//  ├──> Branch 2 (Replay)      : Duyệt (approve) rồi chạy tiếp nguyên bản.
//  ├──> Branch 3 (Edit Call)   : Duyệt kèm sửa query (decision "edit").
//  └──> Branch 4 (Inject Mock) : Tự chèn kết quả Tool, bỏ qua middleware.
//
// Lưu ý: Model có thể gọi Tool nhiều lần liên tiếp, mỗi lần đều bị middleware chặn lại
// -> mỗi Branch phải LẶP resume tới khi thực sự xong (state.next rỗng), không chỉ 1 lần.

require("../_polyfill");
require("dotenv").config();

const { createAgent, humanInTheLoopMiddleware } = require("langchain");
const { MemorySaver, Command } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ToolMessage } = require("@langchain/core/messages");
const { webSearch } = require("./tool");

const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!`;

function printStepEvent(event) {
  for (const [node, value] of Object.entries(event)) {
    // Khi Graph bị middleware chặn lại, stream() bắn thêm 1 event phụ "__interrupt__"
    // không chứa messages - bỏ qua, không phải Node thật (giống hệt bản manual-graph).
    if (!value?.messages) continue;

    const lastMessage = value.messages.at(-1);
    console.log(`[${node}]`, lastMessage.content || lastMessage.tool_calls);
  }
}

// Resume từ `config` tới khi THỰC SỰ xong (state.next rỗng).
// - Lần đầu: dùng `firstInput` (Command với decision cụ thể, hoặc `null`) - nhắm đúng
//   checkpoint `config`, tức điểm rẽ nhánh.
// - Các lần lặp sau (Model gọi Tool thêm lần nữa): PHẢI dùng `thread` (không kèm checkpoint
//   cụ thể) để lấy checkpoint MỚI NHẤT của nhánh vừa tạo.
// Nếu cứ dùng lại `config` cũ, graph sẽ resume lặp lại mãi từ đúng điểm đó -> treo vô hạn.
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

async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });

  const memory = new MemorySaver();

  // interruptOn: { web_search: true } -> mỗi lần Model gọi Tool "web_search" đều bị chặn
  // lại chờ duyệt, tương đương interruptBefore: ["action"] ở bản manual-graph.
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

  // ============================================================
  // BRANCH 1 (NHÁNH GỐC): Chạy lượt đầu tiên, dừng lại chờ duyệt Tool
  // ============================================================
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

  // stream() không trả thẳng interrupt request như invoke() - phải getState() để đọc.
  const firstState = await agent.graph.getState(thread);
  console.log(
    "-> Đang chờ duyệt:",
    firstState.tasks[0].interrupts[0].value.actionRequests,
  );

  // Lấy lịch sử tất cả các snapshot checkpoint (từ mới nhất -> cũ nhất)
  const states = [];
  for await (const snapshot of agent.graph.getStateHistory(thread)) {
    states.push(snapshot);
  }
  console.log(`\n-> Có ${states.length} checkpoint trong lịch sử.`);

  // Tìm checkpoint đang chờ duyệt (message cuối có tool_calls) để làm "Gốc phân nhánh".
  // Không dùng next.includes("tools") như bản manual-graph, vì middleware pause TẠI
  // "HumanInTheLoopMiddleware.after_model", không phải ngay trước Node "tools".
  const toReplay = states.find((snapshot) => snapshot.values.messages?.at(-1)?.tool_calls?.length);
  console.log("-> Checkpoint được chọn để làm điểm rẽ nhánh. Node sắp chạy:", toReplay.next);

  // ============================================================
  // BRANCH 2: Duyệt (approve) rồi chạy tiếp nguyên bản
  // ============================================================
  console.log("\n========== [BRANCH 2] Replay: Duyệt rồi chạy tiếp nguyên bản ==========");

  // Command({ resume }) thay cho stream(null, config) - vì đây là interrupt() động nằm
  // trong middleware, không phải interruptBefore tĩnh như bản manual-graph.
  const branch2State = await resumeUntilDone(
    agent,
    toReplay.config,
    new Command({ resume: { decisions: [{ type: "approve" }] } }),
    thread,
  );
  console.log(">>> [Branch 2] Kết quả:", branch2State.values.messages.at(-1).content);

  // ============================================================
  // BRANCH 3: Duyệt kèm sửa Tool Call (decision "edit")
  // ============================================================
  console.log("\n========== [BRANCH 3] Edit: Duyệt kèm sửa Tool Call ==========");

  const originalAction = toReplay.values.messages.at(-1).tool_calls[0];

  // decision "edit": middleware tự lo việc thay Tool call - không cần tự mutate message
  // hay gọi updateState() thủ công như bản manual-graph.
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

  // ============================================================
  // BRANCH 4: Tự chèn kết quả Tool, bỏ qua middleware
  // ============================================================
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

  // updateState + asNode: "tools" ghi thẳng vào checkpoint, KHÔNG đi qua middleware/Command
  // - Graph coi như Tool đã chạy xong thật, tự tính next là "model_request".
  const branch4Config = await agent.graph.updateState(toReplay.config, stateUpdate, "tools");
  console.log(
    "-> Kết quả Tool giả lập đã chèn:",
    (await agent.graph.getState(branch4Config)).values.messages.at(-1).content,
  );

  const branch4State = await resumeUntilDone(agent, branch4Config, null, thread);
  console.log(">>> [Branch 4] Kết quả:", branch4State.values.messages.at(-1).content);
}

main();
