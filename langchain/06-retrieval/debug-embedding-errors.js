// =======================================================================
// RETRIEVAL - DEBUG: VÌ SAO embedDocuments() "NUỐT" LỖI?
//
// Vấn đề:
// 1. embedDocuments() không throw khi 1 batch lỗi (thường do rate limit).
// 2. Bên trong dùng Promise.allSettled -> batch lỗi trả vector rỗng [].
// 3. try/catch bên ngoài không bắt được gì, lỗi thật bị mất.
// 4. Sau đó MMR search gặp vector rỗng -> crash.
//
// Cách debug: patch thẳng client.batchEmbedContents (hàm gọi HTTP tới Gemini),
// để in lỗi ra trước khi embedDocuments() nuốt mất.
//
// Cách khắc phục: util-embed-safely.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// Giữ lại hàm gốc. Phải .bind() để không mất 'this' (xem util-bind-example.js).
const originalBatchEmbedContents = embeddings.client.batchEmbedContents.bind(
  embeddings.client,
);

// Bọc hàm gốc: log lỗi, rồi throw tiếp như cũ (không đổi hành vi).
embeddings.client.batchEmbedContents = async (req) => {
  try {
    return await originalBatchEmbedContents(req);
  } catch (err) {
    console.error(
      `[batchEmbedContents LỖI] ${req.requests.length} chunk bị fail:`,
      err.status ?? err.code ?? "(không có status)",
      "-",
      err.message,
    );
    throw err;
  }
};

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
  console.log("Tổng số chunk:", splits.length);

  // Gọi trực tiếp embedDocuments().
  // Dù có batch lỗi, hàm vẫn trả về bình thường (vector rỗng []), không throw.
  const texts = splits.map((d) => d.pageContent);
  const vectors = await embeddings.embedDocuments(texts);

  // Đếm số chunk lỗi ngầm (vector rỗng).
  const brokenCount = vectors.filter((v) => v.length === 0).length;
  console.log(`Số chunk bị vector rỗng: ${brokenCount}/${splits.length}`);

  if (brokenCount === 0) {
    console.log("Không có chunk nào lỗi lần này (batch API chạy trót lọt).");
  } else {
    console.log(
      "-> embedDocuments() trả về bình thường (không throw), dù có chunk lỗi bên trong.",
      "Lỗi thật từ Gemini bị thư viện nuốt mất, không có cách nào log ra bằng try/catch ở đây.",
    );
  }

  const vectordb = await MemoryVectorStore.fromExistingIndex(embeddings);
  await vectordb.addVectors(vectors, splits);

  const question = "what did they say about matlab?";
  // Chunk lỗi lọt vào top ứng viên -> dòng này crash, giống lỗi gốc ban đầu.
  await vectordb.maxMarginalRelevanceSearch(question, { k: 3, fetchK: 10 });
}

main();
