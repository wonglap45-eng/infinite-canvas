import type { ReferenceImage } from "@/types/image";

export function imageReferenceLabel(index: number) {
    return `图片${index + 1}`;
}

export function buildImageReferencePromptText(prompt: string, references: ReferenceImage[]) {
    const text = prompt.trim();
    if (!references.length) return text;
    const labels = references.map((_, index) => imageReferenceLabel(index));
    return `参考图片编号：${labels.join("、")}。

重要执行规则：
1. 参考图片是用户上传的产品主体，不是可选灵感图。最终生成图必须以参考图片中的产品为唯一产品主体。
2. 必须保留参考图片中产品的品类、瓶型/盒型、包装比例、主要颜色、标签位置、logo 位置、核心图案、配件关系和可识别外观。
3. 下方提示词如果来自竞品图反推，只能用于迁移构图、画面比例、背景、光影、道具关系、商业视觉风格和质量标准；不能把竞品的品牌、包装文字、产品形状、卖点或颜色当成新产品主体。
4. 可以优化拍摄角度、灯光、背景和质感，但不要把参考产品替换成另一个产品，不要虚构不存在的标签内容，不要改变品牌识别，不要生成与参考图片无关的商品。

用户提示词：
${text}`;
}
