require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { embedChunksSafely } = require("./util-embed-safely");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// Embedding Model: gọi API Gemini để biến Document / Query thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

async function main() {
  const pdfPaths = [
    path.join(lecturesDir, "MachineLearning-Lecture01.pdf"),
    path.join(lecturesDir, "MachineLearning-Lecture02.pdf"),
    path.join(lecturesDir, "MachineLearning-Lecture03.pdf"),
  ];

  let docs = [];
  for (const pdfPath of pdfPaths) {
    docs = docs.concat(await new PDFLoader(pdfPath).load());
  }

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1500,
    chunkOverlap: 150,
  });
  const splits = await textSplitter.splitDocuments(docs);

  // Embed từng chunk an toàn (tự retry khi lỗi) rồi mới đưa vào vectorstore.
  // Xem lý do trong util-embed-safely.js.
  const vectors = await embedChunksSafely(embeddings, splits);
  const vectordb = await MemoryVectorStore.fromExistingIndex(embeddings);
  await vectordb.addVectors(vectors, splits);

  // Vấn đề: similaritySearch chỉ so nghĩa câu hỏi với từng chunk, không hiểu
  // "lecture thứ 3" nghĩa là gì -> kết quả có thể lẫn chunk từ lecture khác.
  const question = "what did they say about regression in the third lecture?";
  const docsNoFilter = await vectordb.similaritySearch(question, 5); // 5 = k, số kết quả muốn lấy
  console.log("=== Không filter: dễ lẫn nội dung giữa các lecture ===");
  docsNoFilter.forEach((d) => console.log(d.metadata.source));

  // Giải pháp: filter theo metadata để giới hạn phạm vi tìm kiếm.
  // MemoryVectorStore nhận filter là 1 hàm (doc) => boolean, chạy trực tiếp trên
  // metadata của từng doc trong RAM (khác Chroma dùng object filter, chạy trên server).
  const docsFiltered = await vectordb.similaritySearch(question, 3, (doc) =>
    doc.metadata.source.endsWith("MachineLearning-Lecture03.pdf"),
  );
  console.log("\n=== Có filter: chỉ lấy Lecture03 ===");
  docsFiltered.forEach((d) => console.log(d.metadata.source));
}

main();
