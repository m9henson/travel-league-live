# Travel League Live v9 — Secure Group Links + Selected Skins

1. Upload every file in this folder to the GitHub Pages repository root.
2. In Firebase Authentication, Anonymous must be enabled.
3. In Firestore Database > Rules, replace the rules with `firestore.rules` and Publish.
4. Open the normal site on the tournament director phone. Existing tournaments without an owner are claimed by that phone the first time they are opened.
5. Open Setup > Secure Access Links, generate links, and mark the tournament Active.
6. Permanent spectator link: `https://m9henson.github.io/?spectator=1`.

Important: generate links before sharing them. Regenerating links invalidates old links. Keep the administrator link private.


## Skins
In Tournament Setup, the administrator can check Handicap Skin and/or Blind Skin for each hole. Handicap skins use the lowest unique net score. Blind skins use the lowest unique gross score. The Skins tab displays live hole winners and totals.
