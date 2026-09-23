// =======================================================================
// QA - BƯỚC 4: RAG BẰNG CHAIN CÓ SẴN
//
// Thay 3 bước làm tay ở file 03 bằng 2 chain có sẵn:
// 1. createStuffDocumentsChain: nhét tất cả document vào {context} -> gọi LLM.
// 2. createRetrievalChain: nối retriever + document chain thành 1 pipeline.
//
// Output: { input, context, answer }. Câu trả lời ở response.answer.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { CSVLoader } = require("@langchain/community/document_loaders/fs/csv");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { createRetrievalChain } = require("@langchain/classic/chains/retrieval");
const {
  createStuffDocumentsChain,
} = require("@langchain/classic/chains/combine_documents");

const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const path = require("path");

// Model embedding: đổi Document và câu hỏi thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// LLM: viết câu trả lời cuối.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const filePath = path.join(__dirname, "OutdoorClothingCatalog_1000.csv");
const loader = new CSVLoader(filePath);

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const docs = await loader.load();

  console.log("Loaded documents:", docs.length);

  // Embed từng Document, lưu vào RAM.
  const db = await MemoryVectorStore.fromDocuments(docs, embeddings);

  // Retriever: nhận câu hỏi -> trả k document liên quan nhất.
  // Thay cho db.similaritySearch(query, k) ở file 03, và ghép được vào chain.
  const retriever = db.asRetriever({
    k: 4,
  });

  // {context}: điền bằng nội dung các document retriever tìm được.
  // {input}: câu hỏi.
  const prompt = ChatPromptTemplate.fromTemplate(`{context} Question: {input}`);

  // Document chain: ghép document + câu hỏi vào prompt -> gọi LLM.
  // "stuff" = nhét tất cả document vào cùng 1 context.
  const documentChain = await createStuffDocumentsChain({
    llm,
    prompt,
  });

  // Retrieval chain: retriever tìm document -> document chain trả lời.
  const ragChain = await createRetrievalChain({
    retriever,
    combineDocsChain: documentChain,
  });

  const query =
    "Please list all your shirts with sun protection in a table in markdown and summarize each one.";

  const response = await ragChain.invoke({
    input: query,
  });

  console.log("\n========== Final Answer ==========");
  console.log(response.answer);
}

main();
