// =======================================================================
// DEMO: HUMAN-IN-THE-LOOP & CHECKPOINT TRÊN POSTGRES
// =======================================================================
//
// Mô tả demo (không dùng LLM):
// - 3 node chỉ log ra console: không gọi API, không cần key, không có response từ model.
// - input "hello world" viết cứng trong code. Người dùng chỉ nhập feedback.
// - Cơ chế dừng/lưu/sửa/chạy tiếp giống hệt khi node là LLM thật.
//
// Sơ đồ:
//   START -> step_1 -> [Graph dừng] human_feedback -> step_3 -> END
//
// 4 bước Human-in-the-Loop:
// 1. Dừng     : interruptBefore: ["human_feedback"] -> graph dừng TRƯỚC KHI chạy node này.
//               Chỉ graph dừng, chương trình vẫn chạy để hỏi feedback.
// 2. Lưu      : checkpointer lưu state sau mỗi bước (kể cả lúc dừng) vào Postgres.
// 3. Người sửa: updateState(..., "human_feedback") -> ghi feedback vào state, coi như node này đã chạy xong.
//               human_feedback chỉ là điểm dừng: hàm của node không chạy, người dùng làm thay.
// 4. Chạy tiếp: stream(null, thread) -> graph chạy tiếp từ điểm dừng sang step_3.
//
// Chuẩn bị:
// - Tạo Postgres bằng Docker:
//   docker run -d --name langgraph-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17-alpine
// - Điền POSTGRES_URI trong .env (xem .env.example).
//
// Cách chạy:
//   node <file>        -> Tạo thread mới, chạy từ đầu.
//   node <file> <id>   -> Chạy tiếp (resume) thread cũ theo ID. Thread đã xong thì chỉ in state cuối.
//
//   Thử resume: khi được hỏi feedback, bấm Ctrl+C để thoát -> chạy lại với ID đã in ra.
//   -> Graph chạy tiếp từ chỗ dừng, không chạy lại step_1, vì state đã lưu trong Postgres.
//      (MemorySaver chỉ lưu trên RAM, tắt chương trình là mất.)
//
// =======================================================================
// ĐỌC THÊM: 4 BẢNG TRONG POSTGRES (nên chạy thử 1 lần rồi mới đọc)
// =======================================================================
//
// setup() tự tạo 4 bảng, LangGraph tự đọc/ghi.
//
// Tóm tắt:
//   checkpoints           : mỗi bước 1 snapshot, nhưng snapshot KHÔNG chứa giá trị.
//                           Nó chỉ ghi "field nào đang ở version nào", giống như 1 mục lục.
//   checkpoint_blobs      : chứa giá trị thật, nhưng không thuộc riêng snapshot nào.
//                           1 giá trị có thể được nhiều snapshot dùng chung.
//                           VD: "hello world" được 4 snapshot dùng.
//   checkpoint_writes     : kết quả tạm node trả về trong 1 bước. Được gộp lại để tạo snapshot kế tiếp,
//                           và vẫn được giữ lại sau khi bước xong.
//   checkpoint_migrations : phiên bản cấu trúc bảng. Không chứa data của graph.
//
// Thuật ngữ:
// - thread_id: id của 1 phiên chạy. 3 bảng đầu đều có cột này.
// - channel  : 1 ô dữ liệu trong state = các field (input, user_feedback) + vài ô nội bộ (xem cuối phần này).
// - version  : số đánh dấu mỗi lần channel có giá trị mới. Số lớn hơn = mới hơn.
//              (Phần nguyên tăng dần, phần thập phân ngẫu nhiên để tránh trùng.)
//
// Vì sao không lưu luôn giá trị vào checkpoints?
//   Nếu mỗi snapshot chép lại toàn bộ state, field không đổi cũng bị chép lại ở mọi bước.
//   VD: state có 1 tài liệu dài (không đổi) + 1 câu trả lời (đổi mỗi bước) -> tài liệu bị lưu lại N lần.
//   Tách ra thì field không đổi chỉ cần trỏ lại version cũ, không lưu lại giá trị.
//   Lưu ý: field đổi giá trị thì vẫn lưu lại TOÀN BỘ giá trị mới (VD: messages của bài chat 05).
//
// 1 bước diễn ra thế nào:
//   snapshot N --node chạy--> kết quả ghi vào checkpoint_writes
//              --gộp lại----> snapshot N+1 = thêm 1 dòng checkpoints + 1 dòng blobs cho mỗi field đổi giá trị
//
// Ví dụ (1 lần chạy thật, nhập feedback "tạm", chỉ nhìn 2 field của State):
//
//   step  chuyện gì xảy ra        checkpoints ghi                    checkpoint_blobs thêm dòng
//   -1    nhận input              (chưa có input/user_feedback)      không (input tạm giữ ở __start__)
//    0    input vào state         input: 2.45                        input 2.45 = "hello world"
//    1    step_1 chạy, DỪNG       input: 2.45                        không (input không đổi)
//    2    updateState ghi "tạm"   input: 2.45, user_feedback: 4.93   user_feedback 4.93 = "tạm"
//    3    step_3 chạy, kết thúc   input: 2.45, user_feedback: 4.93   không
//
//   -> "hello world" chỉ lưu 1 lần, 4 snapshot (step 0 -> 3) cùng trỏ tới.
//   -> getState() ở step 3 lấy state qua 2 bước:
//      1. Đọc checkpoints        -> { input: 2.45, user_feedback: 4.93 }
//      2. Tra checkpoint_blobs   -> { input: "hello world", user_feedback: "tạm" }
//
// Chi tiết từng bảng:
//   Data đã rút gọn: id b036 = 1f1d1bcc-b036-..., version 2.45 = 2.456263...
//
// 1. checkpoints: các cột chính
//    - checkpoint_id / parent_checkpoint_id: id snapshot này / snapshot trước -> nối thành chuỗi lịch sử.
//    - metadata.step  : số thứ tự bước.
//    - metadata.source: snapshot sinh ra do đâu: input = nhận input mới, loop = 1 vòng chạy của graph
//                       (nạp input vào state hoặc chạy node), update = updateState.
//    - checkpoint.channel_versions: mỗi channel đang ở version nào (là cột "checkpoints ghi" ở ví dụ trên).
//
//    step  source  id ← parent      (← = trỏ về snapshot trước)
//    -1    input   b036 ← (trống)
//     0    loop    b051 ← b036
//     1    loop    b069 ← b051
//     2    update  5f48 ← b069
//     3    loop    5f9b ← 5f48
//    -> Lần theo parent để xem lại hoặc chạy lại từ snapshot cũ (time travel).
//
// 2. checkpoint_blobs: các cột chính là channel, version, type, blob (giá trị, lưu dạng bytes).
//    - type = json: có giá trị. type = empty: channel đã được dọn, không còn giá trị.
//
//    channel        version  type  blob
//    input          2.45     json  "hello world"
//    user_feedback  4.93     json  "tạm"
//    (+ các dòng của channel nội bộ, xem cuối phần này)
//
// 3. checkpoint_writes: mỗi dòng = 1 giá trị node ghi ra, gắn với snapshot mà node chạy từ đó.
//    - Bảng thật lưu task_id. Cột "ai ghi" bên dưới ghi tên node cho dễ hiểu.
//    - Bước xong rồi dữ liệu vẫn được giữ lại.
//    -> Ích lợi: nếu 1 bước có nhiều node chạy song song mà crash giữa chừng,
//       node đã xong vẫn còn kết quả ở đây, nên chạy lại chỉ cần chạy node còn thiếu.
//
//    chạy từ        ai ghi          channel                   blob
//    b036 (step -1) __start__       input                     "hello world"  <- LangGraph nạp input vào state
//    b036 (step -1) __start__       branch:to:step_1          null
//    b051 (step 0)  step_1          branch:to:human_feedback  null
//    b069 (step 1)  human_feedback  user_feedback             "tạm"          <- updateState ghi thay node này
//    b069 (step 1)  human_feedback  branch:to:step_3          null
//    5f48 (step 2)  step_3          __no_writes__             null           <- node chạy xong nhưng không ghi gì
//    VD: 2 dòng của b069 gộp lại -> thành snapshot 5f48 (step 2).
//
// 4. checkpoint_migrations: chỉ có cột v = 0, 1, 2, 3, 4, 5 -> đã chạy 6 lần nâng cấp cấu trúc bảng.
//    -> setup() đọc bảng này để chỉ tạo/nâng cấp phần còn thiếu -> gọi lại nhiều lần vẫn an toàn.
//
// Channel nội bộ (LangGraph tự tạo để điều khiển luồng, lúc đầu có thể bỏ qua):
// - __start__       : giữ tạm input vừa truyền vào stream(). Sang step 0 thì chuyển vào field input
//                     rồi bị dọn (type empty). Ở checkpoint_writes nó nằm ở cột "ai ghi" vì
//                     LangGraph coi bước nạp input như 1 node ẩn tên __start__.
// - branch:to:<node>: dấu "node này cần chạy". Giá trị null = đặt dấu, empty = node đã chạy -> xóa dấu.
//   VD: branch:to:step_1 version 2.45 = null -> step_1 cần chạy; version 3.99 = empty -> step_1 đã chạy xong.
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");

const { StateGraph, Annotation, START, END } = require("@langchain/langgraph");
const { PostgresSaver } = require("@langchain/langgraph-checkpoint-postgres");

// Định nghĩa State: mỗi Annotation() = 1 field. Node trả về giá trị mới thì ghi đè lên field đó.
const State = Annotation.Root({
  input: Annotation(), // Dữ liệu ban đầu ("hello world", viết cứng trong code)
  user_feedback: Annotation(), // Phản hồi người dùng nhập khi graph dừng
});

// 3 node rỗng: chỉ log rồi trả {} -> state không đổi. Ứng dụng thực tế sẽ đặt LLM hoặc Tool tại đây.
function step1() {
  console.log("[node]  step_1 chạy");
  return {};
}

function humanFeedback() {
  console.log("[node]  human_feedback chạy");
  return {};
}

function step3() {
  console.log("[node]  step_3 chạy");
  return {};
}

// Nối node theo sơ đồ ở đầu file: START -> step_1 -> human_feedback -> step_3 -> END.
const builder = new StateGraph(State)
  .addNode("step_1", step1)
  .addNode("human_feedback", humanFeedback)
  .addNode("step_3", step3)
  .addEdge(START, "step_1")
  .addEdge("step_1", "human_feedback")
  .addEdge("human_feedback", "step_3")
  .addEdge("step_3", END);

// ===== HÀM IN LOG =====

// In tiêu đề từng phần.
function section(title) {
  console.log(`\n========== ${title} ==========`);
}

// In từng event của stream (streamMode "values"): mỗi event = toàn bộ state sau 1 bước.
// Event { __interrupt__: [] } = graph đã dừng (interruptBefore).
async function printStream(stream) {
  for await (const event of stream) {
    if ("__interrupt__" in event) {
      console.log("[dừng]  graph dừng, chờ người dùng");
    } else {
      console.log("[state]", event);
    }
  }
}

// In lịch sử checkpoint của thread theo thứ tự cũ -> mới (mỗi dòng = 1 dòng trong bảng checkpoints).
async function printHistory(graph, thread) {
  const history = [];
  for await (const snapshot of graph.getStateHistory(thread)) {
    history.unshift(snapshot); // getStateHistory trả mới -> cũ, unshift để đảo lại
  }

  for (const { metadata, next, values } of history) {
    const step = String(metadata.step).padStart(2);
    const source = metadata.source.padEnd(6);
    const nextNodes = JSON.stringify(next).padEnd(20);
    console.log(`step ${step} | ${source} | next: ${nextNodes} | values: ${JSON.stringify(values)}`);
  }
}

async function main() {
  const checkpointer = PostgresSaver.fromConnString(process.env.POSTGRES_URI);
  await checkpointer.setup(); // Tạo 4 bảng nếu chưa có. Đã có thì bỏ qua.

  const graph = builder.compile({
    checkpointer,
    interruptBefore: ["human_feedback"], // Dừng trước node này để chờ người dùng.
  });

  // Xuất sơ đồ graph ra images/graphs (lỗi mạng/vẽ chỉ cảnh báo, không làm dừng ứng dụng).
  try {
    const image = await (await graph.getGraphAsync()).drawMermaidPng();
    const imagePath = path.join(
      __dirname,
      "../../images/graphs",
      `${path.basename(__filename, ".js").replace(/^\d+-/, "")}-flow.png`,
    );
    fs.writeFileSync(imagePath, Buffer.from(await image.arrayBuffer()));
  } catch (e) {
    console.log(`⚠️ Không vẽ được sơ đồ graph: ${e.message}`);
  }

  // Mỗi thread = 1 phiên chạy riêng. Truyền ID cũ qua dòng lệnh để chạy tiếp, không truyền thì tạo ID mới.
  const threadId = process.argv[2] ?? randomUUID();
  const thread = { configurable: { thread_id: threadId } }; // LangGraph đọc thread_id trong configurable
  console.log(`Thread: ${threadId}`);
  console.log(
    `Resume: node ${path.relative(process.cwd(), __filename)} ${threadId}`,
  );

  try {
    // Đọc checkpoint mới nhất của thread để biết nên chạy từ đầu, chạy tiếp hay dừng.
    // saved.values = state đã lưu, saved.next = các node sẽ chạy tiếp ([] = không còn node nào).
    const saved = await graph.getState(thread);

    if (saved.next.includes("human_feedback")) {
      // Thread đang dừng trước human_feedback (lần trước tắt giữa chừng) -> bỏ qua step_1, hỏi feedback luôn.
      section("1. THREAD ĐANG DỪNG -> KHÔNG CHẠY LẠI STEP_1");
      console.log("[state]", saved.values);
    } else if (Object.keys(saved.values).length > 0) {
      // Có state nhưng không còn node nào chạy tiếp = thread đã xong -> in state cuối, không chạy lại.
      section("THREAD ĐÃ CHẠY XONG -> KHÔNG CHẠY LẠI");
      console.log("[state]", saved.values);
      section("LỊCH SỬ CHECKPOINT (cũ -> mới)");
      await printHistory(graph, thread);
      return;
    } else {
      // Chưa có state = thread mới -> chạy từ đầu tới điểm dừng trước human_feedback.
      section("1. CHẠY TỪ ĐẦU TỚI ĐIỂM DỪNG");
      await printStream(
        await graph.stream(
          { input: "hello world" },
          { ...thread, streamMode: "values" },
        ),
      );
    }
    console.log("[next] ", (await graph.getState(thread)).next); // [ 'human_feedback' ]

    // Hỏi feedback từ dòng lệnh.
    // Tạo readline ngay trước khi hỏi: tạo sớm có thể lỗi khi nhập qua pipe (echo "abc" | node <file>).
    section("2. NGƯỜI DÙNG NHẬP FEEDBACK");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const userInput = await rl.question("Nhập feedback: ");
    rl.close();

    // Tham số thứ 3 (asNode) = "human_feedback": graph coi như node này vừa chạy xong -> chuyển sang step_3.
    // Hàm humanFeedback() không được gọi -> không thấy log "[node]  human_feedback chạy".
    await graph.updateState(
      thread,
      { user_feedback: userInput },
      "human_feedback",
    );

    section("3. STATE SAU KHI UPDATE");
    const state = await graph.getState(thread);
    console.log("[state]", state.values);
    console.log("[next] ", state.next); // [ 'step_3' ]

    // Input null = không thêm dữ liệu mới, chạy tiếp từ checkpoint hiện tại -> step_3 -> END.
    section("4. CHẠY TIẾP TỚI END");
    await printStream(
      await graph.stream(null, { ...thread, streamMode: "values" }),
    );
    console.log("[xong]  graph đã tới END");

    section("LỊCH SỬ CHECKPOINT (cũ -> mới)");
    await printHistory(graph, thread);
  } finally {
    // Đóng kết nối Postgres, nếu không process sẽ treo thêm một lúc rồi mới thoát.
    await checkpointer.end();
  }
}

main();
