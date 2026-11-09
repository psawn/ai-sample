// =======================================================================
// QA - BƯỚC 2: SIMILARITY SEARCH TRÊN CATALOG
//
// Tìm sản phẩm liên quan tới câu hỏi bằng similarity search.
// Đây là bước "Retrieval" trong RAG: chỉ tìm tài liệu, chưa gọi LLM trả lời.
//
// File này chạy cả 2 hàm và in kết quả để so sánh similaritySearch với similaritySearchWithScore:
//   - Cách tìm, thứ tự kết quả và số lượt gọi API của mỗi hàm đều giống nhau.
//   - Khác duy nhất: trả kèm score (điểm giống nhau giữa câu hỏi và Document).
//   - Vì sao cần: similaritySearch luôn trả đủ k kết quả, kể cả khi không liên quan.
//     Có score thì biết kết quả nào đáng tin, và có thể bỏ kết quả điểm thấp.
//
// Score ở đây là cosine similarity: đo 2 vector cùng hướng đến đâu, càng gần 1 càng giống nghĩa.
// Vector store khác có thể trả khoảng cách (càng thấp càng giống), VD Chroma.
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();
const path = require("path");

const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { CSVLoader } = require("@langchain/community/document_loaders/fs/csv");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");


// Model embedding: đổi Document và câu hỏi thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

const filePath = path.join(__dirname, "OutdoorClothingCatalog_1000.csv");
const loader = new CSVLoader(filePath);

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const docs = await loader.load();
  console.log("Đã tải thành công số lượng documents:", docs.length);

  // Embed từng Document (gọi Gemini), lưu vector vào RAM.
  const db = await MemoryVectorStore.fromDocuments(docs, embeddings);

  const query =
    "Please list all your shirts with sun protection in a table in markdown and summarize each one.";

  // Mỗi hàm đều làm 2 bước:
  // 1. Embed câu hỏi (gọi Gemini).
  // 2. So với vector đã lưu trong RAM (chạy local, không gọi API).
  // k = 4: lấy 4 Document gần nghĩa nhất, gần nhất đứng đầu.

  // Kết quả là mảng Document: [doc, ...].
  const plainResults = await db.similaritySearch(query, 4);

  // Kết quả là mảng các cặp: [[doc, score], ...].
  const scoredResults = await db.similaritySearchWithScore(query, 4);

  console.log("\n########## similaritySearch ##########");
  console.log("Số lượng kết quả tìm thấy:", plainResults.length);

  plainResults.forEach((doc, index) => {
    console.log(`\n========== Kết quả ${index + 1} ==========`);
    console.log(doc.pageContent);
  });

  console.log("\n########## similaritySearchWithScore ##########");
  console.log("Số lượng kết quả tìm thấy:", scoredResults.length);

  // [doc, score]: tách mỗi cặp kết quả thành 2 biến.
  scoredResults.forEach(([doc, score], index) => {
    console.log(`\n========== Kết quả ${index + 1} (score: ${score.toFixed(3)}) ==========`);
    console.log(doc.pageContent);
  });
}

main();