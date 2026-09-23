// =======================================================================
// LANGGRAPH - AGENT DỰNG BẰNG TAY (DÙNG CHUNG CHO CÁC BÀI *-manual-graph.js)
//
// Agent ReAct dựng bằng StateGraph: gọi LLM -> chạy tool -> lặp lại.
// LangGraph lo phần state và vòng lặp, code chỉ khai báo node và edge.
//
// Luồng chạy (2 node):
//   1. START -> llm: gọi Model.
//   2. llm có tool_calls -> action: chạy tool, rồi quay lại bước 1.
//   3. llm không có tool_calls -> END.
// =======================================================================

require("../_polyfill");

const { StateGraph, END, MessagesAnnotation } = require("@langchain/langgraph");
const { SystemMessage, ToolMessage } = require("@langchain/core/messages");

// State: dữ liệu chung, các node cùng đọc và ghi.
// MessagesAnnotation là state dựng sẵn, chỉ có 1 field "messages".
// Node return { messages: [...] } -> được nối thêm vào mảng messages chung.
const AgentState = MessagesAnnotation;

// Format kết quả tool để log: cắt bớt nếu quá dài, thụt lề từng dòng.
function formatToolResult(text, maxLength = 500) {
  const str = String(text);
  const truncated =
    str.length > maxLength ? `${str.slice(0, maxLength)}...` : str;
  return truncated
    .split("\n")
    .map((line) => `       ${line}`)
    .join("\n");
}

// Agent = Model + Tools + system prompt, tất cả chạy trong 1 Graph.
class Agent {
  constructor(model, tools, system = "") {
    this.system = system;
    this.tools = Object.fromEntries(tools.map((t) => [t.name, t]));
    // bindTools(): cho Model biết có những tool nào để gọi.
    this.model = model.bindTools(tools);

    const graph = new StateGraph(AgentState);

    // 1. Đăng ký node. Chưa chạy ngay: khi .invoke(), LangGraph mới gọi và truyền state.
    //    .bind(this): không bind thì `this` bên trong là undefined -> lỗi this.model.
    graph.addNode("llm", this.callModel.bind(this));
    graph.addNode("action", this.takeAction.bind(this));

    // 2. Điểm bắt đầu: luôn vào "llm" trước.
    //    addEdge(from, to): nối thẳng, không điều kiện.
    graph.addEdge("__start__", "llm");

    // 3. Rẽ nhánh sau "llm": existsAction(state) kiểm tra có tool_calls không.
    //    - "true"  -> "action" chạy tool.
    //    - "false" -> END.
    //    Key là string vì key object JS luôn là string, khớp với giá trị existsAction() trả về.
    graph.addConditionalEdges("llm", this.existsAction.bind(this), {
      true: "action",
      false: END,
    });

    // 4. Vòng lặp: "action" xong luôn quay về "llm" để Model đọc kết quả tool.
    graph.addEdge("action", "llm");

    // Biên dịch thành graph gọi được .invoke() / .stream().
    this.graph = graph.compile();
  }

  // Rẽ nhánh: message mới nhất của Model có yêu cầu gọi tool không?
  // LangGraph tự gọi hàm này và truyền state hiện tại.
  existsAction(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    const hasToolCalls = Boolean(lastMessage.tool_calls?.length);

    console.log(
      hasToolCalls
        ? `[Rẽ nhánh]       Model yêu cầu dùng Tool -> Sang Node "action"`
        : `[Rẽ nhánh]       Model không dùng Tool -> DỪNG (Hoàn tất)`,
    );

    return hasToolCalls ? "true" : "false";
  }

  // Node "llm": thêm system prompt vào đầu lịch sử messages, rồi gọi Model.
  async callModel(state) {
    console.log(
      `\n[Node "llm"]     Đang gửi ${state.messages.length} message cho Model...`,
    );

    let messages = state.messages;
    if (this.system) {
      messages = [new SystemMessage(this.system), ...messages];
    }
    const message = await this.model.invoke(messages);

    if (message.tool_calls?.length) {
      const names = message.tool_calls.map((c) => c.name).join(", ");
      console.log(`[Node "llm"]     -> Model quyết định gọi Tool: "${names}"`);
    } else {
      console.log(
        `[Node "llm"]     -> Model quyết định trả lời trực tiếp (không dùng Tool)`,
      );
    }

    // Trả về message mới -> LangGraph nối thêm vào state.messages.
    return { messages: [message] };
  }

  // Node "action": chạy lần lượt từng tool_call trong message cuối.
  async takeAction(state) {
    const toolCalls = state.messages[state.messages.length - 1].tool_calls;
    console.log(
      `\n[Node "action"]  Model yêu cầu ${toolCalls.length} Tool, đang thực thi...`,
    );
    const results = [];

    for (const call of toolCalls) {
      console.log(`  -> Đang gọi: ${call.name}(${JSON.stringify(call.args)})`);

      // Model gọi tên tool không tồn tại -> báo lại để Model thử lại.
      if (!this.tools[call.name]) {
        console.log(
          `  -> LỖI: Tool "${call.name}" không tồn tại trong hệ thống`,
        );
        results.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: "bad tool name, retry",
          }),
        );
        continue;
      }

      // invoke(call) với cả tool_call -> tool trả về ToolMessage (có sẵn tool_call_id).
      const toolMessage = await this.tools[call.name].invoke(call);
      console.log(`  -> Tool "${call.name}" trả về:`);
      console.log(formatToolResult(toolMessage.content));
      results.push(toolMessage);
    }

    console.log(
      `[Node "action"]  Hoàn thành -> Quay lại Node "llm" để Model đọc kết quả`,
    );

    // Trả về mảng ToolMessage -> LangGraph nối thêm vào state.messages.
    return { messages: results };
  }
}

module.exports = { Agent, AgentState };
