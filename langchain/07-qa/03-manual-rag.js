// =======================================================================
// QA - BƯỚC 3: RAG TỰ LÀM BẰNG TAY
//
// Tự viết từng bước của RAG, chưa dùng chain:
// 1. Retrieval: similaritySearch lấy k document liên quan.
// 2. Augmented: ghép nội dung document thành context, nối với câu hỏi.
// 3. Generation: gửi prompt cho LLM trả lời.
//
// Bản dùng chain có sẵn: 04-rag-chain.js. Bản LCEL: 05-rag-chain-lcel.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { CSVLoader } = require("@langchain/community/document_loaders/fs/csv");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
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

  // Số document liên quan nhất muốn lấy.
  const k = 4;

  const query =
    "Please list all your shirts with sun protection in a table in markdown and summarize each one.";

  // Bước 1 - Retrieval: tìm k document gần câu hỏi nhất (chưa gọi LLM).
  const results = await db.similaritySearch(query, k);

  console.log("\nNumber of results:", results.length);

  // In các document tìm được (bỏ comment để xem).
  // results.forEach((doc, index) => {
  //   console.log(`\n========== Result ${index + 1} ==========`);
  //   console.log(doc.pageContent);
  // });

  // Bước 2 - Augmented: ghép nội dung các document thành context.
  // join(""): các document dính liền nhau. Bản 05 tách bằng "\n\n" cho dễ đọc.
  const context = results.map((doc) => doc.pageContent).join("");

  // Bước 3 - Generation: gửi context + câu hỏi cho LLM.
  const prompt = `${context} Question: ${query}`;

  const response = await llm.invoke(prompt);

  console.log("\n========== Final Answer ==========");
  console.log(response.content);
}

main();
