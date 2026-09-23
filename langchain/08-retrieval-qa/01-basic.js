// =======================================================================
// RETRIEVAL QA - BƯỚC 1: HỎI ĐÁP TRÊN TÀI LIỆU PDF
//
// RAG trên 3 file PDF bài giảng.
//
// Flow:
// 1. Xây vectorDB: load PDF -> split -> embed.
// 2. Retriever tìm k chunk liên quan câu hỏi.
// 3. Document chain ("stuff") nhét các chunk vào prompt -> LLM trả lời.
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
const { createRetrievalChain } = require("@langchain/classic/chains/retrieval");
const {
  createStuffDocumentsChain,
} = require("@langchain/classic/chains/combine_documents");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { embedChunksSafely } = require("../06-retrieval/util-embed-safely");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

// Model embedding: đổi chunk và câu hỏi thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// LLM: viết câu trả lời từ các chunk tìm được.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Xây vectorDB:
// 1. Load 3 file PDF bài giảng.
// 2. Split thành chunk.
// 3. Embed từng chunk, lưu vào MemoryVectorStore.
// Dựng lại trong RAM mỗi lần chạy cho đơn giản, giống 06-retrieval/.
// Muốn lưu lâu dài, không embed lại: dùng Chroma (../05-vectorstores-and-embeddings/02-vectorstore-chroma.js).
async function buildVectorDb() {
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

  // Embed có retry khi lỗi (lý do: ../06-retrieval/util-embed-safely.js).
  const vectors = await embedChunksSafely(embeddings, splits);
  const vectordb = await MemoryVectorStore.fromExistingIndex(embeddings);
  await vectordb.addVectors(vectors, splits);
  return vectordb;
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const vectordb = await buildVectorDb();

  // Retriever: embed câu hỏi -> lấy 3 chunk gần nghĩa nhất.
  const retriever = vectordb.asRetriever({ k: 3 });

  // {context}: nội dung các chunk retriever tìm được.
  // {input}: câu hỏi của người dùng.
  const prompt = ChatPromptTemplate.fromTemplate(
    `Use the following pieces of context to answer the question.\n\n{context}\n\nQuestion: {input}`,
  );

  // Document chain kiểu "stuff": nhét toàn bộ chunk vào 1 prompt, gọi LLM 1 lần.
  // Các kiểu khác (map_reduce, refine): 03-chain-types.js.
  const combineDocsChain = await createStuffDocumentsChain({ llm, prompt });

  // Nối 2 bước: retriever tìm chunk -> combineDocsChain trả lời.
  const qaChain = await createRetrievalChain({ retriever, combineDocsChain });

  const question = "Tóm tắt cho tôi cách gửi email để hỏi hỗ trợ về bài giảng Machine Learning.";
  const result = await qaChain.invoke({ input: question });

  console.log("Question:", question);
  console.log("Answer:", result.answer);
}

main();
