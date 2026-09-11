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

// Embedding Model: gọi API Gemini để biến Document / câu hỏi thành vector.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// LLM: gọi API Gemini để sinh câu trả lời cuối cùng từ context tìm được.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Xây vectorDB theo các bước:
// 1. Nạp 3 file PDF bài giảng.
// 2. Chia nhỏ (split) thành từng chunk.
// 3. Embed từng chunk rồi dựng vectorDB.
// Bản Python dùng lại Chroma đã lưu sẵn (persist_directory) từ bài trước; ở đây dựng lại
// MemoryVectorStore trong RAM mỗi lần chạy cho đơn giản, giống các file khác trong thư
// mục retrieval/.
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

  // Retriever: khi invoke, gọi API Gemini để embed câu hỏi rồi tìm k chunk
  // liên quan nhất trong vectorDB (so sánh vector xử lý local, không gọi API).
  const retriever = vectordb.asRetriever({ k: 3 });

  // {context} sẽ được điền bằng nội dung các chunk mà retriever tìm được,
  // {input} là câu hỏi của người dùng.
  const prompt = ChatPromptTemplate.fromTemplate(
    `Use the following pieces of context to answer the question.\n\n{context}\n\nQuestion: {input}`,
  );

  // Document Chain kiểu "stuff":
  // 1. Nhét toàn bộ chunk tìm được vào 1 prompt duy nhất.
  // 2. Gọi LLM sinh câu trả lời từ prompt đó.
  // Đây là behavior mặc định của Python's RetrievalQA.from_chain_type(llm, retriever=...)
  // khi không truyền chain_type.
  const combineDocsChain = await createStuffDocumentsChain({ llm, prompt });

  // createRetrievalChain nối 2 bước thành 1 pipeline duy nhất:
  // 1. retriever: tìm chunk liên quan tới câu hỏi.
  // 2. combineDocsChain: gọi LLM trả lời dựa trên chunk tìm được.
  // Tương đương RetrievalQAChain bên Python, chỉ khác là dùng API kiểu LCEL (Runnable)
  // thay vì class dựng sẵn.
  const qaChain = await createRetrievalChain({ retriever, combineDocsChain });

  const question = "Tóm tắt cho tôi cách gửi email để hỏi hỗ trợ về bài giảng Machine Learning.";
  const result = await qaChain.invoke({ input: question });

  console.log("Question:", question);
  console.log("Answer:", result.answer);
}

main();
