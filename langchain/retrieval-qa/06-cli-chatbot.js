require("dotenv").config();
const readline = require("readline");
const path = require("path");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const {
  GoogleGenerativeAIEmbeddings,
  ChatGoogleGenerativeAI,
} = require("@langchain/google-genai");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const {
  ChatPromptTemplate,
  MessagesPlaceholder,
} = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const {
  createStuffDocumentsChain,
} = require("langchain/chains/combine_documents");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");

// Chatbot hỏi đáp trên 1 file PDF cố định, chạy thẳng trên terminal (không có UI):
// 1. Load PDF 1 lần lúc khởi động.
// 2. Lặp vòng hỏi-đáp qua readline, mỗi câu hỏi mới đều dùng lại lịch sử chat của các
//    câu trước để trả lời đúng mạch hội thoại.
//
// Cùng pattern LangChain hiện khuyến nghị như 05-conversational-chat.js (rephraseChain
// viết lại câu hỏi để tìm document, answerChain trả lời dựa trên document + chat_history)
// - chỉ khác là tự ghép tay 2 chain (thay vì dùng createHistoryAwareRetriever/
// createRetrievalChain) để lấy được generatedQuestion/sourceDocuments hiển thị debug
// trên terminal.
//
// Dùng API mới (createStuffDocumentsChain) nên chỉ hỗ trợ "stuff", đổi lại câu trả lời
// vẫn "thấy" được chat_history. Muốn thử map_reduce/refine, xem file 07 (dùng API cũ).
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

// loadDb: chuẩn bị mọi thứ cần cho hội thoại.
// 1. Load 1 file PDF.
// 2. Split thành chunk.
// 3. Embed từng chunk.
// 4. Dựng retriever + 2 chain: 1 chain viết lại câu hỏi (rephraseChain), 1 chain trả lời
//    dựa trên context tìm được (answerChain).
async function loadDb(file, k) {
  const documents = await new PDFLoader(file).load();

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 150,
  });
  const docs = await textSplitter.splitDocuments(documents);

  const vectordb = await MemoryVectorStore.fromDocuments(docs, embeddings);
  const retriever = vectordb.asRetriever({ k });

  // rephraseChain: giúp AI "hiểu" câu hỏi tiếp theo đang nói về điều gì, bằng cách viết
  // lại nó thành 1 câu hỏi rõ nghĩa. LangChain gọi bước này là "contextualize question"
  // (đặt câu hỏi vào đúng ngữ cảnh), kết quả gọi là "Standalone Question" (câu hỏi độc
  // lập).
  // Cấu trúc prompt theo thứ tự:
  // 1. system: hướng dẫn.
  // 2. chat_history: lịch sử chat.
  // 3. human: câu hỏi mới.
  // Nhờ vậy retriever vẫn tìm đúng document dù câu hỏi gốc mơ hồ, phụ thuộc câu trước
  // (vd "why is that needed?").
  const rephrasePrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Given a chat history and the latest user question which might reference context in the chat history, formulate a standalone question which can be understood without the chat history. Do NOT answer the question, just reformulate it if needed and otherwise return it as is.",
    ],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);
  const rephraseChain = rephrasePrompt.pipe(llm).pipe(new StringOutputParser());

  // answerChain: nhét document tìm được + câu hỏi gốc + chat_history vào 1 prompt duy nhất
  // ("stuff") để LLM trả lời. Có chat_history nên trả lời được tự nhiên, đúng mạch chat.
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

// Xử lý 1 lượt hỏi-đáp: nhận câu hỏi + chat_history hiện có, trả về answer (câu trả lời),
// generatedQuestion (Standalone Question - câu hỏi đã viết lại, dùng để tìm document)
// và sourceDocuments (các đoạn tài liệu đã dùng làm ngữ cảnh trả lời).
async function askQuestion(qa, query, chatHistory) {
  const { retriever, rephraseChain, answerChain } = qa;

  // Chưa có lịch sử chat thì dùng thẳng câu hỏi gốc, có lịch sử mới cần viết lại thành Standalone Question.
  const generatedQuestion =
    chatHistory.length === 0
      ? query
      : await rephraseChain.invoke({ input: query, chat_history: chatHistory });

  const sourceDocuments = await retriever.invoke(generatedQuestion);

  const answer = await answerChain.invoke({
    input: query,
    context: sourceDocuments,
    chat_history: chatHistory,
  });

  return { answer, generatedQuestion, sourceDocuments };
}

async function main() {
  console.log(`Đang load database từ: ${loadedFile}`);
  const qa = await loadDb(loadedFile, 4);
  console.log("Đã sẵn sàng! Gõ câu hỏi rồi Enter, gõ 'exit' để thoát.\n");

  // Lưu lịch sử hội thoại trong 1 mảng, dùng lại cho các câu hỏi tiếp theo.
  const chatHistory = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

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

      // Lưu lượt hỏi-đáp này vào lịch sử để dùng cho câu hỏi tiếp theo.
      chatHistory.push(new HumanMessage(query), new AIMessage(answer));

      askLoop();
    });
  };

  askLoop();
}

main();
