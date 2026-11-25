export type CentralBankEntry = {
  currency: string;
  bank: string;
  policy_rate: number;
  last_decision_date: string;
  next_decision_date: string;
  last_action: string;
  last_change_bps: number;
  days_since_last_decision: number;
  days_until_next_decision: number;
  decision_cycle: string;
};

type Props = {
  banks: CentralBankEntry[];
  loading?: boolean;
};

function toneForDays(daysUntil: number): string {
  if (daysUntil <= 7) return "text-terminal-warn";
  if (daysUntil <= 21) return "text-terminal-accent";
  return "text-terminal-muted";
}

export function CentralBankMonitor({ banks, loading = false }: Props) {
  return (
    <div role="region" aria-label="Central bank reference table" tabIndex={0} className="min-w-0 max-w-full overflow-x-auto">
      <table className="min-w-[780px] w-full table-fixed text-xs [&_th]:whitespace-nowrap"><colgroup><col className="w-[30%]"/><col className="w-[12%]"/><col className="w-[23%]"/><col className="w-[23%]"/><col className="w-[12%]"/></colgroup>
        <thead className="bg-terminal-bg/40 text-xs uppercase text-terminal-muted">
          <tr>
            <th className="px-3 py-2 text-left">Bank</th>
            <th className="px-3 py-2 text-right">Rate</th>
            <th className="px-3 py-2 text-left">Last Action</th>
            <th className="px-3 py-2 text-left">Next Decision</th>
            <th className="px-3 py-2 text-right">Cycle</th>
          </tr>
        </thead>
        <tbody>
          {banks.map((bank) => (
            <tr key={`${bank.currency}:${bank.bank}`} className="border-t border-terminal-border/70">
              <td className="px-3 py-2">
                <div className="font-medium text-terminal-text">{bank.bank}</div>
                <div className="text-xs text-terminal-muted">{bank.currency}</div>
              </td>
              <td className="px-3 py-2 text-right ot-type-data text-terminal-text">{bank.policy_rate.toFixed(2)}%</td>
              <td className="px-3 py-2">
                <div className="text-terminal-text">{bank.last_action}</div>
                <div className="text-xs text-terminal-muted">
                  {bank.last_change_bps >= 0 ? "+" : ""}{bank.last_change_bps} bps on {bank.last_decision_date}
                </div>
              </td>
              <td className="px-3 py-2">
                <div className={toneForDays(bank.days_until_next_decision)}>{bank.next_decision_date}</div>
                <div className="text-xs text-terminal-muted">{bank.days_until_next_decision < 0 ? `${Math.abs(bank.days_until_next_decision)}d past reference date` : `${bank.days_until_next_decision}d remaining`}</div>
              </td>
              <td className="px-3 py-2 text-right text-terminal-muted">{bank.decision_cycle}</td>
            </tr>
          ))}
          {!banks.length && !loading ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-terminal-muted">
                No central bank data available.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
