// =======================================================================
// VECTORSTORE - BƯỚC 2B: LƯU VECTOR VÀO CHROMA (PERSIST)
//
// Giống 02-vectorstore-similarity-search.js, đổi MemoryVectorStore sang Chroma.
//
// Flow:
// 1. Load PDF, split thành chunk.
// 2. Kết nối collection trên Chroma server.
// 3. Collection trống -> embed + lưu. Đã có dữ liệu -> bỏ qua.
// 4. Similarity search.
//
// Khác MemoryVectorStore: dữ liệu lưu trên server Chroma.
// Lần chạy sau dùng lại vector đã embed, không tốn thêm API embedding.
//
// Cần chạy Chroma server trước:
//   docker run -d --name chroma -p 8000:8000 chromadb/chroma
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const {
  RecursiveCharacterTextSplitter,
} = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { Chroma } = require("@langchain/community/vectorstores/chroma");

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

  // 2. Kết nối collection trên Chroma server.
  const vectordb = new Chroma(embeddings, {
    collectionName: "cs229-lecture01",
    url: "http://localhost:8000",
  });

  let existingCount = 0;
  try {
    await vectordb.ensureCollection();
    existingCount = await vectordb.collection.count();
  } catch (err) {
    console.error(
      "Không kết nối được Chroma server. Hãy chạy trước:\n" +
        "  docker run -d --name chroma -p 8000:8000 chromadb/chroma",
    );
    throw err;
  }

  // 3. Chỉ embed khi collection còn trống, tránh embed lại mỗi lần chạy.
  // Lưu ý: đổi PDF hoặc chunkSize -> phải xóa collection cũ, nếu không vẫn dùng dữ liệu cũ.
  if (existingCount === 0) {
    await vectordb.addDocuments(splits);
    console.log("Đã embed và lưu", splits.length, "chunk vào Chroma.");
  } else {
    console.log(
      "Collection đã có sẵn",
      existingCount,
      "vector, bỏ qua bước embed.",
    );
  }

  // 4. similaritySearch: embed câu hỏi -> tìm 3 chunk có vector gần nhất.
  const question = "is there an email i can ask for help";
  const results = await vectordb.similaritySearch(question, 3);
  console.log("\n=== Similarity search: email hỗ trợ ===");
  console.log(results[0].pageContent);
}

main();
