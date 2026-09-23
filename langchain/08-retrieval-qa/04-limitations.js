// =======================================================================
// RETRIEVAL QA - BƯỚC 4: GIỚI HẠN - KHÔNG NHỚ HỘI THOẠI
//
// Vấn đề: mỗi lần invoke() là 1 lượt hỏi độc lập.
// Câu hỏi nối tiếp như "why are those prerequisites needed?" mất ngữ cảnh,
// vì retriever không biết "those" ám chỉ gì.
//
// Cách khắc phục: thêm chat history (05-conversational-chat.js).
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

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const vectordb = await buildVectorDb();
  const retriever = vectordb.asRetriever({ k: 3 });

  // Chain giống 01-basic.js, không có chat history.
  const prompt = ChatPromptTemplate.fromTemplate(
    `Use the following pieces of context to answer the question.\n\n{context}\n\nQuestion: {input}`,
  );
  const combineDocsChain = await createStuffDocumentsChain({ llm, prompt });
  const qaChain = await createRetrievalChain({ retriever, combineDocsChain });

  // Câu 1: hỏi trực tiếp -> trả lời tốt, vì "probability" có ngay trong câu hỏi.
  const question1 = "Is probability a class topic?";
  const result1 = await qaChain.invoke({ input: question1 });
  console.log("Q1:", question1);
  console.log("A1:", result1.answer);

  // Câu 2: "those prerequesites" chỉ có nghĩa nếu nhớ câu 1 nói về "probability".
  // invoke() không nhớ gì, retriever chỉ tìm theo chữ trong câu 2.
  // Kỳ vọng: câu trả lời lạc đề hoặc chung chung.
  // Cách khắc phục: thêm chat history (05-conversational-chat.js, 03-memory/).
  const question2 = "why are those prerequesites needed?";
  const result2 = await qaChain.invoke({ input: question2 });
  console.log("\nQ2:", question2);
  console.log("A2:", result2.answer);
}

main();
