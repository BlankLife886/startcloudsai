import { WallevenImagePreviewImpl } from "./WallevenImagePreviewImpl.jsx";

let suppressPreviewOpenUntil = 0;

export function canOpenWallevenImagePreview() {
  return Date.now() >= suppressPreviewOpenUntil;
}

// Compatibility entry point for the shared preview restored from the Vue client.
export function WallevenImagePreview(props) {
  if (props.open === false) return null;
  const closePreview = () => {
    suppressPreviewOpenUntil = Date.now() + 700;
    props.onClose?.();
  };
  return (
    <WallevenImagePreviewImpl
      {...props}
      onClose={closePreview}
      sourceUrl={props.sourceUrl || props.currentSrc || ""}
      gallery={props.gallery || props.images || []}
    />
  );
}
