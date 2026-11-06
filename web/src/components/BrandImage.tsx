import { useEffect, useState, type ReactNode } from "react";

/** An image that is replaced by `fallback` when it cannot load (brand images are not in the public build). */
export function BrandImage({
  src,
  alt,
  fallback,
  className,
}: {
  src: string;
  alt: string;
  fallback: ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}
