require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const {
  RecursiveCharacterTextSplitter,
} = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");

// Khởi tạo mô hình Embedding của Gemini (model: gemini-embedding-001),
// dùng để gọi API Gemini, chuyển Document / Query thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

async function main() {
  const pdfPath = path.join(
    __dirname,
    "../../docs/cs229_lectures/MachineLearning-Lecture01.pdf",
  );
  const docs = await new PDFLoader(pdfPath).load();

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1500,
    chunkOverlap: 150,
  });
  const splits = await textSplitter.splitDocuments(docs);
  console.log("Số chunk sau khi split:", splits.length);

  // Vectorstore: embed từng chunk rồi lưu vector lại để tìm kiếm theo ngữ nghĩa sau này.
  // Dùng MemoryVectorStore (lưu trong RAM) vì đơn giản, không cần chạy thêm 1 server
  // như Chroma -> đổi lại, dữ liệu mất khi tắt chương trình (không persist được).
  const vectordb = await MemoryVectorStore.fromDocuments(splits, embeddings);
  console.log("Số vector đã lưu:", vectordb.memoryVectors.length);

  // similaritySearch: embed câu hỏi rồi tìm k chunk có vector gần nhất trong vectordb.
  const question = "is there an email i can ask for help";
  const results = await vectordb.similaritySearch(question, 3);
  console.log("\n=== Similarity search: email hỗ trợ ===");
  console.log(results[0].pageContent);
}

main();
