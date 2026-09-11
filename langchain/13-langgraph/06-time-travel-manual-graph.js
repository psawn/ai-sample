// Human in the Loop - Time Travel & Branching trong LangGraph
//
// File này demo cách LangGraph tạo ra các NHÁNH (Branches) lịch sử độc lập
// từ một điểm dừng Checkpoint trong quá khứ:
//
// Branch 1 (Original) : Chạy ban đầu -> Bị chặn trước "action" (Interrupt).
//  ├──> Branch 2 (Replay) : Chạy tiếp nguyên bản từ checkpoint cũ.
//  ├──> Branch 3 (Edit Call) : Sửa query của Tool Call rồi mới chạy.
//  └──> Branch 4 (Inject Mock) : Giả lập kết quả ToolMessage rồi chạy tiếp.
//
// Lưu ý: Model có thể gọi Tool nhiều lần liên tiếp, mỗi lần đều bị interruptBefore chặn
// lại -> mỗi Branch phải LẶP resume tới khi thực sự xong (state.next rỗng), không chỉ 1 lần.

require("../_polyfill");
require("dotenv").config();

const { MemorySaver } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage, ToolMessage } = require("@langchain/core/messages");

const { Agent } = require("./agent-with-interrupt");
const { webSearch } = require("./tool");

const prompt = `You are a smart research assistant. Use the search engine to look up information. \
You are allowed to make multiple calls (either together or in sequence). \
Only look up information when you are sure of what you want. \
If you need to look up some information before asking a follow up question, you are allowed to do that!`;

function printStepEvent(event) {
  for (const [node, value] of Object.entries(event)) {
    // Khi Graph bị interruptBefore chặn lại, stream() bắn thêm 1 event phụ "__interrupt__"
    // không chứa messages - bỏ qua, không phải Node thật.
    if (!value?.messages) continue;

    const lastMessage = value.messages.at(-1);
    console.log(`[${node}]`, lastMessage.content || lastMessage.tool_calls);
  }
}

// Resume từ `config` (1 checkpoint cụ thể) tới khi THỰC SỰ xong (state.next rỗng).
// - Lần đầu: resume từ đúng `config` được truyền vào.
// - Các lần lặp sau: dùng `thread` (không kèm checkpoint cụ thể) để tiếp tục ĐÚNG nhánh
//   vừa tạo, tránh rẽ nhánh lặp lại từ `config` ban đầu.
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

  // ============================================================
  // BRANCH 1 (NHÁNH GỐC): Chạy lượt đầu tiên cho đến khi bị Interrupt
  // ============================================================
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

  // Lấy toàn bộ lịch sử checkpoint (mới nhất -> cũ nhất)
  const states = [];
  for await (const snapshot of abot.graph.getStateHistory(thread)) {
    states.push(snapshot);
  }

  console.log(`\n-> Tổng số checkpoint trong Memory: ${states.length}`);

  // Tìm ĐÚNG checkpoint đang treo trước Node "action" (next chứa "action") để làm
  // "Gốc phân nhánh" - không đoán theo số thứ tự, vì số checkpoint thực tế có thể ít hơn.
  const toReplay = states.find((snapshot) => snapshot.next.includes("action"));
  console.log("-> Checkpoint gốc được chọn để rẽ nhánh, Node sắp chạy:", toReplay.next);

  // ============================================================
  // BRANCH 2: Quay lại Checkpoint cũ và chạy tiếp nguyên bản (Replay)
  // ============================================================
  console.log(
    "\n========== [BRANCH 2] Replay: Chạy tiếp từ checkpoint cũ ==========",
  );

  const branch2State = await resumeUntilDone(abot, toReplay.config, thread);
  console.log(">>> [Branch 2] Kết quả:", branch2State.values.messages.at(-1).content);

  // ============================================================
  // BRANCH 3: Sửa Tool Call tại Checkpoint cũ rồi rẽ nhánh
  // ============================================================
  console.log(
    "\n========== [BRANCH 3] Edit: Sửa Tool Call rồi tạo nhánh mới ==========",
  );

  const lastMessage = toReplay.values.messages.at(-1);
  const toolCallId = lastMessage.tool_calls[0].id;

  // Sửa trực tiếp trên object JS đang giữ (chưa đụng gì tới checkpoint đã lưu) - giữ
  // nguyên `id` để updateState() bên dưới THAY THẾ đúng message này, không tạo bản mới.
  lastMessage.tool_calls = [
    {
      name: "web_search",
      args: { query: "current weather in LA, accuweather" },
      id: toolCallId,
    },
  ];

  // Ghi đè State đã sửa vào toReplay.config -> Sinh ra ID checkpoint mới cho BRANCH 3
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

  // ============================================================
  // BRANCH 4: Giả lập kết quả Tool (Mock Result) rồi rẽ nhánh
  // ============================================================
  console.log(
    "\n========== [BRANCH 4] Inject: Chèn ToolMessage giả lập ==========",
  );

  const finalToolCallId = toReplay.values.messages.at(-1).tool_calls[0].id;

  // Tạo một ToolMessage giả lập kết quả trả về từ web_search
  const stateUpdate = {
    messages: [
      new ToolMessage({
        tool_call_id: finalToolCallId,
        name: "web_search",
        content: "54 degree celcius",
      }),
    ],
  };

  // Cập nhật State và đánh dấu "action" đã chạy xong -> Sinh ra ID checkpoint cho BRANCH 4
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
