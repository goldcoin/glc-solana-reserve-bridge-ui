import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { BridgeCard } from "@/features/bridge/BridgeCard";

export const metadata: Metadata = { title: "Bridge" };

export default function BridgePage() {
  return (
    // Extra bottom padding on small screens so the last control can always
    // scroll clear of the fixed corner dock (help + theme toggle), which
    // otherwise sits over the route summary at phone heights.
    <Container size="card" className="pt-8 pb-28 md:py-12">
      <BridgeCard />
    </Container>
  );
}
