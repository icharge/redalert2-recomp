import { Flex, Progress, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { formatBytes } from "./format";

const browserEstimate = () => navigator.storage.estimate();

/** How much of the browser's storage this site uses, from `navigator.storage.estimate()`. */
export function StorageMeter({
  estimate = browserEstimate,
  refresh,
}: {
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  /** change this to read the numbers again (after a removal) */
  refresh?: unknown;
}) {
  const [numbers, setNumbers] = useState<{ quota: number; usage: number } | null>(null);
  useEffect(() => {
    let live = true;
    void estimate().then((value) => {
      if (live) setNumbers({ quota: value.quota ?? 0, usage: value.usage ?? 0 });
    });
    return () => {
      live = false;
    };
  }, [estimate, refresh]);
  if (!numbers || numbers.quota === 0) return null;
  return (
    <Flex direction="column" gap="1">
      <Progress value={(numbers.usage / numbers.quota) * 100} aria-label="Browser storage used" />
      <Text size="1" color="gray">
        {formatBytes(numbers.usage)} of {formatBytes(numbers.quota)} the browser allows this site
      </Text>
    </Flex>
  );
}
