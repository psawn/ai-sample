// =======================================================================
// LANGGRAPH - BƯỚC 7: GRAPH LẶP ĐƠN GIẢN (BỔ TRỢ CHO STATE VÀ TIME TRAVEL)
//
// Graph không dùng LLM hay tool, chỉ lặp Node1 -> Node2 -> Node1...
// Log gọn, dễ thấy 3 cơ chế:
// 1. getStateHistory(): xem toàn bộ checkpoint của 1 thread.
// 2. Time travel: chạy tiếp từ 1 checkpoint cũ.
// 3. updateState(): sửa state đã lưu, có và không có asNode.
//
// State:
// - lnode: node vừa chạy xong (ghi đè).
// - scratch: dữ liệu tạm để thử sửa state (ghi đè).
// - count: bộ đếm, cộng dồn mỗi lần node trả về { count: 1 }.
//
// Luồng:
// 1. START -> Node1 -> Node2.
// 2. Sau Node2: count < 3 -> quay lại Node1, ngược lại -> END.
// =======================================================================

require("../_polyfill");

const {
  StateGraph,
  END,
  Annotation,
  MemorySaver,
} = require("@langchain/langgraph");

// State: dữ liệu chung, các node cùng đọc và ghi. Gồm 3 field ở trên.
const AgentState = Annotation.Root({
  // Node không trả field này -> giữ giá trị cũ.
  lnode: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
  scratch: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
  // Node trả { count: 1 } -> reducer cộng thêm 1, không ghi đè.
  count: Annotation({
    reducer: (current, update) => current + update,
    default: () => 0,
  }),
});

// Node 1: ghi tên node, tăng count thêm 1.
async function node1(state) {
  console.log(`Node1, count hiện tại: ${state.count}`);
  return { lnode: "node_1", count: 1 };
}

// Node 2: ghi tên node, tăng count thêm 1.
async function node2(state) {
  console.log(`Node2, count hiện tại: ${state.count}`);
  return { lnode: "node_2", count: 1 };
}

// Rẽ nhánh sau Node2:
// - true: quay lại Node1, lặp tiếp.
// - false: count >= 3 -> dừng.
function shouldContinue(state) {
  return state.count < 3;
}

// Dựng graph: START -> Node1 -> Node2 -> (Node1 hoặc END).
const builder = new StateGraph(AgentState);
builder.addNode("Node1", node1);
builder.addNode("Node2", node2);
builder.addEdge("__start__", "Node1");
builder.addEdge("Node1", "Node2");
builder.addConditionalEdges("Node2", shouldContinue, {
  true: "Node1",
  false: END,
});

// Checkpointer lưu state sau mỗi bước -> cần cho time travel.
const memory = new MemorySaver();
const graph = builder.compile({ checkpointer: memory });

// Demo 1: chạy graph tới khi xong, rồi in lịch sử checkpoint.
async function demoStateHistoryAndSetup(graph, thread) {
  console.log("========== Chạy graph tới khi kết thúc ==========");
  const result = await graph.invoke({ count: 0, scratch: "hi" }, thread);
  console.log("Kết quả cuối:", result);

  console.log(
    "\n========== Lịch sử checkpoint (mới nhất -> cũ nhất) ==========",
  );
  const states = [];
  for await (const snapshot of graph.getStateHistory(thread)) {
    states.push(snapshot);
    console.log(
      `count=${snapshot.values.count}, node sắp chạy=${snapshot.next}`,
    );
  }
  return states;
}

// Demo 2: time travel - chạy tiếp từ 1 checkpoint cũ, không chạy lại từ đầu.
// Dùng để: debug bước lỗi, undo, so sánh nhiều nhánh từ cùng 1 mốc.
async function demoTimeTravel(graph, states) {
  // Checkpoint ngay sau lần đầu Node1 chạy.
  const early = states[states.length - 3];
  console.log(
    "\n-> Checkpoint được chọn để time-travel: count =",
    early.values.count,
  );

  console.log(
    "\n========== Time Travel: chạy tiếp từ checkpoint cũ ==========",
  );
  // Input null + config của checkpoint cũ -> chạy tiếp từ đúng mốc đó.
  const replayed = await graph.invoke(null, early.config);
  console.log("Kết quả sau khi chạy tiếp từ quá khứ:", replayed);
}

// Demo 3: updateState - sửa dữ liệu đã lưu trong checkpoint.
// Dùng cho human in the loop: sửa lỗi của Model/tool, duyệt hành động nhạy cảm trước khi chạy tiếp.
async function demoUpdateState(graph) {
  console.log(
    "\n========== Sửa state rồi update (không truyền asNode) ==========",
  );
  const thread2 = { configurable: { thread_id: "2" } };
  await graph.invoke({ count: 0, scratch: "hi" }, thread2);

  const states2 = [];
  for await (const snapshot of graph.getStateHistory(thread2)) {
    states2.push(snapshot);
  }

  // Checkpoint cũ (count=1), dùng cho ví dụ asNode bên dưới.
  // Ví dụ không asNode ngay sau đây dùng checkpoint mới nhất của thread2.
  const saved = states2[states2.length - 3];
  console.log("Checkpoint gốc trước khi sửa: count =", saved.values.count);

  // Không asNode: chỉ sửa dữ liệu, graph tự tính node kế tiếp như bình thường.
  // count cộng dồn -> -3 được cộng vào count hiện tại, không ghi đè.
  await graph.updateState(thread2, { count: -3, scratch: "hello" });
  let state = await graph.getState(thread2);
  console.log(
    "Sau updateState (mặc định) - count:",
    state.values.count,
    "node sắp chạy:",
    state.next,
  );

  console.log(
    "\n========== update kèm asNode: tự chọn Node nào tạo ra bước tiếp theo ==========",
  );
  // asNode "Node1": coi như Node1 vừa chạy xong -> node kế tiếp là Node2.
  // Dùng để ép graph đi tới node mong muốn, vd: node duyệt.
  await graph.updateState(
    saved.config,
    { count: -3, scratch: "hello2" },
    "Node1",
  );
  state = await graph.getState(thread2);
  console.log(
    'Sau updateState(..., "Node1") - count:',
    state.values.count,
    "node sắp chạy:",
    state.next,
    "(vì coi như vừa từ Node1 xong, nên bước kế tiếp tự động là Node2)",
  );
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const thread = { configurable: { thread_id: "1" } };

  // Demo 1: chạy graph, lấy lịch sử checkpoint.
  const states = await demoStateHistoryAndSetup(graph, thread);

  // Demo 2: time travel từ checkpoint cũ (dùng lịch sử của demo 1).
  await demoTimeTravel(graph, states);

  // Demo 3: sửa state đã lưu, có và không có asNode.
  await demoUpdateState(graph);
}

main();
