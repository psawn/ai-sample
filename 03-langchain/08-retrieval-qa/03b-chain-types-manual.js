// =======================================================================
// RETRIEVAL QA - BƯỚC 3B: TỰ VIẾT 3 CHIẾN LƯỢC GỘP TÀI LIỆU (KHÔNG DÙNG loadQAChain)
//
// Mục đích: Tự hiện thực hóa 3 chiến lược gộp tài liệu (stuff, map_reduce, refine)
// thay vì dùng loadQAChain của LangChain (vì các hàm này đã cũ/deprecated).
//
// Tổng quan 3 chiến lược xử lý context từ các chunk:
// 1. stuff       : Nối toàn bộ chunk vào 1 prompt duy nhất -> gọi LLM 1 lần.
// 2. map_reduce  : Đọc/lọc riêng từng chunk (song song) -> gộp kết quả -> gọi LLM tổng hợp lần cuối.
// 3. refine      : Trả lời từ chunk đầu tiên -> lần lượt đưa các chunk tiếp theo vào để tinh chỉnh câu trả lời.
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { Document } = require("@langchain/core/documents");
const {
  GoogleGenerativeAIEmbeddings,
  ChatGoogleGenerativeAI,
} = require("@langchain/google-genai");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const pdf = require("pdf-parse");

const { embedChunksSafely } = require("../06-retrieval/helpers/embed-safely");

const lecturesDir = path.join(__dirname, "../../data/cs229_lectures");

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

/**
 * Xây dựng VectorDB: Đọc 3 file PDF -> Cắt nhỏ (split) -> Tạo embedding -> Lưu vào MemoryVectorStore.
 * Sử dụng pdf-parse để đọc file PDF thay thế cho PDFLoader (vì @langchain/community đang bị sunset).
 */
async function buildVectorDb() {
  const fileNames = [
    "MachineLearning-Lecture01.pdf",
    "MachineLearning-Lecture02.pdf",
    "MachineLearning-Lecture03.pdf",
  ];

  const docs = [];
  for (const fileName of fileNames) {
    const { text } = await pdf(
      fs.readFileSync(path.join(lecturesDir, fileName)),
    );
    docs.push(
      new Document({ pageContent: text, metadata: { source: fileName } }),
    );
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

// ===== 1. CHIẾN LƯỢC: STUFF =====

/** Nối tất cả chunk vào một prompt duy nhất và gọi LLM xử lý trong 1 lần duy nhất. */
async function stuff(docs, question) {
  const context = docs.map((doc) => doc.pageContent).join("\n\n");

  const response = await llm.invoke([
    {
      role: "system",
      content: `Use the following pieces of context to answer the users question.
If you don't know the answer, just say that you don't know, don't try to make up an answer.
----------------
${context}`,
    },
    { role: "user", content: question },
  ]);
  return { answer: response.content, llmCalls: 1 };
}

// ===== 2. CHIẾN LƯỢC: MAP_REDUCE =====

/** Bước Map: Hỏi LLM độc lập trên từng chunk để trích xuất nội dung liên quan đến câu hỏi. */
async function extractRelevant(doc, question) {
  const response = await llm.invoke([
    {
      role: "system",
      content: `Use the following portion of a long document to see if any of the text is relevant to answer the question.
Return any relevant text verbatim.
----------------
${doc.pageContent}`,
    },
    { role: "user", content: question },
  ]);
  return response.content;
}

/**
 * Thực thi Map-Reduce:
 * - Map: Chạy song song trên mọi chunk bằng Promise.all.
 * - Reduce: Gộp các đoạn trích xuất lại và gọi LLM lần cuối để tạo câu trả lời hoàn chỉnh.
 */
async function mapReduce(docs, question) {
  // Map: Các chunk độc lập nhau nên chạy song song để tối ưu thời gian.
  const extracts = await Promise.all(
    docs.map((doc) => extractRelevant(doc, question)),
  );

  // Reduce: Tổng hợp các đoạn trích lọc được thành câu trả lời cuối cùng.
  const response = await llm.invoke([
    {
      role: "system",
      content: `Given the following extracted parts of a long document and a question, create a final answer.
If you don't know the answer, just say that you don't know. Don't try to make up an answer.
----------------
${extracts.join("\n\n")}`,
    },
    { role: "user", content: question },
  ]);
  return { answer: response.content, llmCalls: docs.length + 1 };
}

// ===== 3. CHIẾN LƯỢC: REFINE =====

/**
 * Thực thi Refine:
 * Trả lời dựa trên chunk đầu tiên, sau đó lần lượt cập nhật/tinh chỉnh câu trả lời với các chunk tiếp theo.
 */
async function refine(docs, question) {
  // Bước khởi tạo: Tạo câu trả lời sơ khai chỉ dựa trên chunk đầu tiên.
  const first = await llm.invoke([
    {
      role: "system",
      content: `Context information is below.
---------------------
${docs[0].pageContent}
---------------------
Given the context information and no prior knowledge, answer any questions`,
    },
    { role: "user", content: question },
  ]);
  let answer = first.content;

  // Các bước tiếp theo: Chạy tuần tự vì mỗi lần tinh chỉnh cần dựa vào kết quả câu trả lời trước đó.
  for (const doc of docs.slice(1)) {
    const response = await llm.invoke([
      { role: "user", content: question },
      { role: "assistant", content: answer },
      {
        role: "user",
        content: `The original question is as follows: ${question}
We have provided an existing answer: ${answer}
We have the opportunity to refine the existing answer
(only if needed) with some more context below.
------------
${doc.pageContent}
------------
Given the new context, refine the original answer to better answer the question.
If the context isn't useful, return the original answer.`,
      },
    ]);
    answer = response.content;
  }
  return { answer, llmCalls: docs.length };
}

/** Chạy thử một chiến lược, sau đó in ra câu trả lời kèm số lần gọi LLM và thời gian thực thi. */
async function run(name, strategy, docs, question) {
  const start = Date.now();
  const { answer, llmCalls } = await strategy(docs, question);
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n=== ${name} (${llmCalls} lần gọi LLM, ${seconds}s) ===`);
  console.log(answer);
}

// ===== KỊCH BẢN CHẠY THỬ =====
// Sử dụng cùng một câu hỏi và bộ 3 chunk cố định để so sánh công bằng giữa 3 chiến lược.
async function main() {
  const vectordb = await buildVectorDb();
  const retriever = vectordb.asRetriever({ k: 3 });

  const question = "Is probability a class topic?";

  // Lấy các chunk một lần dùng chung cho cả 3 chiến lược.
  const docs = await retriever.invoke(question);

  await run("stuff", stuff, docs, question);
  await run("map_reduce", mapReduce, docs, question);
  await run("refine", refine, docs, question);
}

main();
