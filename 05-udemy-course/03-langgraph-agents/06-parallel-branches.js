// =======================================================================
// DEMO: CHẠY SONG SONG NHIỀU NHÁNH (FAN-OUT / FAN-IN)
//
// Không dùng LLM, không cần API key.
// Mỗi node đợi 1 giây (giả làm gọi API), rồi thêm 1 chuỗi vào mảng `aggregate`.
//
// Sơ đồ:
//            +-> b -> b2 -+
//   START -> a            +-> d -> END
//            +-> c -------+
//
// 3 ý chính:
// 1. Tách nhánh: a nối tới cả b và c -> b và c chạy cùng lúc.
// 2. Gộp nhánh : addEdge(["b2", "c"], "d") -> d đợi CẢ b2 và c xong mới chạy.
//                Nếu nối riêng (b2 -> d, c -> d) thì d chạy 2 lần: sau c 1 lần, sau b2 1 lần.
// 3. Reducer   : b và c cùng ghi vào `aggregate` 1 lúc -> reducer nối 2 kết quả lại.
//                Không có reducer thì LangGraph báo lỗi InvalidUpdateError.
//
// Thứ tự chạy (mỗi bước ~1 giây, các node cùng bước chạy song song):
//   bước 1: a -> bước 2: b + c -> bước 3: b2 -> bước 4: d
//   -> Tổng ~4 giây. Chạy lần lượt từng node thì mất 5 giây.
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { StateGraph, Annotation, START, END } = require("@langchain/langgraph");

// aggregate: reducer nối mảng mới vào cuối mảng cũ, không ghi đè.
const State = Annotation.Root({
  aggregate: Annotation({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
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
      `[${elapsed()}] ${value.padEnd(6)} | nhận vào: ${JSON.stringify(state.aggregate)}`,
    );
    return { aggregate: [value] };
  };
}

// Nối node theo sơ đồ ở đầu file.
const graph = new StateGraph(State)
  .addNode("a", returnNodeValue("I'm A"))
  .addNode("b", returnNodeValue("I'm B"))
  .addNode("b2", returnNodeValue("I'm B2"))
  .addNode("c", returnNodeValue("I'm C"))
  .addNode("d", returnNodeValue("I'm D"))
  .addEdge(START, "a")
  .addEdge("a", "b")
  .addEdge("a", "c")
  .addEdge("b", "b2")
  .addEdge(["b2", "c"], "d")
  .addEdge("d", END)
  .compile();

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

  section("CHẠY GRAPH");
  startedAt = Date.now();
  const result = await graph.invoke({ aggregate: [] });

  // ~4 giây = các nhánh đã chạy song song
  section("KẾT QUẢ");
  console.log("[state]", result);
  console.log(`[xong]  ${elapsed()} (chạy lần lượt từng node sẽ mất ~5s)`);
}

main();
