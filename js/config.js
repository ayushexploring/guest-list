/* ============================================================
   GUEST LIST - SETTINGS
   ------------------------------------------------------------
   This is the ONLY file you need to edit.
   ============================================================ */

const CONFIG = {

  /* ---------- 1. HEADINGS ---------- */
  title:    "Guest List",
  subtitle: "Ayush & Yashika · December 11, 2026",

  /* ---------- 2. WHERE THE LIST IS SAVED ----------
     A PRIVATE repository that holds a single guests.json file.
     The file is created automatically on the first save. */
  dataRepo: {
    owner: "ayushexploring",
    repo:  "guest-list-data",
    path:  "guests.json"
  },

  /* ---------- 3. THE LOCKED ACCESS KEY ----------
     Open setup.html, enter your GitHub token and the family
     passcode, then replace  null  below with what it gives you.
     This is encrypted - the real token never appears here. */
  vault: null,

  /* ---------- 4. SIDES ----------
     The ids (bride / groom / both) are what gets saved - change
     only the labels. */
  sides: [
    { id: "bride", label: "Bride's side" },
    { id: "groom", label: "Groom's side" },
    { id: "both",  label: "Both" }
  ],

  /* ---------- 5. STARTER CATEGORIES ----------
     Used only until the very first guest is saved. After that,
     add / rename / delete categories inside the app itself. */
  starterCategories: ["Family", "Relatives", "Friends", "Office", "Neighbours"]
};
