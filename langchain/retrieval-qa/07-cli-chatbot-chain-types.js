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
// loadQAChain: thuộc API "Chain" đời cũ của LangChain, bản thân thư viện đã đánh dấu
// @deprecated - KHÔNG khuyến khích dùng cho code mới. Chỉ dùng ở đây vì đây là cách
// duy nhất hỗ trợ sẵn cả 3 chain_type "stuff" / "map_reduce" / "refine" (API mới
// createStuffDocumentsChain hiện chỉ có bản LCEL cho "stuff").
const { loadQAChain } = require("langchain/chains");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");

// Giống 06-cli-chatbot.js (chatbot hỏi đáp 1 file PDF, chạy trên terminal, không UI),
// nhưng cho chọn chainType thay vì cố định "stuff". Chỉ nên dùng file này khi cần thử
// hoặc so sánh map_reduce/refine - nếu không, ưu tiên dùng file 06 (API mới hơn).
//
// Đánh đổi: loadQAChain dùng prompt mặc định riêng (chỉ có {context}/{question}, không
// có chỗ nhét chat_history), nên bước TRẢ LỜI CUỐI sẽ không "thấy" lịch sử chat nữa -
// chỉ bước rephraseChain (viết lại câu hỏi) là còn dùng chat_history.
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
// 4. Dựng retriever + 2 chain: 1 chain viết lại câu hỏi, 1 chain trả lời dựa trên
//    document tìm được.
//
// chainType mặc định "stuff", có thể đổi thành:
// - "stuff": nhét hết document vào 1 prompt - nhanh, rẻ.
// - "map_reduce": tóm tắt từng document rồi gộp - xử lý được nhiều document hơn.
// - "refine": tinh chỉnh câu trả lời dần qua từng document - mạch tốt nhất nhưng chậm.
async function loadDb(file, k, chainType = "stuff") {
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

  // answerChain: nhét document tìm được vào prompt mặc định sẵn của loadQAChain (theo
  // đúng chainType đã chọn) để LLM trả lời câu hỏi gốc.
  const answerChain = loadQAChain(llm, { type: chainType });

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

  // loadQAChain cố định tên 2 key đầu vào là input_documents/question, và luôn trả về
  // object có key "text" (không phải string trực tiếp như answerChain.invoke() ở file 06).
  const result = await answerChain.invoke({
    input_documents: sourceDocuments,
    question: query,
  });

  return { answer: result.text, generatedQuestion, sourceDocuments };
}

async function main() {
  console.log(`Đang load database từ: ${loadedFile}`);
  // Tham số thứ 3 là chainType, mặc định "stuff". Đổi thành "map_reduce" hoặc
  // "refine" ở đây nếu muốn thử cách gộp document khác (xem giải thích ở loadDb()).
  const qa = await loadDb(loadedFile, 4, "stuff");
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
