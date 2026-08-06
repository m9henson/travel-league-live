# Setup Instructions — Username + Password

## 1. GitHub Pages
1. Delete the old website files from the repository publishing folder.
2. Upload all files from this package to the repository root.
3. In GitHub **Settings > Pages**, publish the `main` branch from `/root`.
4. Wait for deployment and open `https://m9henson.github.io/?v=1.1`.

## 2. Firebase Authentication
1. Firebase Console > **Authentication > Sign-in method**.
2. Keep **Anonymous** enabled.
3. Enable **Email/Password**.
4. Open **Authentication > Users > Add user**.
5. Choose the username you want to type in the app. Example: `m9henson`.
6. In Firebase, enter the matching internal email: `m9henson@ozarktravelstein.app`.
7. Enter the password you want to use and create the user.

The website only shows **Username** and **Password**. It automatically converts `m9henson` to `m9henson@ozarktravelstein.app` before signing in securely through Firebase.

Username rules: 3–30 characters using lowercase letters, numbers, dots, dashes, or underscores. The app converts uppercase letters to lowercase automatically.

## 3. Firestore Rules
1. Firebase Console > **Firestore Database > Rules**.
2. Copy all contents of `firestore.rules`.
3. Replace the existing rules and press **Publish**.

## 4. First tournament
1. Open the website and sign in with only your username and password.
2. Create a tournament.
3. Add players and assign Group 1–6.
4. Setup > choose Handicap Skin and Blind Skin holes.
5. Setup > Generate New Links.
6. Mark the tournament Active and save Setup.
7. Text each group only its own link.
8. Spectators use `https://m9henson.github.io/?spectator=1`.

## 5. Security test
Open a group link in Private Browsing. It should show only that group in score entry. Firestore rules reject writes for players assigned to another group.

## Important
Do not type the internal `@ozarktravelstein.app` address into the app. Type only the username portion.
