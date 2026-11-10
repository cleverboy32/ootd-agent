#!/usr/bin/env python3
"""Generate OOTD-Agent pitch deck for Jinniu competition."""

from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
PUBLIC = ROOT.parent.parent / "public"
LOGO = PUBLIC / "logo.png"
BRAND_HERO = PUBLIC / "brand-hero-gold.png"
OUT = ROOT / "OOTD-Agent-路演PPT.pptx"

# 16:9
SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)

# Palette — light, fashion, gold accent (match landing)
BG = RGBColor(0xFA, 0xF8, 0xF5)
CARD = RGBColor(0xFF, 0xFF, 0xFF)
INK = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x6B, 0x65, 0x5E)
LINE = RGBColor(0xE8, 0xE2, 0xDA)
GOLD = RGBColor(0xC4, 0x9A, 0x3C)
GOLD_SOFT = RGBColor(0xF3, 0xE7, 0xC9)
DARK = RGBColor(0x2A, 0x26, 0x22)


def set_run(run, *, size=18, bold=False, color=INK, font="Microsoft YaHei"):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font
    rPr = run._r.get_or_add_rPr()
    ea = rPr.get_or_add_ea() if hasattr(rPr, "get_or_add_ea") else None
    # east asian font
    for tag in ("ea", "cs"):
        el = rPr.find(qn(f"a:{tag}"))
        if el is None:
            el = rPr.makeelement(qn(f"a:{tag}"), {})
            rPr.append(el)
        el.set("typeface", font)


def add_fade_transition(slide) -> None:
    """Add a gentle fade slide transition (OOXML)."""
    from lxml import etree

    sld = slide._element
    for child in list(sld):
        if child.tag == qn("p:transition"):
            sld.remove(child)
    ns = "http://schemas.openxmlformats.org/presentationml/2006/main"
    transition = etree.fromstring(
        f'<p:transition xmlns:p="{ns}" spd="slow" advClick="1"><p:fade/></p:transition>'
    )
    cSld = sld.find(qn("p:cSld"))
    idx = list(sld).index(cSld) + 1
    clr = sld.find(qn("p:clrMapOvr"))
    if clr is not None:
        idx = list(sld).index(clr) + 1
    sld.insert(idx, transition)


def add_bg(slide, color=BG):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, SLIDE_W, SLIDE_H)
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()
    # send to back
    spTree = slide.shapes._spTree
    sp = shape._element
    spTree.remove(sp)
    spTree.insert(2, sp)
    return shape


def add_logo(slide, left, top, height=Inches(0.55)):
    """Place circular-ish brand logo keeping aspect ratio."""
    from PIL import Image

    with Image.open(LOGO) as im:
        w, h = im.size
    width = height * (w / h)
    return slide.shapes.add_picture(str(LOGO), left, top, width=width, height=height)


def add_rect(slide, left, top, width, height, fill=CARD, line=None):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
    return shape


def add_round(slide, left, top, width, height, fill=CARD, line=None):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.adjustments[0] = 0.08
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = Pt(1)
    return shape


def add_text(
    slide,
    left,
    top,
    width,
    height,
    text,
    *,
    size=18,
    bold=False,
    color=INK,
    align=PP_ALIGN.LEFT,
    anchor=MSO_ANCHOR.TOP,
    font="Microsoft YaHei",
):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    try:
        tf._txBody.bodyPr.set("anchor", {MSO_ANCHOR.TOP: "t", MSO_ANCHOR.MIDDLE: "ctr", MSO_ANCHOR.BOTTOM: "b"}[anchor])
    except Exception:
        pass
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    set_run(run, size=size, bold=bold, color=color, font=font)
    return box


def add_paras(
    slide,
    left,
    top,
    width,
    height,
    lines: list[tuple[str, dict]],
):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    for i, (text, style) in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = style.get("align", PP_ALIGN.LEFT)
        p.space_after = Pt(style.get("space_after", 6))
        run = p.add_run()
        run.text = text
        set_run(
            run,
            size=style.get("size", 16),
            bold=style.get("bold", False),
            color=style.get("color", INK),
        )
    return box


def footer(slide, page: int, total: int = 14):
    add_logo(slide, Inches(0.45), Inches(6.95), height=Inches(0.32))
    add_text(
        slide,
        Inches(0.95),
        Inches(7.05),
        Inches(8),
        Inches(0.3),
        "OOTD-Agent / Fashion AI  ·  金牛区 2026「蓉创未来」",
        size=11,
        color=MUTED,
    )
    add_text(
        slide,
        Inches(11.5),
        Inches(7.05),
        Inches(1.3),
        Inches(0.3),
        f"{page} / {total}",
        size=11,
        color=MUTED,
        align=PP_ALIGN.RIGHT,
    )


def accent_bar(slide):
    add_rect(slide, 0, 0, SLIDE_W, Inches(0.08), fill=GOLD)


def title_block(slide, title: str, subtitle: str | None = None):
    accent_bar(slide)
    add_logo(slide, Inches(0.5), Inches(0.28), height=Inches(0.48))
    add_text(slide, Inches(1.15), Inches(0.32), Inches(11), Inches(0.55), title, size=26, bold=True)
    if subtitle:
        add_text(slide, Inches(1.15), Inches(0.88), Inches(11), Inches(0.4), subtitle, size=14, color=MUTED)


def fit_picture(slide, path: Path, left, top, max_w, max_h):
    from PIL import Image

    with Image.open(path) as im:
        w, h = im.size
    max_w_px = max_w
    max_h_px = max_h
    # convert EMU/Inches already
    ratio = w / h
    box_ratio = max_w / max_h
    if ratio > box_ratio:
        width = max_w
        height = max_w / ratio
    else:
        height = max_h
        width = max_h * ratio
    # center in box
    x = left + (max_w - width) / 2
    y = top + (max_h - height) / 2
    return slide.shapes.add_picture(str(path), int(x), int(y), width=int(width), height=int(height))


def build():
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    blank = prs.slide_layouts[6]

    # ---------- P1 Cover ----------
    s = prs.slides.add_slide(blank)
    add_bg(s, DARK)
    add_rect(s, 0, 0, Inches(0.18), SLIDE_H, fill=GOLD)
    # product intro card on right (landing hero 右侧示意，非整页)
    cover_card = ASSETS / "cover-product-card.png"
    add_round(s, Inches(7.05), Inches(1.35), Inches(5.7), Inches(4.7), fill=CARD, line=None)
    fit_picture(s, cover_card, Inches(7.2), Inches(1.5), Inches(5.4), Inches(4.2))
    add_text(
        s,
        Inches(7.2),
        Inches(5.85),
        Inches(5.4),
        Inches(0.35),
        "产品示意：上传衣物 → 理解场景 → 生成上身效果图",
        size=11,
        color=GOLD_SOFT,
        align=PP_ALIGN.CENTER,
    )
    add_logo(s, Inches(0.75), Inches(0.9), height=Inches(0.85))
    add_text(s, Inches(1.8), Inches(1.05), Inches(5), Inches(0.5), "Fashion AI", size=18, bold=True, color=GOLD)
    add_text(s, Inches(0.8), Inches(2.1), Inches(6.5), Inches(0.4), "金牛区 2026「蓉创未来 筑梦金牛」", size=14, color=GOLD_SOFT)
    add_text(s, Inches(0.8), Inches(2.65), Inches(6.5), Inches(0.9), "OOTD-Agent", size=44, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF))
    add_text(s, Inches(0.8), Inches(3.5), Inches(6.5), Inches(0.5), "AI 私人造型师，穿衣搭配新方式", size=20, color=GOLD)
    add_text(
        s,
        Inches(0.8),
        Inches(4.3),
        Inches(6.5),
        Inches(0.8),
        "数字经济 · 人工智能研发及应用\nwww.meetu.online/ootd  ·  邀请制内测",
        size=14,
        color=RGBColor(0xC9, 0xC2, 0xB8),
    )
    add_text(s, Inches(0.8), Inches(6.6), Inches(10), Inches(0.3), "商业计划书配套路演 PPT  ·  V3", size=12, color=MUTED)

    # ---------- P2 Pain ----------
    s = prs.slides.add_slide(blank)
    add_bg(s)
    title_block(s, "穿衣搭配是全民高频刚需", "却长期没有被服务好")
    cards = [
        ("决策烦恼", "每天早晨站在衣柜前\n「今天穿什么」的微焦虑"),
        ("衣橱闲置", "满柜子衣服\n却总觉得没衣服穿"),
        ("场景焦虑", "通勤 / 差旅 / 聚会\n每次都怕穿错"),
    ]
    for i, (t, body) in enumerate(cards):
        left = Inches(0.6 + i * 4.1)
        add_round(s, left, Inches(1.8), Inches(3.8), Inches(3.6), fill=CARD, line=LINE)
        add_rect(s, left, Inches(1.8), Inches(3.8), Inches(0.12), fill=GOLD)
        add_text(s, left + Inches(0.3), Inches(2.2), Inches(3.2), Inches(0.5), t, size=22, bold=True)
        add_text(s, left + Inches(0.3), Inches(3.0), Inches(3.2), Inches(1.8), body, size=16, color=MUTED)
    add_text(
        s,
        Inches(0.6),
        Inches(5.8),
        Inches(12),
        Inches(0.5),
        "只要穿衣服的人，就是潜在用户。",
        size=18,
        bold=True,
        color=GOLD,
    )
    footer(s, 2)

    # ---------- P3 Dual mode ----------
    s = prs.slides.add_slide(blank)
    add_bg(s)
    title_block(s, "对话问得到，托管懒得问", "双模式把造型师服务产品化")
    # left card
    add_round(s, Inches(0.6), Inches(1.7), Inches(5.8), Inches(4.5), fill=CARD, line=LINE)
    add_rect(s, Inches(0.6), Inches(1.7), Inches(5.8), Inches(0.55), fill=GOLD)
    add_text(s, Inches(0.85), Inches(1.8), Inches(5.3), Inches(0.4), "对话模式 · 已上线", size=18, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF))
    add_paras(
        s,
        Inches(0.95),
        Inches(2.5),
        Inches(5.2),
        Inches(3.4),
        [
            ("「约会穿什么」「白裙子怎么搭」", {"size": 16, "bold": True, "space_after": 10}),
            ("自然语言提问 → 秒级拿到方案", {"size": 15, "color": MUTED, "space_after": 8}),
            ("输出：穿搭方案 + 文案 + 上身效果图", {"size": 15, "color": MUTED, "space_after": 8}),
            ("定位：获客入口 · 永久免费", {"size": 15, "color": MUTED, "space_after": 8}),
        ],
    )
    # right card
    add_round(s, Inches(6.9), Inches(1.7), Inches(5.8), Inches(4.5), fill=CARD, line=LINE)
    add_rect(s, Inches(6.9), Inches(1.7), Inches(5.8), Inches(0.55), fill=DARK)
    add_text(s, Inches(7.15), Inches(1.8), Inches(5.3), Inches(0.4), "托管模式「穿搭计划」· 规划中", size=18, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF))
    add_paras(
        s,
        Inches(7.2),
        Inches(2.5),
        Inches(5.2),
        Inches(3.4),
        [
            ("按天气 / 行程主动推今日穿搭", {"size": 16, "bold": True, "space_after": 10}),
            ("用户照着穿，无需每天询问", {"size": 15, "color": MUTED, "space_after": 8}),
            ("多智能体管线复用，只加触发与推送层", {"size": 15, "color": MUTED, "space_after": 8}),
            ("定位：订阅卖点 · 「穿搭被接管」", {"size": 15, "color": MUTED, "space_after": 8}),
        ],
    )
    footer(s, 3)

    # ---------- P4 Demo（嵌入录屏） ----------
    s = prs.slides.add_slide(blank)
    add_bg(s)
    title_block(s, "产品已上线，完整链路可跑通", "www.meetu.online/ootd  ·  邀请制内测")
    steps = ["用户消息", "意图路由", "衣橱检索", "穿搭方案", "文案+效果图"]
    for i, step in enumerate(steps):
        left = Inches(0.5 + i * 2.5)
        add_round(s, left, Inches(1.55), Inches(2.2), Inches(0.55), fill=GOLD_SOFT if i % 2 == 0 else CARD, line=LINE)
        add_text(s, left, Inches(1.6), Inches(2.2), Inches(0.45), step, size=13, bold=True, align=PP_ALIGN.CENTER, color=DARK)
        if i < len(steps) - 1:
            add_text(s, left + Inches(2.05), Inches(1.6), Inches(0.4), Inches(0.45), "→", size=16, color=GOLD, align=PP_ALIGN.CENTER)

    demo_mp4 = ASSETS / "demo.mp4"
    demo_mov = ASSETS / "demo.mov"
    demo_video = demo_mp4 if demo_mp4.exists() else demo_mov
    poster = ASSETS / "S3-plan-result.png"
    # 16:9 主视觉
    vid_left, vid_top = Inches(1.4), Inches(2.3)
    vid_w, vid_h = Inches(10.5), Inches(4.2)
    add_round(s, vid_left - Inches(0.06), vid_top - Inches(0.06), vid_w + Inches(0.12), vid_h + Inches(0.12), fill=CARD, line=LINE)
    if demo_video.exists():
        s.shapes.add_movie(
            str(demo_video),
            vid_left,
            vid_top,
            vid_w,
            vid_h,
            poster_frame_image=str(poster) if poster.exists() else None,
            mime_type="video/mp4" if demo_video.suffix.lower() == ".mp4" else "video/quicktime",
        )
        add_text(
            s,
            Inches(1.4),
            Inches(6.55),
            Inches(10.5),
            Inches(0.35),
            "Demo 录屏 · 约 58 秒 · 点击播放（提问 → 衣橱检索 → 穿搭方案 → 效果图）",
            size=13,
            color=MUTED,
            align=PP_ALIGN.CENTER,
        )
    else:
        add_text(
            s,
            vid_left,
            vid_top + Inches(1.6),
            vid_w,
            Inches(0.8),
            "缺少 assets/demo.mp4 或 demo.mov",
            size=16,
            color=MUTED,
            align=PP_ALIGN.CENTER,
        )
    footer(s, 4)

    # ---------- P5 Scenarios ----------
    s = prs.slides.add_slide(blank)
    add_bg(s)
    title_block(s, "从「问一句」到「管一天」", "全场景生活方式覆盖")
    scenes = [
        ("日常通勤", "早上收到今日穿搭卡片\n结合天气，照着穿出门"),
        ("差旅出行", "按目的地天气与行程\n生成打包清单"),
        ("节假日聚会", "按场合氛围\n生成造型与效果图"),
        ("度假旅游", "胶囊衣橱\n少量单品一周不重样"),
        ("购物前", "与己有衣橱预搭配\n买得起更搭得起"),
    ]
    for i, (t, body) in enumerate(scenes):
        left = Inches(0.45 + i * 2.55)
        add_round(s, left, Inches(1.8), Inches(2.4), Inches(4.2), fill=CARD, line=LINE)
        add_rect(s, left, Inches(1.8), Inches(2.4), Inches(0.1), fill=GOLD)
        add_text(s, left + Inches(0.15), Inches(2.2), Inches(2.1), Inches(0.6), t, size=18, bold=True, align=PP_ALIGN.CENTER)
        add_text(s, left + Inches(0.15), Inches(3.1), Inches(2.1), Inches(2.2), body, size=13, color=MUTED, align=PP_ALIGN.CENTER)
    footer(s, 5)

    # ---------- P6 Architecture ----------
    s = prs.slides.add_slide(blank)
    add_bg(s)
    title_block(s, "多智能体协同，不是单次 Prompt", "五个专业 Agent 各司其职")
    agents = [
        ("Gatekeeper", "意图路由"),
        ("RAG", "衣橱检索"),
        ("Stylist", "穿搭方案"),
        ("Copywriter", "文案生成"),
        ("VisualDirector", "效果图+审核"),
    ]
    for i, (name, role) in enumerate(agents):
        left = Inches(0.5 + i * 2.5)
        add_round(s, left, Inches(2.2), Inches(2.3), Inches(2.2), fill=CARD, line=LINE)
        add_text(s, left + Inches(0.1), Inches(2.55), Inches(2.1), Inches(0.6), name, size=15, bold=True, align=PP_ALIGN.CENTER)
        add_text(s, left + Inches(0.1), Inches(3.3), Inches(2.1), Inches(0.5), role, size=14, color=MUTED, align=PP_ALIGN.CENTER)
        if i < len(agents) - 1:
            add_text(s, left + Inches(2.15), Inches(2.9), Inches(0.35), Inches(0.4), "→", size=18, color=GOLD, align=PP_ALIGN.CENTER)
    add_round(s, Inches(0.6), Inches(4.8), Inches(12.1), Inches(1.3), fill=GOLD_SOFT, line=None)
    add_text(
        s,
        Inches(0.9),
        Inches(5.15),
        Inches(11.5),
        Inches(0.7),
        "质量可度量、可回归 —— 大模型人人能调；稳定可控的多智能体管线，才是工程能力。",
        size=16,
        bold=True,
        color=DARK,
        align=PP_ALIGN.CENTER,
    )
    footer(s, 6)

    # ---------- P7 Moat ----------
    s = prs.slides.add_slide(blank)
    add_bg(s)
    title_block(s, "AI 应用最稀缺的是「质量可度量」", "把 Prompt 当代码管：有测试、有日志、有审核")
    pillars = [
        ("Prompt 回归测试", "真实 LLM 场景断言\n改一处，不崩全局"),
        ("全链路审计日志", "意图 / 检索 / 效果图审核\n全程可查、可复盘"),
        ("生成 + AI 复审", "效果图不合格\n自动拦截或重生成"),
    ]
    for i, (t, body) in enumerate(pillars):
        left = Inches(0.6 + i * 4.1)
        add_round(s, left, Inches(1.8), Inches(3.8), Inches(3.5), fill=CARD, line=LINE)
        add_text(s, left + Inches(0.3), Inches(2.2), Inches(3.2), Inches(0.7), f"0{i+1}", size=28, bold=True, color=GOLD)
        add_text(s, left + Inches(0.3), Inches(3.1), Inches(3.2), Inches(0.5), t, size=18, bold=True)
        add_text(s, left + Inches(0.3), Inches(3.8), Inches(3.2), Inches(1.2), body, size=15, color=MUTED)
    add_text(s, Inches(0.6), Inches(5.7), Inches(12), Inches(0.4), "软件著作权已申请，登记受理中", size=14, color=MUTED)
    footer(s, 7)

    # ---------- P8 Market ----------
    s = prs.slides.add_slide(blank)
    add_bg(s)
    title_block(s, "万亿服装电商 × AI 穿搭拐点", "公开数据支撑的三个硬数字")
    nums = [
        ("2.38 万亿", "2025 服装 B2C 网络零售额"),
        ("50%–60%", "女装线上退货率\n单次成本约 16 元"),
        ("82 亿 / 46.7%", "2026 虚拟试衣赛道规模\n与年复合增速"),
    ]
    for i, (n, d) in enumerate(nums):
        left = Inches(0.6 + i * 4.1)
        add_round(s, left, Inches(1.9), Inches(3.8), Inches(3.4), fill=CARD, line=LINE)
        add_text(s, left + Inches(0.2), Inches(2.5), Inches(3.4), Inches(0.8), n, size=28, bold=True, color=GOLD, align=PP_ALIGN.CENTER)
        add_text(s, left + Inches(0.3), Inches(3.6), Inches(3.2), Inches(1.2), d, size=15, color=MUTED, align=PP_ALIGN.CENTER)
    add_text(
        s,
        Inches(0.6),
        Inches(5.7),
        Inches(12),
        Inches(0.5),
        "退货黑洞的重要根源：购前看不到搭配效果 —— 正是我们的切口。",
        size=16,
        bold=True,
    )
    footer(s, 8)

    # ---------- P9 Business ----------
    s = prs.slides.add_slide(blank)
    add_bg(s)
    title_block(s, "双轮变现，分三步走", "今天验证产品，明天接购买，后天服务品牌")
    phases = [
        ("第一阶段 · 现在", "C 端产品验证\n托管模式订阅起点\n问答免费 · 托管收费"),
        ("第二阶段", "接入 CPS 联盟\n淘宝 / 京东开放接口\n跑通导购分佣"),
        ("第三阶段", "金牛园区对接\n服装品牌 B 端 SaaS\n降退货 · 提连带"),
    ]
    for i, (t, body) in enumerate(phases):
        left = Inches(0.6 + i * 4.1)
        add_round(s, left, Inches(1.8), Inches(3.8), Inches(3.8), fill=CARD, line=LINE)
        add_rect(s, left, Inches(1.8), Inches(3.8), Inches(0.7), fill=GOLD if i == 0 else DARK)
        add_text(
            s,
            left + Inches(0.2),
            Inches(1.95),
            Inches(3.4),
            Inches(0.45),
            t,
            size=16,
            bold=True,
            color=RGBColor(0xFF, 0xFF, 0xFF),
            align=PP_ALIGN.CENTER,
        )
        add_text(s, left + Inches(0.3), Inches(2.9), Inches(3.2), Inches(2.2), body, size=16, color=MUTED, align=PP_ALIGN.CENTER)
    footer(s, 9)

    # ---------- P10 Competition ----------
    s = prs.slides.add_slide(blank)
    add_bg(s)
    title_block(s, "我们和谁不一样", "私有衣橱数据 + 工程闭环 = 护城河")
    rows = [
        ("虚拟试衣方案商", "重资产 3D 建模、项目制", "生成式零建模，天然 SaaS"),
        ("通用大模型应用", "无衣橱、无质量闭环", "私有衣橱 + 检索 + 审核体系"),
        ("传统穿搭 / 衣橱 App", "依赖人工内容，难规模化", "多智能体全自动生成"),
    ]
    # header
    add_round(s, Inches(0.6), Inches(1.7), Inches(12.1), Inches(0.55), fill=DARK)
    for i, h in enumerate(["对手类型", "它们的短板", "我们的差异"]):
        add_text(s, Inches(0.8 + i * 4.0), Inches(1.8), Inches(3.8), Inches(0.4), h, size=14, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF))
    for r, (a, b, c) in enumerate(rows):
        top = Inches(2.4 + r * 1.15)
        add_round(s, Inches(0.6), top, Inches(12.1), Inches(1.05), fill=CARD, line=LINE)
        for i, val in enumerate([a, b, c]):
            add_text(s, Inches(0.8 + i * 4.0), top + Inches(0.3), Inches(3.8), Inches(0.5), val, size=15, color=INK if i != 2 else GOLD)
    add_text(s, Inches(0.6), Inches(6.0), Inches(12), Inches(0.4), "护城河随使用加深：衣橱数据越多越准，迁移成本越高。", size=14, color=MUTED)
    footer(s, 10)

    # ---------- P11 Team ----------
    s = prs.slides.add_slide(blank)
    add_bg(s)
    title_block(s, "产品技术 × 商业市场", "双人核心，分工清晰")
    members = [
        (
            "吴昀珠",
            "创始人 / 项目负责人",
            "杭州电子科技大学软件工程本科\n前字节跳动高级前端工程师\n负责 TikTok 千万级 DAU Web 核心链路\n2025 起专注 AI Agent，产品已上线",
        ),
        (
            "陈鸿菱",
            "联合创始人",
            "宁夏理工学院计算机科学与技术\n（软件工程方向）\n任职于开林集团，负责软件开发\n商业化落地与市场拓展",
        ),
    ]
    for i, (name, role, bio) in enumerate(members):
        left = Inches(0.7 + i * 6.2)
        add_round(s, left, Inches(1.8), Inches(5.7), Inches(4.2), fill=CARD, line=LINE)
        add_rect(s, left, Inches(1.8), Inches(5.7), Inches(0.12), fill=GOLD)
        add_text(s, left + Inches(0.4), Inches(2.2), Inches(4.9), Inches(0.5), name, size=24, bold=True)
        add_text(s, left + Inches(0.4), Inches(2.8), Inches(4.9), Inches(0.4), role, size=16, color=GOLD)
        add_text(s, left + Inches(0.4), Inches(3.5), Inches(4.9), Inches(2.2), bio, size=15, color=MUTED)
    footer(s, 11)

    # ---------- P12 Finance ----------
    s = prs.slides.add_slide(blank)
    add_bg(s)
    title_block(s, "三年规划 · 天使轮支撑加速", "假设保守、可现场解释")
    years = [
        ("第 1 年", "15 万元", "注册 3 万 / 付费 800"),
        ("第 2 年", "160 万元", "订阅起量 + CPS + 试点 SaaS"),
        ("第 3 年", "560 万元", "接近盈亏平衡"),
    ]
    for i, (y, n, d) in enumerate(years):
        left = Inches(0.6 + i * 4.1)
        add_round(s, left, Inches(1.7), Inches(3.8), Inches(2.6), fill=CARD, line=LINE)
        add_text(s, left + Inches(0.2), Inches(1.95), Inches(3.4), Inches(0.4), y, size=14, color=MUTED, align=PP_ALIGN.CENTER)
        add_text(s, left + Inches(0.2), Inches(2.45), Inches(3.4), Inches(0.7), n, size=28, bold=True, color=GOLD, align=PP_ALIGN.CENTER)
        add_text(s, left + Inches(0.2), Inches(3.3), Inches(3.4), Inches(0.5), d, size=13, color=MUTED, align=PP_ALIGN.CENTER)

    add_round(s, Inches(0.6), Inches(4.6), Inches(12.1), Inches(1.6), fill=DARK)
    add_text(s, Inches(0.9), Inches(4.85), Inches(11.5), Inches(0.4), "天使轮规划：150 万元 · 出让 10%", size=18, bold=True, color=GOLD)
    add_text(
        s,
        Inches(0.9),
        Inches(5.4),
        Inches(11.5),
        Inches(0.5),
        "用途：产品研发 40%  ·  市场获客 30%  ·  团队 20%  ·  运营储备 10%",
        size=15,
        color=RGBColor(0xE8, 0xE2, 0xDA),
    )
    footer(s, 12)

    # ---------- P13 Jinniu ----------
    s = prs.slides.add_slide(blank)
    add_bg(s)
    title_block(s, "扎根金牛，用 AI 服务本地数字消费", "蓉漂回流 · 可落地的产品与用人计划")
    items = [
        ("落地载体", "意向落户 AI 数字创智元 OPC 社区\n算力补贴 / 服务包 / 租金减免"),
        ("蓉漂叙事", "杭州求学 → 上海字节 → 成都创业\n以技术反哺本地数字经济"),
        ("就业带动", "第 1 年 3–4 人\n第 2 年 6–8 人\n第 3 年 12–15 人"),
    ]
    for i, (t, body) in enumerate(items):
        left = Inches(0.6 + i * 4.1)
        add_round(s, left, Inches(1.8), Inches(3.8), Inches(4.0), fill=CARD, line=LINE)
        add_text(s, left + Inches(0.3), Inches(2.2), Inches(3.2), Inches(0.5), t, size=20, bold=True, color=GOLD)
        add_text(s, left + Inches(0.3), Inches(3.0), Inches(3.2), Inches(2.2), body, size=15, color=MUTED)
    footer(s, 13)

    # ---------- P14 Close ----------
    s = prs.slides.add_slide(blank)
    add_bg(s, DARK)
    add_rect(s, 0, 0, Inches(0.18), SLIDE_H, fill=GOLD)
    fit_picture(s, BRAND_HERO, Inches(7.4), Inches(1.8), Inches(5.2), Inches(3.8))
    add_logo(s, Inches(0.75), Inches(1.2), height=Inches(0.7))
    add_text(s, Inches(0.8), Inches(2.2), Inches(6.5), Inches(1.2), "让每个人都有一位\nAI 私人造型师", size=32, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF))
    add_paras(
        s,
        Inches(0.8),
        Inches(3.8),
        Inches(6.5),
        Inches(2.4),
        [
            ("体验  www.meetu.online/ootd  （邀请制，可为评委开通）", {"size": 15, "color": GOLD_SOFT, "space_after": 12}),
            ("IP  软件著作权已申请，登记受理中", {"size": 15, "color": GOLD_SOFT, "space_after": 12}),
            ("诉求  恳请支持晋级，共创金牛 AI + 消费场景", {"size": 15, "color": GOLD_SOFT, "space_after": 12}),
            ("谢谢各位评委", {"size": 20, "bold": True, "color": GOLD, "space_after": 8}),
        ],
    )

    # Soft fade between all slides
    for slide in prs.slides:
        add_fade_transition(slide)

    prs.save(OUT)
    print(f"Wrote {OUT}  slides={len(prs.slides)}")


if __name__ == "__main__":
    build()
