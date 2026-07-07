// 小さなDOM構築ヘルパー（フレームワーク代わり）。
//   el('div', { class: 'card', onclick: fn }, '子テキスト', childNode)
type Attrs = Record<string, unknown>;
type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = String(v);
      else if (k === 'text') node.textContent = String(v);
      else if (k.startsWith('on')) {
        // 関数以外は無視する（setAttribute へ落とすと onclick="..." のインライン実行属性になるため）
        if (typeof v === 'function') node.addEventListener(k.slice(2), v as EventListener);
      } else if (k === 'dataset' && typeof v === 'object') {
        Object.assign(node.dataset, v);
      } else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
