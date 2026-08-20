// Lesson 2: LangGraph Components
//
// Cùng bài toán Agent + Tool như ../agent-from-scratch/03-native-tool-calling-manual-messages.js,
// nhưng thay vì tự viết vòng lặp for (gọi model -> chạy tool nếu cần -> lặp lại), ở đây mô
// tả vòng lặp đó thành 1 GRAPH (đồ thị: node nào nối node nào) rồi để LangGraph tự chạy.
require("../_polyfill");

const { StateGraph, END, MessagesAnnotation } = require("@langchain/langgraph");
const { SystemMessage, ToolMessage } = require("@langchain/core/messages");

// AgentState: "bộ nhớ" được truyền qua lại giữa các Node trong graph.
//
// MessagesAnnotation là 1 State dựng sẵn của LangGraph, có đúng 1 field "messages" với cơ
// chế NỐI THÊM (không ghi đè) mỗi khi 1 Node trả về messages mới - dùng lại luôn, không
// cần tự định nghĩa Annotation từ đầu.
const AgentState = MessagesAnnotation;

// Cắt bớt + thụt lề nội dung log cho dễ đọc, để log kết quả tool không lẫn với log của
// model ở dòng trên/dưới.
function formatToolResult(text, maxLength = 500) {
  const str = String(text);
  const truncated = str.length > maxLength ? `${str.slice(0, maxLength)}...` : str;
  return truncated
    .split("\n")
    .map((line) => `       ${line}`)
    .join("\n");
}

class Agent {
  constructor(model, tools, system = "") {
    this.system = system;
    this.tools = Object.fromEntries(tools.map((t) => [t.name, t]));
    // bindTools(): gắn danh sách Tool vào model để model biết có gì để gọi.
    this.model = model.bindTools(tools);

    // Graph có 2 Node: "llm" (gọi model) và "action" (chạy tool). Luồng chạy:
    //
    //   bắt đầu -> llm -> có tool_calls? --có--> action --+
    //                        |                            |
    //                      không                (quay lại llm, lặp tiếp)
    //                        |
    //                     kết thúc
    const graph = new StateGraph(AgentState);

    // 1. Khai báo 2 Node - mỗi Node là 1 hàm nhận state, trả về phần state cần cập nhật.
    //
    //    .bind(this): callModel/takeAction/existsAction dùng this.model, this.tools,...
    //    nhưng ở đây chỉ đưa "tên hàm" cho LangGraph (không gọi luôn) - khi LangGraph tự
    //    gọi lại hàm sau này, hàm mất kết nối với instance Agent nên this sẽ bị undefined.
    //    bind(this) gắn cứng this vào hàm để tránh việc đó.
    graph.addNode("llm", this.callModel.bind(this));
    graph.addNode("action", this.takeAction.bind(this));

    // 2. Graph bắt đầu chạy từ Node "llm".
    //    "__start__" là tên node đặc biệt LangGraph hiểu là điểm bắt đầu - cũng là giá trị
    //    của hằng số START (import từ "@langchain/langgraph"), dùng thay cho chuỗi này cũng được.
    graph.addEdge("__start__", "llm");

    // 3. Sau Node "llm", gọi existsAction(state) để biết đi đâu tiếp. Kết quả trả về
    //    ("true"/"false") được tra vào object bên dưới để chọn Node kế tiếp:
    graph.addConditionalEdges("llm", this.existsAction.bind(this), {
      true: "action", // model muốn gọi tool -> chạy tool
      false: END, // model đã trả lời xong -> dừng graph
    });

    // 4. Sau khi Node "action" chạy tool xong, luôn quay lại Node "llm" để model đọc kết
    //    quả tool và quyết định bước tiếp theo.
    graph.addEdge("action", "llm");

    // compile(): chốt graph thành dạng chạy được (gọi được .invoke()).
    this.graph = graph.compile();
  }

  // Kiểm tra tin nhắn cuối cùng có yêu cầu gọi Tool hay không.
  // Trả về STRING "true"/"false" (không phải boolean) vì key của object JS luôn là string -
  // phải khớp đúng kiểu với key trong addConditionalEdges phía trên.
  existsAction(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    const hasToolCalls = Boolean(lastMessage.tool_calls?.length);
    console.log(
      hasToolCalls
        ? `[Rẽ nhánh]       có tool_calls (model cần dùng tool) -> đi tới Node "action"`
        : `[Rẽ nhánh]       không có tool_calls -> DỪNG (đây là câu trả lời cuối)`,
    );
    return hasToolCalls ? "true" : "false";
  }

  // Node "llm": gọi model với toàn bộ lịch sử messages (kèm system prompt nếu có).
  // LangGraph tự NỐI message trả về vào state.messages (nhờ MessagesAnnotation) - không
  // cần tự push() bằng tay.
  async callModel(state) {
    console.log(
      `\n[Node "llm"]     đang gửi ${state.messages.length} message (toàn bộ hội thoại + kết quả tool nếu có) cho model...`,
    );

    let messages = state.messages;
    if (this.system) {
      messages = [new SystemMessage(this.system), ...messages];
    }
    const message = await this.model.invoke(messages);

    if (message.tool_calls?.length) {
      const names = message.tool_calls.map((c) => c.name).join(", ");
      console.log(`[Node "llm"]     -> model quyết định: cần gọi tool "${names}" trước khi trả lời`);
    } else {
      console.log(`[Node "llm"]     -> model quyết định: đủ thông tin để trả lời, không cần tool`);
    }

    return { messages: [message] };
  }

  // Node "action": đọc tool_calls của message cuối, chạy từng Tool tương ứng.
  //
  // Có xử lý riêng trường hợp model gọi nhầm tên Tool không tồn tại (model vẫn có thể đoán
  // sai tên dù dùng Tool Calling chuẩn) - thay vì crash, trả về 1 ToolMessage báo lỗi để
  // model tự đọc và thử lại.
  async takeAction(state) {
    const toolCalls = state.messages[state.messages.length - 1].tool_calls;
    console.log(`\n[Node "action"]  model vừa yêu cầu ${toolCalls.length} tool, đang chạy lần lượt...`);
    const results = [];

    for (const call of toolCalls) {
      console.log(`  -> đang gọi: ${call.name}(${JSON.stringify(call.args)})`);

      if (!this.tools[call.name]) {
        console.log(`  -> LỖI: tool "${call.name}" không tồn tại (model đoán nhầm tên tool)`);
        // Tool này không tồn tại nên không gọi tool.invoke() được - phải tự dựng
        // ToolMessage báo lỗi bằng tay (bình thường tool.invoke(call) tự làm việc này).
        results.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: "bad tool name, retry",
          }),
        );
        continue;
      }

      // tool.invoke(call): truyền cả object tool_call (có id) - tool tự trả về 1
      // ToolMessage đúng chuẩn, chỉ việc push vào results.
      const toolMessage = await this.tools[call.name].invoke(call);
      console.log(`  -> tool "${call.name}" trả về:`);
      console.log(formatToolResult(toolMessage.content));
      results.push(toolMessage);
    }

    console.log(
      `[Node "action"]  đã có kết quả -> quay lại Node "llm" để model đọc và trả lời tiếp`,
    );
    return { messages: results };
  }
}

module.exports = { Agent, AgentState };
