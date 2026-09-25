// =======================================================================
// LANGGRAPH - BƯỚC 9: Send (CHẠY SONG SONG 1 NODE NHIỀU LẦN)
//
// Bài toán: Tóm tắt tài liệu dài theo mô hình Map-Reduce.
// 1. Map: Tóm tắt riêng từng phần (chunk) chạy song song.
// 2. Reduce: Tổng hợp tất cả bản tóm tắt thành một bản cuối cùng.
//
// Vấn đề: Cạnh (edge) thông thường được định nghĩa cố định từ trước (A -> B -> C).
// Tuy nhiên, số lượng chunk chỉ được xác định khi chạy thực tế (ví dụ: 6 chunk thì cần 6 nhánh).
//
// Giải pháp từ Send: Cạnh điều kiện (conditional edge) trả về một MẢNG Send, mỗi Send tạo một nhánh chạy song song.
//   new Send("tên node", input riêng)
// - Mỗi nhánh chỉ nhận input riêng của nó (ví dụ: { content }) thay vì toàn bộ state chung.
// - Các nhánh cùng ghi kết quả vào một field -> Bắt buộc dùng reducer nối mảng để tránh ghi đè dữ liệu.
// - Node tiếp theo sẽ đợi TẤT CẢ các nhánh hoàn tất rồi mới chạy.
//
// Luồng hoạt động:
//   START --Send x N--> summarize_chunk (N nhánh song song) -> combine_summaries -> END
//
// Lưu ý: Nếu không dùng LangGraph, Promise.all cũng làm được việc tương tự.
// Tuy nhiên, Send chạy trong graph mang lại nhiều lợi thế: có checkpoint, hỗ trợ stream, và hiển thị chi tiết trên LangSmith.
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  StateGraph,
  START,
  END,
  Annotation,
  Send,
} = require("@langchain/langgraph");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");

// Khai báo tên node ở một chỗ để tránh gõ sai, giúp IDE báo lỗi ngay lập tức thay vì đợi lúc chạy graph.
const SUMMARIZE_CHUNK = "summarize_chunk";
const COMBINE_SUMMARIES = "combine_summaries";

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Định nghĩa State cho đồ thị:
// - contents: Danh sách các chunk cần tóm tắt.
// - summaries: Tóm tắt của từng chunk. Dùng reducer nối mảng (.concat) để các nhánh song song không ghi đè dữ liệu lên nhau.
// - finalSummary: Bản tóm tắt cuối cùng.
const SummaryState = Annotation.Root({
  contents: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => [],
  }),
  summaries: Annotation({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  finalSummary: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
});

const startTime = Date.now();
/** Tính thời gian trôi qua từ lúc bắt đầu chạy, giúp quan sát các nhánh bắt đầu đồng thời. */
function elapsed() {
  return `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
}

/** Cạnh điều kiện: Tạo một Send tương ứng với mỗi chunk để chạy song song node summarize_chunk. */
function mapChunks(state) {
  return state.contents.map(
    (content, index) => new Send(SUMMARIZE_CHUNK, { content, index }),
  );
}

/** Node Map: Nhận input riêng từ Send ({ content, index }), tiến hành tóm tắt từng phần. */
async function summarizeChunk({ content, index }) {
  console.log(`[${elapsed()}] ▶ nhánh ${index + 1} bắt đầu`);
  const response = await llm.invoke(
    `Write a concise summary of the following:\n\n${content}`,
  );
  console.log(`[${elapsed()}] ✔ nhánh ${index + 1} xong`);
  // Trả về mảng chứa 1 phần tử -> reducer sẽ tự động nối vào mảng summaries chung.
  return { summaries: [response.content] };
}

/** Node Reduce: Chỉ chạy sau khi TẤT CẢ các nhánh hoàn tất, gộp toàn bộ bản tóm tắt thành một bản duy nhất. */
async function combineSummaries(state) {
  console.log(
    `[${elapsed()}] ⏩ ${COMBINE_SUMMARIES}: gộp ${state.summaries.length} bản tóm tắt`,
  );
  const response = await llm.invoke(
    `The following is a set of summaries:\n\n${state.summaries.join("\n\n")}\n\n` +
      "Take these and distill it into a final, consolidated summary of the main themes.",
  );
  return { finalSummary: response.content };
}

const graph = new StateGraph(SummaryState)
  .addNode(SUMMARIZE_CHUNK, summarizeChunk)
  .addNode(COMBINE_SUMMARIES, combineSummaries)
  // Tham số thứ 3: Khai báo danh sách các node đích mà hàm mapChunks được phép Send tới.
  .addConditionalEdges(START, mapChunks, [SUMMARIZE_CHUNK])
  .addEdge(SUMMARIZE_CHUNK, COMBINE_SUMMARIES)
  .addEdge(COMBINE_SUMMARIES, END)
  .compile();

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const text = fs.readFileSync(
    path.join(__dirname, "../../data/mediumblog1.txt"),
    "utf8",
  );
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 3000,
    chunkOverlap: 200,
  });
  const contents = await splitter.splitText(text);
  console.log(
    `Tài liệu chia thành ${contents.length} chunk -> ${contents.length} nhánh.\n`,
  );

  const result = await graph.invoke({ contents });

  console.log(`\n=== Bản tóm tắt cuối ===\n${result.finalSummary}`);
  console.log(`\n⏱️  Tổng: ${elapsed()}`);
}

main();
