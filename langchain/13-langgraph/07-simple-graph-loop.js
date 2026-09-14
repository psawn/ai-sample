// Bài tập bổ trợ cho series Human in the Loop: State & Time Travel
//
// File này KHÔNG dùng LLM/Tool - chỉ dựng
// graph đơn giản Node1 <-> Node2 để thấy rõ 3 cơ chế cốt lõi mà không bị nhiễu bởi
// output của Model:
// - getStateHistory(): xem lại toàn bộ lịch sử checkpoint của 1 thread.
// - Time travel: chạy tiếp từ một checkpoint cũ trong lịch sử.
// - updateState(): sửa state đã lưu, có và không kèm asNode.
//
// State gồm:
//   + lnode: Node vừa chạy xong (ghi đè, không cộng dồn).
//   + scratch: dữ liệu tạm để thử sửa state (ghi đè, không cộng dồn).
//   + count: bộ đếm, dùng reducer CỘNG DỒN mỗi lần Node trả { count: 1 }.
// Graph lặp Node1 -> Node2 -> Node1 ... tới khi count >= 3 thì dừng (rẽ nhánh ở Node2).

require("../_polyfill");

const {
  StateGraph,
  END,
  Annotation,
  MemorySaver,
} = require("@langchain/langgraph");

const AgentState = Annotation.Root({
  // Nếu Node không update field này thì giữ giá trị cũ.
  lnode: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
  scratch: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
  // Mỗi lần Node trả { count: 1 }, reducer sẽ cộng thêm 1 thay vì ghi đè.
  count: Annotation({
    reducer: (current, update) => current + update,
    default: () => 0,
  }),
});

async function node1(state) {
  console.log(`Node1, count hiện tại: ${state.count}`);
  return { lnode: "node_1", count: 1 };
}

async function node2(state) {
  console.log(`Node2, count hiện tại: ${state.count}`);
  return { lnode: "node_2", count: 1 };
}

// Điều kiện rẽ nhánh sau Node2 (dùng trong addConditionalEdges bên dưới):
// true -> quay lại Node1 để lặp tiếp, false -> dừng graph (đã đủ count >= 3).
function shouldContinue(state) {
  return state.count < 3;
}

const builder = new StateGraph(AgentState);
builder.addNode("Node1", node1);
builder.addNode("Node2", node2);
builder.addEdge("__start__", "Node1");
builder.addEdge("Node1", "Node2");
builder.addConditionalEdges("Node2", shouldContinue, {
  true: "Node1",
  false: END,
});

const memory = new MemorySaver();
const graph = builder.compile({ checkpointer: memory });

// Demo 1: Chạy luồng cơ bản & Khám phá Lịch sử Checkpoint
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

// Demo 2: Time Travel - chạy tiếp graph từ 1 checkpoint cũ, không cần chạy lại từ đầu.
// Dùng để: debug bước bị lỗi, làm "undo", hoặc so sánh nhiều nhánh từ cùng 1 mốc (A/B test).
async function demoTimeTravel(graph, states) {
  // Chọn một checkpoint cũ để thử chạy lại từ quá khứ.
  // Ở đây, checkpoint được chọn là ngay sau lần đầu Node1 chạy.
  const early = states[states.length - 3];
  console.log(
    "\n-> Checkpoint được chọn để time-travel: count =",
    early.values.count,
  );

  console.log(
    "\n========== Time Travel: chạy tiếp từ checkpoint cũ ==========",
  );
  const replayed = await graph.invoke(null, early.config);
  console.log("Kết quả sau khi chạy tiếp từ quá khứ:", replayed);
}

// Demo 3: Update State - sửa trực tiếp dữ liệu đã lưu trong checkpoint.
// Dùng cho Human-in-the-Loop: sửa lỗi Model/Tool, hoặc duyệt hành động nhạy cảm trước khi chạy tiếp.
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

  // Lưu checkpoint cũ (count=1) để dùng cho ví dụ "asNode" bên dưới - ví dụ "mặc định"
  // ngay sau đây dùng checkpoint MỚI NHẤT của thread2, không dùng checkpoint này.
  const saved = states2[states2.length - 3];
  console.log("Checkpoint gốc trước khi sửa: count =", saved.values.count);

  // Không asNode: chỉ vá dữ liệu, Graph tự tính node kế tiếp như bình thường.
  // (count CỘNG DỒN -> -3 sẽ cộng vào count hiện tại, không ghi đè hẳn.)
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
  // asNode "Node1": coi như Node1 vừa chạy xong -> Graph tự nhảy tới Node2.
  // Dùng để ép Graph chạy đúng Node mong muốn, vd: node duyệt trước khi chạy tiếp.
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

async function main() {
  const thread = { configurable: { thread_id: "1" } };

  // Chạy Demo 1 & lấy dữ liệu checkpoint
  const states = await demoStateHistoryAndSetup(graph, thread);

  // Chạy Demo 2 (truyền checkpoint từ Demo 1 vào)
  await demoTimeTravel(graph, states);

  // Chạy Demo 3
  await demoUpdateState(graph);
}

main();
