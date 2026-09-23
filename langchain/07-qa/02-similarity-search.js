// =======================================================================
// QA - BƯỚC 2: SIMILARITY SEARCH TRÊN CATALOG
//
// Tìm sản phẩm liên quan tới câu hỏi bằng similarity search.
// Đây là bước "Retrieval" trong RAG: chỉ tìm tài liệu, chưa gọi LLM trả lời.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { CSVLoader } = require("@langchain/community/document_loaders/fs/csv");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const path = require("path");

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

  // similaritySearch:
  // 1. Embed câu hỏi (gọi Gemini).
  // 2. So với vector đã lưu trong RAM (chạy local, không gọi API).
  // k = 4: lấy 4 Document gần nghĩa nhất.
  const results = await db.similaritySearch(query, 4);

  console.log("\nSố lượng kết quả tìm thấy:", results.length);

  results.forEach((doc, index) => {
    console.log(`\n========== Kết quả ${index + 1} ==========`);
    console.log(doc.pageContent);
  });
}

main();