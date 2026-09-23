// =======================================================================
// RETRIEVAL - BƯỚC 2: LỌC THEO METADATA
//
// Similarity search chỉ so nghĩa, không hiểu "lecture thứ 3" là điều kiện lọc.
// -> Tự thêm filter theo metadata (vd: source) để giới hạn phạm vi tìm.
//
// Nhược điểm: phải tự viết filter. Để LLM tự suy ra filter: 03-self-query.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { embedChunksSafely } = require("./util-embed-safely");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// Model embedding: đổi Document và câu hỏi thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// ===== KỊCH BẢN MINH HỌA =====
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

  // Embed có retry khi lỗi, rồi mới đưa vào vectorstore.
  // Lý do: util-embed-safely.js.
  const vectors = await embedChunksSafely(embeddings, splits);
  const vectordb = await MemoryVectorStore.fromExistingIndex(embeddings);
  await vectordb.addVectors(vectors, splits);

  // 1. Không filter: kết quả có thể lẫn chunk từ lecture khác.
  const question = "what did they say about regression in the third lecture?";
  const docsNoFilter = await vectordb.similaritySearch(question, 5); // k = 5 kết quả
  console.log("=== Không filter: dễ lẫn nội dung giữa các lecture ===");
  docsNoFilter.forEach((d) => console.log(d.metadata.source));

  // 2. Có filter: chỉ tìm trong chunk thuộc Lecture03.
  // MemoryVectorStore nhận filter là hàm (doc) => boolean, chạy trong RAM.
  // Chroma thì dùng object filter, chạy trên server.
  const docsFiltered = await vectordb.similaritySearch(question, 3, (doc) =>
    doc.metadata.source.endsWith("MachineLearning-Lecture03.pdf"),
  );
  console.log("\n=== Có filter: chỉ lấy Lecture03 ===");
  docsFiltered.forEach((d) => console.log(d.metadata.source));
}

main();
