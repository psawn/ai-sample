// =======================================================================
// RETRIEVAL QA - BƯỚC 6: CHATBOT CLI HỎI ĐÁP TRÊN PDF
//
// Cùng pattern với 05-conversational-chat.js, chạy trên terminal.
//
// Flow:
// 1. Lúc khởi động: load PDF 1 lần, tạo retriever + 2 chain.
// 2. Mỗi câu hỏi: viết lại câu hỏi -> tìm document -> trả lời -> lưu history.
// 3. Lặp lại tới khi gõ "exit".
//
// Khác file 05: tự ghép 2 chain (rephraseChain + answerChain), không dùng
// createHistoryAwareRetriever. Nhờ vậy lấy được câu hỏi đã viết lại và
// số document để in debug.
//
// Chỉ hỗ trợ "stuff" (API mới). Muốn thử map_reduce/refine: file 07.
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
const {
  createStuffDocumentsChain,
} = require("@langchain/classic/chains/combine_documents");
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
async function loadDb(file, k) {
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

  // answerChain ("stuff"): nhét document + câu hỏi gốc + chat_history vào 1 prompt.
  // Có chat_history nên trả lời tự nhiên, đúng mạch hội thoại.
  const qaPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer. Use three sentences maximum. Keep the answer as concise as possible. Always say \"thanks for asking!\" at the end of the answer.\n\n{context}",
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);
  const answerChain = await createStuffDocumentsChain({ llm, prompt: qaPrompt });

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

  // Trả lời câu hỏi gốc (không phải câu đã viết lại), kèm history.
  const answer = await answerChain.invoke({
    input: query,
    context: sourceDocuments,
    chat_history: chatHistory,
  });

  return { answer, generatedQuestion, sourceDocuments };
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  console.log(`Đang load database từ: ${loadedFile}`);
  const qa = await loadDb(loadedFile, 4);
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
