// Agent tạm dừng trước khi chạy Tool (Human-in-the-Loop)
//
// Mục tiêu:
// - Giống hệt Agent ở agent-with-memory.js, chỉ thêm `interruptBefore: ["action"]` khi compile Graph.
// - Giúp Graph tạm dừng ngay trước Node "action" mỗi khi Model muốn gọi Tool,
//   chờ người dùng xác nhận hoặc sửa state rồi mới chạy tiếp.
//
// Lưu ý về MessagesAnnotation:
// - Tự động ghi đè Message nếu trùng `id`, hoặc nối thêm nếu `id` mới.
// - Đúng cơ chế cần thiết để sửa `tool_calls` trong state mà không sợ trùng lặp message.

require("../_polyfill");

const { StateGraph, END, MessagesAnnotation } = require("@langchain/langgraph");
const { SystemMessage, ToolMessage } = require("@langchain/core/messages");

// State = "bộ nhớ chung" của Graph, nơi các Node đọc và cập nhật dữ liệu.
// MessagesAnnotation định nghĩa State (như agent.js)
const AgentState = MessagesAnnotation;

class Agent {
  constructor(model, tools, checkpointer, system = "") {
    this.system = system;
    this.tools = Object.fromEntries(tools.map((t) => [t.name, t]));
    this.model = model.bindTools(tools);

    const graph = new StateGraph(AgentState);
    graph.addNode("llm", this.callModel.bind(this));
    graph.addNode("action", this.takeAction.bind(this));
    graph.addEdge("__start__", "llm");
    graph.addConditionalEdges("llm", this.existsAction.bind(this), {
      true: "action",
      false: END,
    });
    graph.addEdge("action", "llm");

    // interruptBefore: ["action"] -> Tạm dừng Graph NGAY TRƯỚC khi vào Node "action".
    // Mỗi khi Model quyết định gọi Tool, Graph sẽ dừng lại để chờ xác nhận từ người dùng.
    // Cơ chế này áp dụng cho TẤT CẢ các lần gọi Tool (kể cả khi Model gọi Tool liên tiếp).
    //
    // 💡 Dự án Production:
    // - NÊN DÙNG khi Tool có rủi ro/khó đảo ngược (xóa file, chuyển tiền, gửi email...)
    //   hoặc cần tuân thủ quy trình kiểm duyệt (Audit/Compliance).
    // - KHÔNG NÊN DÙNG cho Tool chỉ đọc (web_search, tra DB...) vì làm chậm luồng và treo Agent.
    // - Muốn chặn CHỌN LỌC từng Tool thay vì chặn tất cả, xem `humanInTheLoopMiddleware` 
    //   tại file 04-human-approval-create-agent.js.
    this.graph = graph.compile({ checkpointer, interruptBefore: ["action"] });
  }

  // Kiểm tra xem Message cuối cùng từ Model có chứa tool_calls hay không
  existsAction(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    return lastMessage.tool_calls?.length ? "true" : "false";
  }

  async callModel(state) {
    let messages = state.messages;
    if (this.system) {
      messages = [new SystemMessage(this.system), ...messages];
    }
    const message = await this.model.invoke(messages);
    return { messages: [message] };
  }

  async takeAction(state) {
    const toolCalls = state.messages[state.messages.length - 1].tool_calls;
    const results = [];

    for (const call of toolCalls) {
      console.log(`  -> Đang gọi: ${call.name}(${JSON.stringify(call.args)})`);

      if (!this.tools[call.name]) {
        results.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: "bad tool name, retry",
          }),
        );
        continue;
      }

      const toolMessage = await this.tools[call.name].invoke(call);
      results.push(toolMessage);
    }

    console.log('  -> Quay lại Node "llm" để Model đọc kết quả');
    return { messages: results };
  }
}

module.exports = { Agent, AgentState };
