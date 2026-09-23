// =======================================================================
// RETRIEVAL QA - BƯỚC 7: CHATBOT CLI CHỌN ĐƯỢC CHAIN TYPE
//
// Giống 06-cli-chatbot.js, nhưng chọn được chainType
// (stuff / map_reduce / refine) thay vì cố định "stuff".
//
// Đánh đổi: prompt mặc định của loadQAChain chỉ có {context}/{question},
// không có chỗ cho chat_history.
// - Bước viết lại câu hỏi (rephraseChain): vẫn dùng history.
// - Bước trả lời: không "thấy" history.
//
// Chỉ dùng khi cần thử map_reduce/refine. Bình thường ưu tiên file 06 (API mới).
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const readline = require("readline");
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
const { StringOutputParser } = require("@langchain/core/output_parsers");
// loadQAChain đã deprecated, không nên dùng cho code mới.
// Dùng ở đây vì là cách duy nhất hỗ trợ đủ 3 type: stuff / map_reduce / refine.
const { loadQAChain } = require("@langchain/classic/chains");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");

const loadedFile = path.join(
  __dirname,
  "../../docs/cs229_lectures/MachineLearning-Lecture01.pdf",
);

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Chuẩn bị cho hội thoại:
// 1. Load PDF -> split -> embed.
// 2. Tạo retriever + 2 chain: rephraseChain (viết lại câu hỏi), answerChain (trả lời).
//
// chainType (mặc định "stuff", chi tiết: 03-chain-types.js):
// - "stuff": nhét hết document vào 1 prompt. Nhanh, rẻ.
// - "map_reduce": tóm tắt từng document rồi gộp. Xử lý được nhiều document.
// - "refine": sửa dần câu trả lời qua từng document. Giữ mạch tốt nhất, nhưng chậm.
async function loadDb(file, k, chainType = "stuff") {
  const documents = await new PDFLoader(file).load();

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 150,
  });
  const docs = await textSplitter.splitDocuments(documents);

  const vectordb = await MemoryVectorStore.fromDocuments(docs, embeddings);
  const retriever = vectordb.asRetriever({ k });

  // rephraseChain: viết lại câu hỏi mơ hồ (vd "why is that needed?") thành
  // standalone question dựa vào chat history -> retriever tìm đúng document.
  // Thứ tự prompt: system -> chat_history -> human (câu hỏi mới).
  const rephrasePrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Given a chat history and the latest user question which might reference context in the chat history, formulate a standalone question which can be understood without the chat history. Do NOT answer the question, just reformulate it if needed and otherwise return it as is.",
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);
  const rephraseChain = rephrasePrompt.pipe(llm).pipe(new StringOutputParser());

  // answerChain: prompt mặc định của loadQAChain theo chainType đã chọn.
  const answerChain = loadQAChain(llm, { type: chainType });

  return { retriever, rephraseChain, answerChain };
}

// Xử lý 1 lượt hỏi-đáp. Trả về:
// - answer: câu trả lời.
// - generatedQuestion: câu hỏi đã viết lại (dùng để tìm document).
// - sourceDocuments: các document đã dùng làm context.
async function askQuestion(qa, query, chatHistory) {
  const { retriever, rephraseChain, answerChain } = qa;

  // Chưa có history -> dùng thẳng câu hỏi gốc. Có history -> viết lại cho rõ nghĩa.
  const generatedQuestion =
    chatHistory.length === 0
      ? query
      : await rephraseChain.invoke({ input: query, chat_history: chatHistory });

  const sourceDocuments = await retriever.invoke(generatedQuestion);

  // loadQAChain cố định key đầu vào: input_documents, question.
  // Output là object { text } (file 06 trả string trực tiếp).
  const result = await answerChain.invoke({
    input_documents: sourceDocuments,
    question: query,
  });

  return { answer: result.text, generatedQuestion, sourceDocuments };
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  console.log(`Đang load database từ: ${loadedFile}`);
  // Tham số thứ 3 là chainType. Đổi thành "map_reduce" hoặc "refine" để thử.
  const qa = await loadDb(loadedFile, 4, "stuff");
  console.log("Đã sẵn sàng! Gõ câu hỏi rồi Enter, gõ 'exit' để thoát.\n");

  // Lịch sử hội thoại, dùng lại cho các câu hỏi sau.
  const chatHistory = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Vòng lặp hỏi-đáp: hỏi 1 câu -> trả lời -> hỏi tiếp, tới khi gõ "exit".
  const askLoop = () => {
    rl.question("User: ", async (query) => {
      if (query.trim().toLowerCase() === "exit") {
        rl.close();
        return;
      }

      const { answer, generatedQuestion, sourceDocuments } = await askQuestion(
        qa,
        query,
        chatHistory,
      );

      console.log("DB query (Standalone Question):", generatedQuestion);
      console.log("Số document tìm được:", sourceDocuments.length);
      console.log("ChatBot:", answer, "\n");

      // Lưu Q&A vào history cho câu hỏi sau.
      chatHistory.push(new HumanMessage(query), new AIMessage(answer));

      askLoop();
    });
  };

  askLoop();
}

main();
