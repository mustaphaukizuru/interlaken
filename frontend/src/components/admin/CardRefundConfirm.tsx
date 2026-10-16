/** Refund of a card top-up: the wallet is reversed here, the card only in MultiCobros. */
export function CardRefundConfirm({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="space-y-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-ink">
      <p>
        Esta recarga se pagó con tarjeta. «Devolver» aquí solo descuenta el saldo de cafetería:
        la devolución del cargo a la tarjeta se hace en <strong>MultiCobros (Banorte)</strong>.
      </p>
      <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-line text-purple focus:ring-purple/40"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        Ya hice la devolución del cargo en MultiCobros
      </label>
    </div>
  );
}
