// =======================================================================
// VECTORSTORE - BƯỚC 2: LƯU VECTOR TRONG RAM & SIMILARITY SEARCH
//
// Flow:
// 1. Load PDF, split thành chunk.
// 2. Embed từng chunk, lưu vào vectorstore.
// 3. Khi hỏi: embed câu hỏi -> tìm các chunk có vector gần nhất.
//
// MemoryVectorStore lưu trong RAM: đơn giản, không cần server,
// nhưng tắt chương trình là mất. Bản lưu lâu dài: 02-vectorstore-chroma.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const {
  RecursiveCharacterTextSplitter,
} = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");

// Model embedding: đổi chunk và câu hỏi thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // 1. Load + Split.
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

  // 2. Embed từng chunk, lưu vector vào RAM.
  const vectordb = await MemoryVectorStore.fromDocuments(splits, embeddings);
  console.log("Số vector đã lưu:", vectordb.memoryVectors.length);

  // 3. similaritySearch: embed câu hỏi -> tìm 3 chunk có vector gần nhất.
  const question = "is there an email i can ask for help";
  const results = await vectordb.similaritySearch(question, 3);
  console.log("\n=== Similarity search: email hỗ trợ ===");
  console.log(results[0].pageContent);
}

main();
