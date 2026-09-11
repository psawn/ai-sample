require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { CharacterTextSplitter } = require("@langchain/textsplitters");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");

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

  // splitDocuments giữ nguyên metadata gốc (vd: số trang PDF) cho từng chunk sau khi cắt,
  // nhờ vậy khi LLM trả lời có thể trích dẫn được chunk đó đến từ trang nào.
  const docs = await textSplitter.splitDocuments(pages);
  console.log("=== Kết quả cắt PDF ===");
  console.log("Số trang gốc:", pages.length);
  console.log("Số chunk sau khi cắt:", docs.length);
}

main();
