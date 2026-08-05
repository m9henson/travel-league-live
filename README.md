# Travel League Live

A mobile-first live golf scoring app designed for travel league tournaments.

## Features

- Create 9-hole or 18-hole tournaments
- Add players and handicaps
- Enter scores one hole at a time
- Live leaderboard updates across every connected phone
- Share a direct tournament link
- Installable on iPhone/Android as a web app
- Custom course name, date, hole count, and pars

## 1. Create the GitHub repository

1. Sign in to GitHub.
2. Create a new public repository named `travel-league-live`.
3. Upload every file in this project to the repository root.
4. Commit the files.

## 2. Create the free Firebase database

1. Go to Firebase Console and create a project.
2. Add a **Web App** to the project.
3. Copy the Firebase configuration object.
4. Open `firebase-config.js` and replace `null` with the copied configuration object.
5. In Firebase, open **Firestore Database** and create the database.
6. Open Firestore **Rules**, replace the rules with the contents of `firestore.rules`, and publish them.

Example:

```js
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

## 3. Turn on GitHub Pages

1. In the repository, open **Settings** → **Pages**.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Select the `main` branch and `/ (root)` folder.
4. Save.
5. GitHub will provide a live address similar to:
   `https://YOUR-USERNAME.github.io/travel-league-live/`

## iPhone installation

Open the live site in Safari, tap **Share**, then **Add to Home Screen**.

## Important security note

The included Firestore rules are intentionally open so setup is simple for a casual league. Anyone with the site link can edit scores. For a public or paid league, add Firebase Authentication and administrator/scorer permissions.
