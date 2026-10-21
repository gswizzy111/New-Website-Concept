/**
 * Customer reviews, transcribed word for word from the "Client Reviews"
 * highlight on @the_card_doc. Keep each quote exactly as the customer wrote
 * it. `card` is the card the message is about; `from` is the customer's
 * handle, or a plain description when the message had no name on it.
 */
export type Review = { quote: string; from: string; card?: string };

/** The headline quote on the home page. `emphasis` is set in full white. */
export const FEATURED_REVIEW = {
  lead: "I was at a card convention last weekend and I had several vendors tell me that you are ",
  emphasis: "the best of the best when it comes to card restoration.",
  from: "@mattyh33",
};

/** The Charizard case study from the highlight. */
export const CASE_STUDY = {
  card: "Charizard",
  paid: "$400",
  grade: "PSA 10",
  worth: "$2,500",
};

export const REVIEWS: Review[] = [
  {
    card: "Charmander",
    quote: "Hey, just got the Charmander back in the mail today and I genuinely can’t believe the transformation. You are a master of your work my man! 🙌🙌 … Going to refer you to my friends ❤️",
    from: "Restoration customer",
  },
  {
    card: "Sold on TCGplayer",
    quote: "The card sold almost instantly on TCG player with pictures. I appreciate your brother. I’m gonna definitely be sending you more cards.",
    from: "@abes_games",
  },
  {
    card: "Umbreon",
    quote: "Umbreon just came in and wow! Looks so much better. You guys killed it, thank you!",
    from: "Restoration customer",
  },
  {
    card: "Charmeleon",
    quote: "Awesome. Thanks! The cards look great and I know the Charmeleon was a tough one. I’ll be looking out for the video. Keep up the hustle!",
    from: "@dealking87",
  },
  {
    card: "Ray",
    quote: "What’s up man! Card came back today and she looks great. The cleaning definitely brought out the natural shine of the holo. I’m sending in another Ray to you tomorrow!",
    from: "Restoration customer",
  },
  {
    card: "Crease restoration",
    quote: "Oh wow thanks man! I see one of the crease restoration photos on there. Miraculous work.",
    from: "Restoration customer",
  },
  {
    card: "7 cards to grading",
    quote: "First rd of cards came back! They are looking amazing. Sending in 7 of them for grading! Thanks again! Will continue to have you service my cards going forward.",
    from: "Repeat customer",
  },
  {
    card: "Charizard",
    quote: "Dude incredible work on the charizard!!! It looks fantastic.",
    from: "Restoration customer",
  },
  {
    card: "Two Rays",
    quote: "Bro. The two rays came back today. Y’all snapped!! Absolutely amazing work bro thank you sm.",
    from: "Repeat customer",
  },
];

/** The one product review in the highlight, shown on the shop page. */
export const KIT_REVIEW: Review = { quote: "Love the kit works great.", from: "Kit customer" };
