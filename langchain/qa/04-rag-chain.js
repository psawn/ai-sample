require("dotenv").config();

const { CSVLoader } = require("@langchain/community/document_loaders/fs/csv");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { createRetrievalChain } = require("langchain/chains/retrieval");
const {
  createStuffDocumentsChain,
} = require("langchain/chains/combine_documents");

const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
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

  // Retriever: khi invoke sẽ:
  // 1. Gọi API Gemini để tạo vector cho query.
  // 2. So sánh với các vector Document trong RAM (xử lý local) để trả về những document liên quan nhất.
  const retriever = db.asRetriever({
    k: 4,
  });

  // {context} sẽ được điền bằng nội dung các document mà Retriever tìm được.
  const prompt = ChatPromptTemplate.fromTemplate(`{context} Question: {input}`);

  // Document Chain:
  // 1. Ghép Document + câu hỏi vào prompt.
  // 2. Gọi API Gemini (LLM) để sinh câu trả lời.
  // "stuff" = đưa tất cả document vào cùng một context.
  const documentChain = await createStuffDocumentsChain({
    llm,
    prompt,
  });

  // Retrieval Chain nối 2 bước thành 1 pipeline duy nhất:
  // 1. Retriever: gọi API Gemini lấy document liên quan.
  // 2. Document Chain: gọi API Gemini sinh câu trả lời.
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
