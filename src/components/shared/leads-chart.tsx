"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function LeadsChart({ data, description }: { data: { label: string; leads: number }[]; description: string }) {
  return (
    <div className="h-64 w-full" role="img" aria-label={`График поступления заявок по дням: ${description}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="leads-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            fontSize={12}
            stroke="var(--muted-foreground)"
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis tickLine={false} axisLine={false} fontSize={12} width={44} allowDecimals={false} stroke="var(--muted-foreground)" />
          <Tooltip
            formatter={(v) => [String(v), "Заявок"]}
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          />
          <Area type="monotone" dataKey="leads" stroke="var(--chart-1)" strokeWidth={2} fill="url(#leads-fill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
