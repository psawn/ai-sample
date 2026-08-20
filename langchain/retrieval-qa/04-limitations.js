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
const { embedChunksSafely } = require("../retrieval/util-embed-safely");

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

async function main() {
  const vectordb = await buildVectorDb();
  const retriever = vectordb.asRetriever({ k: 3 });

  const prompt = ChatPromptTemplate.fromTemplate(
    `Use the following pieces of context to answer the question.\n\n{context}\n\nQuestion: {input}`,
  );
  const combineDocsChain = await createStuffDocumentsChain({ llm, prompt });
  const qaChain = await createRetrievalChain({ retriever, combineDocsChain });

  // Câu hỏi 1: hỏi trực tiếp, chain trả lời bình thường vì "probability" có
  // trong câu hỏi, retriever tìm được chunk liên quan.
  const question1 = "Is probability a class topic?";
  const result1 = await qaChain.invoke({ input: question1 });
  console.log("Q1:", question1);
  console.log("A1:", result1.answer);

  // Câu hỏi 2: "those prerequesites" chỉ có nghĩa nếu model nhớ câu hỏi 1 vừa nói về
  // "probability". Nhưng:
  // 1. Mỗi lần invoke() là một lượt hỏi ĐỘC LẬP.
  // 2. retriever chỉ tìm chunk theo đúng chữ trong question2, không biết "those" đang ám
  //    chỉ điều gì.
  // -> câu trả lời thường lạc đề hoặc chung chung.
  // Đây chính là giới hạn của RetrievalQA: không có bộ nhớ hội thoại (chat history). Muốn
  // khắc phục phải dùng ConversationalRetrievalChain kết hợp với memory (xem thêm các ví
  // dụ về memory trong langchain/memory/).
  const question2 = "why are those prerequesites needed?";
  const result2 = await qaChain.invoke({ input: question2 });
  console.log("\nQ2:", question2);
  console.log("A2:", result2.answer);
}

main();
