require("../_polyfill");
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { BM25Retriever } = require("@langchain/community/retrievers/bm25");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// Bản Python dùng SVMRetriever và TFIDFRetriever - cả 2 đều KHÔNG cần embedding,
// chỉ xếp hạng theo thống kê từ khoá trong văn bản. JS LangChain không có 2 class này.
// BM25Retriever (thư viện "okapibm25") là lựa chọn gần nhất còn lại: cũng xếp hạng theo
// từ khoá, không qua embedding - dùng để minh hoạ đúng ý "còn cách retrieve nào khác
// ngoài vectorstore". Riêng SVM thì không có gì thay thế trong JS nên bỏ qua.
//
// Vì không dùng embedding, file này KHÔNG gọi Gemini API, không cần GEMINI_API_KEY,
// không tốn quota - khác với mọi file khác trong thư mục này.

async function main() {
  // Bản Python chỉ load 1 PDF (Lecture01), giữ nguyên để so sánh cho khớp.
  const pdfPath = path.join(lecturesDir, "MachineLearning-Lecture01.pdf");
  const pages = await new PDFLoader(pdfPath).load();

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1500,
    chunkOverlap: 150,
  });
  // Bản Python nối hết text các trang thành 1 chuỗi dài rồi mới split (split_text).
  // Ở đây dùng splitDocuments cho khớp cách làm ở các file khác trong thư mục (giữ
  // nguyên metadata từng trang), kết quả chia chunk tương đương nhau.
  const splits = await textSplitter.splitDocuments(pages);

  const bm25Retriever = BM25Retriever.fromDocuments(splits, { k: 4 });

  // 2 câu hỏi giống bản Python, để so sánh BM25 xếp hạng theo từ khoá ra sao.
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
