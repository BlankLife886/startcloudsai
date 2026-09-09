import { useState } from "react";
import { ImageOff } from "lucide-react";

export function HomeCoverImage({ src, alt = "", ...props }) {
  const [failedSource, setFailedSource] = useState(null);
  if (!src || failedSource === src) {
    return <span className="home-cover-fallback" role="img" aria-label={`${alt || "图片"}暂不可用`}>
      <ImageOff size={32} strokeWidth={1.25} aria-hidden="true" />
    </span>;
  }
  return <img {...props} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailedSource(src)} />;
}
