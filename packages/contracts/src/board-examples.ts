/** Shared examples for prompt conditioning and the visual board rehearsal. */
export const boardExamples = [
 { id:"quadratic",title:"高校数学",input:"平方完成で、同じ値を足して引く理由を補足する。x^2-4x+3=(x-2)^2-1。",
   blackboardMarkdown:"# 平方完成\n◎ **同じ値を足して引く**\n$$x^2-4x+3=(x-2)^2-1$$\n→ 頂点は $(2,-1)$",
   text:"平方の形を作るために四を足したら、同じ四を引きます。式の値を変えないのがポイントです。まとめると、頂点が二、マイナス一だと読み取れます。" },
 { id:"derivative",title:"大学数学",input:"微分係数を、平均変化率の極限として初めて説明する。f(x)=x^2、x=aでの微分係数は2a。",
   blackboardMarkdown:"# 微分係数\n◎ **平均の変化 → 瞬間の変化**\n$$f'(a)=\\lim_{h\\to0}\\frac{f(a+h)-f(a)}{h}$$\n$f(x)=x^2$ → $f'(a)=2a$",
   text:"まず二点の間で、どれだけ値が変わったかを考えます。その二点を近づけていった先が、その場所での微分係数です。エックスの二乗なら、エーの位置での傾きは二エーになります。" },
 { id:"history",title:"歴史",input:"産業革命の工場制機械工業を、手作業との違いから説明する。機械化と分業が要点。",
   blackboardMarkdown:"# 工場制機械工業\n手作業 → **機械化**\n◎ **分業**：作業を分けて担当\n→ 多くの製品を作れる",
   text:"手で行っていた作業に機械が使われるようになります。さらに作業を分担することで、多くの製品を作れるようになりました。機械化と分業を、分けて押さえましょう。" },
] as const;
