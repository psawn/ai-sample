// =======================================================================
// RETRIEVAL QA - BƯỚC 3: 3 CHIẾN LƯỢC GỘP DOCUMENT (CHAIN TYPE)
//
// Retriever trả nhiều chunk. Gửi cho LLM thế nào?
// 1. stuff: nhét hết vào 1 prompt, gọi LLM 1 lần.
//    Nhanh, rẻ. Nhiều chunk dễ vượt giới hạn context.
// 2. map_reduce: tóm tắt từng chunk riêng, rồi gộp.
//    Xử lý được nhiều chunk, nhưng tốn nhiều lượt gọi.
// 3. refine: trả lời từ chunk đầu, rồi tinh chỉnh lần lượt với từng chunk sau.
//    Giữ mạch tốt, nhưng chạy tuần tự nên chậm nhất.
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
// loadQAChain: chain kiểu cũ, hỗ trợ đủ 3 type: stuff, map_reduce, refine.
// Bản LCEL (createStuffDocumentsChain) chỉ có "stuff".
const { loadQAChain } = require("@langchain/classic/chains");
const { embedChunksSafely } = require("../06-retrieval/util-embed-safely");

const lecturesDir = path.join(__dirname, "../../docs/cs229_lectures");

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Xây vectorDB: load 3 PDF -> split -> embed -> MemoryVectorStore (giống 01-basic.js).
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

  const vectors = await embedChunksSafely(embeddings, splits);
  const vectordb = await MemoryVectorStore.fromExistingIndex(embeddings);
  await vectordb.addVectors(vectors, splits);
  return vectordb;
}

// Hỏi với 1 chain type, trả câu trả lời.
async function askWithChainType(chainType, retriever, question) {
  // loadQAChain không tự gọi retriever -> tự lấy document rồi truyền vào.
  const relevantDocs = await retriever.invoke(question);

  // Key đầu vào cố định: input_documents, question. Output: { text }.
  const chain = loadQAChain(llm, { type: chainType });
  const result = await chain.call({
    input_documents: relevantDocs,
    question,
  });
  return result.text;
}

// ===== KỊCH BẢN MINH HỌA =====
// Cùng 1 câu hỏi, so sánh câu trả lời của 3 chain type.
async function main() {
  const vectordb = await buildVectorDb();
  const retriever = vectordb.asRetriever({ k: 3 });

  const question = "Is probability a class topic?";

  // 1. stuff: nhét toàn bộ chunk vào 1 prompt, gọi LLM 1 lần.
  // Ưu: nhanh, rẻ. Nhược: chunk quá nhiều/dài -> vượt giới hạn context.
  const stuffAnswer = await askWithChainType("stuff", retriever, question);
  console.log("=== stuff ===");
  console.log(stuffAnswer);

  // 2. map_reduce:
  // - Map: gọi LLM riêng cho từng chunk để tóm tắt.
  // - Reduce: gọi LLM thêm 1 lần để gộp các tóm tắt thành câu trả lời.
  // Ưu: xử lý nhiều chunk hơn stuff.
  // Nhược: nhiều lượt gọi LLM. Các chunk xử lý riêng, không "thấy" nhau.
  const mapReduceAnswer = await askWithChainType(
    "map_reduce",
    retriever,
    question,
  );
  console.log("\n=== map_reduce ===");
  console.log(mapReduceAnswer);

  // 3. refine:
  // - Trả lời dựa trên chunk đầu tiên.
  // - Lần lượt đưa từng chunk còn lại vào để LLM sửa câu trả lời trước đó.
  // Ưu: giữ mạch ngữ cảnh tốt hơn map_reduce.
  // Nhược: chạy tuần tự, không song song được -> thường chậm nhất.
  const refineAnswer = await askWithChainType("refine", retriever, question);
  console.log("\n=== refine ===");
  console.log(refineAnswer);
}

main();
