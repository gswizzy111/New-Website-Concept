/** A card as the receiving workspace's client components get it (built from IntakeCard). */
export type WorkspaceCard = {
  id: string;
  seq: number | null;
  code: string | null;
  name: string;
  set: string | null;
  year: string | null;
  number: string | null;
  notes: string | null;
  knownDefects: string | null;
  /** Effective tier (card's own, else the order's); null = missing */
  tier: string | null;
  tierName: string;
  /** The tier comes from the card itself (false: from the order) */
  ownTier: boolean;
  refunded: boolean;
  /** Customer photos: full size and the list thumbnail */
  customerPhotos: { url: string; thumb: string }[];
  /** The card catalog's picture (a reference, not the customer's card) */
  referencePhoto: string | null;
  receivingPhotos: string[];
  /** Smaller copies of the receiving photos for the list, by photo URL */
  receivingThumbs: Record<string, string>;
  receivedAt: string | null;
  receivedBy: string | null;
  receivedOn: string | null;
  awaitingArrival: boolean;
  bagId: string | null;
  bagCode: string | null;
  /** "Not started", "Humidor", "Drying", "Done" */
  stageLabel: string;
  round: number;
  completed: boolean;
  /** Any stage recorded (or done): "Mark not received" is no longer offered */
  started: boolean;
  missingImage: boolean;
  missingTier: boolean;
  missingReceivedDate: boolean;
};
