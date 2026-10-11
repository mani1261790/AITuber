/** Shared examples for prompt conditioning and the visual board rehearsal. */
export const boardExamples = [
 { id:"quadratic",title:"高校数学",input:"平方完成で、同じ値を足して引く理由を補足する。x^2-4x+3=(x-2)^2-1。",
   blackboardMarkdown:"# 平方完成\n◎ **同じ値を足して引く**\n$$x^2-4x+3=(x-2)^2-1$$\n→ 頂点は $(2,-1)$",
   text:"平方の形を作るために四を足したら、同じ四を引きます。式の値を変えないのがポイントです。まとめると、頂点が二、マイナス一だと読み取れます。" },
 { id:"diagonalization",title:"大学数学",input:"線形代数。行列A=((2,1),(1,2))の固有値3,1と固有ベクトル(1,1),(1,-1)を使い、基底変換による対角化を説明する。",
   blackboardMarkdown:"# 固有値と対角化\n$$A=\\begin{pmatrix}2&1\\\\1&2\\end{pmatrix}$$\n◎ **固有ベクトルを基底に選ぶ**\n  $v_1=(1,1)^T$ → $\\lambda_1=3$\n  $v_2=(1,-1)^T$ → $\\lambda_2=1$\n\n$$P=(v_1\\ v_2),\\quad P^{-1}AP=\\mathrm{diag}(3,1)$$",
   text:"この行列は、一、一の方向を三倍し、一、マイナス一の方向は変えません。この二つの独立な固有ベクトルを列に並べた行列をピーとします。固有ベクトルを基底に選び直すと、同じ線形変換を三と一が並ぶ対角行列で表せます。" },
 { id:"history",title:"歴史",input:"産業革命の工場制機械工業を、手作業との違いから説明する。機械化と分業が要点。",
   blackboardMarkdown:"# 工場制機械工業\n手作業 → **機械化**\n◎ **分業**：作業を分けて担当\n→ 多くの製品を作れる",
   text:"手で行っていた作業に機械が使われるようになります。さらに作業を分担することで、多くの製品を作れるようになりました。機械化と分業を、分けて押さえましょう。" },
] as const;
