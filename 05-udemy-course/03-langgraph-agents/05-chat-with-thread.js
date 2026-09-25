// =======================================================================
// DEMO: CHAT NHỚ HỘI THOẠI THEO THREAD_ID (LANGGRAPH + POSTGRES)
// =======================================================================
//
// Mô tả demo:
// - Chat với Gemini trên terminal. Tắt chương trình, mở lại cùng thread_id thì chat tiếp được.
// - Mỗi lượt chỉ gửi tin nhắn MỚI. Lịch sử cũ do checkpointer tự nạp lại theo thread_id.
//   (checkpointer = bộ lưu state của graph. Bài này dùng PostgresSaver -> lưu vào Postgres.)
//
// So với các bài trước:
// - 03-langchain/13-langgraph/02a: cũng nhớ theo thread_id, nhưng dùng MemorySaver (RAM) -> tắt là mất.
// - 04-human-in-the-loop: cũng lưu vào Postgres, nhưng không có LLM.
//
// Sơ đồ (mỗi tin nhắn của bạn = 1 lần chạy graph):
//   START -> chat -> END
//
// thread_id = 1 cuộc chat:
// - Cùng thread_id: AI thấy toàn bộ tin nhắn cũ.
// - Khác thread_id: cuộc chat mới, AI không biết gì về cuộc cũ.
//
// Chuẩn bị:
// - Postgres giống bài 04 (lệnh docker ở header bài 04).
// - Điền POSTGRES_URI và GEMINI_API_KEY trong .env.
//
// Cách chạy:
//   node <file>          -> Bắt đầu cuộc chat mới.
//   node <file> <id>     -> Chat tiếp cuộc cũ: in lại lịch sử rồi chat tiếp.
//   node <file> --list   -> Xem danh sách các cuộc chat đã lưu.
//
// Trong lúc chat:
//   /history             -> In lại toàn bộ tin nhắn của cuộc chat hiện tại.
//   exit (hoặc Enter ở dòng trống) -> Thoát.
//
// Lưu gì vào Postgres (cấu trúc 4 bảng: xem header bài 04):
// - Lịch sử tin nhắn nằm ở bảng checkpoint_blobs, channel = messages.
//   Checkpointer tự đọc/ghi, không cần tự tạo bảng hay DB riêng.
// - Mỗi lượt chat tạo 3 checkpoint:
//     input -> LangGraph nhận tin nhắn, giữ tạm ở channel nội bộ __start__ (chưa vào messages)
//     loop  -> tin nhắn được nối vào messages (chưa gọi AI)
//     loop  -> node chat chạy xong: câu trả lời của AI được nối vào messages
//   2 checkpoint đầu chưa gọi AI vì LangGraph tách riêng bước "nạp input" khỏi bước "chạy node".
// - messages đổi ở mỗi lượt -> mỗi lần đổi thêm 1 blob chứa TOÀN BỘ danh sách tin nhắn.
//   VD thật: 2 lượt chat -> 4 blob messages: 237 -> 831 -> 1067 -> 1609 bytes.
//   -> Chat càng dài, DB càng lớn, mỗi lượt gửi cho LLM càng nhiều token.
//   -> Production thường cắt bớt (trimMessages) hoặc tóm tắt tin nhắn cũ. Bài này cố ý không cắt.
//
// Bản production gọn hơn: createAgent({ model, tools, checkpointer }) của langchain v1.
// Cùng cơ chế thread_id, chỉ là graph được dựng sẵn (xem 03-langchain/13-langgraph/02b).
//
// =======================================================================
// ĐỌC THÊM: getState(thread) ĐỌC DB THẾ NÀO
// =======================================================================
//
// Ví dụ trong phần này lấy từ 1 cuộc chat thật 3 lượt: "xin chào", hỏi tuổi Trump, hỏi nghề cũ.
//
// 3 bước (chỉ đọc, không ghi):
// 1. checkpoints     : lấy checkpoint MỚI NHẤT của thread_id -> đọc channel_versions.
//                      VD: { messages: "9.81..." } = messages đang ở version 9.81.
// 2. checkpoint_blobs: lấy blob khớp (thread_id, channel, version) -> danh sách tin nhắn dạng JSON.
// 3. Đổi JSON thành object, ráp lại -> saved.values = { messages: [...] }.
//    Thread mới chưa có checkpoint -> {}.
//
// SQL tương đương (rút gọn, chỉ lấy messages):
//   -- Bước 1: checkpoint mới nhất -> messages đang ở version nào
//   SELECT checkpoint -> 'channel_versions' ->> 'messages' AS version
//   FROM checkpoints
//   WHERE thread_id = '<thread_id>'
//   ORDER BY checkpoint_id DESC
//   LIMIT 1;
//
//   -- Bước 2: lấy blob đúng version đó (= toàn bộ tin nhắn, dạng JSON)
//   SELECT convert_from(blob, 'UTF8') AS messages
//   FROM checkpoint_blobs
//   WHERE thread_id = '<thread_id>' AND channel = 'messages' AND version = '<version ở bước 1>';
//
// Vì sao ORDER BY checkpoint_id lại lấy được bản mới nhất?
// -> checkpoint_id là UUID v6: thời gian nằm ở đầu ID. Tạo sau thì ID lớn hơn.
//
//    6 checkpoint đầu của cuộc chat ví dụ (mỗi lượt chat = 3 checkpoint):
//
//    1f1d1dcc-d43d-60e0-ffff-...   step -1   input   lượt 1: bạn gửi "xin chào"
//    1f1d1dcc-d453-6070-8000-...   step  0   loop
//    1f1d1dcc-ef59-6f90-8001-...   step  1   loop    AI trả lời xong
//    1f1d1dce-6784-6cd0-8002-...   step  2   input   lượt 2   ← đầu ID tăng: bạn mất ~40 giây gõ câu tiếp
//    1f1d1dce-678c-6200-8003-...   step  3   loop
//    1f1d1dce-9920-6ff0-8004-...   step  4   loop
//    └─────┬─────┘      └┬─┘
//      thời điểm tạo    tăng theo step. Không cần nhớ.
//      (hex)
//
// -> Độ dài ID cố định -> sắp xếp ID = sắp xếp theo thời gian.
//    Nên ORDER BY checkpoint_id DESC LIMIT 1 = checkpoint tạo sau cùng = mới nhất.
// -> Khác với thread_id: randomUUID() là UUID v4, ngẫu nhiên hoàn toàn, không sắp xếp theo thời gian được.
//
// Vì sao log saved.values khác chuỗi JSON khi query SQL? Cùng dữ liệu, khác hình thức:
//   Trong DB  : {"lc":1, "type":"constructor", "id":[..., "HumanMessage"],
//                "kwargs":{"content":"xin chào", ...}}
//   Trong code: HumanMessage { "content": "xin chào", ... }
// - JSON không lưu được "đây là class nào", nên LangChain ghi thêm "id" = đường dẫn tới class.
// - Lúc đọc ra, LangGraph dựng lại object theo "id": new HumanMessage(kwargs).
//   -> Object có đủ method (.text, HumanMessage.isInstance...) để printMessage dùng.
// - Object -> JSON khi ghi = serialize. JSON -> object khi đọc = deserialize. Checkpointer tự làm cả 2.
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const { randomUUID } = require("crypto");
const path = require("path");
const readline = require("readline");

const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} = require("@langchain/langgraph");
const { PostgresSaver } = require("@langchain/langgraph-checkpoint-postgres");

// ===== 1. GRAPH: 1 NODE GỌI LLM =====

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
});

// System prompt thêm lúc gọi LLM, không lưu vào state -> DB không bị lặp lại ở mỗi lượt.
const systemPrompt = new SystemMessage(
  "Bạn là trợ lý thân thiện. Trả lời ngắn gọn bằng tiếng Việt.",
);

// Node chat: gửi toàn bộ lịch sử (đã nạp từ checkpoint) cho LLM, trả về câu trả lời.
// MessagesAnnotation tự NỐI tin nhắn trả về vào cuối state.messages, không ghi đè.
async function chatNode(state) {
  const response = await llm.invoke([systemPrompt, ...state.messages]);
  return { messages: [response] };
}

// Graph: START -> chat -> END. State chỉ có messages (MessagesAnnotation).
const builder = new StateGraph(MessagesAnnotation)
  .addNode("chat", chatNode)
  .addEdge(START, "chat")
  .addEdge("chat", END);

// ===== 2. HÀM IN TIN NHẮN =====

// In 1 tin nhắn kèm nhãn người gửi.
function printMessage(message) {
  const label = HumanMessage.isInstance(message) ? "[bạn]" : "[AI] ";
  console.log(`${label} ${message.text}`);
}

// In toàn bộ tin nhắn đã lưu của 1 thread (đọc từ checkpoint mới nhất).
async function printHistory(graph, thread) {
  const messages = (await graph.getState(thread)).values.messages ?? [];
  console.log(`\n========== LỊCH SỬ (${messages.length} tin nhắn) ==========`);
  messages.forEach(printMessage);
  console.log("==========\n");
}

// ===== 3. HAI CHẾ ĐỘ CHẠY: XEM DANH SÁCH / CHAT =====

// In danh sách cuộc chat đã lưu, mới -> cũ.
async function listThreads(checkpointer) {
  console.log("\n========== DANH SÁCH CUỘC CHAT (mới -> cũ) ==========");

  // Lấy checkpoint của MỌI thread (không truyền thread_id), xếp mới -> cũ theo checkpoint_id.
  // Mỗi phần tử gồm:
  //   config.configurable.thread_id -> checkpoint này thuộc cuộc chat nào
  //   checkpoint.channel_values     -> giá trị các channel (đã đổi thành object), VD: messages
  //   checkpoint.ts                 -> thời điểm tạo checkpoint
  const allCheckpoints = checkpointer.list({});

  // 1 thread có nhiều checkpoint. Vì đã xếp mới -> cũ, lần đầu gặp 1 thread = checkpoint mới nhất của nó.
  // -> Ghi nhớ thread đã gặp để bỏ qua các checkpoint cũ hơn.
  const seenThreads = new Set();

  for await (const { config, checkpoint } of allCheckpoints) {
    const threadId = config.configurable.thread_id;
    if (seenThreads.has(threadId)) continue;
    seenThreads.add(threadId);

    // Bỏ qua thread không có messages (VD: thread của bài 04 dùng chung DB).
    const messages = checkpoint.channel_values.messages ?? [];
    if (messages.length === 0) continue;

    const lastChatAt = checkpoint.ts; // checkpoint mới nhất -> lần chat gần nhất
    const title = messages[0].text.slice(0, 40); // tin nhắn đầu tiên làm "tiêu đề" cho dễ nhận ra
    console.log(`${threadId} | ${lastChatAt} | ${messages.length} tin nhắn | ${title}`);
  }
}

// Chat trong 1 thread: in lịch sử cũ (nếu có), rồi đọc từng dòng người dùng gõ.
async function runChat(graph, threadId) {
  const thread = { configurable: { thread_id: threadId } };
  console.log(`Thread: ${threadId}`);
  console.log(
    `Resume: node ${path.relative(process.cwd(), __filename)} ${threadId}`,
  );

  // Đọc state đã lưu của thread từ Postgres (đọc DB thế nào: xem phần "ĐỌC THÊM" ở đầu file).
  // saved.values = { messages: [...] }. Thread mới chưa có checkpoint -> {}.
  const saved = await graph.getState(thread);

  // Xem state đọc từ DB: tin nhắn là object HumanMessage/AIMessage (khác chuỗi JSON khi query SQL).
  console.log("[saved.values]", saved.values);

  // Có tin nhắn cũ -> in lại lịch sử.
  if ((saved.values.messages ?? []).length > 0) {
    await printHistory(graph, thread);
  }

  console.log(
    '\n========== CHAT (/history = xem lịch sử, "exit" = thoát) ==========',
  );
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.setPrompt("[bạn] ");
  rl.prompt();

  // Đọc từng dòng người dùng gõ, tới khi gõ exit.
  for await (const line of rl) {
    const text = line.trim();
    if (text === "" || text.toLowerCase() === "exit") break;

    if (text === "/history") {
      await printHistory(graph, thread);
      rl.prompt();
      continue;
    }

    try {
      // Chỉ gửi tin nhắn MỚI. Checkpointer tự nạp lịch sử cũ của thread rồi nối tin nhắn này vào.
      const result = await graph.invoke(
        { messages: [new HumanMessage(text)] },
        thread,
      );
      printMessage(result.messages.at(-1));
    } catch (e) {
      // Lỗi gọi LLM (sai key, hết quota...) -> báo lỗi, vẫn cho chat tiếp.
      console.log(`[lỗi] ${e.message}`);
    }
    rl.prompt();
  }
  rl.close();
}

// ===== 4. MAIN =====

async function main() {
  const checkpointer = PostgresSaver.fromConnString(process.env.POSTGRES_URI);
  await checkpointer.setup(); // Tạo 4 bảng nếu chưa có. Đã có thì bỏ qua.

  // compile: biến bản thiết kế (builder) thành graph chạy được.
  // Gắn checkpointer -> mỗi lần invoke tự nạp state cũ theo thread_id, chạy xong tự lưu lại.
  const graph = builder.compile({ checkpointer });

  try {
    if (process.argv[2] === "--list") {
      await listThreads(checkpointer);
    } else {
      // Truyền ID cũ qua dòng lệnh để chat tiếp, không truyền thì tạo cuộc chat mới.
      await runChat(graph, process.argv[2] ?? randomUUID());
    }
  } finally {
    // Đóng kết nối Postgres, nếu không process sẽ treo thêm một lúc rồi mới thoát.
    await checkpointer.end();
  }
}

main();
