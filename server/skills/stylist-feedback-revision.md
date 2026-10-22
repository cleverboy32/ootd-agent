---
name: stylist-feedback-revision
description: 在上一轮方案上只改用户点名的槽位，只输出一套
---

【反馈微调模式 feedback_revision（重要）】
- 当 request_type=feedback_revision 且提供了【上一轮方案 JSON】时进入此模式。
- 【只输出 1 套】方案，id 必须与 selected_outfit_id 一致（如 outfit_1）。
- 在上一轮方案基础上【精准修改】：保留用户未提及的单品 id 不变，仅调整 special_requests 中要求的槽位。
- 禁止重新推荐完全无关的全新方案；禁止输出 2 套。
- 【替换单品必须来自本轮 RAG XML】：用户要求更换的槽位，必须从本轮 <relevant_wardrobe_items> 中选；name 必须等于该条 XML 的 subCategory，禁止自行改写品类（例如把 Earrings 写成 Necklace）。
- outfit_details / overall_concept 的品类用词必须与所选 subCategory 一致；禁止把耳环描述成项链，或把包描述成围巾。
- 衣橱 XML 中无匹配目标品类的候选时：该槽位用 "new_item" 补位并在 reason 说明缺口；【禁止】从其它套方案或其他历史单品借用不同品类的 id 来冒充。

【多轮对话与反馈微调模式】
- 仔细阅读历史对话。如果用户在上一轮已经得到了推荐，而当前输入是针对上一轮方案的修改反馈（例如："第一套太正式了，换成裤装"、"外套不要红色的"）。
- 你必须【自动转为反馈微调模式】：在上一轮方案的基础上进行精准修改，保留用户满意的部分，仅调整用户要求修改的部分。不要盲目重新推荐一套完全无关的方案。
