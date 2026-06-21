import { HelpCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { ToolSetupInstructions } from "../onboarding/ToolSetupInstructions";

export function MCPConfig() {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <div className="text-[14px] font-semibold text-ink-800">
          Connect your AI tool
        </div>
        <div className="text-[12px] text-ink-500">
          Pick the tool you use and follow the steps.
        </div>
      </div>

      <ToolSetupInstructions variant="settings" />

      <div
        className="mt-1 flex items-center justify-between border-t pt-2 text-[12px] text-ink-500"
        style={{ borderColor: "rgba(24,24,27,0.10)" }}
      >
        <Link
          to="/help#connect"
          className="inline-flex items-center gap-1 text-ink-600 hover:text-ink-800"
        >
          <HelpCircle size={12} /> Having trouble?
        </Link>
      </div>
    </section>
  );
}
