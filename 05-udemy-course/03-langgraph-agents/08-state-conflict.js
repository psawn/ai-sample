// =======================================================================
// DEMO: XUNG ĐỘT STATE KHI CHẠY SONG SONG TRONG LANGGRAPH
//
// Sơ đồ luồng:
//         ┌──> get_weather ──┐
//   START ┼                  ┼──> END
//         └──> get_news    ──┘
//
// Vấn đề: 2 node chạy song song cùng ghi vào 1 field -> giữ giá trị nào?
//
// Reducer = hàm gộp giá trị node trả về vào state: (current, update) => giá trị mới
//   - current: giá trị đang có trong state
//   - update : giá trị node vừa trả về
//   VD: (current, update) => current.concat(update) -> nối mảng, giữ cả cũ lẫn mới.
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const { StateGraph, Annotation, START, END } = require("@langchain/langgraph");

/** In tiêu đề từng phần */
function section(title) {
  console.log(`\n========== ${title} ==========`);
}

/**
 * Tạo graph theo sơ đồ: 2 node chạy song song rồi kết thúc.
 * Truyền node dạng object `{ getWeather, getNews }` để chỗ gọi thấy rõ hàm nào là node nào.
 */
function buildGraph(State, { getWeather, getNews }) {
  return new StateGraph(State)
    .addNode("get_weather", getWeather)
    .addNode("get_news", getNews)
    .addEdge(START, "get_weather")
    .addEdge(START, "get_news")
    .addEdge("get_weather", END)
    .addEdge("get_news", END)
    .compile();
}

// ===== CÁCH 1: CHUNG FIELD, KHÔNG REDUCER =====
// Không có reducer -> field chỉ nhận 1 giá trị mỗi bước.
// 2 node cùng ghi `result` -> LangGraph không biết giữ giá trị nào -> báo lỗi InvalidUpdateError.
const SharedState = Annotation.Root({
  result: Annotation(), // Không có reducer
});

const sharedGraph = buildGraph(SharedState, {
  getWeather: () => ({ result: "Trời nắng" }),
  getNews: () => ({ result: "Giá vàng tăng" }),
});

// ===== CÁCH 2: CHUNG FIELD, REDUCER "MỚI THẮNG" =====
// Reducer bỏ `current`, chỉ giữ `update` -> giá trị gộp sau đè lên giá trị gộp trước.
// Mất 1 giá trị mà KHÔNG báo lỗi -> khó phát hiện, nguy hiểm nhất.
const OverwriteState = Annotation.Root({
  result: Annotation({
    reducer: (current, update) => update, // Bỏ giá trị cũ, chỉ giữ giá trị mới
    default: () => "",
  }),
});

const overwriteGraph = buildGraph(OverwriteState, {
  getWeather: () => ({ result: "Trời nắng" }),
  getNews: () => ({ result: "Giá vàng tăng" }),
});

// ===== CÁCH 3: MỖI NODE 1 FIELD RIÊNG (KHUYÊN DÙNG) =====
// Mỗi node ghi vào field của riêng nó -> không node nào đè lên node nào, giữ đủ dữ liệu.
// Không cần reducer vì mỗi field chỉ có 1 node ghi.
const SeparateState = Annotation.Root({
  weather: Annotation(), // Chỉ get_weather ghi
  news: Annotation(), // Chỉ get_news ghi
});

const separateGraph = buildGraph(SeparateState, {
  getWeather: () => ({ weather: "Trời nắng" }),
  getNews: () => ({ news: "Giá vàng tăng" }),
});

async function main() {
  section("CÁCH 1: CHUNG FIELD, KHÔNG REDUCER");
  try {
    await sharedGraph.invoke({});
  } catch (e) {
    console.log(`[lỗi]   ${e.name}: ${e.message.split("\n")[0]}`);
  }

  section("CÁCH 2: CHUNG FIELD, REDUCER 'MỚI THẮNG'");
  console.log("[state]", await overwriteGraph.invoke({}));
  console.log("[!]     Mất dữ liệu ngầm nhưng không báo lỗi");

  section("CÁCH 3: MỖI NODE 1 FIELD RIÊNG");
  console.log("[state]", await separateGraph.invoke({}));
  console.log("[ok]    Giữ đủ cả 2 giá trị");
}

main();
