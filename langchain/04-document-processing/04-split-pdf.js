// =======================================================================
// DOCUMENT PROCESSING - BƯỚC 4: CẮT FILE PDF THÀNH CHUNK
//
// Ghép 2 bước load + split:
// 1. PDFLoader đọc PDF -> mỗi trang 1 Document.
// 2. splitDocuments() cắt từng Document thành nhiều chunk nhỏ.
//
// splitDocuments() giữ nguyên metadata gốc (vd: số trang) cho từng chunk
// -> khi trả lời, trích dẫn được chunk đến từ trang nào.
// (splitText() chỉ nhận/trả string, mất metadata.)
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { CharacterTextSplitter } = require("@langchain/textsplitters");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const pdfPath = path.join(
    __dirname,
    "../../docs/cs229_lectures/MachineLearning-Lecture01.pdf",
  );
  const pages = await new PDFLoader(pdfPath).load();

  const textSplitter = new CharacterTextSplitter({
    separator: "\n",
    chunkSize: 1000,
    chunkOverlap: 150,
  });

  // Cắt từng trang, metadata (số trang...) được copy sang mỗi chunk.
  const docs = await textSplitter.splitDocuments(pages);
  console.log("=== Kết quả cắt PDF ===");
  console.log("Số trang gốc:", pages.length);
  console.log("Số chunk sau khi cắt:", docs.length);
}

main();
