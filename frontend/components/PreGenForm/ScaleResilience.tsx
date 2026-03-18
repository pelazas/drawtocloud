"use client";

import ExpectedUsersCards from "./ExpectedUsersCards";
import UptimeCards from "./UptimeCards";

interface ScaleResilienceProps {
  expectedUsers: string;
  onExpectedUsersChange: (value: string) => void;
  uptime: string;
  onUptimeChange: (value: string) => void;
}

export default function ScaleResilience({
  expectedUsers,
  onExpectedUsersChange,
  uptime,
  onUptimeChange,
}: ScaleResilienceProps) {
  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-sm text-gray-400 font-medium">Scale &amp; Resilience</h3>
      <ExpectedUsersCards value={expectedUsers} onChange={onExpectedUsersChange} />
      <UptimeCards value={uptime} onChange={onUptimeChange} />
    </div>
  );
}
