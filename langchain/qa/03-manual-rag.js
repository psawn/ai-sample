require("dotenv").config();

const { CSVLoader } = require("@langchain/community/document_loaders/fs/csv");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const path = require("path");

// Embedding Model: gọi API Gemini (model gemini-embedding-001) để biến Document / Query thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// LLM: gọi API Gemini (model gemini-3.5-flash) để sinh câu trả lời cuối cùng.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const filePath = path.join(__dirname, "OutdoorClothingCatalog_1000.csv");
const loader = new CSVLoader(filePath);

async function main() {
  const docs = await loader.load();

  console.log("Loaded documents:", docs.length);

  // Gọi API Gemini để tạo vector cho từng Document, rồi lưu Document + vector vào MemoryVectorStore trong RAM.
  const db = await MemoryVectorStore.fromDocuments(docs, embeddings);

  // Số lượng document liên quan nhất muốn lấy ra.
  const k = 4;

  const query =
    "Please list all your shirts with sun protection in a table in markdown and summarize each one.";

  // similaritySearch gọi API Gemini để tạo vector cho query, sau đó so sánh với các vector
  // Document đã lưu trong RAM (bước so sánh xử lý local, không gọi API) để tìm k document gần nhất.
  // Ở bước này chưa gọi LLM để trả lời, chỉ đang tìm document liên quan.
  const results = await db.similaritySearch(query, k);

  console.log("\nNumber of results:", results.length);

  // List documents found
  // results.forEach((doc, index) => {
  //   console.log(`\n========== Result ${index + 1} ==========`);
  //   console.log(doc.pageContent);
  // });

  const context = results.map((doc) => doc.pageContent).join("");

  // Gọi API Gemini (LLM) với context (các document tìm được) + câu hỏi để sinh câu trả lời cuối cùng.
  const prompt = `${context} Question: ${query}`;

  const response = await llm.invoke(prompt);

  console.log("\n========== Final Answer ==========");
  console.log(response.content);
}

main();
