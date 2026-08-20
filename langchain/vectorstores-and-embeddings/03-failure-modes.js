require("../_polyfill");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// Khởi tạo mô hình Embedding của Gemini (model: gemini-embedding-001),
// dùng để gọi API Gemini, chuyển Document / Query thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

async function loadDocs() {
  // Cố ý load file Lecture01 2 lần để tạo dữ liệu trùng lặp, xem nó ảnh hưởng
  // thế nào tới kết quả tìm kiếm ở phần bên dưới.
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

async function main() {
  const docs = await loadDocs();

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1500,
    chunkOverlap: 150,
  });
  const splits = await textSplitter.splitDocuments(docs);

  const vectordb = await MemoryVectorStore.fromDocuments(splits, embeddings);

  // === Vấn đề 1: chunk bị trùng lặp ===
  // Vì Lecture01 được load 2 lần, index có 2 vector giống hệt nhau cho cùng 1 đoạn văn
  // -> tìm kiếm có thể trả về 2 chunk trùng nội dung, làm phí chỗ trong prompt gửi LLM.
  // Lấy top 10 thay vì chỉ 2 kết quả đầu, vì không chắc 2 bản trùng luôn xếp hạng liền kề.
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

  // === Vấn đề 2: tìm kiếm lẫn nội dung giữa các lecture ===
  // similaritySearch chỉ so nghĩa câu hỏi với từng chunk, không hiểu "lecture thứ 3"
  // nghĩa là gì -> kết quả có thể lẫn chunk từ lecture khác dù câu hỏi chỉ nói về 1 lecture.
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
