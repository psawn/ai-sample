// =======================================================================
// DEMO: REFLECTION AGENT BẰNG LANGGRAPH
//
// Ý tưởng: LLM tự viết tweet -> tự góp ý -> viết lại, lặp vài vòng để tốt dần.
//
//   START -> generate --(> 6 messages)--> END
//               ↑  |
//               |  +--(còn lại)--> reflect
//               |                    |
//               +--------------------+
//
// - generate: viết tweet (từ lượt 2 thì sửa theo góp ý).
// - reflect: đóng vai người chấm, góp ý cho tweet vừa viết.
//
// Mọi thứ lưu chung trong `messages`, theo thứ tự:
//   Human: yêu cầu -> AI: tweet 1 -> Human: góp ý 1 -> AI: tweet 2 -> ...
//
// "Reflection" là design pattern, nơi hệ thống sử dụng một bước "tự phản biện" (self-reflection) 
// hoặc một agent đóng vai trò như giám khảo (judge) để đánh giá câu trả lời 
// hoặc kết quả truy xuất của mô hình chính trước khi trả về cho người dùng
// =======================================================================

require("../langchain/_polyfill");
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");
const {
  ChatPromptTemplate,
  MessagesPlaceholder,
} = require("@langchain/core/prompts");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} = require("@langchain/langgraph");

// ===== 1. PROMPTS =====

// Prompt Reviewer: Đánh giá & góp ý chi tiết; KHÔNG tự viết lại tweet.
const reflectionPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "You are a viral twitter influencer grading a tweet. " +
      "Generate critique and recommendations for the user's tweet. " +
      "Always provide detailed recommendations, including requests for " +
      "length, virality, style, etc. " +
      "Do not write a new version of the tweet yourself.",
  ],
  new MessagesPlaceholder("messages"),
]);

// Prompt Creator: Viết tweet tối ưu nhất; sửa theo góp ý nếu có.
// Chỉ trả về duy nhất nội dung tweet, không giải thích thêm.
const generationPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "You are a twitter techie influencer assistant tasked with writing " +
      "excellent twitter posts. " +
      "Generate the best twitter post possible for the user's request. " +
      "If the user provides critique, respond with a revised version " +
      "of your previous attempts. " +
      "Respond only with the tweet itself, without options or explanations.",
  ],
  new MessagesPlaceholder("messages"),
]);

// ===== 2. LLM & CHAINS =====

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
});

const generateChain = generationPrompt.pipe(llm);
const reflectChain = reflectionPrompt.pipe(llm);

// ===== 3. NODES =====

// Tên node, dùng lại khi dựng graph.
const GENERATE = "generate";
const REFLECT = "reflect";

// Node Viết: Nhận lịch sử, sinh tweet mới (AIMessage).
// LangGraph sẽ tự động nối message trả về vào reducer state.
async function generationNode(state) {
  const response = await generateChain.invoke({
    messages: state.messages,
  });

  return {
    messages: [response],
  };
}

// Node Phản biện: lý do cần swap AIMessage và HumanMessage
//
// 1. DIỄN BIẾN LỊCH SỬ THỰC TẾ TRONG STATE:
//    - Human: "Hãy viết tweet"
//    - AI   : "Tweet 1"
//    - Human: "Đây là góp ý 1"
//    - AI   : "Tweet 2"  <-- Message mới nhất khi vào reflectionNode
//
// 2. BẢN CHẤT VẤN ĐỀ VỚI GEMINI
//    Khi nhận chuỗi hội thoại trên, Gemini thấy tin nhắn mới nhất là AIMessage ("Tweet 2").
//    LLM sẽ hiểu rằng: "Đây là câu trả lời do CHÍNH MÌNH vừa đưa ra."
//    Vì coi đó là đầu ra của chính nó chứ không phải yêu cầu từ người dùng,
//    Gemini thường sẽ bỏ qua, không chịu đánh giá lại, hoặc trả về phản hồi rỗng.
//
// 3. GIẢI PHÁP SWAP VAI (ĐỔI GÓC NHÌN):
//    - Bỏ prompt gốc ("Hãy viết tweet") vì đó không phải đối tượng cần review.
//    - Đổi toàn bộ AI -> Human và Human -> AI.
//
//    Lúc này, "Tweet 2" (AIMessage) được biến thành HumanMessage.
//    Gemini sẽ hiểu rằng đây là bài viết do NGƯỜI DÙNG gửi lên,
//    từ đó kích hoạt đúng vai trò Reviewer để soi lỗi và đưa ra góp ý.
//
async function reflectionNode(state) {
  // Bỏ message đầu (prompt gốc của người dùng) do không phải tweet cần review.
  const [, ...rest] = state.messages;

  // Đổi vai: AI -> Human, Human -> AI
  const swapped = rest.map((message) =>
    AIMessage.isInstance(message)
      ? new HumanMessage(message.content)
      : new AIMessage(message.content),
  );

  const response = await reflectChain.invoke({
    messages: swapped,
  });

  // Lưu góp ý với vai Human,
  // để GENERATE hiểu đây là feedback cần dùng.
  return {
    messages: [new HumanMessage(response.content)],
  };
}

// ===== 4. ĐIỀU KIỆN DỪNG =====

// Điều kiện dừng: Chạy sau node GENERATE.
// Dừng lại (END) khi số message vượt quá 6 (khoảng 3 vòng lặp), ngược lại chuyển sang REFLECT.
function shouldContinue(state) {
  if (state.messages.length > 6) {
    return END;
  }

  return REFLECT;
}

// Dựng đồ thị
const graph = new StateGraph(MessagesAnnotation)
  .addNode(GENERATE, generationNode)
  .addNode(REFLECT, reflectionNode)

  // Bắt đầu bằng việc sinh tweet
  .addEdge(START, GENERATE)

  // Viết xong thì shouldContinue quyết định:
  // tiếp tục phản biện (REFLECT) hay dừng (END).
  // [REFLECT, END]: các đích có thể đi tới.
  .addConditionalEdges(GENERATE, shouldContinue, [REFLECT, END])

  // Lặp lại: Phản biện xong quay lại sửa tweet
  .addEdge(REFLECT, GENERATE)
  .compile();

// ===== 5. THỰC THI =====

async function main() {
  // Xuất sơ đồ graph ra images/<tên file>-flow.png
  const graphView = await graph.getGraphAsync();
  const image = await graphView.drawMermaidPng();
  const imagePath = path.join(
    __dirname,
    "../images",
    `${path.basename(__filename, ".js")}-flow.png`,
  );
  fs.writeFileSync(imagePath, Buffer.from(await image.arrayBuffer()));

  const inputs = {
    messages: [
      new HumanMessage(`Make this tweet better:

@LangChainAI
— newly Tool Calling feature is seriously underrated.

After a long wait, it's here - making the implementation of agents
across different models with function calling super easy.

Made a video covering their newest blog post`),
    ],
  };

  // Toàn bộ lịch sử các bản tweet + góp ý.
  const response = await graph.invoke(inputs);

  console.log(response);
}

main();
