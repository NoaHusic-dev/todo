# TODO

Web-aplikacija za zadatke i bilješke. Statičke stranice poslužuju se putem GitHub Pagesa, a prijava i sinkronizacija koriste Firebase Authentication i Cloud Firestore.

## Struktura

```text
.
├── index.html                 # Početna stranica aplikacije
├── privatnost.html            # Pravila privatnosti
├── CNAME                      # Prilagođena domena za GitHub Pages
├── firebase.json              # Firebase CLI konfiguracija
├── firestore.rules            # Pravila pristupa Firestoreu
└── assets/
    ├── css/
    │   ├── styles.css         # Stilovi aplikacije
    │   └── privacy.css        # Stilovi pravila privatnosti
    └── js/
        ├── app.js             # Sučelje i logika zadataka/bilješki
        ├── auth.js            # Prijava i odjava
        └── firebase.js        # Firebase inicijalizacija
```

`index.html`, `CNAME` i `firestore.rules` ostaju u korijenu zbog GitHub Pagesa i uobičajenog Firebase CLI rasporeda. Njihovo premještanje moglo bi prekinuti objavu ili povezane servise.

## Lokalni pregled

U VS Codeu pokreni Live Server na `index.html`. Za Google prijavu lokalnu adresu (npr. `127.0.0.1`) moraš dodati u Firebase Authentication: **Settings → Authorized domains**.

## Objavljivanje Firestore pravila

Nakon prijave u Firebase CLI, objavi pravila naredbom:

```sh
firebase deploy --only firestore:rules --project todo-2fff8
```

Web-stranicu objavi putem GitHub Pagesa iz korijena repozitorija.
