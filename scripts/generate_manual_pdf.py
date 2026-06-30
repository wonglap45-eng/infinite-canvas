from __future__ import annotations

from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "output" / "pdf"
TMP_DIR = ROOT / "tmp" / "pdfs"
PDF_PATH = OUT_DIR / "EONS_AI_Image_Studio_Internal_Manual_CN.pdf"
SOURCE_PATH = ROOT / "docs" / "EONS_AI_IMAGE_STUDIO_COMPLETE_MANUAL_CN.md"

PAGE_W, PAGE_H = A4
NAVY = colors.HexColor("#111827")
INK = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#6b7280")
LINE = colors.HexColor("#e5e7eb")
PAPER = colors.HexColor("#f8fafc")
GOLD = colors.HexColor("#c8a15a")
BLUE = colors.HexColor("#2563eb")
GREEN = colors.HexColor("#059669")
RED = colors.HexColor("#dc2626")


def register_fonts() -> tuple[str, str]:
    candidates = [
        ("NotoSansSC", Path(r"C:\Windows\Fonts\NotoSansSC-VF.ttf")),
        ("DengXian", Path(r"C:\Windows\Fonts\Deng.ttf")),
        ("SimHei", Path(r"C:\Windows\Fonts\simhei.ttf")),
    ]
    serif_candidates = [
        ("NotoSerifSC", Path(r"C:\Windows\Fonts\NotoSerifSC-VF.ttf")),
        ("DengXianBold", Path(r"C:\Windows\Fonts\Dengb.ttf")),
        ("SimHei", Path(r"C:\Windows\Fonts\simhei.ttf")),
    ]
    body = "Helvetica"
    title = "Helvetica-Bold"
    for name, path in candidates:
        if path.exists():
            pdfmetrics.registerFont(TTFont(name, str(path)))
            body = name
            break
    for name, path in serif_candidates:
        if path.exists():
            if name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(name, str(path)))
            title = name
            break
    return body, title


BODY_FONT, TITLE_FONT = register_fonts()


def ptext(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("`", "")
    )


def build_styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            "CoverKicker",
            fontName=BODY_FONT,
            fontSize=11,
            leading=15,
            textColor=GOLD,
            alignment=TA_CENTER,
            spaceAfter=12,
        )
    )
    styles.add(
        ParagraphStyle(
            "CoverTitle",
            fontName=TITLE_FONT,
            fontSize=34,
            leading=42,
            textColor=colors.white,
            alignment=TA_CENTER,
            spaceAfter=10,
        )
    )
    styles.add(
        ParagraphStyle(
            "CoverSub",
            fontName=BODY_FONT,
            fontSize=13,
            leading=21,
            textColor=colors.HexColor("#d1d5db"),
            alignment=TA_CENTER,
        )
    )
    styles.add(
        ParagraphStyle(
            "H1",
            fontName=TITLE_FONT,
            fontSize=20,
            leading=27,
            textColor=NAVY,
            spaceBefore=18,
            spaceAfter=10,
        )
    )
    styles.add(
        ParagraphStyle(
            "H2",
            fontName=TITLE_FONT,
            fontSize=14,
            leading=20,
            textColor=BLUE,
            spaceBefore=12,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            "BodyCN",
            fontName=BODY_FONT,
            fontSize=9.8,
            leading=16,
            textColor=INK,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            "Small",
            fontName=BODY_FONT,
            fontSize=8.3,
            leading=12,
            textColor=MUTED,
        )
    )
    styles.add(
        ParagraphStyle(
            "CoverMeta",
            fontName=BODY_FONT,
            fontSize=8.8,
            leading=12,
            textColor=colors.HexColor("#e5e7eb"),
        )
    )
    styles.add(
        ParagraphStyle(
            "TableHead",
            fontName=BODY_FONT,
            fontSize=9.2,
            leading=13,
            textColor=colors.white,
        )
    )
    styles.add(
        ParagraphStyle(
            "Callout",
            fontName=BODY_FONT,
            fontSize=9.2,
            leading=15,
            textColor=INK,
            backColor=colors.HexColor("#fff7ed"),
            borderColor=colors.HexColor("#fed7aa"),
            borderWidth=0.7,
            borderPadding=8,
            spaceBefore=6,
            spaceAfter=10,
        )
    )
    styles.add(
        ParagraphStyle(
            "CodeCN",
            fontName=BODY_FONT,
            fontSize=8.3,
            leading=12,
            textColor=colors.HexColor("#e5e7eb"),
            backColor=colors.HexColor("#111827"),
            borderPadding=8,
            spaceBefore=4,
            spaceAfter=8,
        )
    )
    return styles


STYLES = build_styles()


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, PAGE_H - 16 * mm, PAGE_W - 18 * mm, PAGE_H - 16 * mm)
    canvas.setFont(BODY_FONT, 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, PAGE_H - 12 * mm, "EONS AI Image Studio")
    canvas.drawRightString(PAGE_W - 18 * mm, 11 * mm, f"{doc.page}")
    canvas.restoreState()


def cover_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#0f766e"))
    canvas.circle(PAGE_W * 0.18, PAGE_H * 0.78, 72 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#1d4ed8"))
    canvas.circle(PAGE_W * 0.88, PAGE_H * 0.18, 88 * mm, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(28 * mm, 42 * mm, 50 * mm, 1.2 * mm, fill=1, stroke=0)
    canvas.setStrokeColor(colors.Color(1, 1, 1, alpha=0.22))
    for i in range(7):
        canvas.line(22 * mm, (105 + i * 10) * mm, PAGE_W - 22 * mm, (126 + i * 8) * mm)
    canvas.restoreState()


def mk_doc():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=22 * mm,
        bottomMargin=18 * mm,
        title="EONS AI Image Studio 内部使用与管理说明书",
        author="EONS",
    )
    cover_frame = Frame(0, 0, PAGE_W, PAGE_H, id="cover", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    normal_frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates(
        [
            PageTemplate(id="cover", frames=[cover_frame], onPage=cover_page),
            PageTemplate(id="normal", frames=[normal_frame], onPage=header_footer),
        ]
    )
    return doc


def para(text: str, style="BodyCN"):
    return Paragraph(ptext(text), STYLES[style])


def pill_table(items):
    rows = []
    for i in range(0, len(items), 2):
        row = []
        for item in items[i : i + 2]:
            row.append(Paragraph(ptext(item), STYLES["BodyCN"]))
        if len(row) == 1:
            row.append("")
        rows.append(row)
    table = Table(rows, colWidths=[78 * mm, 78 * mm], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f9fafb")),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def info_table(rows, widths=None):
    table = Table(
        [
            [
                Paragraph(ptext(str(c)), STYLES["TableHead" if row_idx == 0 else "BodyCN"])
                for c in row
            ]
            for row_idx, row in enumerate(rows)
        ],
        colWidths=widths or [44 * mm, 112 * mm],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def bullets(items):
    return ListFlowable(
        [ListItem(para(item), leftIndent=0) for item in items],
        bulletType="bullet",
        leftIndent=12,
        bulletFontName=BODY_FONT,
        bulletFontSize=6,
    )


def numbered(items):
    return ListFlowable(
        [ListItem(para(item), leftIndent=0) for item in items],
        bulletType="1",
        leftIndent=16,
        bulletFontName=BODY_FONT,
    )


def code(text: str):
    block = Table([[Preformatted(text, STYLES["CodeCN"])]], colWidths=[156 * mm], hAlign="LEFT")
    block.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#111827")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#111827")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return block


def section(story, title, subtitle=None):
    story.append(Paragraph(ptext(title), STYLES["H1"]))
    if subtitle:
        story.append(Paragraph(ptext(subtitle), STYLES["Small"]))
        story.append(Spacer(1, 5))


def subsection(story, title):
    story.append(Paragraph(ptext(title), STYLES["H2"]))


def build_story():
    story = []
    story.append(Spacer(1, 80 * mm))
    story.append(Paragraph("内部使用与管理说明书", STYLES["CoverKicker"]))
    story.append(Paragraph("EONS AI Image Studio", STYLES["CoverTitle"]))
    story.append(Paragraph("AI 图片工作台 · Railway 内部部署版 · 用户手册与管理员指南", STYLES["CoverSub"]))
    story.append(Spacer(1, 92 * mm))
    meta = Table(
        [
            [Paragraph("版本", STYLES["CoverMeta"]), Paragraph("1.0", STYLES["CoverMeta"])],
            [Paragraph("适用范围", STYLES["CoverMeta"]), Paragraph("公司内部团队", STYLES["CoverMeta"])],
            [Paragraph("部署环境", STYLES["CoverMeta"]), Paragraph("Railway / Docker", STYLES["CoverMeta"])],
            [Paragraph("文档类型", STYLES["CoverMeta"]), Paragraph("用户手册 + 管理员说明书", STYLES["CoverMeta"])],
        ],
        colWidths=[24 * mm, 70 * mm],
        hAlign="CENTER",
    )
    meta.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.Color(1, 1, 1, alpha=0.08)),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.Color(1, 1, 1, alpha=0.24)),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.Color(1, 1, 1, alpha=0.18)),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(meta)
    story.append(NextPageTemplate("normal"))
    story.append(PageBreak())

    section(story, "01. 执行摘要", "这份说明书面向员工和管理员，覆盖日常使用、部署配置、数据边界和故障排查。")
    story.append(
        para(
            "EONS AI Image Studio 是公司内部 AI 图片工作台，支持无限画布、文生图、图生图、参考图编辑、局部编辑、提示词生成、提示词库、素材管理、图片下载、错误日志和成本估算。员工不需要配置模型 API Key，所有模型 Key 由管理员在 Railway 环境变量中维护。"
        )
    )
    story.append(
        pill_table(
            [
                "内部登录保护：统一账号密码，httpOnly cookie 有效期 7 天。",
                "服务端 API Key：员工前端不显示、不保存、不输入模型 Key。",
                "本地数据隔离：不同电脑和浏览器通常互不影响。",
                "Railway 部署：Dockerfile 构建，自动使用 PORT。",
                "成本估算：点数仅用于内部控成本，真实费用看第三方账单。",
                "开源合规：保留 LICENSE、ATTRIBUTION 和 /license 页面。",
            ]
        )
    )
    story.append(Paragraph("重要边界：当前版本支持多人同时在线使用，但还不是完整的多员工云端账号系统。项目、素材和记录主要保存在浏览器本地，换电脑不会自动同步。", STYLES["Callout"]))

    section(story, "02. 员工快速开始")
    story.append(numbered(["打开公司提供的 EONS AI Image Studio 网址。", "输入管理员分配的用户名和密码。", "进入“我的画布”或“生图工作台”。", "上传参考图或输入提示词。", "选择模型、比例、质量和生成数量。", "点击生成，并在生成前确认窗口检查点数和风险提示。", "保存满意结果到“我的素材”或下载到本地。"]))
    subsection(story, "主要功能区")
    story.append(
        info_table(
            [
                ["功能区", "用途"],
                ["我的画布", "复杂图片流程、节点连接、参考图、提示词节点、生图节点和局部编辑。"],
                ["生图工作台", "快速文生图、图生图、批量生成、记录查看和下载。"],
                ["提示词库", "查找灵感、复制提示词、加入我的素材。"],
                ["我的素材", "保存常用参考图、成品图、提示词和模板。"],
                ["错误日志与成本控制", "查看成功/失败记录、内部估算点数和失败原因。"],
            ],
            [34 * mm, 122 * mm],
        )
    )

    section(story, "03. 推荐工作流：亚马逊商品图")
    story.append(para("商品图建议从参考图开始，使用“亚马逊工作流”模板补齐专业约束，再按实际需求补充细节。"))
    story.append(
        bullets(
            [
                "白底主图：适合标准 Amazon 主图，强调产品保真、干净背景和清晰标签。",
                "产品场景图：适合副图或详情页，强调真实使用环境和可信氛围。",
                "A+ 详情质感图：适合表现材质、瓶盖、包装细节和高级感。",
                "换背景不换产品：只改变环境、光线和阴影，不改变产品身份。",
                "局部重绘：只修改蒙版区域，其他区域尽量保持不变。",
            ]
        )
    )
    story.append(Paragraph("提示词关键点：保留品牌识别、包装比例、瓶型或盒型、标签位置、主色、配件类型和核心视觉层级。避免额外文字、水印、扭曲 logo、虚构包装和不可读标签。", STYLES["Callout"]))

    section(story, "04. 图像生成能力")
    subsection(story, "文生图")
    story.append(para("适合没有参考图的概念图。提示词建议包含主体、场景、构图、光线、背景、风格和禁止项。"))
    subsection(story, "图生图")
    story.append(para("适合基于产品参考图生成新图片。请确认参考图已经上传或连接到生图节点。商品图生成时，参考图通常比单纯文字更稳定。"))
    subsection(story, "局部编辑")
    story.append(para("适合只修改图片中的小区域。蒙版越准确，结果越稳定。不要涂抹过大区域，否则模型可能重绘过多内容。"))
    story.append(code("只修改蒙版区域，其他区域保持不变。把瓶盖改成白色，保持原有光影、材质和瓶身标签不变。"))
    subsection(story, "多图生成策略")
    story.append(para("当一次生成多张图片时，系统会分别请求模型，并追加中性差异要求：原始提示词最高优先级，不改变图片类型、用途、背景方向、主体关系和禁止项；只要求结果在构图、镜头距离、角度、光影、产品位置或细节上有所区别。系统不会用固定关键词判断主图或副图。"))

    section(story, "05. 数据隔离与多人在线")
    story.append(para("系统支持多人同时在线使用。Railway 提供统一 Web 服务，多个员工可以同时打开页面并发起生成请求。真正的并发上限取决于 Railway 服务资源、第三方 API 限流、API Key 额度和图片模型响应速度。"))
    story.append(
        info_table(
            [
                ["场景", "数据可见性"],
                ["不同电脑", "通常看不到彼此项目和素材。"],
                ["不同浏览器或浏览器用户", "通常是独立数据。"],
                ["同一电脑同一浏览器用户", "会看到同一份本地数据。"],
                ["换电脑登录", "不会自动同步原电脑的项目和素材。"],
                ["清理浏览器站点数据", "可能导致本地项目和素材丢失。"],
            ],
            [48 * mm, 108 * mm],
        )
    )

    section(story, "06. 点数与成本估算")
    story.append(para("系统显示的点数是内部估算值，用来提醒成本和避免误消耗，不代表第三方平台真实账单。"))
    story.append(code("估算点数 =（操作基础值 + 参考图数量 x 0.2 + 长提示词加成）x 质量系数 x 尺寸系数 x 生成张数"))
    story.append(
        info_table(
            [
                ["项目", "规则"],
                ["操作基础值", "提示词 0.25；文生图 1；图生图 1.35；局部编辑 1.55。"],
                ["参考图", "每张参考图 +0.2。"],
                ["长提示词", "超过 1000 字 +0.15。"],
                ["质量系数", "high x1.7；medium x1.25；auto/low x1。"],
                ["尺寸系数", "2K 附近 x1.35；4K x2.4；普通尺寸 x1。"],
            ],
            [38 * mm, 118 * mm],
        )
    )

    section(story, "07. 管理员配置")
    subsection(story, "登录变量")
    story.append(code("ADMIN_USERNAME=admin\nADMIN_PASSWORD=your-strong-password"))
    story.append(para("修改 ADMIN_PASSWORD 后，旧登录状态会失效，所有员工需要重新登录。"))
    subsection(story, "模型变量")
    story.append(
        code(
            "NODE_ENV=production\n\n"
            "OPENAI_API_KEY=\nOPENAI_BASE_URL=\n\n"
            "OPENAI_IMAGE_API_KEY=\nOPENAI_IMAGE_BASE_URL=https://openrouter.ai/api/v1\n"
            "OPENAI_IMAGE_MODELS=openai/gpt-image-2\nOPENAI_IMAGE_GENERATIONS_PATH=/images\n\n"
            "OPENAI_TEXT_API_KEY=\nOPENAI_TEXT_BASE_URL=https://openrouter.ai/api/v1\nOPENAI_TEXT_MODELS=openai/gpt-5.5"
        )
    )
    story.append(para("如果一个 API Key 无法访问多个模型，应分别设置图片模型 Key 和文本模型 Key。不要把真实 API Key 写入代码、README、.env.example 或前端本地存储。"))

    section(story, "08. 部署与维护")
    story.append(para("系统使用根目录 Dockerfile 部署到 Railway。Railway 会注入 PORT，服务监听 0.0.0.0。"))
    story.append(code("docker build -t eons-ai-image-studio .\ndocker run --rm -p 3000:3000 eons-ai-image-studio"))
    story.append(bullets(["部署失败时优先检查 Dockerfile、PORT、启动命令和 Railway 构建日志。", "图片无法生成时优先检查图片模型 Key、Base URL、模型名和生成路径。", "提示词生成失败时优先检查文本模型 Key、Base URL 和模型权限。", "多人并发高时关注第三方 API 限流和 Railway 服务资源。"]))

    section(story, "09. 常见问题")
    story.append(
        info_table(
            [
                ["问题", "优先检查"],
                ["登录失败", "ADMIN_USERNAME、ADMIN_PASSWORD、变量保存后是否重新部署。"],
                ["图片无法生成", "OPENAI_IMAGE_API_KEY、OPENAI_IMAGE_BASE_URL、OPENAI_IMAGE_MODELS、OPENAI_IMAGE_GENERATIONS_PATH。"],
                ["提示词生成失败", "OPENAI_TEXT_API_KEY、OPENAI_TEXT_BASE_URL、OPENAI_TEXT_MODELS 和模型权限。"],
                ["结果重复", "减少单次张数，提示词明确“每张图不同”；最终差异仍取决于模型能力。"],
                ["换电脑看不到项目", "当前项目主要保存在浏览器本地，暂不支持个人云端同步。"],
            ],
            [42 * mm, 114 * mm],
        )
    )

    section(story, "10. 合规与上线检查")
    story.append(para("本项目基于开源项目改造，必须保留 LICENSE、ATTRIBUTION.md 和 Web 应用 /license 页面。员工日常界面不展示原项目来源、GitHub 链接、Powered by、Made by 等信息，但不得删除开源协议和版权声明。"))
    story.append(
        bullets(
            [
                "Railway 服务状态为 Online。",
                "/login 可以访问，未登录不能进入主界面。",
                "登录后可以进入画布和生图工作台。",
                "前端不显示 API Key。",
                "图片模型和文本模型可以正常调用。",
                "错误日志与成本控制可以打开。",
                "/license 可以访问。",
                "API Key 未提交到 Git，ADMIN_PASSWORD 使用强密码。",
            ]
        )
    )
    return story


def main():
    doc = mk_doc()
    story = build_story()
    doc.build(story)
    print(PDF_PATH)


if __name__ == "__main__":
    main()
