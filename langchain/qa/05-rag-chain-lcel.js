require("dotenv").config();

const { CSVLoader } = require("@langchain/community/document_loaders/fs/csv");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const {
  RunnableSequence,
  RunnablePassthrough,
} = require("@langchain/core/runnables");
const { StringOutputParser } = require("@langchain/core/output_parsers");
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

function formatDocuments(docs) {
  return docs.map((doc) => doc.pageContent).join("\n\n");
}

async function retrieveContext(retriever, query) {
  const relevantDocs = await retriever.invoke(query);
  return formatDocuments(relevantDocs);
}

async function main() {
  const docs = await loader.load();

  console.log("Loaded documents:", docs.length);

  // Gọi API Gemini để tạo vector cho từng Document, rồi lưu Document + vector vào MemoryVectorStore trong RAM.
  const db = await MemoryVectorStore.fromDocuments(docs, embeddings);

  // Retriever: khi invoke, gọi API Gemini để tạo vector cho query, so sánh với các vector
  // Document trong RAM (xử lý local) để trả về những document liên quan nhất.
  const retriever = db.asRetriever({
    k: 4,
  });

  const prompt = ChatPromptTemplate.fromTemplate(
    `{documents} Question: {input}`,
  );

  // Pipeline: lấy document liên quan (gọi API Gemini) -> đưa vào prompt -> gọi API Gemini (LLM) sinh câu trả lời.
  const ragChain = RunnableSequence.from([
    RunnablePassthrough.assign({
      documents: async (input) => {
        const relevantDocs = await retriever.invoke(input.input);
        return formatDocuments(relevantDocs);
      },
      // documents: (input) => retrieveContext(retriever, input.input),
    }),
    prompt,
    llm,
    new StringOutputParser(),
  ]);

  const query =
    "Please list all your shirts with sun protection in a table in markdown and summarize each one.";

  const answer = await ragChain.invoke({
    input: query,
  });

  console.log("\n========== Final Answer ==========");
  console.log(answer);
}

main();
