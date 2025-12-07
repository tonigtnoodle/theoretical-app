<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1hkvMPdmxtQHhpJnM-G-Q-J9Ll5CWxfTM

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
# AI 智能刷题助手

这是一个基于 Google Gemini 的历史刷题工具，可以：
- 从 PDF/Word 试题中自动抽取题目
- 生成练习试卷（选择题）
- 记录刷题历史与正确率

在线体验地址：[https://llznew.netlify.app](https://theoretical-app.vercel.app/)
所有的信息均存储在用户本地，不用担心api key等隐私信息泄露
