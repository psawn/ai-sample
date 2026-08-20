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
const { embedChunksSafely } = require("../retrieval/util-embed-safely");

// Cách LangChain hiện khuyến nghị để làm chatbot có nhớ hội thoại - thay cho class
// ConversationalRetrievalChain cũ (đã bị đánh dấu deprecated) - bằng cách ghép 2 chain nhỏ:
// 1. historyAwareRetriever: chỉ dùng lịch sử chat để "hiểu" câu hỏi tiếp theo đang nói
//    về cái gì, rồi mới đi tìm document (xem 04-limitations.js để thấy rõ vấn đề
//    khi KHÔNG có bước này: hỏi tiếp không có ngữ cảnh sẽ lạc đề).
// 2. qaChain: trả lời dựa trên document tìm được + câu hỏi GỐC (chưa viết lại) + lịch sử
//    chat - dùng thẳng lịch sử chat ở đây (thay vì câu đã viết lại) để câu trả lời tự
//    nhiên, đúng mạch hội thoại hơn.

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

// Xây vectorDB dùng chung cho cả cuộc hội thoại bên dưới:
// 1. Load cả 3 file PDF bài giảng.
// 2. Gộp lại thành 1 danh sách document.
// 3. Split thành chunk.
// 4. Embed toàn bộ chunk.
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

  // Embed từng chunk an toàn (tự retry khi lỗi) rồi mới đưa vào vectorstore.
  // Xem lý do trong util-embed-safely.js.
  const vectors = await embedChunksSafely(embeddings, splits);
  const vectordb = await MemoryVectorStore.fromExistingIndex(embeddings);
  await vectordb.addVectors(vectors, splits);
  return vectordb;
}

async function main() {
  const vectordb = await buildVectorDb();
  const retriever = vectordb.asRetriever({ k: 4 });

  // Prompt này giúp AI "hiểu" câu hỏi đang nói về điều gì, bằng cách viết lại nó thành 1
  // câu hỏi rõ nghĩa, không cần biết các câu hỏi trước đó. LangChain gọi bước này là
  // "contextualize question" (đặt câu hỏi vào đúng ngữ cảnh), kết quả trả về là
  // "Standalone Question" (câu hỏi độc lập, tự đủ nghĩa).
  // Cấu trúc prompt theo thứ tự:
  // 1. system: hướng dẫn.
  // 2. chat_history: lịch sử chat.
  // 3. human: câu hỏi mới.
  // Ví dụ: "why are those needed?" ("those" mơ hồ -> cần ngữ cảnh mới hiểu) + chat_history
  // đang nói về "probability" -> viết lại thành "why is probability needed?" (đã rõ nghĩa).
  const rephrasePrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Given a chat history and the latest user question which might reference context in the chat history, formulate a standalone question which can be understood without the chat history. Do NOT answer the question, just reformulate it if needed and otherwise return it as is.",
    ],
    // Dùng MessagesPlaceholder("chat_history") thay vì string template vì lịch sử chat
    // là một mảng các đối tượng tin nhắn (HumanMessage, AIMessage), không phải chuỗi thuần túy.
    // Giúp tiêm danh sách tin nhắn vào đúng vị trí mà không làm mất cấu trúc định danh người nói.
    // Nhờ đó, Gemini nhận được một danh sách rõ ràng:
    //   [Human] Câu hỏi cũ
    //   [AI] Câu trả lời cũ
    //   [Human] Câu hỏi mới ({input})
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);

  // Tạo retriever thông minh
  // - chat_history rỗng: chuyển thẳng {input} gốc cho retriever -> KHÔNG gọi LLM để viết lại câu hỏi
  // - chat_history có dữ liệu: gọi LLM với rephrasePrompt -> viết lại {input} thành
  //   câu hỏi standalone, rồi đưa cho retriever
  const historyAwareRetriever = await createHistoryAwareRetriever({
    llm,
    retriever,
    rephrasePrompt,
  });

  // Prompt trả lời: vẫn có {context} (document tìm được) và {input} (câu hỏi
  // GỐC, chưa viết lại) như các bài trước, thêm chat_history để LLM trả lời
  // tự nhiên, đúng mạch hội thoại.
  const qaPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer. Use three sentences maximum. Keep the answer as concise as possible. Always say \"thanks for asking!\" at the end of the answer.\n\n{context}",
    ],
    // Tương tự rephrasePrompt ở trên: dùng MessagesPlaceholder chứ không phải
    // "{chat_history}" dạng chuỗi.
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);
  const questionAnswerChain = await createStuffDocumentsChain({
    llm,
    prompt: qaPrompt,
  });

  // Nối 2 chain lại: historyAwareRetriever tìm document -> questionAnswerChain trả lời.
  const ragChain = await createRetrievalChain({
    retriever: historyAwareRetriever,
    combineDocsChain: questionAnswerChain,
  });

  // Callback để log ra câu hỏi mà historyAwareRetriever thực sự gửi cho retriever đi
  // tìm tài liệu - tức là câu hỏi SAU khi đã qua bước viết lại (rephrase) dựa vào
  // chat_history. Nhờ log này thấy rõ đoạn "biến đổi": câu hỏi mơ hồ ("those...") ->
  // câu hỏi độc lập, đã có đủ ngữ cảnh.
  const logRephraseCallback = {
    handleRetrieverStart: (_retriever, query) => {
      console.log("  -> Câu hỏi dùng để tìm tài liệu:", query);
    },
  };

  // Lịch sử hội thoại lưu tay trong RAM, giống cách làm ở memory/03-all-history.js.
  // Đây là cách quản lý chat_history TỰ TAY - xem so sánh với cách TỰ ĐỘNG ở
  // ../chat-history-manual-vs-auto.js.
  const chatHistory = [];

  const question1 = "Is probability a class topic?";
  console.log("Q1:", question1);
  const result1 = await ragChain.invoke(
    { input: question1, chat_history: chatHistory },
    { callbacks: [logRephraseCallback] }
  );
  console.log("A1:", result1.answer);

  // Lưu lại câu hỏi + câu trả lời vừa rồi vào lịch sử, để dùng cho câu hỏi tiếp theo.
  chatHistory.push(new HumanMessage(question1), new AIMessage(result1.answer));

  // Câu hỏi này có "those" mơ hồ. Nhờ historyAwareRetriever viết lại câu hỏi dựa vào
  // chatHistory ở trên, retriever vẫn tìm đúng chunk liên quan tới "probability" - khác
  // với khi KHÔNG có bước này (xem 04-limitations.js: cùng 2 câu hỏi này nhưng chạy qua
  // RetrievalQA không có contextualize/memory, câu trả lời 2 thường lạc đề).
  const question2 = "why are those prerequesites needed?";
  console.log("\nQ2:", question2);
  const result2 = await ragChain.invoke(
    { input: question2, chat_history: chatHistory },
    { callbacks: [logRephraseCallback] }
  );
  console.log("A2:", result2.answer);
}

main();
