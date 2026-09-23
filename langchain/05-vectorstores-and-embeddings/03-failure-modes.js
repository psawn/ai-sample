// =======================================================================
// VECTORSTORE - BƯỚC 3: CÁC TRƯỜNG HỢP SIMILARITY SEARCH THẤT BẠI
//
// Similarity search không phải lúc nào cũng tốt:
// 1. Chunk trùng lặp: dữ liệu trùng -> kết quả trùng, phí chỗ trong prompt.
// 2. Lẫn nguồn tài liệu: hỏi "lecture thứ 3" nhưng nhận cả chunk lecture khác,
//    vì search chỉ so nghĩa, không hiểu điều kiện lọc.
//
// Cách khắc phục: 06-retrieval/
// - Trùng lặp -> MMR (01-similarity-vs-mmr.js).
// - Lẫn nguồn -> metadata filter (02-metadata-filter.js), self-query (03-self-query.js).
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// Model embedding: đổi chunk và câu hỏi thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// Load các file lecture PDF có trong thư mục. File nào thiếu thì bỏ qua.
async function loadDocs() {
  // Cố ý load Lecture01 2 lần để tạo dữ liệu trùng lặp (vấn đề 1).
  const pdfPaths = [
    path.join(lecturesDir, "MachineLearning-Lecture01.pdf"),
    path.join(lecturesDir, "MachineLearning-Lecture01.pdf"),
    path.join(lecturesDir, "MachineLearning-Lecture02.pdf"),
    path.join(lecturesDir, "MachineLearning-Lecture03.pdf"),
  ].filter((p) => fs.existsSync(p));

  let docs = [];
  for (const pdfPath of pdfPaths) {
    const pages = await new PDFLoader(pdfPath).load();
    docs = docs.concat(pages);
  }
  return docs;
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const docs = await loadDocs();

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1500,
    chunkOverlap: 150,
  });
  const splits = await textSplitter.splitDocuments(docs);

  const vectordb = await MemoryVectorStore.fromDocuments(splits, embeddings);

  // Vấn đề 1: chunk bị trùng lặp.
  // Lecture01 load 2 lần -> 2 vector giống hệt cho cùng 1 đoạn văn
  // -> kết quả có thể chứa 2 chunk trùng, phí chỗ trong prompt.
  // Lấy top 10 vì 2 bản trùng không chắc luôn xếp liền nhau.
  const question1 = "what did they say about matlab?";
  const results1 = await vectordb.similaritySearch(question1, 10);
  const duplicatePair = results1.find((doc, i) =>
    results1.some((other, j) => j > i && other.pageContent === doc.pageContent),
  );
  console.log("=== Vấn đề: chunk bị trùng lặp (matlab) ===");
  console.log(
    duplicatePair
      ? "Tìm thấy chunk trùng nội dung trong top 10 kết quả."
      : "Không có chunk trùng trong top 10 (bản duplicate xếp hạng thấp hơn).",
  );

  // Vấn đề 2: lẫn nội dung giữa các lecture.
  // Search chỉ so nghĩa, không hiểu "lecture thứ 3" là điều kiện lọc
  // -> kết quả có thể chứa chunk từ lecture khác. Xem metadata.source để kiểm tra.
  // Cần ít nhất 2 file khác nhau mới thấy được vấn đề này.
  const uniqueSources = new Set(docs.map((d) => d.metadata.source));
  if (uniqueSources.size > 1) {
    const question2 =
      "what did they say about regression in the third lecture?";
    const results2 = await vectordb.similaritySearch(question2, 5);
    console.log("\n=== Vấn đề: lẫn nội dung giữa các lecture ===");
    results2.forEach((doc) => console.log(doc.metadata));
  } else {
    console.log("\n(Bỏ qua vì thiếu Lecture02/03.pdf)");
  }
}

main();
