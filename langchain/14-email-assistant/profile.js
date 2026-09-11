// Dữ liệu dùng chung cho cả 3 file demo trong bài: hồ sơ người dùng (để LLM biết đang
// hỗ trợ ai) + quy tắc phân loại email (để LLM biết email nào bỏ qua/thông báo/trả lời)
// + 2 email mẫu để test.

const profile = {
  name: "John",
  fullName: "John Doe",
  userProfileBackground:
    "Senior software engineer leading a team of 5 developers",
};

// Các quy tắc này sẽ được nhét vào system prompt của LLM phân loại (triage) - LLM đọc
// mô tả bằng ngôn ngữ tự nhiên này để quyết định xếp email vào nhóm nào.
const triageRules = {
  ignore: "Marketing newsletters, spam emails, mass company announcements",
  notify:
    "Team member out sick, build system notifications, project status updates",
  respond:
    "Direct questions from team members, meeting requests, critical bug reports",
};

// Cố tình để chỉ dẫn chung chung để thấy agent có thể dùng Tool quá tay.
// Với questionEmail, agent có thể tự gọi schedule_meeting dù câu hỏi có thể
// trả lời trực tiếp qua email. Đây không phải lỗi code mà do prompt chưa đủ ràng buộc.
//
// Muốn agent ưu tiên trả lời email, cần thêm rule rõ ràng, ví dụ:
// "Prefer answering directly via write_email; only use schedule_meeting when the
// sender explicitly asks for a meeting or the issue cannot be resolved by email alone."
const agentInstructions =
  "Use these tools when appropriate to help manage John's tasks efficiently.";

// Email cần LLM trả lời (câu hỏi trực tiếp từ đồng nghiệp).
const questionEmail = {
  author: "Alice Smith <alice.smith@company.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "Quick question about API documentation",
  emailThread: `Hi John,

I was reviewing the API documentation for the new authentication service and noticed a few endpoints seem to be missing from the specs. Could you help clarify if this was intentional or if we should update the docs?

Specifically, I'm looking at:
- /auth/refresh
- /auth/validate

Thanks!
Alice`,
};

// Email nên bị LLM lọc bỏ (spam quảng cáo, không đáng trả lời).
const spamEmail = {
  author: "Marketing Team <marketing@amazingdeals.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "🔥 EXCLUSIVE OFFER: Limited Time Discount on Developer Tools! 🔥",
  emailThread: `Dear Valued Developer,

Don't miss out on this INCREDIBLE opportunity!

For a LIMITED TIME ONLY, get 80% OFF on our Premium Developer Suite!

Regular Price: $999/month
YOUR SPECIAL PRICE: Just $199/month!

Click here to claim your discount: https://amazingdeals.com/special-offer

Best regards,
Marketing Team
---
To unsubscribe, click here`,
};

module.exports = {
  profile,
  triageRules,
  agentInstructions,
  questionEmail,
  spamEmail,
};
