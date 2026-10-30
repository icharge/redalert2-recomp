import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Button, Callout, Flex, Heading, Text } from "@radix-ui/themes";
import type { Requirement } from "./features";

/** What this browser lacks, and what that means. Shown only when something required is missing. */
export function BrowserCheck({ requirements }: { requirements: Requirement[] }) {
  const missing = requirements.filter((r) => !r.ok);
  return (
    <Flex direction="column" gap="4" p="6" maxWidth="640px" mx="auto">
      <Heading size="6">This browser can't run the game yet</Heading>
      {missing.map((r) => (
        <Callout.Root key={r.id} color={r.required ? "red" : "amber"} role="alert">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            <Text weight="bold">{r.label}</Text>
            {r.required ? " is required. " : " is missing. "}
            {r.help}
          </Callout.Text>
        </Callout.Root>
      ))}
      {missing.some((r) => r.id === "threads") && (
        <Button onClick={() => window.location.reload()} style={{ alignSelf: "flex-start" }}>
          Reload
        </Button>
      )}
    </Flex>
  );
}
