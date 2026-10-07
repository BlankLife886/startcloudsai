import { BottomSheet } from "@mobile/components/overlay/index.js";

/** 创作页的参数/模型弹层。 */
export function Sheet({ visible, onClose, title, children, footer }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} footer={footer}>
      {children}
    </BottomSheet>
  );
}
