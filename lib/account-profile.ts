/** What /api/account/profile returns for the signed-in customer (checkout prefill). */
export type AccountProfile = {
  name: string;
  email: string;
  phone: string;
  address: { street1: string; street2: string; city: string; state: string; zip: string } | null;
};
