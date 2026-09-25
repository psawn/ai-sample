// =======================================================================
// DEMO: CHỌN NHÁNH SONG SONG BẰNG ĐIỀU KIỆN (CONDITIONAL FAN-OUT)
//
// Không dùng LLM, không cần API key.
// Mỗi node đợi 1 giây (giả làm gọi API), rồi thêm 1 chuỗi vào mảng `aggregate`.
//
// Sơ đồ:
//                   +-> b -+
//   START -> a --?--+-> c -+-> e -> END
//                   +-> d -+
//
// Khác bài 06: không nối cố định a -> b, a -> c. Hàm router chọn nhánh lúc chạy:
// - which = "cd"    -> chạy c + d song song
// - còn lại ("bc")  -> chạy b + c song song
//
// 3 ý chính:
// 1. Router trả về MẢNG tên node -> các node đó chạy cùng lúc.
// 2. Tham số thứ 3 của addConditionalEdges = mọi node router có thể chọn.
//    LangGraph cần biết trước để vẽ sơ đồ và kiểm tra tên node.
// 3. Nối riêng b -> e, c -> e, d -> e mà e vẫn chỉ chạy 1 lần:
//    2 nhánh được chọn xong cùng 1 bước -> e chạy 1 lần ở bước sau.
//    (Bài 06 phải gộp nhánh vì b -> b2 dài hơn c, 2 nhánh xong ở 2 bước khác nhau.)
//
// Thứ tự chạy mỗi lần: bước 1: a -> bước 2: 2 nhánh được chọn -> bước 3: e  -> ~3 giây.
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { StateGraph, Annotation, START, END } = require("@langchain/langgraph");

const State = Annotation.Root({
  // reducer nối mảng mới vào cuối mảng cũ, không ghi đè.
  aggregate: Annotation({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  which: Annotation(), // Router đọc field này để chọn nhánh
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let startedAt; // Mốc lúc bắt đầu chạy graph, dùng để in thời điểm node chạy xong

/** Số giây từ lúc bắt đầu chạy graph, VD: "2.0s". */
function elapsed() {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

/** In tiêu đề từng phần. */
function section(title) {
  console.log(`\n========== ${title} ==========`);
}

/**
 * Tạo 1 node: đợi 1 giây rồi thêm `value` vào `aggregate`.
 * Dùng `await sleep` (không chặn chương trình) nên các node cùng bước chạy song song được.
 * Log in thời điểm node xong + `aggregate` mà node nhận vào.
 */
function returnNodeValue(value) {
  return async (state) => {
    await sleep(1000);
    console.log(
      `[${elapsed()}] ${value.padEnd(5)} | nhận vào: ${JSON.stringify(state.aggregate)}`,
    );
    return { aggregate: [value] };
  };
}

/** Router: chọn 2 nhánh chạy song song sau node a, dựa vào `which`. */
function routeBcOrCd(state) {
  if (state.which === "cd") {
    return ["c", "d"];
  }
  return ["b", "c"];
}

const intermediates = ["b", "c", "d"];

// Nối node theo sơ đồ ở đầu file.
const builder = new StateGraph(State)
  .addNode("a", returnNodeValue("I'm A"))
  .addNode("b", returnNodeValue("I'm B"))
  .addNode("c", returnNodeValue("I'm C"))
  .addNode("d", returnNodeValue("I'm D"))
  .addNode("e", returnNodeValue("I'm E"))
  .addEdge(START, "a")
  .addConditionalEdges("a", routeBcOrCd, intermediates);

for (const node of intermediates) {
  builder.addEdge(node, "e");
}

builder.addEdge("e", END);
const graph = builder.compile();

async function main() {
  // Lưu sơ đồ graph vào images/graphs. Lỗi (VD: mất mạng) chỉ in cảnh báo, chương trình vẫn chạy tiếp.
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

  // Chạy 2 lần với 2 giá trị `which` để thấy router chọn nhánh khác nhau.
  for (const which of ["bc", "cd"]) {
    section(`CHẠY GRAPH: which = "${which}"`);
    startedAt = Date.now();
    const result = await graph.invoke({ aggregate: [], which });
    console.log("[state]", result.aggregate);
    console.log(`[xong]  ${elapsed()}`);
  }
}

main();
