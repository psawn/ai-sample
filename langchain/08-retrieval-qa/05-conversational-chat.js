// =======================================================================
// RETRIEVAL QA - BƯỚC 5: CHATBOT RAG CÓ NHỚ HỘI THOẠI
//
// Khắc phục giới hạn ở 04-limitations.js (hỏi tiếp bị lạc đề).
// Ghép 2 chain nhỏ, thay ConversationalRetrievalChain (deprecated):
// 1. historyAwareRetriever: dùng chat history viết lại câu hỏi cho rõ nghĩa,
//    rồi mới tìm document.
//    Vd: "why are those needed?" + history về "probability"
//        -> "why is probability needed?"
// 2. questionAnswerChain: trả lời dựa trên document + câu hỏi gốc + chat history
//    -> câu trả lời tự nhiên, đúng mạch hội thoại.
// =======================================================================

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
const {
  ChatPromptTemplate,
  MessagesPlaceholder,
} = require("@langchain/core/prompts");
const {
  createHistoryAwareRetriever,
} = require("@langchain/classic/chains/history_aware_retriever");
const { createRetrievalChain } = require("@langchain/classic/chains/retrieval");
const {
  createStuffDocumentsChain,
} = require("@langchain/classic/chains/combine_documents");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");
const { embedChunksSafely } = require("../06-retrieval/util-embed-safely");

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

// Xây vectorDB: load 3 PDF -> split -> embed -> MemoryVectorStore (giống 01-basic.js).
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

  // Embed có retry khi lỗi (lý do: ../06-retrieval/util-embed-safely.js).
  const vectors = await embedChunksSafely(embeddings, splits);
  const vectordb = await MemoryVectorStore.fromExistingIndex(embeddings);
  await vectordb.addVectors(vectors, splits);
  return vectordb;
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const vectordb = await buildVectorDb();
  const retriever = vectordb.asRetriever({ k: 4 });

  // ----- Chain 1: viết lại câu hỏi (contextualize question) -----
  // Câu hỏi mơ hồ -> "standalone question" (tự đủ nghĩa, không cần history).
  // Thứ tự prompt: system (hướng dẫn) -> chat_history -> human (câu hỏi mới).
  const rephrasePrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Given a chat history and the latest user question which might reference context in the chat history, formulate a standalone question which can be understood without the chat history. Do NOT answer the question, just reformulate it if needed and otherwise return it as is.",
    ],
    // chat_history là mảng message (HumanMessage, AIMessage), không phải chuỗi.
    // MessagesPlaceholder chèn mảng này vào prompt, giữ đúng vai người nói:
    // [Human] câu hỏi cũ -> [AI] câu trả lời cũ -> [Human] câu hỏi mới.
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);

  // Retriever có dùng history:
  // - History rỗng: dùng thẳng câu hỏi gốc, không gọi LLM viết lại.
  // - History có dữ liệu: gọi LLM viết lại câu hỏi, rồi mới tìm document.
  const historyAwareRetriever = await createHistoryAwareRetriever({
    llm,
    retriever,
    rephrasePrompt,
  });

  // ----- Chain 2: trả lời -----
  // Prompt gồm {context} (document), {input} (câu hỏi gốc) và chat_history.
  // Dùng câu hỏi gốc, không dùng câu đã viết lại, để trả lời tự nhiên theo mạch hội thoại.
  const qaPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer. Use three sentences maximum. Keep the answer as concise as possible. Always say \"thanks for asking!\" at the end of the answer.\n\n{context}",
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);
  const questionAnswerChain = await createStuffDocumentsChain({
    llm,
    prompt: qaPrompt,
  });

  // Nối 2 chain: historyAwareRetriever tìm document -> questionAnswerChain trả lời.
  const ragChain = await createRetrievalChain({
    retriever: historyAwareRetriever,
    combineDocsChain: questionAnswerChain,
  });

  // Callback in câu hỏi sau khi viết lại (câu thật sự dùng để tìm tài liệu).
  // Thấy rõ: câu mơ hồ ("those...") -> câu rõ nghĩa.
  const logRephraseCallback = {
    handleRetrieverStart: (_retriever, query) => {
      console.log("  -> Câu hỏi dùng để tìm tài liệu:", query);
    },
  };

  // Chat history quản lý bằng tay (giống 03-memory/03-all-history.js).
  // So sánh cách tự động: 01-basics/chat-history-manual-vs-auto.js.
  const chatHistory = [];

  const question1 = "Is probability a class topic?";
  console.log("Q1:", question1);
  const result1 = await ragChain.invoke(
    { input: question1, chat_history: chatHistory },
    { callbacks: [logRephraseCallback] }
  );
  console.log("A1:", result1.answer);

  // Lưu Q&A vừa rồi vào history cho câu hỏi sau.
  chatHistory.push(new HumanMessage(question1), new AIMessage(result1.answer));

  // Câu hỏi có "those" mơ hồ. Nhờ viết lại theo history, retriever vẫn tìm đúng
  // chunk về "probability". (Ở 04-limitations.js, cùng câu này thường lạc đề.)
  const question2 = "why are those prerequesites needed?";
  console.log("\nQ2:", question2);
  const result2 = await ragChain.invoke(
    { input: question2, chat_history: chatHistory },
    { callbacks: [logRephraseCallback] }
  );
  console.log("A2:", result2.answer);
}

main();
