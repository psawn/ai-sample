// =======================================================================
// RETRIEVAL - BƯỚC 4: CONTEXTUAL COMPRESSION
//
// Document tìm được thường dài, nhiều đoạn không liên quan câu hỏi.
// Gửi nguyên cho LLM -> tốn token, dễ trả lời sai.
// Giải pháp: 1 LLM đọc từng document, chỉ giữ phần liên quan tới câu hỏi.
//
// Kết hợp MMR + compression:
// 1. MMR chọn kết quả đa dạng.
// 2. Compression cắt phần dư thừa trong từng kết quả.
// -> Context gọn, không trùng lặp.
//
// Đánh đổi: mỗi document = thêm 1 lần gọi LLM.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const {
  GoogleGenerativeAIEmbeddings,
  ChatGoogleGenerativeAI,
} = require("@langchain/google-genai");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const {
  ContextualCompressionRetriever,
} = require("@langchain/classic/retrievers/contextual_compression");
const {
  LLMChainExtractor,
} = require("@langchain/classic/retrievers/document_compressors/chain_extract");
const { embedChunksSafely } = require("./util-embed-safely");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// Model embedding: đổi Document và câu hỏi thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// LLM: đọc từng document, chỉ giữ phần liên quan tới câu hỏi.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// In các document, ngăn bằng đường kẻ.
function prettyPrintDocs(docs) {
  console.log(
    docs
      .map((d, i) => `Document ${i + 1}:\n\n${d.pageContent}`)
      .join(`\n${"-".repeat(80)}\n`),
  );
}

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

  // Compressor: LLM đọc (document, câu hỏi) -> chỉ giữ phần liên quan.
  const compressor = LLMChainExtractor.fromLLM(llm);

  const question = "what did they say about matlab?";

  // 1. Chỉ compression.
  // ContextualCompressionRetriever cần baseRetriever, không nhận vectorstore
  // -> asRetriever() bọc vectorstore thành retriever. Mặc định search kiểu similarity.
  const compressionRetriever = new ContextualCompressionRetriever({
    baseCompressor: compressor,
    baseRetriever: vectordb.asRetriever(),
  });
  const compressedDocs = await compressionRetriever.invoke(question);
  console.log("=== Contextual compression ===");
  prettyPrintDocs(compressedDocs);

  // 2. MMR + compression.
  // MMR chọn kết quả đa dạng -> compression cắt phần dư thừa trong từng kết quả.
  const compressionRetrieverMmr = new ContextualCompressionRetriever({
    baseCompressor: compressor,
    baseRetriever: vectordb.asRetriever({ searchType: "mmr" }),
  });
  const compressedDocsMmr = await compressionRetrieverMmr.invoke(question);
  console.log("\n=== Contextual compression + MMR ===");
  prettyPrintDocs(compressedDocsMmr);
}

main();
