import type { ReferenceImage } from "@/types/image";

export type ImageReferenceMode = "preserve-product" | "redesign-label";

export function imageReferenceLabel(index: number) {
    return `图片${index + 1}`;
}

export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[], mode: ImageReferenceMode = "preserve-product") {
    const text = prompt.trim();
    if (!references.length) return text;
    const labels = references.map((_, index) => imageReferenceLabel(index));
    const executionRules =
        mode === "redesign-label"
            ? `1. 参考图片是用户自己的产品。必须保留产品品类、数量、袋型/瓶型/盒型、物理轮廓、尺寸比例、封口、易撕口、底部结构和真实材质，不能换成其他商品。
2. 必须保留用户产品真实品牌、Logo、产品名称、规格和图片中能够确认的事实信息；不能复制其他品牌信息，也不能虚构功效、认证、成分或参数。
3. 本次任务明确要求重新设计包装的可印刷标签区域。旧标签的版式、文字位置、信息层级、装饰图形、色彩关系、字体风格、徽章样式和表面工艺不是保留对象，必须按照用户提示词重新组织。
4. 用户提示词中的标签设计要求优先于参考图旧标签的视觉样式。不要因为需要保留产品身份而保留旧标签布局、旧图案或旧配色。
5. 最终结果必须与参考图保持同一件真实产品和同一物理包装，但包装印刷区应出现肉眼可见、结构明确的全新设计，禁止将参考图原样返回或只做像素级微调。
6. 只修改包装可印刷区域，不在商品外部添加文字、Logo、图标、道具或装饰；背景、机位、构图与光影按照用户提示词执行。`
            : `1. 参考图片是用户上传的产品主体，不是可选灵感图。最终生成图必须以参考图片中的产品为唯一产品主体。
2. 必须保留参考产品的品类、数量、瓶型/盒型/袋型、包装比例、品牌识别、Logo 和图片中能够确认的真实文字事实。
3. 如果用户提示词明确要求重新设计包装标签或可印刷区域，应保留产品身份与真实事实，但允许并应当改变标签版式、图形、颜色、文字层级和视觉风格；不要把旧标签样式错误地当成不可修改的产品结构。
4. 如果用户没有要求包装设计变化，则保持参考产品的主要颜色、标签位置、核心图案、配件关系和可识别外观。
5. 下方提示词如果来自竞品图反推，只能迁移构图、画面比例、背景、光影、道具关系、商业视觉机制和质量标准，不能复制竞品品牌、包装文字、产品形状、卖点或事实信息。
6. 不要把参考产品替换成另一件商品，不要虚构不存在的标签事实，不要改变品牌归属，不要生成与参考图片无关的商品。`;
    return `参考图片编号：${labels.join("、")}。

重要执行规则：
${executionRules}

用户提示词：
${text}`;
}
