import type { CustomerInfo } from "@/lib/types";
import { BLOCK_TITLE, FORM_PANEL, TEXT_ACTION } from "@/components/checkout/form-styles";

/** The customer's contact and address, beside the order summary on the review step. */
export function YourInformation({ customer, onEdit }: { customer: CustomerInfo; onEdit: () => void }) {
  return (
    <div className={`${FORM_PANEL} flex flex-col gap-4`}>
      <div className="flex items-center justify-between">
        <h3 className={`${BLOCK_TITLE} text-[1.375rem] md:text-[1.5rem]`}>Your Information</h3>
        <button type="button" onClick={onEdit} className={TEXT_ACTION}>
          Edit
        </button>
      </div>
      <div className="flex flex-col gap-0.5 text-[15px] leading-relaxed text-ink-soft [overflow-wrap:anywhere]">
        <p className="font-semibold text-ink">{customer.name}</p>
        <p>{customer.email}</p>
        <p>{customer.phone}</p>
        <p>
          {customer.street1}
          {customer.street2 ? `, ${customer.street2}` : ""}
        </p>
        <p>
          {customer.city}, {customer.state} {customer.zip}
        </p>
      </div>
    </div>
  );
}
