// =======================================================================
// EMAIL ASSISTANT - CÁC TOOL XỬ LÝ EMAIL / LỊCH HỌP
//
// 3 tool cho agent: gửi email, đặt lịch họp, xem lịch trống.
// Tool cho LLM hành động, thay vì chỉ trả lời bằng văn bản.
// LLM chọn tool và điền tham số dựa vào description + schema,
// nên mô tả càng rõ thì chọn và điền càng đúng.
//
// Tool chỉ trả về chuỗi giả lập, chưa gửi mail hay đặt lịch thật.
// =======================================================================

require("../_polyfill");

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");

// Gửi email: người nhận, tiêu đề, nội dung.
const writeEmail = tool(
  ({ to, subject, content }) => {
    return `Email sent to ${to} with subject '${subject}'`;
  },
  {
    name: "write_email",
    description: "Write and send an email.",
    schema: z.object({
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject line"),
      content: z.string().describe("Email body content"),
    }),
  },
);

// Đặt lịch họp: người dự, chủ đề, thời lượng, ngày mong muốn.
const scheduleMeeting = tool(
  ({ attendees, subject, durationMinutes, preferredDay }) => {
    return `Meeting '${subject}' scheduled for ${preferredDay} with ${attendees.length} attendees`;
  },
  {
    name: "schedule_meeting",
    description: "Schedule a calendar meeting.",
    schema: z.object({
      attendees: z.array(z.string()).describe("List of attendee email addresses"),
      subject: z.string().describe("Meeting subject"),
      durationMinutes: z.number().describe("Meeting duration in minutes"),
      preferredDay: z.string().describe("Preferred day for the meeting"),
    }),
  },
);

// Xem lịch trống của 1 ngày. Luôn trả về 3 khung giờ giả lập.
const checkCalendarAvailability = tool(
  ({ day }) => {
    return `Available times on ${day}: 9:00 AM, 2:00 PM, 4:00 PM`;
  },
  {
    name: "check_calendar_availability",
    description: "Check calendar availability for a given day.",
    schema: z.object({
      day: z.string().describe("Day to check availability for"),
    }),
  },
);

module.exports = { writeEmail, scheduleMeeting, checkCalendarAvailability };
