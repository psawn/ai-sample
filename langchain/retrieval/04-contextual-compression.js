require("dotenv").config();
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const {
  GoogleGenerativeAIEmbeddings,
  ChatGoogleGenerativeAI,
} = require("@langchain/google-genai");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const {
  ContextualCompressionRetriever,
} = require("langchain/retrievers/contextual_compression");
const {
  LLMChainExtractor,
} = require("langchain/retrievers/document_compressors/chain_extract");
const { embedChunksSafely } = require("./util-embed-safely");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// Embedding Model: gọi API Gemini để biến Document / Query thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// LLM: đọc từng document trả về và chỉ giữ lại phần liên quan tới câu hỏi.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

function prettyPrintDocs(docs) {
  console.log(
    docs
      .map((d, i) => `Document ${i + 1}:\n\n${d.pageContent}`)
      .join(`\n${"-".repeat(80)}\n`),
  );
}

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

  // Vấn đề: mỗi document trả về có thể dài, nhiều đoạn không liên quan tới câu hỏi
  // -> gửi nguyên document cho LLM vừa tốn token vừa dễ làm câu trả lời kém chính xác.
  // LLMChainExtractor: dùng chính 1 LLM đọc (document, câu hỏi) rồi chỉ giữ lại phần liên quan.
  const compressor = LLMChainExtractor.fromLLM(llm);

  const question = "what did they say about matlab?";

  // vectordb.asRetriever(): bọc vectorstore thành "retriever" (có method .invoke(query))
  // để cắm được vào ContextualCompressionRetriever - class này cần baseRetriever, không nhận
  // thẳng vectorstore. Mặc định asRetriever() search kiểu similarity (giống similaritySearch).
  const compressionRetriever = new ContextualCompressionRetriever({
    baseCompressor: compressor,
    baseRetriever: vectordb.asRetriever(),
  });
  const compressedDocs = await compressionRetriever.invoke(question);
  console.log("=== Contextual compression ===");
  prettyPrintDocs(compressedDocs);

  // Kết hợp MMR + compression:
  // 1. MMR chọn kết quả đa dạng (đỡ trùng lặp).
  // 2. Compression cắt bớt phần dư thừa trong từng kết quả đó.
  // -> retriever "sạch" hơn.
  const compressionRetrieverMmr = new ContextualCompressionRetriever({
    baseCompressor: compressor,
    baseRetriever: vectordb.asRetriever({ searchType: "mmr" }),
  });
  const compressedDocsMmr = await compressionRetrieverMmr.invoke(question);
  console.log("\n=== Contextual compression + MMR ===");
  prettyPrintDocs(compressedDocsMmr);
}

main();
