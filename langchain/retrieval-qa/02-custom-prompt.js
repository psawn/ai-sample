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

// Prompt tuỳ chỉnh, ép LLM:
// - Chỉ trả lời dựa trên context.
// - Không tự bịa khi không biết.
// - Luôn trả lời ngắn gọn.
// Giữ nguyên nội dung tiếng Anh vì đây là chỉ dẫn gửi thẳng cho LLM (giống bản Python),
// không phải comment giải thích code.
const qaPromptTemplate = `Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer. Use three sentences maximum. Keep the answer as concise as possible. Always say "thanks for asking!" at the end of the answer.
{context}
Question: {input}
Helpful Answer:`;

async function main() {
  const vectordb = await buildVectorDb();
  const retriever = vectordb.asRetriever({ k: 3 });

  const prompt = ChatPromptTemplate.fromTemplate(qaPromptTemplate);

  // returnSourceDocuments bên Python tương ứng với việc createRetrievalChain
  // LUÔN trả kèm field "context" (mảng Document đã dùng để trả lời) trong kết quả,
  // không cần bật thêm tuỳ chọn gì.
  const combineDocsChain = await createStuffDocumentsChain({ llm, prompt });
  const qaChain = await createRetrievalChain({ retriever, combineDocsChain });

  const question = "Is probability a class topic?";
  const result = await qaChain.invoke({ input: question });

  console.log("Question:", question);
  console.log("Answer:", result.answer);

  // context: danh sách chunk đã được retriever tìm ra và đưa vào prompt cho LLM,
  // dùng để kiểm tra câu trả lời có bằng chứng thật hay không.
  console.log("\nSource document [0]:");
  console.log(result.context[0]);
}

main();
