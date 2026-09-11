require("../_polyfill");
require("dotenv").config();
const { CSVLoader } = require("@langchain/community/document_loaders/fs/csv");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const path = require("path");

// Khởi tạo mô hình Embedding của Gemini (model: gemini-embedding-001),
// dùng để gọi API Gemini, chuyển Document / Query thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

const filePath = path.join(__dirname, "OutdoorClothingCatalog_1000.csv");
const loader = new CSVLoader(filePath);

async function main() {
  const docs = await loader.load();
  console.log("Đã tải thành công số lượng documents:", docs.length);

  // Gọi API Gemini để tạo vector cho từng Document, rồi lưu các vector đó vào RAM (MemoryVectorStore).
  const db = await MemoryVectorStore.fromDocuments(docs, embeddings);

  const query =
    "Please list all your shirts with sun protection in a table in markdown and summarize each one.";

  // similaritySearch:
  // 1. Gọi API Gemini để tạo vector cho query.
  // 2. So sánh vector này với các vector Document đã lưu trong RAM (xử lý local, không gọi API).
  // k = 4: lấy 4 Document có vector giống query nhất.
  const results = await db.similaritySearch(query, 4);

  console.log("\nSố lượng kết quả tìm thấy:", results.length);

  results.forEach((doc, index) => {
    console.log(`\n========== Kết quả ${index + 1} ==========`);
    console.log(doc.pageContent);
  });
}

main();