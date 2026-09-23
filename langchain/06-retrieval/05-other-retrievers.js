// =======================================================================
// RETRIEVAL - BƯỚC 5: RETRIEVER KHÔNG DÙNG EMBEDDING (BM25)
//
// Ngoài vectorstore, còn cách tìm theo từ khóa (thống kê tần suất từ).
// BM25 xếp hạng document theo mức độ khớp từ khóa với câu hỏi.
// - Ưu: không dùng embedding -> không gọi Gemini API, không cần API key, không tốn quota.
// - Nhược: chỉ khớp chữ, không hiểu nghĩa (vd "car" không khớp "automobile").
//
// BM25Retriever dùng thư viện "okapibm25".
// =======================================================================

require("../_polyfill");
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { BM25Retriever } = require("@langchain/community/retrievers/bm25");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Chỉ load Lecture01 cho nhanh.
  const pdfPath = path.join(lecturesDir, "MachineLearning-Lecture01.pdf");
  const pages = await new PDFLoader(pdfPath).load();

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1500,
    chunkOverlap: 150,
  });
  // splitDocuments: giữ metadata từng trang, giống các file khác.
  const splits = await textSplitter.splitDocuments(pages);

  // k: 4 -> trả 4 document khớp từ khóa nhất.
  const bm25Retriever = BM25Retriever.fromDocuments(splits, { k: 4 });

  // 2 câu hỏi, xem BM25 xếp hạng theo từ khóa ra sao.
  const question1 = "What are major topics for this class?";
  const docsBm25Q1 = await bm25Retriever.invoke(question1);
  console.log("=== BM25Retriever -", question1, "===");
  console.log(docsBm25Q1[0].pageContent.slice(0, 200));

  const question2 = "what did they say about matlab?";
  const docsBm25Q2 = await bm25Retriever.invoke(question2);
  console.log("\n=== BM25Retriever -", question2, "===");
  console.log(docsBm25Q2[0].pageContent.slice(0, 200));
}

main();
