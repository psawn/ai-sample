// =======================================================================
// RETRIEVAL QA - BƯỚC 2: PROMPT TÙY CHỈNH & TÀI LIỆU NGUỒN
//
// Nâng cấp từ 01-basic.js:
// 1. Prompt tùy chỉnh: chỉ dựa vào context, không bịa, trả lời ngắn.
// 2. In result.context: các chunk đã dùng để trả lời.
//    Dùng để kiểm tra câu trả lời có bằng chứng thật trong tài liệu không.
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

// Prompt tùy chỉnh, yêu cầu LLM:
// - Chỉ trả lời dựa trên context.
// - Không biết thì nói không biết, không bịa.
// - Tối đa 3 câu, kết thúc bằng "thanks for asking!" (dấu hiệu dễ thấy prompt có hiệu lực).
const qaPromptTemplate = `Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer. Use three sentences maximum. Keep the answer as concise as possible. Always say "thanks for asking!" at the end of the answer.
{context}
Question: {input}
Helpful Answer:`;

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const vectordb = await buildVectorDb();
  const retriever = vectordb.asRetriever({ k: 3 });

  const prompt = ChatPromptTemplate.fromTemplate(qaPromptTemplate);

  // createRetrievalChain luôn trả kèm field "context" (mảng Document đã dùng), không cần bật thêm.
  const combineDocsChain = await createStuffDocumentsChain({ llm, prompt });
  const qaChain = await createRetrievalChain({ retriever, combineDocsChain });

  const question = "Is probability a class topic?";
  const result = await qaChain.invoke({ input: question });

  console.log("Question:", question);
  console.log("Answer:", result.answer);

  // In chunk đầu tiên đã dùng, để đối chiếu với câu trả lời.
  console.log("\nSource document [0]:");
  console.log(result.context[0]);
}

main();
