// =======================================================================
// QA - BƯỚC 5: RAG BẰNG LCEL
//
// Tự ráp pipeline RAG bằng RunnableSequence, thay chain có sẵn ở file 04:
// 1. RunnablePassthrough.assign: tìm document, thêm key "documents".
// 2. prompt: điền {documents} + {input}.
// 3. llm: viết câu trả lời.
// 4. StringOutputParser: AIMessage -> string.
//
// Ưu điểm: thấy rõ từng bước, dễ tùy biến (đổi cách format document, thêm bước...).
// Output là string, không cần lấy .answer như file 04.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { CSVLoader } = require("@langchain/community/document_loaders/fs/csv");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const {
  RunnableSequence,
  RunnablePassthrough,
} = require("@langchain/core/runnables");
const { StringOutputParser } = require("@langchain/core/output_parsers");
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

// Ghép nội dung các document thành 1 đoạn text, ngăn bằng dòng trống.
function formatDocuments(docs) {
  return docs.map((doc) => doc.pageContent).join("\n\n");
}

// Cách viết khác: tách bước retrieve + format ra hàm riêng (xem dòng comment trong ragChain).
async function retrieveContext(retriever, query) {
  const relevantDocs = await retriever.invoke(query);
  return formatDocuments(relevantDocs);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const docs = await loader.load();

  console.log("Loaded documents:", docs.length);

  // Embed từng Document, lưu vào RAM.
  const db = await MemoryVectorStore.fromDocuments(docs, embeddings);

  // Retriever: nhận câu hỏi -> trả k document liên quan nhất.
  const retriever = db.asRetriever({
    k: 4,
  });

  const prompt = ChatPromptTemplate.fromTemplate(
    `{documents} Question: {input}`,
  );

  // Pipeline RAG (4 bước ở header).
  // assign(): giữ nguyên key "input", thêm key "documents".
  // Vd: { input: "..." } -> { input: "...", documents: "..." }.
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
